// Shared types used by the backend (Cloudflare Worker), the Chrome extension,
// and the web dashboard. Imported by relative path from each package.

export type Decision = 'allow' | 'block' | 'unsure';

export interface Verdict {
  decision: Decision;
  confidence: number; // 0..1
  reason: string; // one sentence, parent-readable
  evaluatedAt: number; // epoch ms
  source: 'ai' | 'override' | 'default';
}

export interface ChannelMeta {
  channelId: string; // "@handle" or "UC..." id — whatever the page exposes
  title: string;
  handle?: string;
  description?: string;
  videoTitles?: string[]; // sample of video titles observed for this channel
}

export interface VideoMeta {
  videoId: string;
  title: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  durationSeconds?: number;
  keywords?: string[];
}

export interface NotificationSettings {
  /** ntfy.sh topic name — install the ntfy app, subscribe to this topic, get pushes. */
  ntfyTopic: string | null;
  /** Email address for notifications (requires RESEND_API_KEY on the backend). */
  email: string | null;
  onKidRequest: boolean; // notify when the kid taps "ask my grown-up"
  onAiFlag: boolean; // notify when the AI blocks or is unsure about something new
}

export interface Settings {
  model: string;
  failMode: 'open' | 'closed'; // what to do when backend/AI is unreachable
  channelTtlDays: number; // re-evaluate channels after this many days
  checkAllowedChannels: boolean; // run lightweight video checks even on allowed channels
  dailyLimitMinutes: number | null; // null = no timer
  blockShorts: boolean;
  /** Gate YouTube players embedded on other websites, not just youtube.com. */
  filterEmbeds: boolean;
  notifications: NotificationSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-opus-5',
  failMode: 'closed',
  channelTtlDays: 30,
  checkAllowedChannels: true,
  dailyLimitMinutes: null,
  blockShorts: true,
  filterEmbeds: true,
  notifications: { ntfyTopic: null, email: null, onKidRequest: true, onAiFlag: false },
};

/** Models offered in the dashboard dropdown. */
export const MODEL_CHOICES: Array<{ id: string; label: string }> = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — most capable (recommended)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced quality and cost' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest and cheapest' },
];

export interface Override {
  kind: 'channel' | 'video';
  targetId: string;
  decision: 'allow' | 'block';
  note?: string;
  createdAt: number;
}

export interface Policy {
  criteria: string;
  settings: Settings;
  overrides: Override[];
  /** Epoch ms until which ALL YouTube viewing is paused, or null when not paused. */
  pausedUntil: number | null;
  updatedAt: number;
}

// ---- Device API payloads ----

export interface PairRequest {
  code: string;
  deviceName: string;
}
export interface PairResponse {
  deviceToken: string;
  deviceId: string;
}

export interface EvaluateChannelsRequest {
  channels: ChannelMeta[];
}
export interface EvaluateChannelsResponse {
  verdicts: Record<string, Verdict>; // keyed by channelId
}

export interface EvaluateVideoRequest {
  video: VideoMeta;
  transcriptExcerpt?: string;
}
export interface EvaluateVideoResponse {
  verdict: Verdict;
}

export type EventType = 'watched' | 'blocked' | 'request_access' | 'time_used';
export interface EventInput {
  type: EventType;
  targetKind?: 'channel' | 'video';
  targetId?: string;
  title?: string;
  detail?: Record<string, unknown>;
}

// ---- Dashboard API payloads ----

export interface ReviewItem {
  id: number;
  kind: 'channel' | 'video';
  targetId: string;
  title: string;
  reason: string;
  source: 'ai_unsure' | 'ai_block' | 'kid_request';
  status: 'pending' | 'resolved';
  createdAt: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  pairedAt: number | null;
  lastSeenAt: number | null;
}

export interface ActivityEvent {
  id: number;
  deviceName: string;
  type: EventType;
  targetKind?: 'channel' | 'video';
  targetId?: string;
  title?: string;
  detail?: Record<string, unknown>;
  createdAt: number;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface ScreenTimeEntry {
  deviceName: string;
  secondsToday: number;
}

export interface ExportBundle {
  version: 1;
  exportedAt: number;
  criteria: string;
  settings: Settings;
  overrides: Override[];
}

export interface TestRequest {
  url: string; // a YouTube video or channel URL
}
export interface TestResponse {
  kind: 'channel' | 'video';
  extracted: ChannelMeta | VideoMeta;
  verdict: Verdict;
}
