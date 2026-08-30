import { useEffect, useRef, useState } from 'react';
import type { ExportBundle, NotificationSettings, Settings, TestResponse } from '../../../shared/types';
import { DEFAULT_SETTINGS, MODEL_CHOICES } from '../../../shared/types';
import { api } from '../api';

const EXAMPLE = `Allow educational content, science experiments, LEGO builds, calm crafts, and nature documentaries suitable for a 7-year-old.

Block gaming rage content, "brainrot"/skibidi-style content, prank channels, unboxing/haul videos, anything with rapid-fire jump cuts engineered for retention, and content with scary or violent themes.`;

export default function CriteriaPage() {
  const [criteria, setCriteria] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);

  const [testUrl, setTestUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [testError, setTestError] = useState('');
  const [backupMsg, setBackupMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const notif: NotificationSettings = settings.notifications ?? DEFAULT_SETTINGS.notifications;
  const setNotif = (patch: Partial<NotificationSettings>) =>
    setSettings({ ...settings, notifications: { ...notif, ...patch } });

  useEffect(() => {
    void api
      .getPolicy()
      .then((p) => {
        setCriteria(p.criteria);
        setSettings({ ...DEFAULT_SETTINGS, ...p.settings });
        setLoaded(true);
      })
      .catch(() => setMsg({ text: 'Could not load policy', kind: 'error' }));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.putPolicy(criteria, settings);
      setMsg({
        text: 'Saved. Existing AI verdicts were reset so everything is re-judged against the new rules.',
        kind: 'ok',
      });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Save failed', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const exportBundle = async () => {
    setBackupMsg(null);
    try {
      const bundle = await api.exportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `skfbr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setBackupMsg({ text: e instanceof Error ? e.message : 'Export failed', kind: 'error' });
    }
  };

  const importBundle = async (file: File) => {
    setBackupMsg(null);
    try {
      const bundle = JSON.parse(await file.text()) as ExportBundle;
      const policy = await api.importBundle(bundle);
      setCriteria(policy.criteria);
      setSettings({ ...DEFAULT_SETTINGS, ...policy.settings });
      setBackupMsg({ text: 'Imported! Rules, settings, and pinned decisions were replaced.', kind: 'ok' });
    } catch (e) {
      setBackupMsg({ text: e instanceof Error ? e.message : 'Import failed', kind: 'error' });
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestError('');
    setTestResult(null);
    try {
      setTestResult(await api.test(testUrl));
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>Your family's rules</h2>
        <p className="sub">
          Written in plain language. The AI judges every channel and video your kid encounters
          against exactly this text.
        </p>
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          placeholder={EXAMPLE}
          disabled={!loaded}
        />
        <div className="settings-grid">
          <div>
            <label>Daily time limit (minutes, blank = none)</label>
            <input
              type="number"
              min={0}
              value={settings.dailyLimitMinutes ?? ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  dailyLimitMinutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                })
              }
            />
          </div>
          <div>
            <label>AI model</label>
            <select
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            >
              {MODEL_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              {!MODEL_CHOICES.some((m) => m.id === settings.model) && (
                <option value={settings.model}>Custom: {settings.model}</option>
              )}
            </select>
          </div>
          <div>
            <label>Re-check channels after (days)</label>
            <input
              type="number"
              min={1}
              value={settings.channelTtlDays}
              onChange={(e) => setSettings({ ...settings, channelTtlDays: Math.max(1, Number(e.target.value)) })}
            />
          </div>
          <div>
            <label>If the AI can't be reached</label>
            <select
              value={settings.failMode}
              onChange={(e) => setSettings({ ...settings, failMode: e.target.value as Settings['failMode'] })}
            >
              <option value="closed">Block unknown content (recommended)</option>
              <option value="open">Allow unknown content</option>
            </select>
          </div>
        </div>
        <div className="checkbox-row">
          <input
            id="shorts"
            type="checkbox"
            checked={settings.blockShorts}
            onChange={(e) => setSettings({ ...settings, blockShorts: e.target.checked })}
          />
          <label htmlFor="shorts" style={{ margin: 0 }}>Block YouTube Shorts entirely</label>
        </div>
        <div className="checkbox-row">
          <input
            id="embeds"
            type="checkbox"
            checked={settings.filterEmbeds}
            onChange={(e) => setSettings({ ...settings, filterEmbeds: e.target.checked })}
          />
          <label htmlFor="embeds" style={{ margin: 0 }}>
            Also filter YouTube videos embedded on other websites
          </label>
        </div>
        <div className="checkbox-row">
          <input
            id="checkAllowed"
            type="checkbox"
            checked={settings.checkAllowedChannels}
            onChange={(e) => setSettings({ ...settings, checkAllowedChannels: e.target.checked })}
          />
          <label htmlFor="checkAllowed" style={{ margin: 0 }}>
            Still check individual videos on channels you've allowed
          </label>
        </div>
        <button className="primary" disabled={saving || !loaded} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save rules'}
        </button>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      <div className="card">
        <h2>Notifications</h2>
        <p className="sub">
          Get pinged when your kid asks for something. Push is easiest: install the free{' '}
          <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> app on your phone,
          subscribe to a topic, and enter the same topic name here (treat it like a password —
          use something long and random). Email requires a Resend API key on the backend.
        </p>
        <div className="settings-grid">
          <div>
            <label>ntfy.sh topic (push to phone)</label>
            <input
              value={notif.ntfyTopic ?? ''}
              onChange={(e) => setNotif({ ntfyTopic: e.target.value.trim() || null })}
              placeholder="skfbr-a8f2k9x1qz"
            />
          </div>
          <div>
            <label>Email</label>
            <input
              type="email"
              value={notif.email ?? ''}
              onChange={(e) => setNotif({ email: e.target.value.trim() || null })}
              placeholder="you@example.com"
            />
          </div>
        </div>
        <div className="checkbox-row">
          <input
            id="onKidRequest"
            type="checkbox"
            checked={notif.onKidRequest}
            onChange={(e) => setNotif({ onKidRequest: e.target.checked })}
          />
          <label htmlFor="onKidRequest" style={{ margin: 0 }}>
            When my kid taps "ask my grown-up"
          </label>
        </div>
        <div className="checkbox-row">
          <input
            id="onAiFlag"
            type="checkbox"
            checked={notif.onAiFlag}
            onChange={(e) => setNotif({ onAiFlag: e.target.checked })}
          />
          <label htmlFor="onAiFlag" style={{ margin: 0 }}>
            When the AI blocks or is unsure about something new
          </label>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          Saved together with your rules via the button above.
        </p>
      </div>

      <div className="card">
        <h2>Backup</h2>
        <p className="sub">
          Export your rules, settings, and pinned decisions to a file — or restore them (import
          replaces everything and re-judges all content).
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" onClick={() => void exportBundle()}>Export</button>
          <button className="primary" onClick={() => importInput.current?.click()}>Import…</button>
          <input
            ref={importInput}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importBundle(file);
              e.target.value = '';
            }}
          />
        </div>
        {backupMsg && <div className={`msg ${backupMsg.kind}`}>{backupMsg.text}</div>}
      </div>

      <div className="card">
        <h2>Test your rules</h2>
        <p className="sub">Paste any YouTube video or channel URL to see how the AI would judge it.</p>
        <input
          value={testUrl}
          onChange={(e) => setTestUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=… or https://www.youtube.com/@channel"
        />
        <button className="primary" disabled={testing || !testUrl} onClick={() => void runTest()}>
          {testing ? 'Judging…' : 'Run test'}
        </button>
        {testError && <div className="msg error">{testError}</div>}
        {testResult && (
          <div className="item">
            <div className="meta">
              <div className="title">
                {(testResult.extracted as { title: string }).title}{' '}
                <span className={`pill ${testResult.verdict.decision}`}>{testResult.verdict.decision}</span>
              </div>
              <div className="detail">
                {testResult.verdict.reason} · confidence {Math.round(testResult.verdict.confidence * 100)}%
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
