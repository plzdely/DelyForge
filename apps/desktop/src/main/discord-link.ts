import { createServer } from 'node:http';
import { DISCORD_LOOPBACK } from '@delyforge/shared';
import { AppError } from './errors';

const PAGE = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#09090d;color:#ededf3;font:15px system-ui"><main style="max-width:420px;padding:32px;border:1px solid #21212b;border-radius:14px;background:#121219"><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="color:#a1a1b5">${text}</p></main>`;

/**
 * Listens on this computer only (127.0.0.1) for Discord's answer to one "Connect Discord" click, then stops.
 * Resolves with the code + state for the signed-in app to hand to the API. Nothing else is accepted.
 */
export function waitForDiscordAnswer(opts: { port?: number; timeoutMs?: number } = {}): { ready: Promise<void>; answer: Promise<{ code: string; state: string }> } {
  const port = opts.port ?? DISCORD_LOOPBACK.port;
  let settle!: (r: { code: string; state: string } | Error) => void;
  const answer = new Promise<{ code: string; state: string }>((ok, fail) => (settle = (r) => (r instanceof Error ? fail(r) : ok(r))));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method !== 'GET' || url.pathname !== DISCORD_LOOPBACK.path) {
      res.writeHead(404, { connection: 'close' }).end();
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    // connection: close — one answer per click; a kept-alive connection must not reach a later listener.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", connection: 'close' });
    if (code && state) {
      res.end(PAGE('Almost done', 'You can close this tab and go back to DelyForge.'));
      settle({ code, state });
    } else {
      res.end(PAGE('Discord not connected', 'You cancelled on Discord. Go back to DelyForge and try again.'));
      settle(new AppError('VALIDATION_FAILED', 'Discord linking was cancelled.'));
    }
    close();
  });
  const timer = setTimeout(() => (settle(new AppError('VALIDATION_FAILED', 'Discord linking timed out. Click “Connect Discord” again.')), close()), opts.timeoutMs ?? 10 * 60_000);
  const close = () => {
    clearTimeout(timer);
    server.close();
  };
  const ready = new Promise<void>((ok, fail) => {
    server.once('listening', ok);
    server.once('error', (e: NodeJS.ErrnoException) => {
      close();
      const err = new AppError('INTERNAL', e.code === 'EADDRINUSE' ? `Another program is using port ${port}, so Discord can’t reach DelyForge. Close it and try again.` : 'Couldn’t prepare Discord linking.');
      settle(err);
      fail(err);
    });
  });
  answer.catch(() => null); // reported to the caller that awaits it
  server.listen(port, '127.0.0.1');
  return { ready, answer };
}
