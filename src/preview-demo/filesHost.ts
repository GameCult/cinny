// The preview's pretend file host: the contract of docs/commons-files-desk.md answered from a few in-memory zones,
// so the Files desk can be built and looked at in a browser before the real host exists. It stands in for a host
// whose roots, ticket auth and error codes Eureka has not settled (Q-E1, Q-E3): the zones here are samples, the
// codes are `demo_*`, and nothing in the client may depend on either. It enforces what the real host must: a bearer
// token, one zone root per path, no `..`, no dotfiles, and `handoff-private` is simply not there.
import { DEMO_ORIGIN } from './fixtures';
import { DemoMedia, pngGradient, wavTone } from './media';
import type { DemoRequest, DemoResponse } from './server';

/** Where the fake answers: the demo origin, under this prefix. The client's `host` setting is this URL. */
export const FILES_PREFIX = '/_files';
export const DEMO_FILES_HOST = `${DEMO_ORIGIN}${FILES_PREFIX}`;
/** What the pretend homeserver's openid/request_token hands out, and the only bearer the fake accepts. */
export const DEMO_OPENID_TOKEN = 'demo-openid-token';

const text = (s: string): DemoMedia => ({ type: 'text/plain', data: new TextEncoder().encode(s) });

// name -> children (a directory) or media (a file), per zone
interface Tree {
  [name: string]: Tree | DemoMedia;
}
const ZONES: Record<string, Tree> = {
  commons: {
    'README.txt': text('Commons: what members and Minds share.\n'),
    'cast-art': {
      poses: {
        'aqua-calm.png': pngGradient([80, 160, 220]),
        'nibu-bright.png': pngGradient([240, 190, 70]),
      },
    },
    backlog: { 'backlog-void.md': text('# void\n\n- one thing\n- another\n') },
    '.hidden': text('a dotfile the host never shows\n'),
    uploads: {},
  },
  // present on disk, never served: the host's allowlist does not name it (bait for the tests)
  'handoff-private': { 'secret.txt': text('never shown\n') },
  aqua: {
    shared: {
      'clip-01.wav': wavTone(440),
      'clip-02.wav': wavTone(660),
      'notes.txt': text('listen on headphones\n'),
    },
  },
};

const isMedia = (n: Tree | DemoMedia): n is DemoMedia =>
  'data' in n && n.data instanceof Uint8Array;

const hex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

const fail = (status: number, code: string, error: string): DemoResponse => ({
  status,
  body: { code, error },
});

// A path the real host would refuse to resolve at all answers 404 as if it did not exist.
const NEVER = 'handoff-private';
const shown = (name: string) => !name.startsWith('.') && name !== NEVER;

const segmentsOf = (path: string): string[] | undefined => {
  if (path === '') return [];
  const segs = path.split('/');
  return segs.every((n) => shown(n) && !/[\\\0]/.test(n)) ? segs : undefined;
};

const walk = (segs: string[]): Tree | DemoMedia | undefined =>
  segs.reduce<Tree | DemoMedia | undefined>(
    (at, s) =>
      at && !isMedia(at) && Object.prototype.hasOwnProperty.call(at, s) ? at[s] : undefined,
    ZONES
  );

const parseRange = (header: string, size: number): [number, number] | 'bad' | undefined => {
  if (header === '') return undefined;
  const m = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === '' && m[2] === '')) return 'bad';
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  return start > end || start >= size ? 'bad' : [start, end];
};

export type DemoFiles = {
  handles: (url: string) => boolean;
  handle: (req: DemoRequest) => Promise<DemoResponse>;
};

/** `mtime` of every sample entry, in unix seconds; the clock is injected so tests do not drift. */
export const createDemoFiles = (now: () => number = Date.now): DemoFiles => {
  const mtime = () => Math.floor(now() / 1000) - 3600;

  const entry = async (name: string, node: Tree | DemoMedia) =>
    isMedia(node)
      ? {
          kind: 'file',
          name,
          size: node.data.length,
          mtime: mtime(),
          mime: node.type,
          hash: hex(await crypto.subtle.digest('SHA-256', node.data)),
        }
      : { kind: 'dir', name, mtime: mtime() };

  const handle = async (req: DemoRequest): Promise<DemoResponse> => {
    const u = new URL(req.url, DEMO_ORIGIN);
    const route = u.pathname.slice(FILES_PREFIX.length);
    if (req.method.toUpperCase() !== 'GET') return fail(405, 'demo_method', 'Read only');
    if (req.headers?.authorization !== `Bearer ${DEMO_OPENID_TOKEN}`)
      return fail(401, 'demo_unauthenticated', 'Sign in again');
    if (route !== '/index' && route !== '/file')
      return fail(404, 'demo_not_found', 'No such route');
    const path = u.searchParams.get('path') ?? '';
    const segs = segmentsOf(path);
    const node = segs && walk(segs);
    if (!node) return fail(404, 'demo_not_found', 'No such path');

    if (route === '/index') {
      if (isMedia(node)) return fail(400, 'demo_not_a_directory', 'Not a directory');
      return {
        status: 200,
        body: {
          role: 'member',
          path,
          entries: await Promise.all(
            Object.entries(node)
              .filter(([name]) => shown(name))
              .sort(
                ([a, x], [b, y]) => Number(isMedia(x)) - Number(isMedia(y)) || a.localeCompare(b)
              )
              .map(([name, child]) => entry(name, child))
          ),
        },
      };
    }

    if (!isMedia(node)) return fail(400, 'demo_not_a_file', 'Not a file');
    const range = parseRange(req.headers?.range ?? '', node.data.length);
    const base = { 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
    if (range === 'bad')
      return {
        status: 416,
        body: { code: 'demo_range', error: 'Range not satisfiable' },
        headers: { 'content-range': `bytes */${node.data.length}` },
      };
    if (!range) return { status: 200, body: null, raw: node, headers: base };
    const [start, end] = range;
    return {
      status: 206,
      body: null,
      raw: { type: node.type, data: node.data.slice(start, end + 1) },
      headers: { ...base, 'content-range': `bytes ${start}-${end}/${node.data.length}` },
    };
  };

  return {
    handles: (url) => new URL(url, DEMO_ORIGIN).pathname.startsWith(`${FILES_PREFIX}/`),
    handle,
  };
};
