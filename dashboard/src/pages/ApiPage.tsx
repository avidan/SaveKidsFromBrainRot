import {
  Alert,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconCheck, IconCopy, IconKey, IconPlus, IconSparkles } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { ApiKeyInfo } from '../../../shared/types';
import { api, getBackendUrl } from '../api';

export default function ApiPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);

  const backend = getBackendUrl();

  const load = async () => {
    const { keys } = await api.listApiKeys();
    setKeys(keys);
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const keyName = name || 'API key';
    const { key } = await api.createApiKey(keyName);
    setCreated({ name: keyName, key });
    setName('');
    await load();
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this key? Anything using it (including MCP connections) stops working.')) return;
    await api.revokeApiKey(id);
    if (created) setCreated(null);
    await load();
  };

  const mcpUrl = created ? `${backend}/mcp/${created.key}` : `${backend}/mcp/<your-key>`;

  return (
    <Stack gap="md">
      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>API keys</Title>
            <Text size="sm" c="dimmed">
              Keys give programmatic access to your family's data — same powers as this dashboard.
              Shown once at creation; revoke anytime.
            </Text>
          </div>
          <Group align="flex-end" gap="xs">
            <TextInput
              label="Key name"
              style={{ flex: 1 }}
              maw={320}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. Claude MCP"
            />
            <Button leftSection={<IconPlus size={16} />} onClick={() => void create()}>
              Create key
            </Button>
          </Group>
          {created && (
            <Alert color="orange" icon={<IconKey size={16} />} title={`“${created.name}” — copy it now, it won't be shown again`}>
              <code className="secret-box">{created.key}</code>
              <Group mt="xs">
                <CopyButton value={created.key}>
                  {({ copied, copy }) => (
                    <Button
                      size="compact-sm"
                      variant="default"
                      leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      onClick={copy}
                    >
                      {copied ? 'Copied' : 'Copy key'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
            </Alert>
          )}
          {keys.map((k) => (
            <Group key={k.id} justify="space-between" wrap="nowrap" py={4}>
              <Stack gap={2}>
                <Text fw={600} size="sm">
                  {k.name}
                </Text>
                <Text size="xs" c="dimmed">
                  Created {new Date(k.createdAt).toLocaleDateString()} · last used{' '}
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
                </Text>
              </Stack>
              <Button size="compact-sm" color="red" variant="light" onClick={() => void revoke(k.id)}>
                Revoke
              </Button>
            </Group>
          ))}
          {keys.length === 0 && (
            <Text c="dimmed" ta="center" py="md">
              No API keys yet.
            </Text>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>
              <Group gap={8}>
                <IconSparkles size={20} color="var(--mantine-color-orange-6)" />
                Connect Claude (MCP)
              </Group>
            </Title>
            <Text size="sm" c="dimmed">
              Manage everything conversationally — “what did the kids watch today?”, “approve that
              request”, “pause YouTube for an hour”, “make the weekend rules allow Minecraft”.
              Create a key above, then connect:
            </Text>
          </div>
          <div>
            <Text size="sm" fw={500}>
              claude.ai → Settings → Connectors → Add custom connector → URL:
            </Text>
            <Code block mt={4} style={{ wordBreak: 'break-all' }}>
              {mcpUrl}
            </Code>
          </div>
          <div>
            <Text size="sm" fw={500}>
              Claude Code:
            </Text>
            <Code block mt={4} style={{ wordBreak: 'break-all' }}>
              claude mcp add skfbr --transport http {backend}/mcp --header "Authorization: Bearer
              &lt;your-key&gt;"
            </Code>
          </div>
          <Text size="xs" c="dimmed">
            Tools exposed: policy &amp; criteria (week and weekend), pause/resume, review queue,
            overrides, activity, screen time, devices, and test-a-URL. The URL form embeds your key
            — treat that link as a secret.
          </Text>
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>REST API</Title>
            <Text size="sm" c="dimmed">
              Base <Code>{backend}/api/v1</Code> · header <Code>Authorization: Bearer &lt;key&gt;</Code>
            </Text>
          </div>
          <Group gap={6}>
            {[
              'GET /policy',
              'PUT /criteria',
              'POST /pause',
              'DELETE /pause',
              'GET /review',
              'POST /review/:id',
              'POST /overrides',
              'GET /activity',
              'GET /screen-time',
              'GET /devices',
              'POST /test',
            ].map((e) => (
              <Code key={e}>{e}</Code>
            ))}
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
