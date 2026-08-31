// Which criteria mode is in force right now, evaluated in the family's own
// timezone. The weekend is a weekly window from (weekendStartDay, time) to
// (weekendEndDay, time), wrapping across the Saturday/Sunday boundary — the
// default is Friday 12:00 → Monday 00:00.

import type { CriteriaMode, Policy, Settings } from '../../shared/types';

const DAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const WEEK_MINUTES = 7 * 24 * 60;

function parseHHMM(time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? '');
  if (!m) return 0;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/** Minutes since the week started (Sunday 00:00) in the given timezone. */
function weekMinutesIn(timezone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  let day = 0;
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'weekday') day = DAY_INDEX[p.value] ?? 0;
    if (p.type === 'hour') hour = Number(p.value);
    if (p.type === 'minute') minute = Number(p.value);
  }
  return day * 24 * 60 + hour * 60 + minute;
}

export function activeMode(settings: Settings, at: number = Date.now()): CriteriaMode {
  const s = settings.schedule;
  if (!s?.enabled) return 'week';
  let nowW: number;
  try {
    nowW = weekMinutesIn(s.timezone, at);
  } catch {
    return 'week'; // invalid timezone — fail to the stricter default
  }
  const start = (s.weekendStartDay % 7) * 24 * 60 + parseHHMM(s.weekendStartTime);
  const end = (s.weekendEndDay % 7) * 24 * 60 + parseHHMM(s.weekendEndTime);
  if (start === end) return 'week';
  const inWindow =
    start < end ? nowW >= start && nowW < end : nowW >= start || nowW < end; // window wraps the week
  return inWindow ? 'weekend' : 'week';
}

/** The criteria text to judge with in the given mode (weekend falls back to week). */
export function criteriaFor(policy: Pick<Policy, 'criteria' | 'weekendCriteria'>, mode: CriteriaMode): string {
  if (mode === 'weekend' && policy.weekendCriteria.trim()) return policy.weekendCriteria;
  return policy.criteria;
}

/**
 * The mode to evaluate and cache under. When the weekend has no criteria of
 * its own, everything runs as 'week' so the two caches stay unified.
 */
export function effectiveMode(policy: Policy, at: number = Date.now()): CriteriaMode {
  if (!policy.weekendCriteria.trim()) return 'week';
  return activeMode(policy.settings, at);
}
