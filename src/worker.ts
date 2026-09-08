import worker, { WeddingRoom } from './index';
import type { Env } from './index';

export { WeddingRoom };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const roomMatch = url.pathname.match(/^\/room\/([^/]+)\/ws$/);
    if (roomMatch) {
      const stub = env.WEDDING_ROOM.get(env.WEDDING_ROOM.idFromName(roomMatch[1]));
      const headers = new Headers(req.headers);
      return stub.fetch(new Request('https://room/ws', { method: 'GET', headers }));
    }
    return worker.fetch(req, env);
  },
};
