// Password hashing (scrypt), invite tokens and a small login rate limiter. See openwiki/architecture.md (Security).
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** Returns "scrypt$N$r$p$salt$hash" (base64url parts). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A new invite token and the hash that is stored (the token itself is never stored). */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Fixed-window limiter: max `limit` failures per key in `windowMs`. */
export class RateLimiter {
  private hits = new Map<string, { count: number; until: number }>();
  private limit: number;
  private windowMs: number;
  constructor(limit = 5, windowMs = 15 * 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  blocked(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.until < now) return false;
    return h.count >= this.limit;
  }

  fail(key: string, now = Date.now()): void {
    const h = this.hits.get(key);
    if (!h || h.until < now) this.hits.set(key, { count: 1, until: now + this.windowMs });
    else h.count++;
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.until < now) this.hits.delete(k);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}
