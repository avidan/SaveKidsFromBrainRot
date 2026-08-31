import type { ChannelMeta, Policy, Verdict } from '../../shared/types';

export type BgRequest =
  | { type: 'GET_STATE' }
  | { type: 'EVALUATE_CHANNELS'; channels: ChannelMeta[] }
  | { type: 'EVALUATE_VIDEO'; videoId: string; channelRef?: string; pageTitle?: string }
  | { type: 'HEARTBEAT'; playing: boolean }
  | { type: 'REQUEST_ACCESS'; targetKind: 'channel' | 'video'; targetId: string; title: string }
  | { type: 'REPORT_BLOCKED'; targetKind: 'channel' | 'video'; targetId: string; title: string }
  | { type: 'REPORT_WATCHED'; videoId: string; title: string }
  | { type: 'SYNC_POLICY' }
  | { type: 'PAIR'; backendUrl: string; code: string; deviceName: string }
  | { type: 'UNPAIR' };

export interface StateResponse {
  paired: boolean;
  backendUrl: string | null;
  deviceName: string | null;
  policy: Policy | null;
  remainingSeconds: number | null; // null = no timer configured
}

export interface ChannelVerdictsResponse {
  verdicts: Record<string, Verdict>;
}

export interface VideoVerdictResponse {
  verdict: Verdict;
}

export interface HeartbeatResponse {
  remainingSeconds: number | null;
  /** Epoch ms until which all viewing is paused by a parent, or null. */
  pausedUntil: number | null;
  /** Which criteria mode is in force ('week' | 'weekend') — content re-filters when it flips. */
  activeMode: 'week' | 'weekend';
}

export interface PairResult {
  ok: boolean;
  error?: string;
}
