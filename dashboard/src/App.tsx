import {
  AppShell,
  Badge,
  Box,
  Button,
  Container,
  Group,
  Select,
  Tabs,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconActivity,
  IconClipboardCheck,
  IconDevices,
  IconKey,
  IconLogout,
  IconPin,
  IconPlayerPause,
  IconPlayerPlay,
  IconShieldCheck,
  IconSparkles,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import ActivityPage from './pages/ActivityPage';
import ApiPage from './pages/ApiPage';
import CriteriaPage from './pages/CriteriaPage';
import DevicesPage from './pages/DevicesPage';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import OverridesPage from './pages/OverridesPage';
import ReviewPage from './pages/ReviewPage';

const PAUSE_CHOICES = [
  { label: '15 minutes', value: '15' },
  { label: '30 minutes', value: '30' },
  { label: '1 hour', value: '60' },
  { label: '2 hours', value: '120' },
  { label: '4 hours', value: '240' },
  { label: 'Rest of the day', value: 'eod' },
];

function minutesUntilMidnight(): number {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((midnight.getTime() - Date.now()) / 60_000));
}

/** Big red switch: pause all YouTube viewing on every device for a while. */
function PauseControl() {
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [choice, setChoice] = useState('30');
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
    const interval = setInterval(load, 30_000); // reflect pauses set via MCP or other tabs
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const active = pausedUntil !== null && pausedUntil > Date.now();

  const pause = async () => {
    setBusy(true);
    try {
      const minutes = choice === 'eod' ? minutesUntilMidnight() : Number(choice);
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
      <Group gap="xs">
        <Badge color="red" size="lg" variant="light" leftSection={<IconPlayerPause size={13} />}>
          Paused until {until}
        </Badge>
        <Button
          size="xs"
          color="red"
          loading={busy}
          leftSection={<IconPlayerPlay size={14} />}
          onClick={() => void resume()}
        >
          Resume
        </Button>
      </Group>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap">
      <Select
        size="xs"
        w={130}
        data={PAUSE_CHOICES}
        value={choice}
        onChange={(v) => v && setChoice(v)}
        allowDeselect={false}
        aria-label="Pause duration"
      />
      <Button
        size="xs"
        color="red"
        variant="outline"
        loading={busy}
        leftSection={<IconPlayerPause size={14} />}
        onClick={() => void pause()}
      >
        Pause YouTube
      </Button>
    </Group>
  );
}

const TABS = [
  { value: 'criteria', label: 'Rules', icon: IconSparkles },
  { value: 'review', label: 'Review', icon: IconClipboardCheck },
  { value: 'overrides', label: 'Pinned', icon: IconPin },
  { value: 'devices', label: 'Devices', icon: IconDevices },
  { value: 'activity', label: 'Activity', icon: IconActivity },
  { value: 'api', label: 'API & MCP', icon: IconKey },
];

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken());
  const [tab, setTab] = useState('criteria');
  const [reviewCount, setReviewCount] = useState(0);
  // First-launch wizard: shown while the family has no criteria yet.
  const [onboarding, setOnboarding] = useState<'unknown' | 'show' | 'hide'>('unknown');

  useEffect(() => {
    if (!authed) return;
    let flag: string | null = null;
    try {
      flag = localStorage.getItem('skfbr.onboarded');
    } catch {
      /* ignore */
    }
    if (flag) {
      setOnboarding('hide');
      return;
    }
    void api
      .getPolicy()
      .then((p) => setOnboarding(p.criteria.trim() === '' ? 'show' : 'hide'))
      .catch(() => setOnboarding('hide'));
  }, [authed]);

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
  if (onboarding === 'unknown') return null; // one quick policy fetch decides
  if (onboarding === 'show') return <Onboarding onDone={() => setOnboarding('hide')} />;

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setToken(null);
      setAuthed(false);
    }
  };

  return (
    <AppShell header={{ height: 64 }} padding={0}>
      <AppShell.Header withBorder style={{ background: 'white' }}>
        <Container size="md" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size={36} radius="md" variant="gradient" gradient={{ from: 'orange.5', to: 'orange.7' }}>
                <IconShieldCheck size={22} />
              </ThemeIcon>
              <Box visibleFrom="xs">
                <Title order={4} lh={1.1}>
                  SaveKidsFromBrainRot
                </Title>
                <Text size="xs" c="dimmed" lh={1.2}>
                  AI parental controls for YouTube
                </Text>
              </Box>
            </Group>
            <Group gap="md" wrap="nowrap">
              <PauseControl />
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={<IconLogout size={14} />}
                onClick={() => void logout()}
              >
                Sign out
              </Button>
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main style={{ background: '#faf9f7' }}>
        <Container size="md" py="lg">
          <Tabs value={tab} onChange={(v) => v && setTab(v)} keepMounted={false} mb="lg">
            <Tabs.List>
              {TABS.map((t) => (
                <Tabs.Tab
                  key={t.value}
                  value={t.value}
                  leftSection={<t.icon size={15} />}
                  rightSection={
                    t.value === 'review' && reviewCount > 0 ? (
                      <Badge size="xs" color="red" circle>
                        {reviewCount}
                      </Badge>
                    ) : undefined
                  }
                >
                  {t.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>

          {tab === 'criteria' && <CriteriaPage />}
          {tab === 'review' && <ReviewPage onChanged={() => setReviewCount((c) => Math.max(0, c - 1))} />}
          {tab === 'overrides' && <OverridesPage />}
          {tab === 'devices' && <DevicesPage />}
          {tab === 'activity' && <ActivityPage />}
          {tab === 'api' && <ApiPage />}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
