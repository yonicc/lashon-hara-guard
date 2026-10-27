import { handle, type Env } from './handler.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = await handle(request, env);
      if (env.LHG_BUILD_SHA && /^[a-f0-9]{40}$/.test(env.LHG_BUILD_SHA)) {
        response.headers.set('x-lhg-build-sha', env.LHG_BUILD_SHA);
      }
      return response;
    } catch (e) {
      // Never leak internals; the extension renders this as "not checked".
      console.log('lhg-proxy error', e instanceof Error ? e.message : String(e));
      return new Response(JSON.stringify({ error: 'internal' }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      });
    }
  },
};
