import { system, world } from "@minecraft/server";
import { registerCommands, registerScriptEvents } from "./commands.js";
import { registerLoggerEvents } from "./logger.js";
import { CONFIG } from "./config.js";

system.beforeEvents.startup.subscribe((event) => {
  try {
    registerCommands(event.customCommandRegistry);
  } catch (err) {
    console.warn(`[BlockLogger] Failed to register custom commands: ${err}`);
  }
});

registerLoggerEvents();
registerScriptEvents();

world.afterEvents.worldLoad.subscribe(() => {
  console.warn(
    `[BlockLogger] Ready. Place/break logging is active. Try /${CONFIG.namespace}:help`
  );
});
