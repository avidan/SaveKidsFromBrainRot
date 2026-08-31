import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconPin, IconSearch } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { Override } from '../../../shared/types';
import { api } from '../api';

export default function OverridesPage() {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'channel' | 'video'>('channel');
  const [targetId, setTargetId] = useState('');
  const [decision, setDecision] = useState<'allow' | 'block'>('allow');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filterKind, setFilterKind] = useState('all');
  const [filterDecision, setFilterDecision] = useState('all');
  const [sort, setSort] = useState('newest');

  const load = async () => {
    try {
      const { overrides } = await api.getOverrides();
      setOverrides(overrides);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return overrides
      .filter((o) => filterKind === 'all' || o.kind === filterKind)
      .filter((o) => filterDecision === 'all' || o.decision === filterDecision)
      .filter((o) => !q || o.targetId.toLowerCase().includes(q) || (o.note ?? '').toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort === 'az') return a.targetId.localeCompare(b.targetId);
        return sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
      });
  }, [overrides, query, filterKind, filterDecision, sort]);

  const add = async () => {
    setError('');
    let id = targetId.trim();
    const video = id.match(/[?&]v=([\w-]{6,})/) ?? id.match(/youtu\.be\/([\w-]{6,})/);
    const handle = id.match(/youtube\.com\/(@[\w.-]+)/);
    if (kind === 'video' && video) id = video[1];
    if (kind === 'channel' && handle) id = handle[1];
    if (!id) {
      setError('Enter a channel handle (@name), video ID, or URL');
      return;
    }
    try {
      await api.addOverride(kind, id, decision, 'Added by parent');
      setTargetId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  const remove = async (o: Override) => {
    await api.deleteOverride(o.kind, o.targetId);
    await load();
  };

  return (
    <Card>
      <Stack gap="sm">
        <div>
          <Title order={4}>Pinned decisions</Title>
          <Text size="sm" c="dimmed">
            These always win over the AI, in both rule modes. Channel handles look like{' '}
            <b>@veritasium</b>; video IDs are the 11 characters after <b>watch?v=</b> (URLs work
            too).
          </Text>
        </div>
        <Grid gutter="sm" align="flex-end">
          <Grid.Col span={{ base: 6, sm: 2.5 }}>
            <Select
              label="Type"
              data={[
                { value: 'channel', label: 'Channel' },
                { value: 'video', label: 'Video' },
              ]}
              value={kind}
              onChange={(v) => v && setKind(v as 'channel' | 'video')}
              allowDeselect={false}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, sm: 2.5 }}>
            <Select
              label="Decision"
              data={[
                { value: 'allow', label: 'Always allow' },
                { value: 'block', label: 'Always block' },
              ]}
              value={decision}
              onChange={(v) => v && setDecision(v as 'allow' | 'block')}
              allowDeselect={false}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 5 }}>
            <TextInput
              label="Channel / video"
              value={targetId}
              onChange={(e) => setTargetId(e.currentTarget.value)}
              placeholder="@veritasium, dQw4w9WgXcQ, or a URL"
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 2 }}>
            <Button fullWidth leftSection={<IconPin size={15} />} onClick={() => void add()}>
              Pin
            </Button>
          </Grid.Col>
        </Grid>
        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Divider my={4} />

        <Group gap="xs">
          <TextInput
            style={{ flex: 1, minWidth: 160 }}
            leftSection={<IconSearch size={14} />}
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <Select
            w={120}
            data={[
              { value: 'all', label: 'All types' },
              { value: 'channel', label: 'Channels' },
              { value: 'video', label: 'Videos' },
            ]}
            value={filterKind}
            onChange={(v) => v && setFilterKind(v)}
            allowDeselect={false}
          />
          <Select
            w={130}
            data={[
              { value: 'all', label: 'Allow + block' },
              { value: 'allow', label: 'Allowed' },
              { value: 'block', label: 'Blocked' },
            ]}
            value={filterDecision}
            onChange={(v) => v && setFilterDecision(v)}
            allowDeselect={false}
          />
          <Select
            w={130}
            data={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'az', label: 'A → Z' },
            ]}
            value={sort}
            onChange={(v) => v && setSort(v)}
            allowDeselect={false}
          />
        </Group>

        {loading && (
          <Text c="dimmed" ta="center" py="lg">
            Loading…
          </Text>
        )}
        {!loading && overrides.length === 0 && (
          <Text c="dimmed" ta="center" py="lg">
            No pinned decisions yet.
          </Text>
        )}
        {!loading && overrides.length > 0 && visible.length === 0 && (
          <Text c="dimmed" ta="center" py="lg">
            Nothing matches your filters.
          </Text>
        )}
        {visible.map((o) => (
          <Group key={`${o.kind}:${o.targetId}`} justify="space-between" wrap="nowrap" py={6}>
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={600} size="sm">
                  {o.targetId}
                </Text>
                <Badge size="sm" color={o.decision === 'allow' ? 'teal' : 'red'} variant="light">
                  {o.decision}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {o.kind}
                {o.note ? ` · ${o.note}` : ''} · {new Date(o.createdAt).toLocaleDateString()}
              </Text>
            </Stack>
            <Button size="compact-sm" variant="default" onClick={() => void remove(o)}>
              Remove
            </Button>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
