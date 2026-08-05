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
   * Soft cap on total retained log entries.
   * Oldest entries are pruned when this is exceeded.
   */
  maxEntries: 8000,

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
   * Optional Bedrock Dedicated Server HTTP endpoint.
   * Leave empty to store logs only in world dynamic properties.
   * Example: "http://127.0.0.1:8787/block-log"
   *
   * Requires @minecraft/server-net on BDS with outbound HTTP enabled.
   * This pack does not depend on server-net by default.
   */
  httpEndpoint: "",
};
