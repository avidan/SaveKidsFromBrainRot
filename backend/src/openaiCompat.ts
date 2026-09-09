import { PROVIDER_INFO } from '../../shared/types';
import { RUBRIC, aiKey, type ClaudeResult, type UserContent } from './claude';
import type { Env } from './env';

// Google's Gemini API exposes an OpenAI-compatible endpoint, so a single
// Chat Completions client serves both OpenAI and Google — only the base URL
// and the key change. Google's docs confirm response_format json_schema
// works on their compat endpoint.
const BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
} as const;

type CompatProvider = 'openai' | 'google';

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function toChatParts(userContent: UserContent): ChatContentPart[] {
  const blocks = typeof userContent === 'string' ? [{ type: 'text' as const, text: userContent }] : userContent;
  return blocks.map((b) =>
    b.type === 'image'
      ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } }
      : { type: 'text', text: b.text },
  );
}

export async function callOpenAICompat(
  env: Env,
  provider: CompatProvider,
  model: string,
  criteria: string,
  userContent: UserContent,
  schema: object,
): Promise<ClaudeResult> {
  const apiLabel = provider === 'google' ? 'Google API' : 'OpenAI API';
  const apiKey = await aiKey(env, provider);
  if (!apiKey) {
    return {
      ok: false,
      refused: false,
      error: `No ${PROVIDER_INFO[provider].name} API key configured — open your dashboard and add one under AI connection`,
    };
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URLS[provider]}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              `${RUBRIC}\n\n` +
              `Parent's criteria:\n${criteria || '(The parent has not written criteria yet — return "unsure" for everything.)'}`,
          },
          { role: 'user', content: toChatParts(userContent) },
        ],
        // max_tokens is the compatibility field both providers accept.
        max_tokens: 4000,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'verdict', strict: false, schema },
        },
      }),
    });
  } catch (e) {
    // A thrown fetch (network/DNS/timeout) must degrade to an unsure verdict,
    // not a 500 — otherwise nothing is stored and nothing is diagnosable.
    const error = `${apiLabel} fetch threw: ${e instanceof Error ? e.message : String(e)}`;
    console.error(error);
    return { ok: false, refused: false, error };
  }

  if (!res.ok) {
    const body = await res.text();
    const error = `${apiLabel} ${res.status}: ${body.slice(0, 300)}`;
    console.error(error); // visible via `wrangler tail` when debugging
    return { ok: false, refused: false, error };
  }

  const data = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; refusal?: string | null };
    }>;
  };
  const choice = data.choices?.[0];
  if (!choice) return { ok: false, refused: false, error: 'No choices in response' };
  if (choice.message?.refusal || choice.finish_reason === 'content_filter') {
    return { ok: false, refused: true };
  }

  const text = choice.message?.content;
  if (!text) return { ok: false, refused: false, error: 'No text in response' };
  try {
    return { ok: true, refused: false, json: JSON.parse(text) };
  } catch {
    return { ok: false, refused: false, error: 'Unparseable JSON from model' };
  }
}
