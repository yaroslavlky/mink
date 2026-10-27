import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { CacheEntry } from './cache.js';

export interface RemoteCacheProvider {
  get(fingerprint: string): Promise<CacheEntry | undefined>;
  put(fingerprint: string, entry: CacheEntry): Promise<void>;
}
export interface HttpCacheOptions {
  url: string;
  token?: string;
  signingKey?: string;
}

export class HttpRemoteCache implements RemoteCacheProvider {
  constructor(private readonly options: HttpCacheOptions) {}
  async get(fingerprint: string): Promise<CacheEntry | undefined> {
    const response = await fetch(this.location(fingerprint), { headers: this.headers() });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Remote cache GET failed: ${response.status}`);
    const body = await response.text();
    this.verify(body, response.headers.get('x-mink-signature'));
    const entry = JSON.parse(body) as CacheEntry;
    if (entry.fingerprint !== fingerprint) throw new Error('Remote cache fingerprint mismatch');
    return entry;
  }
  async put(fingerprint: string, entry: CacheEntry): Promise<void> {
    const body = JSON.stringify(entry);
    const response = await fetch(this.location(fingerprint), {
      method: 'PUT',
      headers: { ...this.headers(), 'content-type': 'application/json', ...this.signature(body) },
      body,
    });
    if (!response.ok) throw new Error(`Remote cache PUT failed: ${response.status}`);
  }
  private location(fingerprint: string): string {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid cache fingerprint');
    return `${this.options.url.replace(/\/$/, '')}/${fingerprint}.json`;
  }
  private headers(): Record<string, string> {
    return this.options.token ? { authorization: `Bearer ${this.options.token}` } : {};
  }
  private signature(body: string): Record<string, string> {
    return this.options.signingKey
      ? {
          'x-mink-signature': createHmac('sha256', this.options.signingKey)
            .update(body)
            .digest('hex'),
        }
      : { 'x-mink-integrity': createHash('sha256').update(body).digest('hex') };
  }
  private verify(body: string, signature: string | null): void {
    if (!this.options.signingKey) return;
    if (!signature || !/^[a-f0-9]{64}$/.test(signature))
      throw new Error('Unsigned remote cache entry');
    const actual = Buffer.from(signature, 'hex');
    const expected = createHmac('sha256', this.options.signingKey).update(body).digest();
    if (!timingSafeEqual(actual, expected)) throw new Error('Remote cache signature mismatch');
  }
}

export class S3CompatibleCache extends HttpRemoteCache {}
