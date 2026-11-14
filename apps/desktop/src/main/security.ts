import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, isAbsolute } from 'node:path';
import { type Session, app, protocol, shell } from 'electron';
import { isAllowedExternalUrl } from '@delyforge/shared';

/**
 * The production UI is served from a private `app://delyforge/` protocol instead of `file://`.
 * This lets us send a strict Content-Security-Policy header and confines the UI to the bundled files.
 */
export const APP_SCHEME = 'app';
export const APP_HOST = 'delyforge';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.discordapp.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Vite dev server needs inline scripts (React Refresh) and a websocket for hot reload.
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.discordapp.com",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
};

/** Must run before `app.ready`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** Serves files from `rendererDir` on app://delyforge/, refusing anything outside that folder. */
export function serveRenderer(session: Session, rendererDir: string): void {
  session.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const filePath = normalize(join(rendererDir, pathname));
    const rel = relative(rendererDir, filePath);
    if (rel.startsWith('..') || isAbsolute(rel)) return new Response('Forbidden', { status: 403 });

    try {
      const body = await readFile(filePath);
      return new Response(body, {
        headers: {
          'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          'content-security-policy': PROD_CSP,
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

/** Adds the dev CSP to responses from the Vite dev server. */
export function applyDevCsp(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [DEV_CSP] },
    });
  });
}

/** App-wide hardening for every web contents (window) we create. */
export function hardenApp(isTrustedUrl: (url: string) => boolean): void {
  app.on('web-contents-created', (_event, contents) => {
    // Never allow the UI to navigate away from the app.
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    // Links that try to open new windows go to the user's browser — only for allow-listed https URLs.
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

/** Deny camera, microphone, geolocation, notifications etc. unless a feature explicitly needs them. */
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}
