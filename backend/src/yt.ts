// Server-side YouTube metadata extraction — used only by the dashboard's
// "test a URL" preview. The extension gathers richer metadata client-side.

import type { ChannelMeta, VideoMeta } from '../../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

export function parseYouTubeUrl(
  url: string,
): { kind: 'video'; videoId: string } | { kind: 'channel'; ref: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(u.hostname) && u.hostname !== 'youtu.be') return null;

  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return id ? { kind: 'video', videoId: id } : null;
  }
  const v = u.searchParams.get('v');
  if (u.pathname === '/watch' && v) return { kind: 'video', videoId: v };
  const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/);
  if (shorts) return { kind: 'video', videoId: shorts[1] };
  const handle = u.pathname.match(/^\/(@[\w.-]+)/);
  if (handle) return { kind: 'channel', ref: handle[1] };
  const chan = u.pathname.match(/^\/channel\/(UC[\w-]+)/);
  if (chan) return { kind: 'channel', ref: chan[1] };
  return null;
}

export async function fetchVideoMetaServer(videoId: string): Promise<VideoMeta | null> {
  // oEmbed: stable, no scraping needed. Gives title + channel title.
  const res = await fetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    { headers: { 'user-agent': UA } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { title?: string; author_name?: string };
  if (!data.title) return null;
  return { videoId, title: data.title, channelTitle: data.author_name };
}

export async function fetchChannelMetaServer(ref: string): Promise<ChannelMeta | null> {
  const path = ref.startsWith('@') ? `/${ref}` : `/channel/${ref}`;
  const res = await fetch(`https://www.youtube.com${path}`, { headers: { 'user-agent': UA } });
  if (!res.ok) return null;
  const html = await res.text();
  const meta = (prop: string) => {
    const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`));
    return m ? decodeHtml(m[1]) : undefined;
  };
  const title = meta('og:title');
  if (!title) return null;
  return {
    channelId: ref,
    title,
    handle: ref.startsWith('@') ? ref : undefined,
    description: meta('og:description'),
  };
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
