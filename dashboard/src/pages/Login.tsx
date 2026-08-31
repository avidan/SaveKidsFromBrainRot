import {
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconShieldCheck } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api, getBackendUrl, setBackendUrl, setToken } from '../api';

type Mode = 'login' | 'signup' | 'forgot';

export default function Login({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [backend, setBackend] = useState(getBackendUrl());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

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
    <Center mih="100vh" p="md" style={{ background: '#faf9f7' }}>
      <Stack w={420} maw="100%" gap="lg">
        <Group justify="center" gap="sm">
          <ThemeIcon size={44} radius="md" variant="gradient" gradient={{ from: 'orange.5', to: 'orange.7' }}>
            <IconShieldCheck size={28} />
          </ThemeIcon>
          <div>
            <Title order={3} lh={1.1}>
              SaveKidsFromBrainRot
            </Title>
            <Text size="sm" c="dimmed">
              AI parental controls for YouTube
            </Text>
          </div>
        </Group>

        <Card shadow="sm">
          <Stack gap="sm">
            <Title order={4}>{title}</Title>
            <TextInput
              label="Dashboard URL"
              description="Where your family's server lives"
              value={backend}
              onChange={(e) => setBackend(e.currentTarget.value)}
              placeholder="https://skfbr-backend.you.workers.dev"
            />
            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            {mode === 'forgot' && codeSent && (
              <TextInput
                label="6-digit code"
                description="Check your ntfy app or email"
                maxLength={6}
                value={resetCode}
                onChange={(e) => setResetCode(e.currentTarget.value)}
              />
            )}
            {(mode !== 'forgot' || codeSent) && (
              <PasswordInput
                label={mode === 'forgot' ? 'New password' : 'Password'}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            )}
            <Button fullWidth loading={busy} onClick={() => void submit()}>
              {buttonLabel}
            </Button>
            {error && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {error}
              </Alert>
            )}
            {notice && (
              <Alert color="teal" icon={<IconCircleCheck size={16} />}>
                {notice}
              </Alert>
            )}
            <Text size="sm" c="dimmed" ta="center">
              {mode === 'login' ? (
                <>
                  New here?{' '}
                  <Anchor size="sm" onClick={() => setMode('signup')}>
                    Create an account
                  </Anchor>
                  {' · '}
                  <Anchor
                    size="sm"
                    onClick={() => {
                      setMode('forgot');
                      setCodeSent(false);
                    }}
                  >
                    Forgot password?
                  </Anchor>
                </>
              ) : (
                <>
                  Back to{' '}
                  <Anchor
                    size="sm"
                    onClick={() => {
                      setMode('login');
                      setCodeSent(false);
                    }}
                  >
                    sign in
                  </Anchor>
                </>
              )}
            </Text>
          </Stack>
        </Card>
      </Stack>
    </Center>
  );
}
