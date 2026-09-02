import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Code,
  Container,
  CopyButton,
  Group,
  List,
  Stack,
  Stepper,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowLeft,
  IconBrandChrome,
  IconBrandYoutube,
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconDevices,
  IconExternalLink,
  IconFlask,
  IconPlug,
  IconRefresh,
  IconShieldCheck,
  IconSparkles,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import type { Settings, TestResponse } from '../../../shared/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { api, getBackendUrl } from '../api';
import { STORE_URL } from '../mobileconfig';

// A solid, opinionated starting point — parents edit the age and tweak from here.
const STARTER_CRITERIA = `Educational and calm content for a 8-year-old.

GREAT: science and nature, space, animals, how-things-work, LEGO and building, drawing and crafts, cooking with kids, math and reading, gentle storytelling.

NOT ALLOWED: brainrot (skibidi, mukbang, "satisfying" spam), rage gaming or shouty commentary, pranks, unboxing and haul videos, horror or jump-scares, anything with weapons or violence, clickbait designed purely for attention.

WHEN UNSURE: if it teaches something and stays calm, allow it. If it exists only to grab attention, block it.`;

const VERDICT_COLOR: Record<string, string> = { allow: 'teal', block: 'red', unsure: 'yellow' };

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [criteria, setCriteria] = useState(STARTER_CRITERIA);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairedName, setPairedName] = useState<string | null>(null);
  const deviceName = useRef('My Mac (testing)');

  const [testUrl, setTestUrl] = useState('https://www.youtube.com/@veritasium');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  const backend = getBackendUrl() || window.location.origin;

  // Seed settings from the (fresh) policy so saving doesn't clobber anything.
  useEffect(() => {
    void api
      .getPolicy()
      .then((p) => {
        setSettings({ ...DEFAULT_SETTINGS, ...p.settings });
        if (p.criteria.trim()) setCriteria(p.criteria);
      })
      .catch(() => undefined);
  }, []);

  // While on the pairing step, watch for the extension checking in.
  useEffect(() => {
    if (step !== 2 || pairedName) return;
    const interval = setInterval(() => {
      void api
        .getDevices()
        .then(({ devices }) => {
          const paired = devices.find((d) => d.pairedAt);
          if (paired) setPairedName(paired.name);
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(interval);
  }, [step, pairedName]);

  const saveRules = async () => {
    setSaving(true);
    setError('');
    try {
      await api.putPolicy(criteria, '', settings);
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save — try again');
    } finally {
      setSaving(false);
    }
  };

  const createCode = async () => {
    setError('');
    try {
      setPairCode(await api.createPairCode(deviceName.current));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code');
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError('');
    try {
      setTestResult(await api.test(testUrl));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const finish = () => {
    try {
      localStorage.setItem('skfbr.onboarded', '1');
    } catch {
      /* ignore */
    }
    onDone();
  };

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Group gap="sm">
            <ThemeIcon size={40} radius="md" variant="gradient" gradient={{ from: 'orange.5', to: 'orange.7' }}>
              <IconShieldCheck size={24} />
            </ThemeIcon>
            <div>
              <Title order={3} lh={1.1}>
                Let's set up your family
              </Title>
              <Text size="sm" c="dimmed">
                Five minutes, on this computer — so you see exactly what your kid will see.
              </Text>
            </div>
          </Group>
          <Anchor size="sm" c="dimmed" onClick={finish}>
            Skip for now
          </Anchor>
        </Group>

        <Stepper active={step} size="sm" iconSize={30}>
          <Stepper.Step label="Rules" icon={<IconSparkles size={16} />} />
          <Stepper.Step label="Install" icon={<IconBrandChrome size={16} />} />
          <Stepper.Step label="Pair" icon={<IconPlug size={16} />} />
          <Stepper.Step label="Try it" icon={<IconBrandYoutube size={16} />} />
          <Stepper.Step label="Done" icon={<IconCheck size={16} />} />
        </Stepper>

        {error && (
          <Alert color="red" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        {step === 0 && (
          <Card>
            <Stack gap="sm">
              <div>
                <Title order={4}>Write your family's rules</Title>
                <Text size="sm" c="dimmed">
                  Plain language — the AI judges every channel and video against exactly this text.
                  We've started you off; change the age and make it yours. You can refine it any
                  time, and add separate weekend rules later.
                </Text>
              </div>
              <Textarea
                autosize
                minRows={10}
                value={criteria}
                onChange={(e) => setCriteria(e.currentTarget.value)}
              />
              <Group justify="flex-end">
                <Button loading={saving} onClick={() => void saveRules()}>
                  Save & continue
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <Stack gap="sm">
              <div>
                <Title order={4}>Install the extension in Chrome — on this Mac</Title>
                <Text size="sm" c="dimmed">
                  Try it on your own computer first so you can see the whole flow; you'll add your
                  kid's computer (and remove this one) at the end. The extension does nothing until
                  it's paired with your dashboard.
                </Text>
              </div>
              <Group>
                <Button
                  component="a"
                  href={STORE_URL}
                  target="_blank"
                  rel="noreferrer"
                  leftSection={<IconBrandChrome size={18} />}
                  rightSection={<IconExternalLink size={14} />}
                >
                  Get it from the Chrome Web Store
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                The listing is unlisted — only people with this link can find it.
              </Text>
              <Group justify="space-between" mt="xs">
                <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={14} />} onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button onClick={() => setStep(2)}>It's installed — continue</Button>
              </Group>
            </Stack>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <Stack gap="sm">
              <div>
                <Title order={4}>Pair this computer</Title>
                <Text size="sm" c="dimmed">
                  Click the extension's icon in Chrome's toolbar (the orange shield — check the
                  puzzle-piece menu if it's hidden), open <b>Options</b>, and enter these two
                  things:
                </Text>
              </div>
              <Group gap="xs" align="center">
                <Text size="sm" fw={500} w={110}>
                  Dashboard URL
                </Text>
                <Code style={{ flex: 1 }}>{backend}</Code>
                <CopyButton value={backend}>
                  {({ copied, copy }) => (
                    <Button size="compact-sm" variant="default" onClick={copy} leftSection={copied ? <IconCheck size={13} /> : <IconCopy size={13} />}>
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  )}
                </CopyButton>
              </Group>
              {!pairCode ? (
                <Group>
                  <TextInput
                    defaultValue={deviceName.current}
                    onChange={(e) => (deviceName.current = e.currentTarget.value)}
                    label="Name this device"
                    maw={260}
                  />
                  <Button mt={24} onClick={() => void createCode()}>
                    Generate pairing code
                  </Button>
                </Group>
              ) : (
                <div>
                  <div className="paircode">{pairCode.code}</div>
                  <Group justify="space-between" mt={6}>
                    <Text size="xs" c="dimmed">
                      Expires {new Date(pairCode.expiresAt).toLocaleTimeString()}.
                    </Text>
                    <Button size="compact-sm" variant="subtle" leftSection={<IconRefresh size={13} />} onClick={() => void createCode()}>
                      New code
                    </Button>
                  </Group>
                </div>
              )}
              {pairedName ? (
                <Alert color="teal" icon={<IconCircleCheck size={16} />}>
                  <b>“{pairedName}” is paired and protected.</b> Filtering is on for this computer.
                </Alert>
              ) : (
                pairCode && (
                  <Text size="sm" c="dimmed">
                    Waiting for the extension to check in… this updates automatically the moment
                    you pair.
                  </Text>
                )
              )}
              <Group justify="space-between" mt="xs">
                <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={14} />} onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button disabled={!pairedName} onClick={() => setStep(3)}>
                  Continue
                </Button>
              </Group>
            </Stack>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <Stack gap="sm">
              <div>
                <Title order={4}>Watch it work</Title>
                <Text size="sm" c="dimmed">
                  Open YouTube in a new tab — the feed filters itself against your rules, and
                  clicking any video holds it behind a quick check. Blocked things show a friendly
                  screen with an “ask my grown-up” button that lands in your Review tab.
                </Text>
              </div>
              <Group>
                <Button
                  component="a"
                  href="https://www.youtube.com"
                  target="_blank"
                  rel="noreferrer"
                  variant="light"
                  leftSection={<IconBrandYoutube size={18} />}
                  rightSection={<IconExternalLink size={14} />}
                >
                  Open YouTube
                </Button>
              </Group>
              <Text size="sm" fw={500} mt="xs">
                Or test a specific channel or video without leaving this page:
              </Text>
              <Group wrap="nowrap" align="center">
                <TextInput style={{ flex: 1 }} value={testUrl} onChange={(e) => setTestUrl(e.currentTarget.value)} />
                <Button loading={testing} leftSection={<IconFlask size={16} />} onClick={() => void runTest()}>
                  Judge it
                </Button>
              </Group>
              {testResult && (
                <Alert
                  color={VERDICT_COLOR[testResult.verdict.decision] ?? 'gray'}
                  title={
                    <Group gap="xs">
                      {(testResult.extracted as { title: string }).title}
                      <Badge color={VERDICT_COLOR[testResult.verdict.decision] ?? 'gray'}>
                        {testResult.verdict.decision}
                      </Badge>
                    </Group>
                  }
                >
                  {testResult.verdict.reason} · confidence {Math.round(testResult.verdict.confidence * 100)}%
                </Alert>
              )}
              <Group justify="space-between" mt="xs">
                <Button variant="subtle" color="gray" leftSection={<IconArrowLeft size={14} />} onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button onClick={() => setStep(4)}>Looks good — continue</Button>
              </Group>
            </Stack>
          </Card>
        )}

        {step === 4 && (
          <Card>
            <Stack gap="sm">
              <Center>
                <ThemeIcon size={56} radius="xl" color="teal" variant="light">
                  <IconCircleCheck size={34} />
                </ThemeIcon>
              </Center>
              <Title order={4} ta="center">
                You're set up!
              </Title>
              <Text size="sm" c="dimmed" ta="center">
                Everything from here is remote — you'll never need your kid's laptop again after a
                one-time install.
              </Text>
              <List spacing="sm" size="sm" mt="xs" icon={<IconDevices size={16} />}>
                <List.Item>
                  <b>Protect your kid's computer:</b> Devices tab → on a Mac, <i>Download Mac setup
                  profile</i> installs, pairs, and locks it down in one file; anything else uses a
                  pairing code, just like you did.
                </List.Item>
                <List.Item icon={<IconSparkles size={16} />}>
                  <b>Tune as you go:</b> the Review tab collects requests and borderline calls;
                  Rules can differ on a weekly schedule (school days vs weekend); the pause button
                  up top stops all YouTube instantly.
                </List.Item>
                <List.Item icon={<IconPlug size={16} />}>
                  <b>Talk to it from Claude:</b> the API &amp; MCP tab connects your dashboard to
                  claude.ai — “what did the kids watch today?” just works.
                </List.Item>
                <List.Item icon={<IconShieldCheck size={16} />}>
                  <b>When you're done testing here,</b> revoke “{pairedName ?? 'your test device'}”
                  in the Devices tab and uninstall the extension from your own Chrome.
                </List.Item>
              </List>
              <Center mt="sm">
                <Button size="md" onClick={finish}>
                  Go to my dashboard
                </Button>
              </Center>
            </Stack>
          </Card>
        )}
      </Stack>
    </Container>
  );
}
