/* eslint-disable no-param-reassign */
// Patching the window's network entry points is this module's whole job.
// Routes the page's network through the pretend homeserver and refuses everything else. Installed
// only by a build with VITE_PREVIEW_DEMO=1 whose config.json says previewDemo: true (src/index.tsx).
// Own-origin requests (the app's static files) pass; the demo origin is answered in-page; any
// other origin is refused, so no real homeserver can be contacted while this is on.
import { removeFallbackSession } from '../app/state/sessions';
import { DEMO_ORIGIN } from './fixtures';
import { createDemoServer, DemoServer } from './server';
import { demoDesk } from './deskForks';
import { setDeskSource } from '../app/features/desk/source';

export type Route = 'own' | 'demo' | 'refuse';

export const routeOf = (url: string, pageOrigin: string): Route => {
  let u: URL;
  try {
    u = new URL(url, pageOrigin);
  } catch {
    return 'refuse';
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return 'own';
  if (u.origin === DEMO_ORIGIN) return 'demo';
  const ws = u.protocol === 'ws:' || u.protocol === 'wss:';
  const sameHost = u.host === new URL(pageOrigin).host;
  return sameHost && (u.origin === pageOrigin || ws) ? 'own' : 'refuse';
};

const refusal = (what: string, url: string) =>
  new Error(`preview: pretend server only; ${what} to ${url} refused`);

const BANNER_TEXT = 'preview: pretend server. Any password works.';

// In flow, above the app: body becomes a column and the app root takes the rest, so the banner
// never covers the room header or the connection strip.
const showBanner = (text: string) => {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  el.style.cssText =
    'flex:none;padding:2px 8px;font:11px/1.4 system-ui,sans-serif;color:#1b1b1b;background:#ffc46b;text-align:center';
  const root = document.getElementById('root');
  document.body.style.cssText += ';display:flex;flex-direction:column';
  if (root) root.style.cssText += ';flex:1;min-height:0;height:auto';
  document.body.insertBefore(el, root);
};

const parseBody = (body: unknown): unknown => {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
};

const lowerHeaders = (h: HeadersInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  new Headers(h).forEach((v, k) => {
    out[k] = v;
  });
  return out;
};

export type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Own-origin requests go to the real fetch, the demo origin to the pretend server, the rest throw.
export const guardedFetch =
  (server: DemoServer, origin: string, realFetch: FetchFn): FetchFn =>
  async (input, init) => {
    const req = input instanceof Request ? input : undefined;
    const url = req ? req.url : String(input);
    const route = routeOf(url, origin);
    if (route === 'own') return realFetch(input, init);
    if (route === 'refuse') throw new TypeError(refusal('fetch', url).message);
    const method = init?.method ?? req?.method ?? 'GET';
    const raw = init?.body ?? (req ? await req.clone().text() : undefined);
    const out = await server.handle({
      method,
      url,
      body: parseBody(raw),
      signal: init?.signal ?? req?.signal ?? undefined,
      headers: lowerHeaders(init?.headers ?? req?.headers),
    });
    if (out.raw) {
      return new Response(out.raw.data, {
        status: out.status,
        headers: { ...out.headers, 'Content-Type': out.raw.type },
      });
    }
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { ...out.headers, 'Content-Type': 'application/json' },
    });
  };

// Every preview of this site shares one origin, so one localStorage: a login another preview left
// (a real homeserver) would make the app connect to that server, which the guard refuses. The
// demo has one server, so a stored login for any other is dropped before the app reads it.
export const dropForeignSession = (storage: Storage) => {
  const base = storage.getItem('cinny_hs_base_url');
  if (base !== null && base !== DEMO_ORIGIN) removeFallbackSession(storage);
};

export const installDemo = (win: Window & typeof globalThis = window) => {
  dropForeignSession(win.localStorage);
  const server = createDemoServer();
  setDeskSource(demoDesk);
  const { origin } = win.location;
  const realFetch = win.fetch.bind(win);

  win.fetch = guardedFetch(server, origin, realFetch);

  const { WebSocket: RealSocket } = win;
  class GuardedSocket extends RealSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (routeOf(String(url), origin) !== 'own') throw refusal('WebSocket', String(url));
      super(url, protocols);
    }
  }
  win.WebSocket = GuardedSocket;

  const { open: realOpen } = win.XMLHttpRequest.prototype;
  win.XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    if (routeOf(String(url), origin) !== 'own') throw refusal('XMLHttpRequest', String(url));
    return (realOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof realOpen;

  const realBeacon = win.navigator.sendBeacon?.bind(win.navigator);
  if (realBeacon) {
    win.navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) =>
      routeOf(String(url), origin) === 'own' ? realBeacon(url, data) : false;
  }

  showBanner(BANNER_TEXT);
  return server;
};
