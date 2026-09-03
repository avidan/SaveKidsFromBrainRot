import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBook2,
  IconCircleCheck,
  IconConfetti,
  IconDownload,
  IconFlask,
  IconUpload,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import type {
  CriteriaMode,
  DistractionSettings,
  ExportBundle,
  NotificationSettings,
  ScheduleSettings,
  Settings,
  TestResponse,
} from '../../../shared/types';
import { DEFAULT_SETTINGS, MODEL_CHOICES } from '../../../shared/types';

const DISTRACTION_TOGGLES: Array<{ key: keyof DistractionSettings; label: string; hint?: string }> = [
  { key: 'hideHomeFeed', label: 'Hide the home feed entirely', hint: 'Kids search or use subscriptions instead of scrolling' },
  { key: 'hideRelated', label: 'Hide "up next" sidebar on videos' },
  { key: 'hideComments', label: 'Hide comments' },
  { key: 'hideEndScreens', label: 'Hide end-of-video suggestions' },
  { key: 'disableAutoplay', label: 'Keep autoplay off' },
  { key: 'redirectHomeToSubs', label: 'Send youtube.com to Subscriptions' },
  { key: 'hideNotifications', label: 'Hide the notification bell' },
  { key: 'hideExplore', label: 'Hide Trending / Explore links' },
  { key: 'hideChips', label: 'Hide category chips above feeds' },
  { key: 'hideLiveChat', label: 'Hide live chat' },
];
import { api } from '../api';

const EXAMPLE = `Allow educational content, science experiments, LEGO builds, calm crafts, and nature documentaries suitable for a 7-year-old.

Block gaming rage content, "brainrot"/skibidi-style content, prank channels, unboxing/haul videos, anything with rapid-fire jump cuts engineered for retention, and content with scary or violent themes.`;

const WEEKEND_EXAMPLE = `Same as the week rules, but gaming videos are fine (still no rage/shouty commentary), and one movie-length video is okay.

Leave this empty to use the week rules all the time.`;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => ({
  label: d,
  value: String(i),
}));

function timezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['America/Los_Angeles', 'America/New_York', 'America/Chicago', 'America/Denver', 'UTC'];
  }
}

const VERDICT_COLOR: Record<string, string> = { allow: 'teal', block: 'red', unsure: 'yellow' };

export default function CriteriaPage() {
  const [criteria, setCriteria] = useState('');
  const [weekendCriteria, setWeekendCriteria] = useState('');
  const [editingMode, setEditingMode] = useState<CriteriaMode>('week');
  const [activeMode, setActiveMode] = useState<CriteriaMode>('week');
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
  const sched: ScheduleSettings = settings.schedule ?? DEFAULT_SETTINGS.schedule;
  const setSched = (patch: Partial<ScheduleSettings>) =>
    setSettings({ ...settings, schedule: { ...sched, ...patch } });
  const distr: DistractionSettings = settings.distractions ?? DEFAULT_SETTINGS.distractions;
  const setDistr = (patch: Partial<DistractionSettings>) =>
    setSettings({ ...settings, distractions: { ...DEFAULT_SETTINGS.distractions, ...distr, ...patch } });

  useEffect(() => {
    void api
      .getPolicy()
      .then((p) => {
        setCriteria(p.criteria);
        setWeekendCriteria(p.weekendCriteria ?? '');
        setActiveMode(p.activeMode ?? 'week');
        setSettings({
          ...DEFAULT_SETTINGS,
          ...p.settings,
          schedule: { ...DEFAULT_SETTINGS.schedule, ...(p.settings.schedule ?? {}) },
        });
        setLoaded(true);
      })
      .catch(() => setMsg({ text: 'Could not load policy', kind: 'error' }));
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const p = await api.putPolicy(criteria, weekendCriteria, settings);
      setActiveMode(p.activeMode ?? 'week');
      setMsg({
        text: 'Saved. AI verdicts were reset only for the rule set you changed — the other stays cached.',
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
      setWeekendCriteria(policy.weekendCriteria ?? '');
      setActiveMode(policy.activeMode ?? 'week');
      setSettings({
        ...DEFAULT_SETTINGS,
        ...policy.settings,
        schedule: { ...DEFAULT_SETTINGS.schedule, ...(policy.settings.schedule ?? {}) },
      });
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

  const hasWeekend = weekendCriteria.trim() !== '';

  return (
    <Stack gap="md">
      <Card>
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap">
            <div>
              <Title order={4}>Your family's rules</Title>
              <Text size="sm" c="dimmed">
                Written in plain language — the AI judges every channel and video against exactly
                this text.
              </Text>
            </div>
            {hasWeekend && (
              <Badge
                size="lg"
                variant="light"
                color={activeMode === 'weekend' ? 'grape' : 'blue'}
                leftSection={activeMode === 'weekend' ? <IconConfetti size={14} /> : <IconBook2 size={14} />}
              >
                {activeMode === 'weekend' ? 'Weekend rules active now' : 'Week rules active now'}
              </Badge>
            )}
          </Group>
          <SegmentedControl
            value={editingMode}
            onChange={(v) => setEditingMode(v as CriteriaMode)}
            data={[
              { label: '📚 Week rules', value: 'week' },
              { label: hasWeekend ? '🎉 Weekend rules' : '🎉 Weekend rules (off)', value: 'weekend' },
            ]}
            w="fit-content"
          />
          {editingMode === 'week' ? (
            <Textarea
              autosize
              minRows={8}
              maxRows={22}
              value={criteria}
              onChange={(e) => setCriteria(e.currentTarget.value)}
              placeholder={EXAMPLE}
              disabled={!loaded}
            />
          ) : (
            <Textarea
              autosize
              minRows={8}
              maxRows={22}
              value={weekendCriteria}
              onChange={(e) => setWeekendCriteria(e.currentTarget.value)}
              placeholder={WEEKEND_EXAMPLE}
              disabled={!loaded}
            />
          )}

          <Grid gutter="sm">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <NumberInput
                label="Daily time limit (minutes)"
                description="Blank = no limit"
                min={0}
                value={settings.dailyLimitMinutes ?? ''}
                onChange={(v) =>
                  setSettings({ ...settings, dailyLimitMinutes: v === '' || v === null ? null : Math.max(0, Number(v)) })
                }
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select
                label="AI model"
                data={[
                  ...MODEL_CHOICES.map((m) => ({ value: m.id, label: m.label })),
                  ...(MODEL_CHOICES.some((m) => m.id === settings.model)
                    ? []
                    : [{ value: settings.model, label: `Custom: ${settings.model}` }]),
                ]}
                value={settings.model}
                onChange={(v) => v && setSettings({ ...settings, model: v })}
                allowDeselect={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <NumberInput
                label="Re-check channels after (days)"
                min={1}
                value={settings.channelTtlDays}
                onChange={(v) => setSettings({ ...settings, channelTtlDays: Math.max(1, Number(v) || 1) })}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <Select
                label="If the AI can't be reached"
                data={[
                  { value: 'closed', label: 'Block unknown content (recommended)' },
                  { value: 'open', label: 'Allow unknown content' },
                ]}
                value={settings.failMode}
                onChange={(v) => v && setSettings({ ...settings, failMode: v as Settings['failMode'] })}
                allowDeselect={false}
              />
            </Grid.Col>
          </Grid>

          <Stack gap={8} mt={4}>
            <Switch
              label="Block YouTube Shorts entirely"
              checked={settings.blockShorts}
              onChange={(e) => setSettings({ ...settings, blockShorts: e.currentTarget.checked })}
            />
            <Switch
              label="Also filter YouTube videos embedded on other websites"
              checked={settings.filterEmbeds}
              onChange={(e) => setSettings({ ...settings, filterEmbeds: e.currentTarget.checked })}
            />
            <Switch
              label="Still check individual videos on channels you've allowed"
              checked={settings.checkAllowedChannels}
              onChange={(e) => setSettings({ ...settings, checkAllowedChannels: e.currentTarget.checked })}
            />
            <Switch
              label="Quiet filtering — only show content once it's approved"
              description="No blurred placeholders: feeds and search results simply appear to contain only approved videos, so kids never see that something was filtered out"
              checked={settings.quietFiltering}
              onChange={(e) => setSettings({ ...settings, quietFiltering: e.currentTarget.checked })}
            />
          </Stack>

          <Group mt={4}>
            <Button loading={saving} disabled={!loaded} onClick={() => void save()}>
              Save rules
            </Button>
          </Group>
          {msg && (
            <Alert
              color={msg.kind === 'ok' ? 'teal' : 'red'}
              icon={msg.kind === 'ok' ? <IconCircleCheck size={16} /> : <IconAlertCircle size={16} />}
            >
              {msg.text}
            </Alert>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>Distractions</Title>
            <Text size="sm" c="dimmed">
              Remove YouTube's attention traps outright — no AI involved, applies within a minute,
              and kids can't switch it back. Hiding the home feed and sidebar also cuts your AI
              costs, since there's less content to judge.
            </Text>
          </div>
          <Grid gutter={6}>
            {DISTRACTION_TOGGLES.map((t) => (
              <Grid.Col key={t.key} span={{ base: 12, sm: 6 }}>
                <Switch
                  label={t.label}
                  description={t.hint}
                  checked={distr[t.key]}
                  onChange={(e) => setDistr({ [t.key]: e.currentTarget.checked })}
                />
              </Grid.Col>
            ))}
          </Grid>
          <Text size="xs" c="dimmed">
            Saved together with your rules via the button above.
          </Text>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>Weekly schedule</Title>
            <Text size="sm" c="dimmed">
              When should the weekend rules apply? Times are in your family's timezone. Devices
              switch within about a minute, and both rule sets keep their own verdict cache — no
              re-evaluation at the boundary.
            </Text>
          </div>
          <Switch
            label="Use different rules on a weekly schedule"
            checked={sched.enabled}
            onChange={(e) => setSched({ enabled: e.currentTarget.checked })}
          />
          {sched.enabled && (
            <Grid gutter="sm">
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="sm" fw={500} mb={4}>
                  Weekend starts
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Select
                    data={DAYS}
                    value={String(sched.weekendStartDay)}
                    onChange={(v) => v && setSched({ weekendStartDay: Number(v) })}
                    allowDeselect={false}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    type="time"
                    value={sched.weekendStartTime}
                    onChange={(e) => setSched({ weekendStartTime: e.currentTarget.value || '12:00' })}
                    w={110}
                  />
                </Group>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Text size="sm" fw={500} mb={4}>
                  Weekend ends
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Select
                    data={DAYS}
                    value={String(sched.weekendEndDay)}
                    onChange={(v) => v && setSched({ weekendEndDay: Number(v) })}
                    allowDeselect={false}
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    type="time"
                    value={sched.weekendEndTime}
                    onChange={(e) => setSched({ weekendEndTime: e.currentTarget.value || '00:00' })}
                    w={110}
                  />
                </Group>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <Select
                  label="Timezone"
                  searchable
                  data={timezones()}
                  value={sched.timezone}
                  onChange={(v) => v && setSched({ timezone: v })}
                  allowDeselect={false}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6 }}>
                <NumberInput
                  label="Weekend daily limit (minutes)"
                  description="Blank = same as the week limit"
                  min={0}
                  value={settings.weekendDailyLimitMinutes ?? ''}
                  onChange={(v) =>
                    setSettings({
                      ...settings,
                      weekendDailyLimitMinutes: v === '' || v === null ? null : Math.max(0, Number(v)),
                    })
                  }
                />
              </Grid.Col>
            </Grid>
          )}
          <Text size="xs" c="dimmed">
            Saved together with your rules via the button above. Weekend rules must be non-empty to
            take effect.
          </Text>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>Notifications</Title>
            <Text size="sm" c="dimmed">
              Get pinged when your kid asks for something. Push is easiest: install the free{' '}
              <a href="https://ntfy.sh" target="_blank" rel="noreferrer">
                ntfy
              </a>{' '}
              app, subscribe to a long random topic, and enter the same topic here (treat it like a
              password). Email requires a Resend API key on the backend.
            </Text>
          </div>
          <Grid gutter="sm">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="ntfy.sh topic (push to phone)"
                value={notif.ntfyTopic ?? ''}
                onChange={(e) => setNotif({ ntfyTopic: e.currentTarget.value.trim() || null })}
                placeholder="skfbr-a8f2k9x1qz"
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="Email"
                type="email"
                value={notif.email ?? ''}
                onChange={(e) => setNotif({ email: e.currentTarget.value.trim() || null })}
                placeholder="you@example.com"
              />
            </Grid.Col>
          </Grid>
          <Stack gap={8}>
            <Switch
              label={'When my kid taps "ask my grown-up"'}
              checked={notif.onKidRequest}
              onChange={(e) => setNotif({ onKidRequest: e.currentTarget.checked })}
            />
            <Switch
              label="When the AI blocks or is unsure about something new"
              checked={notif.onAiFlag}
              onChange={(e) => setNotif({ onAiFlag: e.currentTarget.checked })}
            />
          </Stack>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>Test your rules</Title>
            <Text size="sm" c="dimmed">
              Paste any YouTube video or channel URL to see how the AI would judge it right now.
            </Text>
          </div>
          <Group wrap="nowrap" align="flex-end">
            <TextInput
              style={{ flex: 1 }}
              value={testUrl}
              onChange={(e) => setTestUrl(e.currentTarget.value)}
              placeholder="https://www.youtube.com/watch?v=… or https://www.youtube.com/@channel"
            />
            <Button
              loading={testing}
              disabled={!testUrl}
              leftSection={<IconFlask size={16} />}
              onClick={() => void runTest()}
            >
              Run test
            </Button>
          </Group>
          {testError && (
            <Alert color="red" icon={<IconAlertCircle size={16} />}>
              {testError}
            </Alert>
          )}
          {testResult && (
            <Card padding="sm" bg="gray.0">
              <Group gap="xs" mb={4}>
                <Text fw={600} size="sm">
                  {(testResult.extracted as { title: string }).title}
                </Text>
                <Badge color={VERDICT_COLOR[testResult.verdict.decision] ?? 'gray'}>
                  {testResult.verdict.decision}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed">
                {testResult.verdict.reason} · confidence {Math.round(testResult.verdict.confidence * 100)}%
                {testResult.mode && hasWeekend && (
                  <> · judged with {testResult.mode === 'weekend' ? 'weekend' : 'week'} rules</>
                )}
              </Text>
            </Card>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>Backup</Title>
            <Text size="sm" c="dimmed">
              Export your rules, settings, and pinned decisions — or restore them (import replaces
              everything and re-judges all content).
            </Text>
          </div>
          <Group>
            <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => void exportBundle()}>
              Export
            </Button>
            <Button variant="default" leftSection={<IconUpload size={16} />} onClick={() => importInput.current?.click()}>
              Import…
            </Button>
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
          </Group>
          {backupMsg && (
            <Alert
              color={backupMsg.kind === 'ok' ? 'teal' : 'red'}
              icon={backupMsg.kind === 'ok' ? <IconCircleCheck size={16} /> : <IconAlertCircle size={16} />}
            >
              {backupMsg.text}
            </Alert>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
