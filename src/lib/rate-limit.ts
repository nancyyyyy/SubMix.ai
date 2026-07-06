import { NextRequest } from 'next/server';

// In-memory fixed-window limiter. Good enough for a single Node process;
// swap for a shared store (Redis, etc.) once running multiple instances,
// since counts here don't survive a restart or sync across processes.
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT = 5;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Sweep expired buckets so the map doesn't grow forever; unref so this
// timer never keeps the process alive on its own.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, DEFAULT_WINDOW_MS);
cleanupTimer.unref?.();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

// NextRequest no longer exposes `.ip` (removed upstream; hosting providers
// are expected to supply it via headers instead), so read it off the
// forwarding headers a proxy/load balancer sets.
export function getClientIp(request: NextRequest | Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return 'unknown';
}
