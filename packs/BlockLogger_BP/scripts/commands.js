import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  world,
} from "@minecraft/server";
import { CONFIG } from "./config.js";
import { formatEntryLine, toPublicJson } from "./format.js";
import { getMeta, queryEntries } from "./storage.js";
import { parseDuration, nowMs } from "./time.js";
import {
  findRollbackCandidates,
  runRollback,
  runRestore,
  rollbackPlayerSince,
} from "./rollback.js";

/**
 * @typedef {import("./format.js").LogEntry} LogEntry
 * @typedef {import("@minecraft/server").CustomCommandOrigin} CustomCommandOrigin
 */

/**
 * @param {CustomCommandOrigin} origin
 * @returns {Player | undefined}
 */
function getPlayer(origin) {
  const source = origin.initiator ?? origin.sourceEntity;
  if (source instanceof Player) return source;
  return undefined;
}

/**
 * Operator-ish check for chat-prefix admin actions (stable API).
 * @param {Player} player
 * @returns {boolean}
 */
function canManageWorld(player) {
  try {
    const level = player.commandPermissionLevel;
    // Any / GameDirectors / Admin / Host / Owner — treat above Any as allowed.
    if (level !== undefined && level !== CommandPermissionLevel.Any) {
      return true;
    }
  } catch {
    // fall through
  }
  try {
    if (typeof player.isOp === "function" && player.isOp()) return true;
  } catch {
    // fall through
  }
  return false;
}

/**
 * @param {Player} player
 * @param {LogEntry[]} entries
 * @param {string} title
 */
function sendLookupResults(player, entries, title) {
  if (!entries.length) {
    player.sendMessage(`§e[BlockLogger] ${title}: no matches.`);
    return;
  }
  player.sendMessage(`§a[BlockLogger] ${title} (§f${entries.length}§a):`);
  const now = nowMs();
  for (const entry of entries) {
    player.sendMessage(formatEntryLine(entry, { now }));
  }
}

/**
 * Inspect the block the player is looking at.
 * @param {Player} player
 */
function inspectLook(player) {
  const hit = player.getBlockFromViewDirection({ maxDistance: 8 });
  if (!hit?.block) {
    player.sendMessage("§e[BlockLogger] Look at a block within 8 blocks.");
    return;
  }

  const { block } = hit;
  const x = block.x;
  const y = block.y;
  const z = block.z;
  const dim = block.dimension.id;

  const entries = queryEntries(
    (e) => e.x === x && e.y === y && e.z === z && e.d === dim,
    { limit: CONFIG.lookupLimit }
  );

  sendLookupResults(player, entries, `History at ${x} ${y} ${z}`);

  if (entries[0]) {
    player.sendMessage(
      `§7Latest: §f${entries[0].p} §7${entries[0].a === "p" ? "placed" : "broke"} §b${entries[0].b}`
    );
  }
}

/**
 * @param {Player} player
 * @param {string} name
 * @param {number} [limit]
 */
function lookupPlayer(player, name, limit = CONFIG.lookupLimit) {
  const needle = name.toLowerCase();
  const entries = queryEntries((e) => e.p.toLowerCase() === needle, { limit });
  sendLookupResults(player, entries, `Actions by ${name}`);
}

/**
 * @param {Player} player
 * @param {number} radius
 */
function lookupNear(player, radius) {
  const r = Math.min(Math.max(1, radius), CONFIG.maxNearRadius);
  const cx = Math.floor(player.location.x);
  const cy = Math.floor(player.location.y);
  const cz = Math.floor(player.location.z);
  const dim = player.dimension.id;
  const r2 = r * r;

  const entries = queryEntries(
    (e) => {
      if (e.d !== dim) return false;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const dz = e.z - cz;
      return dx * dx + dy * dy + dz * dz <= r2;
    },
    { limit: CONFIG.lookupLimit }
  );

  sendLookupResults(player, entries, `Near ${cx} ${cy} ${cz} r=${r}`);
}

/**
 * @param {Player} player
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function lookupCoords(player, x, y, z) {
  const dim = player.dimension.id;
  const entries = queryEntries(
    (e) => e.x === x && e.y === y && e.z === z && e.d === dim,
    { limit: CONFIG.lookupLimit }
  );
  sendLookupResults(player, entries, `History at ${x} ${y} ${z}`);
}

/**
 * @param {Player} player
 */
function showStats(player) {
  const meta = getMeta();
  player.sendMessage(
    `§a[BlockLogger] Entries: §f${meta.count}§a · Chunks: §f${meta.chunks}§a · Next ID: §f${meta.nextId}§a · Cap: §f${CONFIG.maxEntries > 0 ? CONFIG.maxEntries : "unlimited"}`
  );
}

/**
 * @param {Player} player
 */
function showHelp(player) {
  const ns = CONFIG.namespace;
  const prefix = CONFIG.chatPrefix;
  player.sendMessage("§a[BlockLogger] No experiments required. Commands:");
  player.sendMessage(`§f/${ns}:inspect §7or §f${prefix} inspect`);
  player.sendMessage(`§f/${ns}:lookup <player> §7or §f${prefix} lookup <player>`);
  player.sendMessage(`§f/${ns}:near [radius] §7or §f${prefix} near [radius]`);
  player.sendMessage(`§f/${ns}:coords <x> <y> <z>`);
  player.sendMessage(`§f/${ns}:rollback <player> <time> §7e.g. Finn 1h`);
  player.sendMessage(`§f/${ns}:rollbackhere <time> [radius]`);
  player.sendMessage(`§f/${ns}:restore <id>`);
  player.sendMessage(`§f/${ns}:stats §7· §f/${ns}:export <player> §7· §f${prefix} help`);
  player.sendMessage(`§f${prefix} dump [n] §7- prepare logs for PC file export`);
  player.sendMessage(`§f${prefix} dumpchat [n] §7- raw JSON in chat (hard to copy)`);
  player.sendMessage("§7Logs place/break, fire, water/lava, explosions, chests, kills.");
  player.sendMessage("§7Time formats: §f30s§7, §f5m§7, §f2h§7, §f1d§7, §f1w");
}

/**
 * @param {Player} player
 * @param {string} name
 */
function exportLatest(player, name) {
  const needle = name.toLowerCase();
  const entries = queryEntries((e) => e.p.toLowerCase() === needle, { limit: 1 });
  if (!entries.length) {
    player.sendMessage(`§e[BlockLogger] No entries for ${name}.`);
    return;
  }
  player.sendMessage(`§a[BlockLogger] JSON:\n§f${JSON.stringify(toPublicJson(entries[0]))}`);
}

/**
 * Dump events. Prefer PC file export — chat copy is painful.
 * Also re-emits BLJSON lines into Minecraft's content log for tools/pull-minecraft-logs.mjs.
 * @param {Player} player
 * @param {number} [limit] optional; omit / 0 = all entries
 */
function dumpRecent(player, limit) {
  const raw = Number(limit);
  const unlimited = limit === undefined || limit === null || limit === "" || raw === 0;
  const entries = unlimited
    ? queryEntries(() => true, { unlimited: true })
    : queryEntries(() => true, { limit: Math.max(1, raw) });
  if (!entries.length) {
    player.sendMessage("§e[BlockLogger] No events to dump yet. Place/break a few blocks first.");
    return;
  }

  // Re-print into content/script log so a PC helper can turn them into real files.
  for (const entry of entries) {
    console.warn(`BLJSON:${JSON.stringify(toPublicJson(entry))}`);
  }

  player.sendMessage(`§a[BlockLogger] §f${entries.length}§a events ready (no cap).`);
  player.sendMessage(
    "§eEasiest (PC): §frun §btools\\export-logs.cmd§f — creates §blogs/blocklogger/latest.json§f"
  );
  player.sendMessage("§7Or: §fnode tools/pull-minecraft-logs.mjs --open");
  player.sendMessage(
    "§7Chat paste (hard): §f!bl dumpchat§7 dumps raw JSON here for the website Import box."
  );
}

/**
 * Raw JSON dump into chat (last resort for website paste).
 * @param {Player} player
 * @param {number} [limit] optional; omit / 0 = all entries
 */
function dumpChat(player, limit) {
  const raw = Number(limit);
  const unlimited = limit === undefined || limit === null || limit === "" || raw === 0;
  const entries = unlimited
    ? queryEntries(() => true, { unlimited: true })
    : queryEntries(() => true, { limit: Math.max(1, raw) });
  if (!entries.length) {
    player.sendMessage("§e[BlockLogger] No events to dump yet.");
    return;
  }
  const payload = entries.map((e) => toPublicJson(e));
  player.sendMessage(
    `§a[BlockLogger] Chat dump (§f${payload.length}§a). Select/copy below into the website Import box:`
  );
  const text = JSON.stringify(payload);
  const chunkSize = 180;
  for (let i = 0; i < text.length; i += chunkSize) {
    player.sendMessage(`§f${text.slice(i, i + chunkSize)}`);
  }
}

/**
 * Shared action router used by slash commands, chat prefix, and scriptevents.
 * @param {Player} player
 * @param {string} action
 * @param {string[]} parts
 */
export function handleAction(player, action, parts = []) {
  switch (action) {
    case "help":
      showHelp(player);
      break;
    case "inspect":
      inspectLook(player);
      break;
    case "lookup":
      if (!parts[0]) {
        player.sendMessage(`§eUsage: ${CONFIG.chatPrefix} lookup <player>`);
        break;
      }
      lookupPlayer(player, parts[0], Number(parts[1]) || CONFIG.lookupLimit);
      break;
    case "near":
      lookupNear(player, Number(parts[0]) || CONFIG.defaultNearRadius);
      break;
    case "coords":
      if (parts.length < 3) {
        player.sendMessage(`§eUsage: ${CONFIG.chatPrefix} coords <x> <y> <z>`);
        break;
      }
      lookupCoords(player, Number(parts[0]), Number(parts[1]), Number(parts[2]));
      break;
    case "rollback":
      if (parts.length < 2) {
        player.sendMessage(`§eUsage: ${CONFIG.chatPrefix} rollback <player> <time>`);
        break;
      }
      {
        const duration = parseDuration(parts[1]);
        if (duration === undefined) {
          player.sendMessage("§cInvalid time. Use 30s, 5m, 2h, 1d, or 1w.");
          break;
        }
        if (!canManageWorld(player)) {
          player.sendMessage("§c[BlockLogger] Rollback requires operator permission.");
          break;
        }
        rollbackPlayerSince(player, parts[0], duration);
      }
      break;
    case "rollbackhere":
      {
        const duration = parseDuration(parts[0]);
        if (duration === undefined) {
          player.sendMessage("§cInvalid time. Use 30s, 5m, 2h, 1d, or 1w.");
          break;
        }
        if (!canManageWorld(player)) {
          player.sendMessage("§c[BlockLogger] Rollback requires operator permission.");
          break;
        }
        const r = Math.min(
          Math.max(1, Number(parts[1]) || CONFIG.defaultNearRadius),
          CONFIG.maxNearRadius
        );
        const candidates = findRollbackCandidates({
          sinceMs: nowMs() - duration,
          cx: Math.floor(player.location.x),
          cy: Math.floor(player.location.y),
          cz: Math.floor(player.location.z),
          radius: r,
          dimensionId: player.dimension.id,
        });
        runRollback(player, candidates);
      }
      break;
    case "restore":
      if (!parts[0]) {
        player.sendMessage(`§eUsage: ${CONFIG.chatPrefix} restore <id>`);
        break;
      }
      if (!canManageWorld(player)) {
        player.sendMessage("§c[BlockLogger] Restore requires operator permission.");
        break;
      }
      runRestore(player, Number(parts[0]));
      break;
    case "stats":
      showStats(player);
      break;
    case "export":
      if (!parts[0]) {
        player.sendMessage(`§eUsage: ${CONFIG.chatPrefix} export <player>`);
        break;
      }
      exportLatest(player, parts[0]);
      break;
    case "dump":
      dumpRecent(player, parts[0] !== undefined ? Number(parts[0]) : undefined);
      break;
    case "dumpchat":
      dumpChat(player, parts[0] !== undefined ? Number(parts[0]) : undefined);
      break;
    default:
      player.sendMessage(`§eUnknown BlockLogger action: ${action}. Try ${CONFIG.chatPrefix} help`);
  }
}

/**
 * Register slash commands (stable Script API — no Beta APIs experiment).
 * @param {import("@minecraft/server").CustomCommandRegistry} registry
 */
export function registerCommands(registry) {
  const ns = CONFIG.namespace;

  registry.registerCommand(
    {
      name: `${ns}:help`,
      description: "Show BlockLogger command help",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
    },
    (origin) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      system.run(() => handleAction(player, "help"));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:inspect`,
      description: "Show who last changed the block you are looking at",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
    },
    (origin) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      system.run(() => handleAction(player, "inspect"));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:lookup`,
      description: "Show recent block actions by a player",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      mandatoryParameters: [{ name: "player", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "limit", type: CustomCommandParamType.Integer }],
    },
    (origin, playerName, limit) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      const args = [playerName];
      if (limit !== undefined) args.push(String(limit));
      system.run(() => handleAction(player, "lookup", args));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:near`,
      description: "Show recent block actions near you",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ name: "radius", type: CustomCommandParamType.Integer }],
    },
    (origin, radius) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      const args = radius !== undefined ? [String(radius)] : [];
      system.run(() => handleAction(player, "near", args));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:coords`,
      description: "Show block history at specific coordinates",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      mandatoryParameters: [
        { name: "x", type: CustomCommandParamType.Integer },
        { name: "y", type: CustomCommandParamType.Integer },
        { name: "z", type: CustomCommandParamType.Integer },
      ],
    },
    (origin, x, y, z) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      system.run(() => handleAction(player, "coords", [String(x), String(y), String(z)]));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:rollback`,
      description: "Rollback a player's block changes within a time window",
      permissionLevel: CommandPermissionLevel.Admin,
      cheatsRequired: true,
      mandatoryParameters: [
        { name: "player", type: CustomCommandParamType.String },
        { name: "time", type: CustomCommandParamType.String },
      ],
    },
    (origin, playerName, timeText) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      if (parseDuration(timeText) === undefined) {
        return {
          status: CustomCommandStatus.Failure,
          message: "Invalid time. Use 30s, 5m, 2h, 1d, or 1w.",
        };
      }
      system.run(() => handleAction(player, "rollback", [playerName, timeText]));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:rollbackhere`,
      description: "Rollback block changes near you within a time window",
      permissionLevel: CommandPermissionLevel.Admin,
      cheatsRequired: true,
      mandatoryParameters: [{ name: "time", type: CustomCommandParamType.String }],
      optionalParameters: [{ name: "radius", type: CustomCommandParamType.Integer }],
    },
    (origin, timeText, radius) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      if (parseDuration(timeText) === undefined) {
        return {
          status: CustomCommandStatus.Failure,
          message: "Invalid time. Use 30s, 5m, 2h, 1d, or 1w.",
        };
      }
      const args = [timeText];
      if (radius !== undefined) args.push(String(radius));
      system.run(() => handleAction(player, "rollbackhere", args));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:restore`,
      description: "Undo a previous BlockLogger rollback batch",
      permissionLevel: CommandPermissionLevel.Admin,
      cheatsRequired: true,
      mandatoryParameters: [{ name: "id", type: CustomCommandParamType.Integer }],
    },
    (origin, id) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      system.run(() => handleAction(player, "restore", [String(id)]));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:stats`,
      description: "Show BlockLogger storage statistics",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
    },
    (origin) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      system.run(() => handleAction(player, "stats"));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:export`,
      description: "Dump the latest log entry for a player as JSON",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      mandatoryParameters: [{ name: "player", type: CustomCommandParamType.String }],
    },
    (origin, playerName) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      system.run(() => handleAction(player, "export", [playerName]));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:dump`,
      description: "Prepare recent events for PC JSON file export",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ name: "limit", type: CustomCommandParamType.Integer }],
    },
    (origin, limit) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      const args = limit !== undefined ? [String(limit)] : [];
      system.run(() => handleAction(player, "dump", args));
      return { status: CustomCommandStatus.Success };
    }
  );

  registry.registerCommand(
    {
      name: `${ns}:dumpchat`,
      description: "Dump recent events as raw JSON in chat (hard to copy)",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ name: "limit", type: CustomCommandParamType.Integer }],
    },
    (origin, limit) => {
      const player = getPlayer(origin);
      if (!player) {
        return { status: CustomCommandStatus.Failure, message: "Players only." };
      }
      const args = limit !== undefined ? [String(limit)] : [];
      system.run(() => handleAction(player, "dumpchat", args));
      return { status: CustomCommandStatus.Success };
    }
  );
}

/**
 * Chat prefix commands: "!bl help", "!bl lookup Finn", etc.
 * Works on existing worlds with no experiments and no slash-command registration.
 */
export function registerChatCommands() {
  const prefix = CONFIG.chatPrefix.toLowerCase();

  world.beforeEvents.chatSend.subscribe((event) => {
    const message = (event.message ?? "").trim();
    const lower = message.toLowerCase();
    if (!lower.startsWith(prefix)) return;

    const rest = message.slice(prefix.length).trim();
    if (!rest && lower !== prefix) return;

    event.cancel = true;
    const player = event.sender;
    const tokens = rest ? rest.split(/\s+/) : [];
    const action = (tokens.shift() || "help").toLowerCase();

    system.run(() => handleAction(player, action, tokens));
  });
}

/**
 * Fallback via /scriptevent blocklogger:<action> <args>
 */
export function registerScriptEvents() {
  system.afterEvents.scriptEventReceive.subscribe(
    (event) => {
      const player =
        event.initiator instanceof Player
          ? event.initiator
          : event.sourceEntity instanceof Player
            ? event.sourceEntity
            : undefined;
      if (!player) return;

      const id = event.id;
      const message = (event.message ?? "").trim();
      const parts = message ? message.split(/\s+/) : [];
      const action = id.includes(":") ? id.split(":")[1] : id;

      system.run(() => handleAction(player, action, parts));
    },
    { namespaces: [CONFIG.namespace] }
  );
}
