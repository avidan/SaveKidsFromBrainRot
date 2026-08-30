import type {
  ActivityEvent,
  ApiKeyInfo,
  DeviceInfo,
  ExportBundle,
  Override,
  Policy,
  ReviewItem,
  Settings,
  TestResponse,
} from '../../shared/types';

const BACKEND_KEY = 'skfbr.backendUrl';
const TOKEN_KEY = 'skfbr.sessionToken';

export function getBackendUrl(): string {
  return localStorage.getItem(BACKEND_KEY) ?? '';
}
export function setBackendUrl(url: string): void {
  localStorage.setItem(BACKEND_KEY, url.replace(/\/$/, ''));
}
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBackendUrl();
  if (!base) throw new ApiError(0, 'Backend URL not set');
  const token = getToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, (body.error as string) ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  signup: (email: string, password: string) =>
    request<{ sessionToken: string }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    request<{ sessionToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  requestReset: (email: string) =>
    request<{ ok: true }>('/auth/request-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    request<{ ok: true }>('/auth/reset', { method: 'POST', body: JSON.stringify({ email, code, newPassword }) }),

  getPolicy: () => request<Policy>('/dashboard/policy'),
  putPolicy: (criteria: string, settings: Settings) =>
    request<Policy>('/dashboard/policy', { method: 'PUT', body: JSON.stringify({ criteria, settings }) }),

  pause: (minutes: number) =>
    request<{ pausedUntil: number }>('/dashboard/pause', { method: 'POST', body: JSON.stringify({ minutes }) }),
  resume: () => request<{ pausedUntil: null }>('/dashboard/pause', { method: 'DELETE' }),

  getOverrides: () => request<{ overrides: Override[] }>('/dashboard/overrides'),
  addOverride: (kind: 'channel' | 'video', targetId: string, decision: 'allow' | 'block', note?: string) =>
    request<{ ok: true }>('/dashboard/overrides', {
      method: 'POST',
      body: JSON.stringify({ kind, targetId, decision, note }),
    }),
  deleteOverride: (kind: string, targetId: string) =>
    request<{ ok: true }>(`/dashboard/overrides/${kind}/${encodeURIComponent(targetId)}`, { method: 'DELETE' }),

  getDevices: () => request<{ devices: DeviceInfo[] }>('/dashboard/devices'),
  createPairCode: (deviceName: string) =>
    request<{ code: string; expiresAt: number }>('/dashboard/devices/pair-code', {
      method: 'POST',
      body: JSON.stringify({ deviceName }),
    }),
  /** For MDM deployments: create a code and immediately redeem it, yielding the deviceToken. */
  mintDeviceToken: async (deviceName: string) => {
    const { code } = await api.createPairCode(deviceName);
    return request<{ deviceToken: string; deviceId: string }>('/pair', {
      method: 'POST',
      body: JSON.stringify({ code, deviceName }),
    });
  },
  revokeDevice: (id: string) => request<{ ok: true }>(`/dashboard/devices/${id}`, { method: 'DELETE' }),

  getReview: () => request<{ items: ReviewItem[] }>('/dashboard/review'),
  resolveReview: (id: number, action: 'allow' | 'block' | 'dismiss') =>
    request<{ ok: true }>(`/dashboard/review/${id}`, { method: 'POST', body: JSON.stringify({ action }) }),

  getActivity: () => request<{ events: ActivityEvent[] }>('/dashboard/activity?limit=200'),

  test: (url: string) => request<TestResponse>('/dashboard/test', { method: 'POST', body: JSON.stringify({ url }) }),

  listApiKeys: () => request<{ keys: ApiKeyInfo[] }>('/dashboard/api-keys'),
  createApiKey: (name: string) =>
    request<{ id: string; key: string }>('/dashboard/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeApiKey: (id: string) => request<{ ok: true }>(`/dashboard/api-keys/${id}`, { method: 'DELETE' }),

  exportBundle: () => request<ExportBundle>('/dashboard/export'),
  importBundle: (bundle: ExportBundle) =>
    request<Policy>('/dashboard/import', { method: 'POST', body: JSON.stringify(bundle) }),
};
