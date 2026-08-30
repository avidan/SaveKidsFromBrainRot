import { useEffect, useState } from 'react';
import type { DeviceInfo } from '../../../shared/types';
import { api, getBackendUrl } from '../api';
import { buildMobileconfig } from '../mobileconfig';

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [deviceName, setDeviceName] = useState('');
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const { devices } = await api.getDevices();
    setDevices(devices);
  };
  useEffect(() => {
    void load();
  }, []);

  const createCode = async () => {
    setMinted(null);
    setProfileFor(null);
    setPairCode(await api.createPairCode(deviceName || 'Kid laptop'));
  };

  const mintToken = async () => {
    setPairCode(null);
    setProfileFor(null);
    setCopied(false);
    const name = deviceName || 'Kid laptop';
    const { deviceToken } = await api.mintDeviceToken(name);
    setMinted({ name, token: deviceToken });
    await load();
  };

  // Mint a token and wrap it in a ready-to-install macOS profile: force-install
  // + auto-pairing + kid-proofing, no MDM needed.
  const downloadProfile = async () => {
    setPairCode(null);
    setMinted(null);
    const name = deviceName || 'Kid laptop';
    const { deviceToken } = await api.mintDeviceToken(name);
    const backendUrl = getBackendUrl() || window.location.origin;
    const xml = buildMobileconfig({ backendUrl, deviceName: name, deviceToken });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/x-apple-aspen-config' }));
    a.download = `skfbr.${slug}.mobileconfig`;
    a.click();
    URL.revokeObjectURL(a.href);
    setProfileFor(name);
    await load();
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this device? It will stop enforcing rules until re-paired.')) return;
    await api.revokeDevice(id);
    await load();
  };

  return (
    <>
      <div className="card">
        <h2>Add a device</h2>
        <p className="sub">
          Two ways in: a <b>pairing code</b> (install the extension on the kid's laptop, open its
          setup page, type the code — expires in 15 minutes), or the <b>Mac setup profile</b> — a
          file you install once on the kid's Mac that force-installs the extension, pairs it, and
          disables incognito, with no MDM needed. MDM users can mint a raw device token instead.
        </p>
        <label>Device name</label>
        <input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Maya's laptop" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="primary" onClick={() => void createCode()}>
            Generate pairing code
          </button>
          <button className="primary" onClick={() => void downloadProfile()}>
            Download Mac setup profile
          </button>
          <button onClick={() => void mintToken()}>Mint MDM device token</button>
        </div>
        {profileFor && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Profile for “{profileFor}” downloaded ✓</div>
            <div className="detail" style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
              On the kid's Mac (no MDM needed): copy the file over, double-click it, then open{' '}
              <b>System Settings → Privacy &amp; Security → Profiles</b>, double-click the pending
              profile, and click <b>Install</b> (admin password required). Restart Chrome — the
              extension installs and pairs itself, and incognito/guest mode are disabled. The
              profile contains this device's credential, so treat the file like a password and
              delete it after installing. To undo everything later, remove the profile from that
              same Profiles screen.
            </div>
          </div>
        )}
        {pairCode && (
          <div>
            <div className="paircode">{pairCode.code}</div>
            <div className="detail" style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
              Expires {new Date(pairCode.expiresAt).toLocaleTimeString()} — type this into the
              extension's setup page on the kid's computer.
            </div>
          </div>
        )}
        {minted && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              Device token for “{minted.name}” — shown once, copy it now:
            </div>
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
              {minted.token}
            </code>
            <button
              className="small"
              onClick={() => {
                void navigator.clipboard.writeText(minted.token);
                setCopied(true);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy token'}
            </button>
            <div className="detail" style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
              Paste it as <b>deviceToken</b> (both places) in this device's .mobileconfig. This is
              a credential, not a pairing code — don't confuse it with the 6-digit codes.
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Paired devices</h2>
        {devices.length === 0 && <div className="empty">No devices paired yet.</div>}
        {devices.map((d) => (
          <div className="item" key={d.id}>
            <div className="meta">
              <div className="title">{d.name}</div>
              <div className="detail">
                Paired {d.pairedAt ? new Date(d.pairedAt).toLocaleDateString() : '—'} · last seen{' '}
                {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}
              </div>
            </div>
            <div className="actions">
              <button className="small block" onClick={() => void revoke(d.id)}>
                Revoke
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
