import { system, world } from "@minecraft/server";
import {
  registerChatCommands,
  registerCommands,
  registerScriptEvents,
} from "./commands.js";
import { registerLoggerEvents } from "./logger.js";
import { CONFIG } from "./config.js";

// Stable @minecraft/server only — Beta APIs experiment is NOT required.
system.beforeEvents.startup.subscribe((event) => {
  try {
    registerCommands(event.customCommandRegistry);
  } catch (err) {
    console.warn(
      `[BlockLogger] Custom slash commands unavailable (${err}). Use chat: ${CONFIG.chatPrefix} help`
    );
  }
});

registerLoggerEvents();
try {
  registerChatCommands();
} catch (err) {
  console.warn(`[BlockLogger] Chat prefix unavailable (${err}). Use /${CONFIG.namespace}:help`);
}
registerScriptEvents();

world.afterEvents.worldLoad.subscribe(() => {
  console.warn(
    `[BlockLogger] Ready (no experiments needed). Try ${CONFIG.chatPrefix} help or /${CONFIG.namespace}:help`
  );
  try {
    world.sendMessage(
      `§a[BlockLogger] §fLogging on. Type §e${CONFIG.chatPrefix} help§f — no Beta APIs required.`
    );
  } catch {
    // ignore if messaging is restricted this tick
  }
});
