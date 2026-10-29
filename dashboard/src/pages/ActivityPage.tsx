import {
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconBan,
  IconClock,
  IconHandStop,
  IconPlayerPlay,
  IconSearch,
  IconWorld,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { ActivityEvent, SiteVisitEntry } from '../../../shared/types';
import { api } from '../api';

const TYPE_META: Record<ActivityEvent['type'], { label: string; color: string; icon: typeof IconPlayerPlay }> = {
  watched: { label: 'Watched', color: 'teal', icon: IconPlayerPlay },
  blocked: { label: 'Blocked', color: 'red', icon: IconBan },
  request_access: { label: 'Asked for', color: 'blue', icon: IconHandStop },
  time_used: { label: 'Screen time', color: 'gray', icon: IconClock },
  site_visit: { label: 'Visited site', color: 'grape', icon: IconWorld },
};

function fmtMinutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [device, setDevice] = useState('all');
  const [sort, setSort] = useState('newest');

  const [sites, setSites] = useState<SiteVisitEntry[]>([]);
  const [sitesDays, setSitesDays] = useState('7');

  useEffect(() => {
    let cancelled = false;
    const loadSites = async () => {
      if (document.hidden) return;
      try {
        const { sites } = await api.getSites(Number(sitesDays));
        if (!cancelled) setSites(sites);
      } catch {
        /* transient; next poll retries */
      }
    };
    void loadSites();
    const interval = setInterval(loadSites, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sitesDays]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return; // don't poll while the tab is backgrounded
      try {
        const { events } = await api.getActivity();
        if (!cancelled) {
          setEvents(events);
          setError('');
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const interval = setInterval(load, 15_000); // live view: refresh every 15s
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const devices = useMemo(() => [...new Set(events.map((e) => e.deviceName))].sort(), [events]);

  // Screen time today: the daily counter is cumulative, so take the max per device.
  const screenTimeToday = useMemo(() => {
    const today = new Date().toDateString();
    const byDevice: Record<string, number> = {};
    for (const e of events) {
      if (e.type !== 'time_used') continue;
      if (new Date(e.createdAt).toDateString() !== today) continue;
      const s = Number(e.detail?.secondsToday ?? 0);
      byDevice[e.deviceName] = Math.max(byDevice[e.deviceName] ?? 0, s);
    }
    return Object.entries(byDevice);
  }, [events]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => e.type !== 'site_visit') // aggregate rows live in the Sites card below
      .filter((e) => type === 'all' || e.type === type)
      .filter((e) => device === 'all' || e.deviceName === device)
      .filter(
        (e) => !q || (e.title ?? '').toLowerCase().includes(q) || (e.targetId ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => (sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [events, query, type, device, sort]);

  return (
    <Stack gap="md">
    <Card>
      <Stack gap="sm">
        <div>
          <Title order={4}>Activity</Title>
          <Text size="sm" c="dimmed">
            What each device has been up to recently. Refreshes automatically every 15 seconds.
          </Text>
        </div>
        {screenTimeToday.length > 0 && (
          <Group gap="xs">
            {screenTimeToday.map(([name, seconds]) => (
              <Badge key={name} size="lg" variant="light" color="gray" leftSection={<IconClock size={13} />}>
                {name}: {fmtMinutes(seconds)} today
              </Badge>
            ))}
          </Group>
        )}
        <Group gap="xs">
          <TextInput
            style={{ flex: 1, minWidth: 160 }}
            leftSection={<IconSearch size={14} />}
            placeholder="Search titles…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <Select
            w={140}
            data={[
              { value: 'all', label: 'All events' },
              { value: 'watched', label: 'Watched' },
              { value: 'blocked', label: 'Blocked' },
              { value: 'request_access', label: 'Requests' },
              { value: 'time_used', label: 'Screen time' },
            ]}
            value={type}
            onChange={(v) => v && setType(v)}
            allowDeselect={false}
          />
          {devices.length > 1 && (
            <Select
              w={160}
              data={[{ value: 'all', label: 'All devices' }, ...devices.map((d) => ({ value: d, label: d }))]}
              value={device}
              onChange={(v) => v && setDevice(v)}
              allowDeselect={false}
            />
          )}
          <Select
            w={130}
            data={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
            ]}
            value={sort}
            onChange={(v) => v && setSort(v)}
            allowDeselect={false}
          />
        </Group>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}
        {loading && (
          <Text c="dimmed" ta="center" py="lg">
            Loading…
          </Text>
        )}
        {!loading && !error && events.length === 0 && (
          <Text c="dimmed" ta="center" py="lg">
            Nothing yet.
          </Text>
        )}
        {!loading && events.length > 0 && visible.length === 0 && (
          <Text c="dimmed" ta="center" py="lg">
            Nothing matches your filters.
          </Text>
        )}
        {visible.map((e) => {
          const meta = TYPE_META[e.type];
          return (
            <Group key={e.id} wrap="nowrap" gap="sm" py={4}>
              <ThemeIcon size={30} radius="xl" variant="light" color={meta.color}>
                <meta.icon size={16} />
              </ThemeIcon>
              <Stack gap={0} style={{ flex: 1 }}>
                <Group gap={6}>
                  <Badge size="xs" variant="light" color={meta.color}>
                    {meta.label}
                  </Badge>
                  {e.targetId ? (
                    <Anchor
                      size="sm"
                      fw={500}
                      href={
                        e.targetKind === 'video'
                          ? `https://www.youtube.com/watch?v=${e.targetId}`
                          : `https://www.youtube.com/${e.targetId}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      {e.title || e.targetId}
                    </Anchor>
                  ) : e.type === 'time_used' ? (
                    <Text size="sm">{fmtMinutes(Number(e.detail?.secondsToday ?? 0))} so far that day</Text>
                  ) : (
                    <Text size="sm">{e.title ?? ''}</Text>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {e.deviceName} · {new Date(e.createdAt).toLocaleString()}
                </Text>
              </Stack>
            </Group>
          );
        })}
      </Stack>
    </Card>

    <Card>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Title order={4}>Sites visited</Title>
            <Text size="sm" c="dimmed">
              Every website the devices browse, counted by visit — not just YouTube. Devices
              running extension 0.3.0+ report these; hostnames only, never full page addresses.
            </Text>
          </div>
          <Select
            w={130}
            data={[
              { value: '1', label: 'Today' },
              { value: '7', label: 'Last 7 days' },
              { value: '30', label: 'Last 30 days' },
            ]}
            value={sitesDays}
            onChange={(v) => v && setSitesDays(v)}
            allowDeselect={false}
          />
        </Group>
        {sites.length === 0 ? (
          <Text c="dimmed" ta="center" py="lg">
            No site visits reported yet — devices start reporting once they update to
            extension 0.3.0.
          </Text>
        ) : (
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Site</Table.Th>
                <Table.Th>Visits</Table.Th>
                <Table.Th>Devices</Table.Th>
                <Table.Th>Last visited</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sites.map((s) => (
                <Table.Tr key={s.host}>
                  <Table.Td>
                    <Anchor size="sm" fw={500} href={`https://${s.host}`} target="_blank" rel="noreferrer">
                      {s.host}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{s.visits}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {s.deviceNames.split(',').join(', ')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="dimmed">
                      {new Date(s.lastAt).toLocaleString()}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
    </Stack>
  );
}
