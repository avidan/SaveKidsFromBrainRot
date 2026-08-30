// MCP (Model Context Protocol) server over Streamable HTTP. Lets Claude —
// claude.ai custom connectors, Claude Code, or any MCP client — manage the
// family's YouTube policy conversationally: check activity, work the review
// queue, tune criteria, test URLs.
//
// Stateless JSON responses (the Streamable HTTP spec permits plain JSON in
// place of an SSE stream). Auth is resolved by the caller (API key), which
// scopes every tool to one family.

import type { Env } from './env';
import {
  addOverride,
  getPolicy,
  listActivity,
  listDevices,
  listReview,
  resolveReview,
  screenTimeToday,
  setPause,
  testUrl,
  updateCriteria,
} from './service';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'get_policy',
    description:
      "Get the family's current YouTube policy: the plain-language criteria, settings (model, timer, Shorts blocking), and all pinned allow/block overrides.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'update_criteria',
    description:
      "Replace the family's plain-language filtering criteria. This clears all cached AI verdicts so every channel and video is re-judged against the new rules. Confirm with the parent before calling.",
    inputSchema: {
      type: 'object',
      properties: { criteria: { type: 'string', description: 'The full new criteria text' } },
      required: ['criteria'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_review_queue',
    description:
      'List pending review items: videos/channels the AI was unsure about or blocked, and content the kids asked to watch.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'resolve_review',
    description:
      'Resolve a review-queue item. "allow" or "block" pins that decision permanently; "dismiss" just clears the item.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Review item id from list_review_queue' },
        action: { type: 'string', enum: ['allow', 'block', 'dismiss'] },
      },
      required: ['id', 'action'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_override',
    description:
      'Pin a permanent allow/block decision for a channel (handle like "@veritasium") or a video (11-char video id). Overrides always win over the AI.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['channel', 'video'] },
        targetId: { type: 'string' },
        decision: { type: 'string', enum: ['allow', 'block'] },
        note: { type: 'string' },
      },
      required: ['kind', 'targetId', 'decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'pause_youtube',
    description:
      'Immediately pause ALL YouTube viewing on every family device for the given number of minutes. Kids see a full-screen "YouTube is paused" message until it expires or a parent resumes. Devices pick it up within about a minute.',
    inputSchema: {
      type: 'object',
      properties: { minutes: { type: 'number', description: 'How long to pause, in minutes (max 7 days)' } },
      required: ['minutes'],
      additionalProperties: false,
    },
  },
  {
    name: 'resume_youtube',
    description: 'Lift an active pause so YouTube works again (normal filtering rules still apply).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_activity',
    description:
      'Recent activity across the kids\' devices: videos watched, content blocked, access requests, and screen-time events. Newest first.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max events (default 50, max 500)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_screen_time',
    description: 'YouTube watch time today, per device.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_devices',
    description: 'List paired kid devices with pairing date and last-seen time.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'test_url',
    description:
      "Run any YouTube video or channel URL through the family's AI filter and return the verdict (allow/block/unsure), confidence, and reason. Useful to preview how the current criteria judge specific content.",
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
];

async function callTool(env: Env, familyId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'get_policy':
      return getPolicy(env, familyId);
    case 'update_criteria':
      return updateCriteria(env, familyId, String(args.criteria ?? ''));
    case 'list_review_queue':
      return listReview(env, familyId);
    case 'resolve_review': {
      const ok = await resolveReview(env, familyId, Number(args.id), args.action as 'allow' | 'block' | 'dismiss');
      return ok ? { resolved: true } : { resolved: false, error: 'Review item not found' };
    }
    case 'add_override':
      await addOverride(
        env,
        familyId,
        args.kind as 'channel' | 'video',
        String(args.targetId),
        args.decision as 'allow' | 'block',
        args.note ? String(args.note) : undefined,
      );
      return { pinned: true };
    case 'pause_youtube': {
      const pausedUntil = await setPause(env, familyId, Number(args.minutes));
      return { pausedUntil, pausedUntilLocal: pausedUntil ? new Date(pausedUntil).toISOString() : null };
    }
    case 'resume_youtube':
      await setPause(env, familyId, null);
      return { resumed: true };
    case 'get_activity':
      return listActivity(env, familyId, Number(args.limit ?? 50));
    case 'get_screen_time':
      return screenTimeToday(env, familyId);
    case 'list_devices':
      return listDevices(env, familyId);
    case 'test_url':
      return testUrl(env, familyId, String(args.url ?? ''));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result });
}
function rpcError(id: JsonRpcRequest['id'], code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

export async function handleMcpRequest(env: Env, familyId: string, request: Request): Promise<Response> {
  if (request.method === 'GET') {
    // No server-initiated stream; clients fall back to plain request/response.
    return new Response(null, { status: 405 });
  }
  let msg: JsonRpcRequest;
  try {
    msg = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  switch (msg.method) {
    case 'initialize':
      return rpcResult(msg.id, {
        protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'savekidsfrombrainrot', version: '1.0.0' },
        instructions:
          'Manage a family\'s AI-powered YouTube filter: read activity and screen time, work the parent review queue, pin allow/block overrides, tune the plain-language criteria, and test how specific URLs would be judged.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202 });
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const name = String(msg.params?.name ?? '');
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(env, familyId, name, args);
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (e) {
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
