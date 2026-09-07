import { logger } from '../util/logger.js';
import { sanitizeForLog } from '../security/sanitize.js';

export interface PanelAuthOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

export class PanelAuth {
  private accessToken: string | null = null;
  private cookieJar = '';
  private refreshPromise: Promise<void> | null = null;

  constructor(private opts: PanelAuthOptions) {}

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.opts.baseUrl}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.cookieJar ? { Cookie: this.cookieJar } : {}),
          ...init.headers,
        },
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) this.cookieJar = setCookie.split(',').map((s) => s.split(';')[0]).join('; ');
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async login(): Promise<void> {
    const res = await this.request(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({
          username: this.opts.username,
          password: this.opts.password,
          rememberMe: false,
        }),
      },
      this.opts.timeoutMs,
    );
    if (!res.ok) {
      logger.warn('panel_login_failed', { status: (res as Response).status });
      throw new Error(`Panel login failed with status ${(res as Response).status}`);
    }
    const data = (await res.json().catch(() => ({}))) as { token?: string; accessToken?: string };
    const token = data.accessToken ?? data.token;
    if (!token) throw new Error('Panel login response did not include access token');
    this.accessToken = token;
    logger.info('panel_login_success', { user: this.opts.username });
  }

  getToken(): string | null {
    return this.accessToken;
  }

  async refreshSingleFlight(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      try {
        const res = await this.request('/api/auth/refresh', { method: 'POST' }, this.opts.timeoutMs);
        if (!res.ok) {
          await this.login();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { token?: string; accessToken?: string };
        if (data.accessToken ?? data.token) {
          this.accessToken = (data.accessToken ?? data.token) as string;
        } else {
          await this.login();
        }
      } finally {
        this.refreshPromise = null;
      }
    })();
    return this.refreshPromise;
  }

  async withAuthRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    if (!this.accessToken) await this.login();
    try {
      return await fn(this.accessToken as string);
    } catch (err) {
      const msg = sanitizeForLog(String(err));
      if (msg.includes('401')) {
        await this.refreshSingleFlight();
        return fn(this.accessToken as string);
      }
      throw err;
    }
  }
}
