// Parent notifications. Two channels, both optional and configured per-family
// in Settings.notifications:
//  - ntfy.sh push: parent installs the ntfy app and subscribes to a topic name.
//    Zero-infrastructure phone push. Topic names are effectively passwords —
//    the dashboard suggests generating a long random one.
//  - Email via Resend: requires the RESEND_API_KEY secret on the Worker.

import type { Settings } from '../../shared/types';
import type { Env } from './env';

export function shouldNotify(settings: Settings, trigger: 'kid_request' | 'ai_flag'): boolean {
  const n = settings.notifications;
  if (!n) return false;
  if (!n.ntfyTopic && !n.email) return false;
  return trigger === 'kid_request' ? n.onKidRequest : n.onAiFlag;
}

export async function notifyParent(
  env: Env,
  settings: Settings,
  subject: string,
  body: string,
): Promise<void> {
  const n = settings.notifications;
  if (!n) return;
  await sendDirect(env, { ntfyTopic: n.ntfyTopic, email: n.email }, subject, body);
}

/** Send to explicit targets — used by notifyParent and the password-reset flow. */
export async function sendDirect(
  env: Env,
  target: { ntfyTopic?: string | null; email?: string | null },
  subject: string,
  body: string,
): Promise<{ delivered: boolean }> {
  const n = target;
  const jobs: Promise<unknown>[] = [];

  if (n.ntfyTopic) {
    jobs.push(
      fetch(`https://ntfy.sh/${encodeURIComponent(n.ntfyTopic)}`, {
        method: 'POST',
        headers: { Title: subject, Tags: 'shield' },
        body,
      }).catch(() => undefined),
    );
  }

  if (n.email && env.RESEND_API_KEY) {
    jobs.push(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: env.NOTIFY_FROM ?? 'SaveKidsFromBrainRot <onboarding@resend.dev>',
          to: [n.email],
          subject,
          text: body,
        }),
      }).catch(() => undefined),
    );
  }

  await Promise.all(jobs);
  return { delivered: jobs.length > 0 };
}
