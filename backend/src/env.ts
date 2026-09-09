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
  /**
   * Optional: Meta Model API key for Muse Spark models (api.meta.ai).
   * Same precedence as ANTHROPIC_API_KEY: when unset, the key stored via the
   * dashboard (server_config table) is used instead. The secret, when present,
   * always wins.
   */
  META_API_KEY?: string;
  /**
   * Optional: OpenAI API key (api.openai.com). Same precedence as
   * ANTHROPIC_API_KEY: when unset, the key stored via the dashboard
   * (server_config table) is used instead. The secret, when present,
   * always wins.
   */
  OPENAI_API_KEY?: string;
  /**
   * Optional: Google AI Studio API key for Gemini models, via Google's
   * OpenAI-compatible endpoint. Same precedence as ANTHROPIC_API_KEY.
   */
  GOOGLE_API_KEY?: string;
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
