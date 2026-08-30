// Background-side metadata extraction: fetches the watch page HTML and parses
// the embedded ytInitialPlayerResponse. All parsing is best-effort — callers
// must tolerate nulls (fail-closed handles breakage safely).

import type { VideoMeta } from '../../shared/types';

interface PlayerResponse {
  videoDetails?: {
    videoId?: string;
    title?: string;
    shortDescription?: string;
    lengthSeconds?: string;
    keywords?: string[];
    channelId?: string;
    author?: string;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: Array<{ baseUrl: string; languageCode?: string; kind?: string }>;
    };
  };
}

function extractPlayerResponse(html: string): PlayerResponse | null {
  const marker = 'ytInitialPlayerResponse = ';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  // Balance braces from the first '{' — the JSON is a single object literal.
  let i = html.indexOf('{', start);
  if (i === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(i, j + 1)) as PlayerResponse;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface FetchedVideo {
  meta: VideoMeta;
  transcriptExcerpt?: string;
}

export async function fetchVideoData(videoId: string): Promise<FetchedVideo | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const pr = extractPlayerResponse(html);
    const d = pr?.videoDetails;
    if (!d?.title) return null;

    const meta: VideoMeta = {
      videoId,
      title: d.title,
      description: d.shortDescription?.slice(0, 2000),
      channelId: d.channelId,
      channelTitle: d.author,
      durationSeconds: d.lengthSeconds ? parseInt(d.lengthSeconds, 10) : undefined,
      keywords: d.keywords,
    };

    let transcriptExcerpt: string | undefined;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const track = tracks?.find((t) => t.kind !== 'asr') ?? tracks?.[0];
    if (track?.baseUrl) {
      transcriptExcerpt = await fetchTranscriptExcerpt(track.baseUrl);
    }
    return { meta, transcriptExcerpt };
  } catch {
    return null;
  }
}

async function fetchTranscriptExcerpt(baseUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${baseUrl}&fmt=json3`, { credentials: 'omit' });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };
    const text = (data.events ?? [])
      .flatMap((e) => e.segs ?? [])
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? text.slice(0, 2500) : undefined;
  } catch {
    return undefined;
  }
}
