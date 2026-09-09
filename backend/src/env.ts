export interface Env {
  DB: D1Database;
  /** Static assets (the built dashboard). Absent on asset-less deploys. */
  ASSETS?: Fetcher;
  /**
   * Optional: when unset, the key stored via the dashboard (server_config
   * table) is used instead — that's the one-click-deploy path. The secret,
   * when present, always wins.
   */
  ANTHROPIC_API_KEY?: string;
  /** Optional: enables email notifications (wrangler secret put RESEND_API_KEY). */
  RESEND_API_KEY?: string;
  /** Optional: the From address for notification emails. */
  NOTIFY_FROM?: string;
  /** Optional: set to 'true' to allow signups beyond the first family (multi-family hosting). */
  OPEN_SIGNUPS?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    familyId: string;
    deviceId: string;
  };
};
