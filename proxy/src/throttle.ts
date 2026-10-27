import type { Env } from './handler.js';

/** Shared by edge admission and authenticated account admission; fail closed. */
export async function throttle(limiter: Env['LIMITER'], key: string): Promise<Response | null> {
  if (!limiter) return null; // isolated/local environments may omit the binding
  let status = 429, error = 'rate_limited';
  try {
    if ((await limiter.limit({ key })).success) return null;
  } catch { status = 503; error = 'limiter_unavailable'; }
  return new Response(JSON.stringify({ error }), {
    status, headers: {
      'content-type': 'application/json', 'cache-control': 'no-store',
      'access-control-allow-origin': '*', 'retry-after': '60',
    },
  });
}
