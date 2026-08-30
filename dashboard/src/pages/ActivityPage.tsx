import { useEffect, useMemo, useState } from 'react';
import type { ActivityEvent } from '../../../shared/types';
import { api } from '../api';

const TYPE_LABEL: Record<ActivityEvent['type'], string> = {
  watched: '▶️ Watched',
  blocked: '🚫 Blocked',
  request_access: '🙋 Asked for',
  time_used: '⏳ Screen time',
};

function fmtMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | ActivityEvent['type']>('all');
  const [device, setDevice] = useState<'all' | string>('all');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return; // don't poll while the tab is backgrounded
      try {
        const { events } = await api.getActivity();
        if (!cancelled) {
          setEvents(events);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = setInterval(load, 15_000); // live view: refresh every 15s
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const devices = useMemo(() => [...new Set(events.map((e) => e.deviceName))].sort(), [events]);

  // Screen time today: the daily counter is cumulative, so take the max per device.
  const screenTimeToday = useMemo(() => {
    const today = new Date().toDateString();
    const byDevice: Record<string, number> = {};
    for (const e of events) {
      if (e.type !== 'time_used') continue;
      if (new Date(e.createdAt).toDateString() !== today) continue;
      const s = Number(e.detail?.secondsToday ?? 0);
      byDevice[e.deviceName] = Math.max(byDevice[e.deviceName] ?? 0, s);
    }
    return Object.entries(byDevice);
  }, [events]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => (type === 'all' || e.type === type))
      .filter((e) => (device === 'all' || e.deviceName === device))
      .filter(
        (e) => !q || (e.title ?? '').toLowerCase().includes(q) || (e.targetId ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => (sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [events, query, type, device, sort]);

  return (
    <div className="card">
      <h2>Activity</h2>
      <p className="sub">What each device has been up to recently. Refreshes automatically every 15 seconds.</p>
      {screenTimeToday.length > 0 && (
        <div className="summary-row">
          {screenTimeToday.map(([name, seconds]) => (
            <span key={name} className="pill">
              ⏳ {name}: {fmtMinutes(seconds)} today
            </span>
          ))}
        </div>
      )}
      <div className="toolbar">
        <input placeholder="Search titles…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="all">All events</option>
          <option value="watched">Watched</option>
          <option value="blocked">Blocked</option>
          <option value="request_access">Requests</option>
          <option value="time_used">Screen time</option>
        </select>
        {devices.length > 1 && (
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            <option value="all">All devices</option>
            {devices.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      {error && <div className="msg error">{error}</div>}
      {loading && <div className="empty">Loading…</div>}
      {!loading && !error && events.length === 0 && <div className="empty">Nothing yet.</div>}
      {!loading && events.length > 0 && visible.length === 0 && (
        <div className="empty">Nothing matches your filters.</div>
      )}
      {visible.map((e) => (
        <div className="item" key={e.id}>
          <div className="meta">
            <div className="title">
              {TYPE_LABEL[e.type]}{' '}
              {e.targetId ? (
                <a
                  href={
                    e.targetKind === 'video'
                      ? `https://www.youtube.com/watch?v=${e.targetId}`
                      : `https://www.youtube.com/${e.targetId}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {e.title || e.targetId}
                </a>
              ) : e.type === 'time_used' ? (
                fmtMinutes(Number(e.detail?.secondsToday ?? 0)) + ' so far that day'
              ) : (
                e.title ?? ''
              )}
            </div>
            <div className="detail">
              {e.deviceName} · {new Date(e.createdAt).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
