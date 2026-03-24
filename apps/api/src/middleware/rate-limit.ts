// ─────────────────────────────────────────────────────
// MortgageGuard — Rate Limiting Middleware
// Simple sliding-window rate limiter using KV
// ─────────────────────────────────────────────────────
import { createMiddleware } from "hono/factory";
import type { Env } from "../env";

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export function rateLimit(opts: RateLimitOptions) {
  const { windowMs, maxRequests, keyPrefix = "rl" } = opts;
  const windowSec = Math.ceil(windowMs / 1000);

  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
    const key = `${keyPrefix}:${ip}`;

    const current = await c.env.SESSIONS.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= maxRequests) {
      return c.json(
        { error: "Too many requests", retryAfter: windowSec },
        429,
      );
    }

    // Increment counter with TTL
    await c.env.SESSIONS.put(key, String(count + 1), {
      expirationTtl: windowSec,
    });

    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(maxRequests - count - 1));

    await next();
  });
}
