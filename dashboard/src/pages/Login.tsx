import { useEffect, useState } from 'react';
import { api, getBackendUrl, setBackendUrl, setToken } from '../api';

type Mode = 'login' | 'signup' | 'forgot';

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [backend, setBackend] = useState(getBackendUrl());

  // Single-deploy setups serve this dashboard from the Worker itself, so the
  // API is same-origin. Probe /health and prefill — must parse as JSON, since
  // an SPA fallback would answer any path with index.html and a 200.
  useEffect(() => {
    if (getBackendUrl()) return;
    void fetch('/health')
      .then((r) => r.json())
      .then((data: { ok?: boolean }) => {
        if (data?.ok) setBackend((prev) => prev || window.location.origin);
      })
      .catch(() => undefined);
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      setBackendUrl(backend);
      if (mode === 'forgot') {
        if (!codeSent) {
          await api.requestReset(email);
          setCodeSent(true);
          setNotice('If that account exists, a code was sent to its notification channels.');
        } else {
          await api.resetPassword(email, resetCode, password);
          setMode('login');
          setCodeSent(false);
          setResetCode('');
          setPassword('');
          setNotice('Password updated — sign in with it now.');
        }
      } else {
        const result =
          mode === 'login' ? await api.login(email, password) : await api.signup(email, password);
        setToken(result.sessionToken);
        onAuthed();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create your family account' : 'Reset your password';
  const buttonLabel =
    mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Sign up' : codeSent ? 'Set new password' : 'Send reset code';

  return (
    <div className="auth-box">
      <h1>🛡️ SaveKidsFromBrainRot</h1>
      <div className="card">
        <h2>{title}</h2>
        <label>Backend URL</label>
        <input
          value={backend}
          onChange={(e) => setBackend(e.target.value)}
          placeholder="https://api.yourdomain.com"
        />
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        {mode === 'forgot' && codeSent && (
          <>
            <label>6-digit code (check your ntfy app / email)</label>
            <input value={resetCode} onChange={(e) => setResetCode(e.target.value)} maxLength={6} />
          </>
        )}
        {(mode !== 'forgot' || codeSent) && (
          <>
            <label>{mode === 'forgot' ? 'New password' : 'Password'}</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
          </>
        )}
        <button className="primary" disabled={busy} onClick={() => void submit()}>
          {buttonLabel}
        </button>
        {error && <div className="msg error">{error}</div>}
        {notice && <div className="msg ok">{notice}</div>}
        <div className="switch">
          {mode === 'login' && (
            <>
              New here? <a onClick={() => setMode('signup')}>Create an account</a>
              {' · '}
              <a onClick={() => { setMode('forgot'); setCodeSent(false); }}>Forgot password?</a>
            </>
          )}
          {mode !== 'login' && (
            <>
              Back to <a onClick={() => { setMode('login'); setCodeSent(false); }}>sign in</a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
