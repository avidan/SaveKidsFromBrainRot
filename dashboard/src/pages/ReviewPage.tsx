import { useEffect, useMemo, useState } from 'react';
import type { ReviewItem } from '../../../shared/types';
import { api } from '../api';

const SOURCE_LABEL: Record<ReviewItem['source'], string> = {
  ai_unsure: 'AI was unsure',
  ai_block: 'AI blocked',
  kid_request: '🙋 Kid asked',
};

function targetUrl(item: ReviewItem): string {
  return item.kind === 'video'
    ? `https://www.youtube.com/watch?v=${item.targetId}`
    : `https://www.youtube.com/${item.targetId.startsWith('@') ? item.targetId : `channel/${item.targetId}`}`;
}

export default function ReviewPage({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'channel' | 'video'>('all');
  const [source, setSource] = useState<'all' | ReviewItem['source']>('all');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  useEffect(() => {
    void api
      .getReview()
      .then(({ items }) => setItems(items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (kind === 'all' || i.kind === kind))
      .filter((i) => (source === 'all' || i.source === source))
      .filter(
        (i) =>
          !q ||
          i.title.toLowerCase().includes(q) ||
          i.reason.toLowerCase().includes(q) ||
          i.targetId.toLowerCase().includes(q),
      )
      .sort((a, b) => (sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [items, query, kind, source, sort]);

  const resolve = async (id: number, action: 'allow' | 'block' | 'dismiss') => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    onChanged();
    try {
      await api.resolveReview(id, action);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save decision');
    }
  };

  return (
    <div className="card">
      <h2>Review queue</h2>
      <p className="sub">
        Things the AI wasn't sure about, videos it blocked, and requests from your kid. Allow or
        block pins your decision permanently.
      </p>
      <div className="toolbar">
        <input placeholder="Search title, reason, or ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="all">All types</option>
          <option value="video">Videos</option>
          <option value="channel">Channels</option>
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
          <option value="all">All sources</option>
          <option value="kid_request">Kid requests</option>
          <option value="ai_unsure">AI unsure</option>
          <option value="ai_block">AI blocked</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      {error && <div className="msg error">{error}</div>}
      {loading && <div className="empty">Loading…</div>}
      {!loading && !error && items.length === 0 && <div className="empty">All caught up! 🎉</div>}
      {!loading && items.length > 0 && visible.length === 0 && (
        <div className="empty">Nothing matches your filters.</div>
      )}
      {visible.map((item) => (
        <div className="item" key={item.id}>
          {item.kind === 'video' && (
            <a href={targetUrl(item)} target="_blank" rel="noreferrer">
              <img
                className="thumb"
                src={`https://i.ytimg.com/vi/${item.targetId}/mqdefault.jpg`}
                alt=""
                loading="lazy"
              />
            </a>
          )}
          <div className="meta">
            <div className="title">
              <a href={targetUrl(item)} target="_blank" rel="noreferrer">
                {item.title || item.targetId}
              </a>{' '}
              <span className="pill unsure">{SOURCE_LABEL[item.source]}</span>
            </div>
            <div className="detail">
              {item.kind} · {item.reason} · {new Date(item.createdAt).toLocaleString()}
            </div>
          </div>
          <div className="actions">
            <button className="small allow" onClick={() => void resolve(item.id, 'allow')}>
              Allow
            </button>
            <button className="small block" onClick={() => void resolve(item.id, 'block')}>
              Block
            </button>
            <button className="small" onClick={() => void resolve(item.id, 'dismiss')}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
