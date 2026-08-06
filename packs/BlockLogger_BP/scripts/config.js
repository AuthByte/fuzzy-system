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
};
