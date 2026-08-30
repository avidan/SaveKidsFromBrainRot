import { useEffect, useMemo, useState } from 'react';
import type { Override } from '../../../shared/types';
import { api } from '../api';

export default function OverridesPage() {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'channel' | 'video'>('channel');
  const [targetId, setTargetId] = useState('');
  const [decision, setDecision] = useState<'allow' | 'block'>('allow');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filterKind, setFilterKind] = useState<'all' | 'channel' | 'video'>('all');
  const [filterDecision, setFilterDecision] = useState<'all' | 'allow' | 'block'>('all');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'az'>('newest');

  const load = async () => {
    try {
      const { overrides } = await api.getOverrides();
      setOverrides(overrides);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overrides
      .filter((o) => (filterKind === 'all' || o.kind === filterKind))
      .filter((o) => (filterDecision === 'all' || o.decision === filterDecision))
      .filter((o) => !q || o.targetId.toLowerCase().includes(q) || (o.note ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort === 'az') return a.targetId.localeCompare(b.targetId);
        return sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
      });
  }, [overrides, query, filterKind, filterDecision, sort]);

  const add = async () => {
    setError('');
    let id = targetId.trim();
    const video = id.match(/[?&]v=([\w-]{6,})/) ?? id.match(/youtu\.be\/([\w-]{6,})/);
    const handle = id.match(/youtube\.com\/(@[\w.-]+)/);
    if (kind === 'video' && video) id = video[1];
    if (kind === 'channel' && handle) id = handle[1];
    if (!id) {
      setError('Enter a channel handle (@name), video ID, or URL');
      return;
    }
    try {
      await api.addOverride(kind, id, decision, 'Added by parent');
      setTargetId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const remove = async (o: Override) => {
    await api.deleteOverride(o.kind, o.targetId);
    await load();
  };

  return (
    <div className="card">
      <h2>Pinned decisions</h2>
      <p className="sub">
        These always win over the AI. Channel handles look like <b>@veritasium</b>; video IDs are
        the 11 characters after <b>watch?v=</b> (URLs work too).
      </p>
      <div className="settings-grid">
        <div>
          <label>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'channel' | 'video')}>
            <option value="channel">Channel</option>
            <option value="video">Video</option>
          </select>
        </div>
        <div>
          <label>Decision</label>
          <select value={decision} onChange={(e) => setDecision(e.target.value as 'allow' | 'block')}>
            <option value="allow">Always allow</option>
            <option value="block">Always block</option>
          </select>
        </div>
      </div>
      <label>Channel / video</label>
      <input
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        placeholder="@veritasium, dQw4w9WgXcQ, or a full URL"
      />
      <button className="primary" onClick={() => void add()}>
        Pin decision
      </button>
      {error && <div className="msg error">{error}</div>}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0 14px' }} />
      <div className="toolbar">
        <input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={filterKind} onChange={(e) => setFilterKind(e.target.value as typeof filterKind)}>
          <option value="all">All types</option>
          <option value="channel">Channels</option>
          <option value="video">Videos</option>
        </select>
        <select value={filterDecision} onChange={(e) => setFilterDecision(e.target.value as typeof filterDecision)}>
          <option value="all">Allow + block</option>
          <option value="allow">Allowed</option>
          <option value="block">Blocked</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="az">A → Z</option>
        </select>
      </div>

      {loading && <div className="empty">Loading…</div>}
      {!loading && overrides.length === 0 && <div className="empty">No pinned decisions yet.</div>}
      {!loading && overrides.length > 0 && visible.length === 0 && (
        <div className="empty">Nothing matches your filters.</div>
      )}
      {visible.map((o) => (
        <div className="item" key={`${o.kind}:${o.targetId}`}>
          <div className="meta">
            <div className="title">
              {o.targetId} <span className={`pill ${o.decision}`}>{o.decision}</span>
            </div>
            <div className="detail">
              {o.kind} · {o.note ?? ''} · {new Date(o.createdAt).toLocaleDateString()}
            </div>
          </div>
          <div className="actions">
            <button className="small" onClick={() => void remove(o)}>
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
