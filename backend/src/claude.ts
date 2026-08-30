import type { ChannelMeta, Decision, Verdict, VideoMeta } from '../../shared/types';
import type { Env } from './env';

const API_URL = 'https://api.anthropic.com/v1/messages';

const RUBRIC = `You are a parental-control classifier for YouTube. A parent has written criteria describing what their child may watch. You will receive metadata about YouTube channels or individual videos, and you must decide for each item:

- "allow": clearly consistent with the parent's criteria.
- "block": violates the criteria, or exhibits the engagement-bait / "brainrot" patterns the criteria prohibit.
- "unsure": not enough information, or genuinely borderline — a human parent should decide.

Guidance:
- Judge only from the evidence given; do not assume good or bad faith beyond it.
- Titles engineered for compulsive clicking (ALL-CAPS, emoji spam, "YOU WON'T BELIEVE", rage-bait framing) weigh toward blocking when the criteria target such content.
- When the criteria mention an age, apply age-appropriateness with common sense.
- "confidence" is a number from 0 to 1.
- "reason" is one short sentence a parent can read at a glance.
- Err toward "unsure" rather than guessing: an unsure verdict is reviewed by the parent, a wrong allow is not.`;

const CHANNEL_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          channelId: { type: 'string' },
          decision: { type: 'string', enum: ['allow', 'block', 'unsure'] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['channelId', 'decision', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
} as const;

const VIDEO_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['allow', 'block', 'unsure', 'escalate'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['decision', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

const FINAL_VIDEO_SCHEMA = {
  ...VIDEO_SCHEMA,
  properties: {
    ...VIDEO_SCHEMA.properties,
    decision: { type: 'string', enum: ['allow', 'block', 'unsure'] },
  },
} as const;

type UserContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;

interface ClaudeResult {
  ok: boolean;
  refused: boolean;
  json?: unknown;
  error?: string;
}

// Not every model accepts every parameter — sending an unsupported one is a
// 400 and the evaluation fails outright. Gate by model family:
//  - effort: supported on the Opus/Sonnet/Fable 5 lines; ERRORS on Haiku 4.5.
//  - server-side refusal fallbacks: Opus 5 / Fable 5 / Mythos 5 only.
function supportsEffort(model: string): boolean {
  return /^claude-(opus|sonnet|fable|mythos)-5/.test(model) || /^claude-opus-4-[5-9]/.test(model);
}
function supportsFallbacks(model: string): boolean {
  return /^claude-(opus|fable|mythos)-5/.test(model);
}

async function callClaude(
  env: Env,
  model: string,
  criteria: string,
  userContent: UserContent,
  schema: object,
  effort?: 'low' | 'medium' | 'high',
): Promise<ClaudeResult> {
  const useFallbacks = supportsFallbacks(model);
  let res: Response;
  try {
    res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // Server-side fallback: if safety classifiers decline (possible on
      // claude-opus-5), the API re-runs the request on the recommended
      // fallback model within the same call.
      ...(useFallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
    },
    body: JSON.stringify({
      model,
      // Thinking is on by default on current models and shares this budget —
      // keep generous headroom so batch verdicts never truncate mid-JSON.
      max_tokens: 16000,
      ...(effort && supportsEffort(model) ? { output_config: { effort } } : {}),
      ...(useFallbacks ? { fallbacks: 'default' } : {}),
      // Stable rubric first, then per-family criteria with a cache breakpoint:
      // repeated evaluations for the same family hit the prompt cache.
      system: [
        { type: 'text', text: RUBRIC },
        {
          type: 'text',
          text: `Parent's criteria:\n${criteria || '(The parent has not written criteria yet — return "unsure" for everything.)'}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: userContent }],
    }),
    });
  } catch (e) {
    // A thrown fetch (network/DNS/timeout) must degrade to an unsure verdict,
    // not a 500 — otherwise nothing is stored and nothing is diagnosable.
    const error = `Claude API fetch threw: ${e instanceof Error ? e.message : String(e)}`;
    console.error(error);
    return { ok: false, refused: false, error };
  }

  if (!res.ok) {
    const body = await res.text();
    const error = `Claude API ${res.status}: ${body.slice(0, 300)}`;
    console.error(error); // visible via `wrangler tail` when debugging
    return { ok: false, refused: false, error };
  }

  const data = (await res.json()) as {
    stop_reason: string;
    content: Array<{ type: string; text?: string }>;
  };

  if (data.stop_reason === 'refusal') {
    return { ok: false, refused: true };
  }

  const text = data.content.find((b) => b.type === 'text')?.text;
  if (!text) return { ok: false, refused: false, error: 'No text block in response' };
  try {
    return { ok: true, refused: false, json: JSON.parse(text) };
  } catch {
    return { ok: false, refused: false, error: 'Unparseable JSON from model' };
  }
}

function unsureVerdict(reason: string): Verdict {
  return { decision: 'unsure', confidence: 0, reason, evaluatedAt: Date.now(), source: 'ai' };
}

export async function evaluateChannels(
  env: Env,
  model: string,
  criteria: string,
  channels: ChannelMeta[],
): Promise<Record<string, Verdict>> {
  const prompt = [
    'Evaluate each of the following YouTube channels against the parent\'s criteria.',
    'Return one verdict per channel, keyed by the exact "channelId" given.',
    '',
    JSON.stringify(
      channels.map((c) => ({
        channelId: c.channelId,
        title: c.title,
        handle: c.handle,
        description: c.description?.slice(0, 1000),
        sampleVideoTitles: c.videoTitles?.slice(0, 15),
      })),
      null,
      2,
    ),
  ].join('\n');

  // Channel triage is latency-sensitive (a kid is staring at a blurred feed):
  // run at low effort. Quality holds up well for this shape of judgment, and
  // borderline channels surface as "unsure" for the parent anyway.
  const result = await callClaude(env, model, criteria, prompt, CHANNEL_SCHEMA, 'low');
  const out: Record<string, Verdict> = {};

  if (result.ok) {
    const parsed = result.json as {
      verdicts: Array<{ channelId: string; decision: Decision; confidence: number; reason: string }>;
    };
    for (const v of parsed.verdicts) {
      out[v.channelId] = {
        decision: v.decision,
        confidence: v.confidence,
        reason: v.reason,
        evaluatedAt: Date.now(),
        source: 'ai',
      };
    }
  }
  // Anything the model failed to return (or the whole call failing) → unsure.
  // Include the underlying error so the review queue doubles as diagnostics.
  const failReason = result.refused
    ? 'Safety system declined to evaluate; needs parent review'
    : `Evaluation failed (${result.error?.slice(0, 160) ?? 'unknown error'})`;
  for (const c of channels) {
    if (!out[c.channelId]) out[c.channelId] = unsureVerdict(failReason);
  }
  return out;
}

async function fetchThumbnailBase64(videoId: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < buf.length; i += chunk) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunk));
    }
    return { data: btoa(binary), mediaType: 'image/jpeg' };
  } catch {
    return null;
  }
}

function videoPromptText(
  video: VideoMeta,
  channelPrior: Verdict | null,
  transcriptExcerpt?: string,
): string {
  return [
    'Evaluate this single YouTube video against the parent\'s criteria.',
    channelPrior
      ? `Context: the video's channel was previously judged "${channelPrior.decision}" (${channelPrior.reason}). Use this as a prior, not a conclusion — good channels post bad videos and vice versa.`
      : 'Context: the video\'s channel has not been evaluated yet.',
    '',
    JSON.stringify(
      {
        videoId: video.videoId,
        title: video.title,
        channelTitle: video.channelTitle,
        description: video.description?.slice(0, 1500),
        durationSeconds: video.durationSeconds,
        keywords: video.keywords?.slice(0, 25),
      },
      null,
      2,
    ),
    transcriptExcerpt ? `\nTranscript excerpt (start of video):\n${transcriptExcerpt.slice(0, 4000)}` : '',
  ].join('\n');
}

/**
 * Two-pass video evaluation:
 *  1. Lightweight pass on text metadata. The model may answer "escalate".
 *  2. On escalate, a full pass including the thumbnail image (a strong
 *     brainrot signal) and the transcript excerpt when available.
 */
export async function evaluateVideo(
  env: Env,
  model: string,
  criteria: string,
  video: VideoMeta,
  channelPrior: Verdict | null,
  transcriptExcerpt?: string,
): Promise<Verdict> {
  const lightPrompt =
    videoPromptText(video, channelPrior) +
    '\n\nIf you could decide substantially better by seeing the video thumbnail and a transcript excerpt, return "escalate" instead of guessing.';

  // The lightweight pass gates playback interactively — low effort keeps the
  // wait short; anything genuinely hard escalates to the full-effort pass.
  const light = await callClaude(env, model, criteria, lightPrompt, VIDEO_SCHEMA, 'low');

  if (!light.ok) {
    return unsureVerdict(
      light.refused
        ? 'Safety system declined to evaluate; needs parent review'
        : `Evaluation failed (${light.error?.slice(0, 160) ?? 'unknown error'})`,
    );
  }

  const lightVerdict = light.json as { decision: Decision | 'escalate'; confidence: number; reason: string };
  if (lightVerdict.decision !== 'escalate') {
    return {
      decision: lightVerdict.decision,
      confidence: lightVerdict.confidence,
      reason: lightVerdict.reason,
      evaluatedAt: Date.now(),
      source: 'ai',
    };
  }

  // Escalation pass: add thumbnail + transcript.
  const thumb = await fetchThumbnailBase64(video.videoId);
  const content: UserContent = [];
  if (thumb) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: thumb.mediaType, data: thumb.data },
    });
  }
  content.push({
    type: 'text',
    text:
      videoPromptText(video, channelPrior, transcriptExcerpt) +
      (thumb ? '\n\nThe image above is the video\'s thumbnail.' : ''),
  });

  const full = await callClaude(env, model, criteria, content, FINAL_VIDEO_SCHEMA);
  if (!full.ok) {
    return unsureVerdict('Needed a closer look but the follow-up evaluation failed; needs parent review');
  }
  const v = full.json as { decision: Decision; confidence: number; reason: string };
  return { decision: v.decision, confidence: v.confidence, reason: v.reason, evaluatedAt: Date.now(), source: 'ai' };
}
