import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
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

  sendLookupResults(
    player,
    entries,
    `History at ${x} ${y} ${z}`
  );

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
  const { x: cx, y: cy, z: cz } = {
    x: Math.floor(player.location.x),
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z),
  };
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
    `§a[BlockLogger] Entries: §f${meta.count}§a · Chunks: §f${meta.chunks}§a · Next ID: §f${meta.nextId}§a · Soft cap: §f${CONFIG.maxEntries}`
  );
}

/**
 * @param {Player} player
 */
function showHelp(player) {
  const ns = CONFIG.namespace;
  player.sendMessage("§a[BlockLogger] Commands:");
  player.sendMessage(`§f/${ns}:inspect §7- history of the block you look at`);
  player.sendMessage(`§f/${ns}:lookup <player> §7- recent actions by player`);
  player.sendMessage(`§f/${ns}:near [radius] §7- recent actions near you`);
  player.sendMessage(`§f/${ns}:coords <x> <y> <z> §7- history at coordinates`);
  player.sendMessage(`§f/${ns}:rollback <player> <time> §7- e.g. Finn 1h`);
  player.sendMessage(`§f/${ns}:rollbackhere <time> [radius] §7- rollback near you`);
  player.sendMessage(`§f/${ns}:restore <id> §7- undo a rollback batch`);
  player.sendMessage(`§f/${ns}:stats §7- storage usage`);
  player.sendMessage(`§f/${ns}:export §7- dump latest match as JSON in chat`);
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
 * Register slash commands.
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
      system.run(() => showHelp(player));
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
      system.run(() => inspectLook(player));
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
      system.run(() =>
        lookupPlayer(player, playerName, limit ?? CONFIG.lookupLimit)
      );
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
      system.run(() =>
        lookupNear(player, radius ?? CONFIG.defaultNearRadius)
      );
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
      system.run(() => lookupCoords(player, x, y, z));
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
      const duration = parseDuration(timeText);
      if (duration === undefined) {
        return {
          status: CustomCommandStatus.Failure,
          message: "Invalid time. Use 30s, 5m, 2h, 1d, or 1w.",
        };
      }
      system.run(() => rollbackPlayerSince(player, playerName, duration));
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
      const duration = parseDuration(timeText);
      if (duration === undefined) {
        return {
          status: CustomCommandStatus.Failure,
          message: "Invalid time. Use 30s, 5m, 2h, 1d, or 1w.",
        };
      }
      const r = Math.min(
        Math.max(1, radius ?? CONFIG.defaultNearRadius),
        CONFIG.maxNearRadius
      );
      system.run(() => {
        const sinceMs = nowMs() - duration;
        const candidates = findRollbackCandidates({
          sinceMs,
          cx: Math.floor(player.location.x),
          cy: Math.floor(player.location.y),
          cz: Math.floor(player.location.z),
          radius: r,
          dimensionId: player.dimension.id,
        });
        runRollback(player, candidates);
      });
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
      system.run(() => runRestore(player, id));
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
      system.run(() => showStats(player));
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
      system.run(() => exportLatest(player, playerName));
      return { status: CustomCommandStatus.Success };
    }
  );
}

/**
 * Fallback interface via /scriptevent for environments without custom command UX.
 * Examples:
 *   /scriptevent blocklogger:help
 *   /scriptevent blocklogger:lookup Finn
 *   /scriptevent blocklogger:rollback Finn 1h
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

      const id = event.id; // e.g. blocklogger:lookup
      const message = (event.message ?? "").trim();
      const parts = message ? message.split(/\s+/) : [];
      const action = id.includes(":") ? id.split(":")[1] : id;

      system.run(() => {
        switch (action) {
          case "help":
            showHelp(player);
            break;
          case "inspect":
            inspectLook(player);
            break;
          case "lookup":
            if (!parts[0]) {
              player.sendMessage("§eUsage: /scriptevent blocklogger:lookup <player>");
              break;
            }
            lookupPlayer(player, parts[0], Number(parts[1]) || CONFIG.lookupLimit);
            break;
          case "near":
            lookupNear(player, Number(parts[0]) || CONFIG.defaultNearRadius);
            break;
          case "coords":
            if (parts.length < 3) {
              player.sendMessage("§eUsage: /scriptevent blocklogger:coords <x> <y> <z>");
              break;
            }
            lookupCoords(player, Number(parts[0]), Number(parts[1]), Number(parts[2]));
            break;
          case "rollback":
            if (parts.length < 2) {
              player.sendMessage("§eUsage: /scriptevent blocklogger:rollback <player> <time>");
              break;
            }
            {
              const duration = parseDuration(parts[1]);
              if (duration === undefined) {
                player.sendMessage("§cInvalid time. Use 30s, 5m, 2h, 1d, or 1w.");
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
              player.sendMessage("§eUsage: /scriptevent blocklogger:restore <id>");
              break;
            }
            runRestore(player, Number(parts[0]));
            break;
          case "stats":
            showStats(player);
            break;
          case "export":
            if (!parts[0]) {
              player.sendMessage("§eUsage: /scriptevent blocklogger:export <player>");
              break;
            }
            exportLatest(player, parts[0]);
            break;
          default:
            player.sendMessage(`§eUnknown BlockLogger action: ${action}. Try help.`);
        }
      });
    },
    { namespaces: [CONFIG.namespace] }
  );
}
