import {
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  List,
  Loader,
  Modal,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconBrandApple,
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconDeviceLaptop,
  IconDownload,
  IconKey,
  IconTicket,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { DeviceInfo } from '../../../shared/types';
import { api, getBackendUrl } from '../api';
import { buildMobileconfig, STORE_URL } from '../mobileconfig';

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
  const [profileInstalled, setProfileInstalled] = useState(false);

  // While the confirm-installation modal is open, watch for the profiled Mac
  // checking in — the device token exists from minting, so a fresh lastSeenAt
  // means the profile installed and Chrome picked the extension up.
  useEffect(() => {
    if (!profileFor || profileInstalled) return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      void api
        .getDevices()
        .then(({ devices }) => {
          setDevices(devices);
          const d = devices.find((x) => x.name === profileFor);
          if (d?.lastSeenAt && d.lastSeenAt >= startedAt - 60_000) setProfileInstalled(true);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(interval);
  }, [profileFor, profileInstalled]);

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
    setProfileInstalled(false);
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
              The easiest way in is the <b>Mac setup profile</b> — one file you install on the
              kid's Mac that force-installs the extension, pairs it, and disables incognito, no
              MDM needed. For non-Mac devices, use a <b>pairing code</b>:{' '}
              <a href={STORE_URL} target="_blank" rel="noreferrer">
                install the extension
              </a>{' '}
              on the kid's laptop, open its setup page, and type the code (expires in 15 minutes).
              MDM fleets can mint a raw device token instead.
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
            <Button
              leftSection={<IconBrandApple size={16} />}
              rightSection={<IconDownload size={14} />}
              onClick={() => void downloadProfile()}
            >
              Mac setup profile
            </Button>
            <Button variant="light" leftSection={<IconTicket size={16} />} onClick={() => void createCode()}>
              Generate pairing code
            </Button>
            <Button variant="default" leftSection={<IconKey size={16} />} onClick={() => void mintToken()}>
              Mint MDM token
            </Button>
          </Group>

          <Modal
            opened={!!profileFor}
            onClose={() => setProfileFor(null)}
            title={
              <Group gap="xs">
                <IconBrandApple size={18} />
                <Text fw={700}>Install the profile on “{profileFor}”</Text>
              </Group>
            }
            size="lg"
            centered
          >
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                The profile downloaded to this computer. Now install it on the kid's Mac:
              </Text>
              <List type="ordered" spacing="sm" size="sm">
                <List.Item>
                  <b>Move the file to the kid's Mac</b> — AirDrop, USB stick, or a shared drive.
                  It's named <code>skfbr.*.mobileconfig</code>.
                </List.Item>
                <List.Item>
                  On the kid's Mac, <b>double-click the file</b>. macOS will say the profile is
                  ready to review — nothing is installed yet.
                </List.Item>
                <List.Item>
                  Open <b>System Settings → Privacy &amp; Security → Profiles</b>. You'll see{' '}
                  <b>SaveKidsFromBrainRot ({profileFor})</b> waiting under "Downloaded".
                </List.Item>
                <List.Item>
                  <b>Double-click it → Install → Install again</b> to confirm. macOS asks for an
                  administrator password.
                </List.Item>
                <List.Item>
                  <b>Quit and reopen Chrome.</b> Within a minute the extension appears in the
                  toolbar ("Installed by your administrator"), pairs itself, and incognito/guest
                  mode are disabled.
                </List.Item>
              </List>
              {profileInstalled ? (
                <Alert color="teal" icon={<IconCircleCheck size={16} />}>
                  <b>“{profileFor}” just checked in — the profile is installed and working.</b>{' '}
                  YouTube on that Mac is now protected.
                </Alert>
              ) : (
                <Alert color="gray" icon={<Loader size={14} color="orange" />}>
                  Watching for “{profileFor}” to check in… this updates by itself the moment the
                  profile is installed and Chrome restarts. Leave this open, or close it and watch
                  the device list below.
                </Alert>
              )}
              <Text size="xs" c="dimmed">
                The file contains this device's credential — treat it like a password and delete it
                from both Macs after installing. To undo everything later, remove the profile from
                that same Profiles screen.
              </Text>
              <Group justify="flex-end">
                <Button variant={profileInstalled ? 'filled' : 'default'} onClick={() => setProfileFor(null)}>
                  {profileInstalled ? 'Done' : 'Close'}
                </Button>
              </Group>
            </Stack>
          </Modal>
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
