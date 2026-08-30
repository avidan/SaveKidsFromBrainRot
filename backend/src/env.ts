export interface Env {
  DB: D1Database;
  /** Static assets (the built dashboard). Absent on asset-less deploys. */
  ASSETS?: Fetcher;
  ANTHROPIC_API_KEY: string;
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
