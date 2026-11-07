/* eslint-disable no-param-reassign */
// Patching the window's network entry points is this module's whole job.
// Routes the page's network through the pretend homeserver and refuses everything else. Installed
// only by a build with VITE_PREVIEW_DEMO=1 whose config.json says previewDemo: true (src/index.tsx).
// Own-origin requests (the app's static files) pass; the demo origin is answered in-page; any
// other origin is refused, so no real homeserver can be contacted while this is on.
import { DEMO_ORIGIN, DEMO_SERVER } from './fixtures';
import { createDemoServer, DemoServer } from './server';

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
const FOREIGN_SESSION_TEXT =
  'preview: pretend server. A login for another server is stored here and cannot be used.';

const showBanner = (text: string) => {
  const el = document.createElement('div');
  el.textContent = text;
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:96vw;' +
    'padding:0 8px;font:10px/1.5 system-ui,sans-serif;white-space:nowrap;opacity:0.9;color:#1b1b1b;background:#ffc46b;' +
    'border-radius:0 0 6px 6px;pointer-events:none;text-align:center';
  document.body.appendChild(el);
};

// The preview host's CSP sandbox has no allow-forms, so the browser cancels a native form
// submission before its submit event fires and no login button works. Deliver the event ourselves;
// nothing is submitted natively. Remove this when the host grants allow-forms to /void/rat-*.
const deliverSubmitEvents = (doc: Document) => {
  const submit = (form: HTMLFormElement) =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  doc.addEventListener(
    'click',
    (e) => {
      const button = (e.target as Element | null)?.closest?.(
        'button[type="submit"], input[type="submit"]'
      );
      const form = (button as HTMLButtonElement | null)?.form;
      if (!form || (button as HTMLButtonElement).disabled) return;
      e.preventDefault();
      submit(form);
    },
    true
  );
  doc.addEventListener(
    'keydown',
    (e) => {
      const target = e.target as HTMLInputElement | null;
      if (e.key !== 'Enter' || e.isComposing || target?.tagName !== 'INPUT' || !target.form) return;
      e.preventDefault();
      submit(target.form);
    },
    true
  );
};

const parseBody = (body: unknown): unknown => {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
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
    });
    return new Response(JSON.stringify(out.body), {
      status: out.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

export const installDemo = (win: Window & typeof globalThis = window) => {
  const server = createDemoServer();
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

  deliverSubmitEvents(document);
  const stored = win.localStorage.getItem('cinny_hs_base_url');
  showBanner(stored !== null && stored !== DEMO_ORIGIN ? FOREIGN_SESSION_TEXT : BANNER_TEXT);
  return server;
};
