/**
 * BlockLogger configuration.
 * Adjust these values for your world's size and activity.
 */
export const CONFIG = {
  /** Namespace used for custom commands and script events. */
  namespace: "blocklogger",

  /** Chat prefix commands, e.g. "!bl help" — no experiments / no slash needed. */
  chatPrefix: "!bl",

  /**
   * Max characters stored in a single world dynamic property chunk.
   * Bedrock string dynamic properties allow up to 32767; stay under that.
   */
  chunkCharLimit: 30000,

  /**
   * Soft cap on retained log entries.
   * Set to 0 for unlimited (no pruning). Minecraft world storage still has
   * a hard engine limit eventually, but we won't delete old entries ourselves.
   */
  maxEntries: 0,

  /** How many matching entries to show in chat lookups by default. */
  lookupLimit: 12,

  /** Default radius (blocks) for /near when omitted. */
  defaultNearRadius: 8,

  /** Max radius allowed for /near. */
  maxNearRadius: 64,

  /** Max blocks changed by a single rollback/restore job. */
  maxRollbackBlocks: 2000,

  /** Yield to the engine every N block writes during rollback. */
  rollbackBatchSize: 25,

  /**
   * When true, also echo each logged action to the content log
   * (useful while testing; leave false on busy realms).
   */
  debugConsole: false,

  /**
   * Emit BLJSON:... lines for tools/bds-bridge.mjs to scrape.
   * Enable on Bedrock Dedicated Server when you run the dashboard bridge.
   * Does NOT require Beta APIs.
   */
  bridgeConsole: true,

  /**
   * Optional direct HTTP endpoint (if your runtime provides fetch), e.g.
   * "http://127.0.0.1:8787/api/logs" or ".../block-log".
   * Prefer bridgeConsole + tools/bds-bridge.mjs on stock BDS.
   */
  httpEndpoint: "",

  /** Shared secret sent as X-BlockLogger-Key when httpEndpoint is set. */
  httpApiKey: "",

  /**
   * Items that count as "setting something on fire" when used on a block.
   */
  fireTools: ["minecraft:flint_and_steel", "minecraft:fire_charge"],

  /**
   * Block ids that are fire itself (also caught via place events).
   */
  fireBlocks: ["minecraft:fire", "minecraft:soul_fire"],

  /**
   * Full bucket → fluid block placed when emptied.
   * (Creative mode may keep the full bucket; we still scan for the fluid.)
   */
  liquidPlaceBuckets: {
    "minecraft:water_bucket": "minecraft:water",
    "minecraft:lava_bucket": "minecraft:lava",
    "minecraft:powder_snow_bucket": "minecraft:powder_snow",
  },

  /**
   * Empty bucket → fluid removed when filled.
   */
  liquidPickupResults: {
    "minecraft:water_bucket": "minecraft:water",
    "minecraft:lava_bucket": "minecraft:lava",
    "minecraft:powder_snow_bucket": "minecraft:powder_snow",
  },

  /**
   * Block ids treated as liquids / fluid sources for logging + dedupe.
   */
  liquidBlocks: [
    "minecraft:water",
    "minecraft:lava",
    "minecraft:flowing_water",
    "minecraft:flowing_lava",
    "minecraft:powder_snow",
  ],

  /** Log blocks destroyed by TNT / creepers / beds / crystals / etc. */
  logExplosions: true,

  /** Log who opens chests, barrels, shulkers, hoppers, furnaces, … */
  logContainerOpens: true,

  /**
   * Log kills when a player is the killer or victim, or the victim type
   * is in killLogEntities (armor stands, villagers, frames, …).
   */
  logKills: true,

  /**
   * Entity type ids always logged on death (even if no player involved).
   * Keep this short — mob farms would flood storage otherwise.
   */
  killLogEntities: [
    "minecraft:armor_stand",
    "minecraft:villager",
    "minecraft:wandering_trader",
    "minecraft:iron_golem",
    "minecraft:item_frame",
    "minecraft:glow_item_frame",
    "minecraft:painting",
    "minecraft:minecart",
    "minecraft:chest_minecart",
    "minecraft:hopper_minecart",
    "minecraft:tnt_minecart",
    "minecraft:boat",
    "minecraft:chest_boat",
  ],

  /**
   * Block type ids (or suffixes) treated as containers when right-clicked.
   * Full ids and simple includes() needles are both supported.
   */
  containerBlocks: [
    "minecraft:chest",
    "minecraft:trapped_chest",
    "minecraft:barrel",
    "minecraft:hopper",
    "minecraft:dropper",
    "minecraft:dispenser",
    "minecraft:furnace",
    "minecraft:blast_furnace",
    "minecraft:smoker",
    "minecraft:brewing_stand",
    "minecraft:ender_chest",
    "shulker_box",
  ],
};
