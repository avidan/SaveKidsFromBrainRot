import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconBrandApple,
  IconCheck,
  IconCopy,
  IconDeviceLaptop,
  IconDownload,
  IconKey,
  IconTicket,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { DeviceInfo } from '../../../shared/types';
import { api, getBackendUrl } from '../api';
import { buildMobileconfig } from '../mobileconfig';

function lastSeenBadge(d: DeviceInfo) {
  if (!d.lastSeenAt) return <Badge size="sm" color="gray" variant="light">never seen</Badge>;
  const mins = (Date.now() - d.lastSeenAt) / 60_000;
  if (mins < 10) return <Badge size="sm" color="teal" variant="light">online</Badge>;
  if (mins < 24 * 60) return <Badge size="sm" color="yellow" variant="light">seen today</Badge>;
  return <Badge size="sm" color="gray" variant="light">inactive</Badge>;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [deviceName, setDeviceName] = useState('');
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [minted, setMinted] = useState<{ name: string; token: string } | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);

  const load = async () => {
    const { devices } = await api.getDevices();
    setDevices(devices);
  };
  useEffect(() => {
    void load();
  }, []);

  const createCode = async () => {
    setMinted(null);
    setProfileFor(null);
    setPairCode(await api.createPairCode(deviceName || 'Kid laptop'));
  };

  const mintToken = async () => {
    setPairCode(null);
    setProfileFor(null);
    const name = deviceName || 'Kid laptop';
    const { deviceToken } = await api.mintDeviceToken(name);
    setMinted({ name, token: deviceToken });
    await load();
  };

  // Mint a token and wrap it in a ready-to-install macOS profile: force-install
  // + auto-pairing + kid-proofing, no MDM needed.
  const downloadProfile = async () => {
    setPairCode(null);
    setMinted(null);
    const name = deviceName || 'Kid laptop';
    const { deviceToken } = await api.mintDeviceToken(name);
    const backendUrl = getBackendUrl() || window.location.origin;
    const xml = buildMobileconfig({ backendUrl, deviceName: name, deviceToken });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([xml], { type: 'application/x-apple-aspen-config' }));
    a.download = `skfbr.${slug}.mobileconfig`;
    a.click();
    URL.revokeObjectURL(a.href);
    setProfileFor(name);
    await load();
  };

  const revoke = async (id: string) => {
    if (!confirm('Revoke this device? It will stop enforcing rules until re-paired.')) return;
    await api.revokeDevice(id);
    await load();
  };

  return (
    <Stack gap="md">
      <Card>
        <Stack gap="sm">
          <div>
            <Title order={4}>Add a device</Title>
            <Text size="sm" c="dimmed">
              Two ways in: a <b>pairing code</b> (install the extension on the kid's laptop, open
              its setup page, type the code — expires in 15 minutes), or the{' '}
              <b>Mac setup profile</b> — installed once on the kid's Mac, it force-installs the
              extension, pairs it, and disables incognito, no MDM needed. MDM fleets can mint a raw
              device token instead.
            </Text>
          </div>
          <TextInput
            label="Device name"
            value={deviceName}
            onChange={(e) => setDeviceName(e.currentTarget.value)}
            placeholder="Maya's laptop"
            maw={340}
          />
          <Group gap="xs">
            <Button leftSection={<IconTicket size={16} />} onClick={() => void createCode()}>
              Generate pairing code
            </Button>
            <Button
              variant="light"
              leftSection={<IconBrandApple size={16} />}
              rightSection={<IconDownload size={14} />}
              onClick={() => void downloadProfile()}
            >
              Mac setup profile
            </Button>
            <Button variant="default" leftSection={<IconKey size={16} />} onClick={() => void mintToken()}>
              Mint MDM token
            </Button>
          </Group>

          {profileFor && (
            <Alert color="teal" icon={<IconCheck size={16} />} title={`Profile for “${profileFor}” downloaded`}>
              On the kid's Mac: copy the file over, double-click it, then open{' '}
              <b>System Settings → Privacy &amp; Security → Profiles</b>, double-click the pending
              profile, and click <b>Install</b> (admin password required). Restart Chrome — the
              extension installs and pairs itself, and incognito/guest mode are disabled. The file
              contains this device's credential: treat it like a password and delete it after
              installing. To undo later, remove the profile from the same screen.
            </Alert>
          )}
          {pairCode && (
            <div>
              <div className="paircode">{pairCode.code}</div>
              <Text size="xs" c="dimmed" mt={6}>
                Expires {new Date(pairCode.expiresAt).toLocaleTimeString()} — type this into the
                extension's setup page on the kid's computer.
              </Text>
            </div>
          )}
          {minted && (
            <div>
              <Text fw={600} size="sm">
                Device token for “{minted.name}” — shown once, copy it now:
              </Text>
              <code className="secret-box" style={{ margin: '8px 0' }}>
                {minted.token}
              </code>
              <Group gap="xs" mt={4}>
                <CopyButton value={minted.token}>
                  {({ copied, copy }) => (
                    <Button
                      size="compact-sm"
                      variant="default"
                      leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      onClick={copy}
                    >
                      {copied ? 'Copied' : 'Copy token'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
              <Text size="xs" c="dimmed" mt={6}>
                Paste it as <b>deviceToken</b> (both places) in this device's .mobileconfig. This is
                a credential, not a pairing code.
              </Text>
            </div>
          )}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          <Title order={4}>Paired devices</Title>
          {devices.length === 0 && (
            <Text c="dimmed" ta="center" py="lg">
              No devices paired yet.
            </Text>
          )}
          {devices.map((d) => (
            <Group key={d.id} justify="space-between" wrap="nowrap" py={6}>
              <Group gap="sm" wrap="nowrap">
                <IconDeviceLaptop size={20} color="var(--mantine-color-gray-6)" />
                <Stack gap={2}>
                  <Group gap="xs">
                    <Text fw={600} size="sm">
                      {d.name}
                    </Text>
                    {lastSeenBadge(d)}
                  </Group>
                  <Text size="xs" c="dimmed">
                    Paired {d.pairedAt ? new Date(d.pairedAt).toLocaleDateString() : '—'} · last seen{' '}
                    {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}
                  </Text>
                </Stack>
              </Group>
              <Button size="compact-sm" color="red" variant="light" onClick={() => void revoke(d.id)}>
                Revoke
              </Button>
            </Group>
          ))}
        </Stack>
      </Card>
    </Stack>
  );
}
