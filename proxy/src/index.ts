import { handle, type Env } from './handler.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
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
