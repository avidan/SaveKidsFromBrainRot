import {
  Alert,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  NumberInput,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconClockPlus, IconHourglassLow } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import type { DeviceInfo, ScreenTimeEntry, Settings } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { api } from '../api';

function fmtMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export default function TimePage() {
  const [criteria, setCriteria] = useState('');
  const [weekendCriteria, setWeekendCriteria] = useState('');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeMode, setActiveMode] = useState<'week' | 'weekend'>('week');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [screenTime, setScreenTime] = useState<ScreenTimeEntry[]>([]);
  const [busyDevice, setBusyDevice] = useState<string | null>(null);
  const [grantMsg, setGrantMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const customMinutes = useRef<Record<string, number>>({});

  const loadDevices = async () => {
    try {
      const [{ devices: d }, { screenTime: s }] = await Promise.all([api.getDevices(), api.getScreenTime()]);
      setDevices(d);
      setScreenTime(s);
    } catch {
      /* transient; next poll retries */
    }
  };

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
      .catch(() => setMsg({ text: 'Could not load settings', kind: 'error' }));
    void loadDevices();
    const interval = setInterval(() => void loadDevices(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api.putPolicy(criteria, weekendCriteria, settings);
      setMsg({ text: 'Saved. Devices pick this up within a minute.', kind: 'ok' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Save failed', kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const extend = async (device: DeviceInfo, minutes: number) => {
    setBusyDevice(device.id);
    setGrantMsg(null);
    try {
      const { bonusMinutesToday } = await api.extendDevice(device.id, minutes);
      setDevices((ds) => ds.map((d) => (d.id === device.id ? { ...d, bonusMinutesToday } : d)));
      setGrantMsg({
        text: `${device.name} gets ${fmtMinutes(bonusMinutesToday)} extra today. The device picks it up within a minute while YouTube is open.`,
        kind: 'ok',
      });
    } catch (e) {
      setGrantMsg({ text: e instanceof Error ? e.message : 'Could not add time', kind: 'error' });
    } finally {
      setBusyDevice(null);
    }
  };

  const clearBonus = async (device: DeviceInfo) => {
    setBusyDevice(device.id);
    setGrantMsg(null);
    try {
      await api.clearDeviceBonus(device.id);
      setDevices((ds) => ds.map((d) => (d.id === device.id ? { ...d, bonusMinutesToday: 0 } : d)));
      setGrantMsg({ text: `Removed today's extra time for ${device.name}.`, kind: 'ok' });
    } catch (e) {
      setGrantMsg({ text: e instanceof Error ? e.message : 'Could not remove time', kind: 'error' });
    } finally {
      setBusyDevice(null);
    }
  };

  const baseLimitToday =
    activeMode === 'weekend'
      ? settings.weekendDailyLimitMinutes ?? settings.dailyLimitMinutes
      : settings.dailyLimitMinutes;

  const usedMinutes = (deviceName: string): number | null => {
    const entry = screenTime.find((s) => s.deviceName === deviceName);
    return entry ? Math.round(entry.secondsToday / 60) : null;
  };

  return (
    <Stack gap="md">
      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>Daily limits</Title>
            <Text size="sm" c="dimmed">
              How much YouTube per day, counted only while a video is actually playing. Time resets
              at midnight on each device. Blank = no limit.
            </Text>
          </div>
          <Grid gutter="sm">
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <NumberInput
                label={settings.schedule.enabled ? 'School-week limit (minutes)' : 'Daily limit (minutes)'}
                min={0}
                value={settings.dailyLimitMinutes ?? ''}
                onChange={(v) =>
                  setSettings({ ...settings, dailyLimitMinutes: v === '' || v === null ? null : Math.max(0, Number(v)) })
                }
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <NumberInput
                label="Weekend limit (minutes)"
                description={
                  settings.schedule.enabled
                    ? 'Blank = same as the week limit'
                    : 'Applies once a weekly schedule is turned on (Rules tab)'
                }
                min={0}
                disabled={!settings.schedule.enabled}
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
          <Group align="flex-end" gap="sm">
            <Switch
              label="Warn before time runs out"
              description="Shows a small countdown notice on the video page so the end isn't a surprise"
              checked={settings.timeWarningMinutes !== null}
              onChange={(e) =>
                setSettings({ ...settings, timeWarningMinutes: e.currentTarget.checked ? 5 : null })
              }
            />
            {settings.timeWarningMinutes !== null && (
              <NumberInput
                label="Warn at (minutes left)"
                min={1}
                max={60}
                w={160}
                value={settings.timeWarningMinutes}
                onChange={(v) => setSettings({ ...settings, timeWarningMinutes: Math.max(1, Number(v) || 1) })}
              />
            )}
          </Group>
          <Group>
            <Button loading={saving} disabled={!loaded} onClick={() => void save()}>
              Save limits
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
            <Title order={4}>Today, per device</Title>
            <Text size="sm" c="dimmed">
              Give one device extra time for today — for finishing a video, or as a reward — without
              changing the everyday limit. Extra time disappears at midnight. If a device is already
              on the "time's up" screen, it unlocks within a minute of adding time.
            </Text>
          </div>
          {devices.length === 0 ? (
            <Text size="sm" c="dimmed">
              No devices paired yet — add one from the Devices tab.
            </Text>
          ) : (
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Device</Table.Th>
                  <Table.Th>Watched today</Table.Th>
                  <Table.Th>Limit today</Table.Th>
                  <Table.Th>Give more time</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {devices.map((d) => {
                  const bonus = d.bonusMinutesToday ?? 0;
                  const used = usedMinutes(d.name);
                  return (
                    <Table.Tr key={d.id}>
                      <Table.Td>
                        <Text fw={600} size="sm">
                          {d.name}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{used === null ? '—' : fmtMinutes(used)}</Text>
                      </Table.Td>
                      <Table.Td>
                        {baseLimitToday === null ? (
                          <Text size="sm" c="dimmed">
                            No limit
                          </Text>
                        ) : (
                          <Group gap={6}>
                            <Text size="sm">{fmtMinutes(baseLimitToday + bonus)}</Text>
                            {bonus > 0 && (
                              <Badge size="sm" variant="light" color="teal" leftSection={<IconClockPlus size={12} />}>
                                +{fmtMinutes(bonus)}
                              </Badge>
                            )}
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="wrap">
                          {[15, 30, 60].map((m) => (
                            <Button
                              key={m}
                              size="compact-sm"
                              variant="light"
                              loading={busyDevice === d.id}
                              onClick={() => void extend(d, m)}
                            >
                              +{m}m
                            </Button>
                          ))}
                          <NumberInput
                            size="xs"
                            w={80}
                            min={1}
                            max={720}
                            placeholder="min"
                            onChange={(v) => (customMinutes.current[d.id] = Number(v) || 0)}
                          />
                          <Button
                            size="compact-sm"
                            variant="default"
                            loading={busyDevice === d.id}
                            onClick={() => {
                              const m = customMinutes.current[d.id];
                              if (m && m > 0) void extend(d, m);
                            }}
                          >
                            Add
                          </Button>
                          {bonus > 0 && (
                            <Button
                              size="compact-sm"
                              variant="subtle"
                              color="red"
                              loading={busyDevice === d.id}
                              onClick={() => void clearBonus(d)}
                            >
                              Undo
                            </Button>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          )}
          {grantMsg && (
            <Alert
              color={grantMsg.kind === 'ok' ? 'teal' : 'red'}
              icon={grantMsg.kind === 'ok' ? <IconCircleCheck size={16} /> : <IconAlertCircle size={16} />}
            >
              {grantMsg.text}
            </Alert>
          )}
          {baseLimitToday === null && devices.length > 0 && (
            <Alert color="yellow" icon={<IconHourglassLow size={16} />}>
              No daily limit is set, so extra time has nothing to add to. Set a limit above to use
              per-device time controls.
            </Alert>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
