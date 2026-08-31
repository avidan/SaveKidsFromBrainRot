import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Image,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconCircleCheck, IconSearch } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReviewItem } from '../../../shared/types';
import { api } from '../api';

const SOURCE_LABEL: Record<ReviewItem['source'], { label: string; color: string }> = {
  ai_unsure: { label: 'AI was unsure', color: 'yellow' },
  ai_block: { label: 'AI blocked', color: 'red' },
  kid_request: { label: 'Kid asked', color: 'blue' },
};

function targetUrl(item: ReviewItem): string {
  return item.kind === 'video'
    ? `https://www.youtube.com/watch?v=${item.targetId}`
    : `https://www.youtube.com/${item.targetId.startsWith('@') ? item.targetId : `channel/${item.targetId}`}`;
}

export default function ReviewPage({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState('newest');

  useEffect(() => {
    void api
      .getReview()
      .then(({ items }) => setItems(items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => kind === 'all' || i.kind === kind)
      .filter((i) => source === 'all' || i.source === source)
      .filter(
        (i) =>
          !q ||
          i.title.toLowerCase().includes(q) ||
          i.reason.toLowerCase().includes(q) ||
          i.targetId.toLowerCase().includes(q),
      )
      .sort((a, b) => (sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [items, query, kind, source, sort]);

  const resolve = async (id: number, action: 'allow' | 'block' | 'dismiss') => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    onChanged();
    try {
      await api.resolveReview(id, action);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save decision');
    }
  };

  return (
    <Card>
      <Stack gap="sm">
        <div>
          <Title order={4}>Review queue</Title>
          <Text size="sm" c="dimmed">
            Things the AI wasn't sure about, videos it blocked, and requests from your kid.
            Allow or block pins your decision permanently.
          </Text>
        </div>
        <Group gap="xs">
          <TextInput
            style={{ flex: 1, minWidth: 180 }}
            leftSection={<IconSearch size={14} />}
            placeholder="Search title, reason, or ID…"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <Select
            w={120}
            data={[
              { value: 'all', label: 'All types' },
              { value: 'video', label: 'Videos' },
              { value: 'channel', label: 'Channels' },
            ]}
            value={kind}
            onChange={(v) => v && setKind(v)}
            allowDeselect={false}
          />
          <Select
            w={140}
            data={[
              { value: 'all', label: 'All sources' },
              { value: 'kid_request', label: 'Kid requests' },
              { value: 'ai_unsure', label: 'AI unsure' },
              { value: 'ai_block', label: 'AI blocked' },
            ]}
            value={source}
            onChange={(v) => v && setSource(v)}
            allowDeselect={false}
          />
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
        {!loading && !error && items.length === 0 && (
          <Alert color="teal" icon={<IconCircleCheck size={16} />}>
            All caught up! Nothing waiting for review.
          </Alert>
        )}
        {!loading && items.length > 0 && visible.length === 0 && (
          <Text c="dimmed" ta="center" py="lg">
            Nothing matches your filters.
          </Text>
        )}
        {visible.map((item) => (
          <Card key={item.id} padding="sm" bg="gray.0">
            <Group wrap="nowrap" align="flex-start">
              {item.kind === 'video' && (
                <Anchor href={targetUrl(item)} target="_blank" rel="noreferrer">
                  <Image
                    src={`https://i.ytimg.com/vi/${item.targetId}/mqdefault.jpg`}
                    w={120}
                    radius="sm"
                    loading="lazy"
                    alt=""
                  />
                </Anchor>
              )}
              <Stack gap={4} style={{ flex: 1 }}>
                <Group gap="xs">
                  <Anchor href={targetUrl(item)} target="_blank" rel="noreferrer" fw={600} size="sm">
                    {item.title || item.targetId}
                  </Anchor>
                  <Badge size="sm" variant="light" color={SOURCE_LABEL[item.source].color}>
                    {SOURCE_LABEL[item.source].label}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {item.kind} · {item.reason} · {new Date(item.createdAt).toLocaleString()}
                </Text>
                <Group gap="xs" mt={4}>
                  <Button size="compact-sm" color="teal" onClick={() => void resolve(item.id, 'allow')}>
                    Allow
                  </Button>
                  <Button size="compact-sm" color="red" onClick={() => void resolve(item.id, 'block')}>
                    Block
                  </Button>
                  <Button
                    size="compact-sm"
                    variant="default"
                    onClick={() => void resolve(item.id, 'dismiss')}
                  >
                    Dismiss
                  </Button>
                </Group>
              </Stack>
            </Group>
          </Card>
        ))}
      </Stack>
    </Card>
  );
}
