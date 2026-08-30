import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import ActivityPage from './pages/ActivityPage';
import ApiPage from './pages/ApiPage';
import CriteriaPage from './pages/CriteriaPage';
import DevicesPage from './pages/DevicesPage';
import Login from './pages/Login';
import OverridesPage from './pages/OverridesPage';
import ReviewPage from './pages/ReviewPage';

const TABS = ['Criteria', 'Review', 'Overrides', 'Devices', 'Activity', 'API'] as const;
type Tab = (typeof TABS)[number];

const PAUSE_CHOICES = [
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
  { label: 'Rest of the day', minutes: -1 }, // computed at click time
] as const;

function minutesUntilMidnight(): number {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - Date.now()) / 60_000));
}

/** Big red switch: pause all YouTube viewing on every device for a while. */
function PauseControl() {
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [choice, setChoice] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const policy = await api.getPolicy();
        if (!cancelled) setPausedUntil(policy.pausedUntil);
      } catch {
        /* transient — keep last known state */
      }
    };
    void load();
    // Poll so a pause set elsewhere (MCP, another tab) shows here; a 1s tick
    // would be overkill — the countdown below re-renders on this cadence too.
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const active = pausedUntil !== null && pausedUntil > Date.now();

  const pause = async () => {
    setBusy(true);
    try {
      const minutes = choice === -1 ? minutesUntilMidnight() : choice;
      const { pausedUntil } = await api.pause(minutes);
      setPausedUntil(pausedUntil);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      await api.resume();
      setPausedUntil(null);
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    const until = new Date(pausedUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return (
      <div className="pause-control paused">
        <span className="pause-status">⏸️ Paused until {until}</span>
        <button disabled={busy} onClick={() => void resume()}>
          Resume
        </button>
      </div>
    );
  }

  return (
    <div className="pause-control">
      <select value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
        {PAUSE_CHOICES.map((c) => (
          <option key={c.label} value={c.minutes}>
            {c.label}
          </option>
        ))}
      </select>
      <button disabled={busy} onClick={() => void pause()}>
        ⏸️ Pause YouTube
      </button>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const [tab, setTab] = useState<Tab>('Criteria');
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { items } = await api.getReview();
        if (!cancelled) setReviewCount(items.length);
      } catch {
        /* ignore */
      }
    };
    void load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [authed, tab]);

  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setToken(null);
      setAuthed(false);
    }
  };

  return (
    <div className="shell">
      <header className="topbar">
        <h1>🛡️ SaveKidsFromBrainRot</h1>
        <div className="topbar-actions">
          <PauseControl />
          <button onClick={() => void logout()}>Sign out</button>
        </div>
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
            {t === 'Review' && reviewCount > 0 && <span className="badge">{reviewCount}</span>}
          </button>
        ))}
      </nav>
      {tab === 'Criteria' && <CriteriaPage />}
      {tab === 'Review' && <ReviewPage onChanged={() => setReviewCount((c) => Math.max(0, c - 1))} />}
      {tab === 'Overrides' && <OverridesPage />}
      {tab === 'Devices' && <DevicesPage />}
      {tab === 'Activity' && <ActivityPage />}
      {tab === 'API' && <ApiPage />}
    </div>
  );
}
