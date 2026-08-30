import { useEffect, useState } from 'react';
import type { ApiKeyInfo } from '../../../shared/types';
import { api, getBackendUrl } from '../api';

export default function ApiPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const backend = getBackendUrl();

  const load = async () => {
    const { keys } = await api.listApiKeys();
    setKeys(keys);
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const keyName = name || 'API key';
    const { key } = await api.createApiKey(keyName);
    setCreated({ name: keyName, key });
    setName('');
    setCopied(null);
    await load();
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? Anything using it (including MCP connections) stops working.')) return;
    await api.revokeApiKey(id);
    if (created) setCreated(null);
    await load();
  };

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(label);
  };

  const mcpUrl = created ? `${backend}/mcp/${created.key}` : `${backend}/mcp/<your-key>`;

  return (
    <>
      <div className="card">
        <h2>API keys</h2>
        <p className="sub">
          Keys give programmatic access to your family's data — same powers as this dashboard.
          Shown once at creation; revoke anytime.
        </p>
        <label>Key name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude MCP" />
        <button className="primary" onClick={() => void create()}>
          Create key
        </button>
        {created && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>“{created.name}” — copy it now, it won't be shown again:</div>
            <code
              style={{
                display: 'block',
                wordBreak: 'break-all',
                background: 'var(--accent-soft)',
                borderRadius: 8,
                padding: '10px 12px',
                margin: '8px 0',
                fontSize: 13,
              }}
            >
              {created.key}
            </code>
            <button className="small" onClick={() => copy('key', created.key)}>
              {copied === 'key' ? 'Copied ✓' : 'Copy key'}
            </button>
          </div>
        )}
        {keys.map((k) => (
          <div className="item" key={k.id}>
            <div className="meta">
              <div className="title">{k.name}</div>
              <div className="detail">
                Created {new Date(k.createdAt).toLocaleDateString()} · last used{' '}
                {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
              </div>
            </div>
            <div className="actions">
              <button className="small block" onClick={() => void revoke(k.id)}>
                Revoke
              </button>
            </div>
          </div>
        ))}
        {keys.length === 0 && <div className="empty">No API keys yet.</div>}
      </div>

      <div className="card">
        <h2>Connect Claude (MCP)</h2>
        <p className="sub">
          Manage everything conversationally — “what did the kids watch today?”, “approve that
          request”, “block that channel”, “pause YouTube for an hour”. Create a key above, then connect:
        </p>
        <label>claude.ai → Settings → Connectors → Add custom connector → URL:</label>
        <code style={{ display: 'block', wordBreak: 'break-all', fontSize: 13, padding: '8px 0' }}>{mcpUrl}</code>
        {created && (
          <button className="small" onClick={() => copy('mcp', mcpUrl)}>
            {copied === 'mcp' ? 'Copied ✓' : 'Copy MCP URL'}
          </button>
        )}
        <label style={{ marginTop: 16 }}>Claude Code:</label>
        <code style={{ display: 'block', wordBreak: 'break-all', fontSize: 13, padding: '8px 0' }}>
          claude mcp add skfbr --transport http {backend}/mcp --header "Authorization: Bearer &lt;your-key&gt;"
        </code>
        <p className="sub" style={{ marginTop: 12 }}>
          Tools exposed: policy &amp; criteria, review queue (list/resolve), overrides, activity,
          screen time, devices, and test-a-URL. The URL form embeds your key — treat that link as a
          secret.
        </p>
      </div>

      <div className="card">
        <h2>REST API</h2>
        <p className="sub">
          Base <code>{backend}/api/v1</code> · header <code>Authorization: Bearer &lt;key&gt;</code>
        </p>
        <div className="detail" style={{ fontSize: 13.5, lineHeight: 2 }}>
          <code>GET /policy</code> · <code>PUT /criteria</code> · <code>POST /pause</code> ·{' '}
          <code>DELETE /pause</code> · <code>GET /review</code> ·{' '}
          <code>POST /review/:id</code> · <code>POST /overrides</code> · <code>GET /activity</code> ·{' '}
          <code>GET /screen-time</code> · <code>GET /devices</code> · <code>POST /test</code>
        </div>
      </div>
    </>
  );
}
