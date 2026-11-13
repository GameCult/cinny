// The Files desk's contract with the file host (docs/commons-files-desk.md, "Host contract"): response types, the
// parser that refuses a malformed index, and the client that calls the host with a Matrix OpenID token. The host
// is Eureka's; its answers to Q-E1..7 are the authority and win over anything written here. This module draws no
// UI, reads no filesystem and holds no zone roots: a path is `<zone>/<relative path>` built only from names the
// host listed.
//
// Left to the host's answers (placeholders, nothing here depends on them):
//   - the Commons roots (Q-E1): the client lists zones from `GET /index?path=` and assumes none;
//   - media-element auth (Q-E3): a path ticket, a service worker or a blob fetch. `file()` sends the bearer token
//     and returns the Response, which serves a blob fetch; a ticket would be one more method;
//   - error codes: `FilesHostError.code` carries the host's code string untouched and no code is interpreted.

import type { MatrixClient } from 'matrix-js-sdk';

/** `member`, `mind` and `steward` as the doc proposes (Q-E4); any other word the host sends reads as `other`,
 * which the client treats as least privilege. The host gates every request; the role only hides controls. */
export type FilesRole = 'member' | 'mind' | 'steward' | 'other';

export type FileEntry = {
  kind: 'file';
  name: string;
  size: number;
  /** unix seconds */
  mtime: number;
  /** sniffed by the host from the bytes, not guessed from the extension */
  mime: string;
  /** lower-case hex sha256; absent while the host has not computed it */
  hash?: string;
};

export type DirEntry = { kind: 'dir'; name: string; mtime: number };

export type FilesEntry = FileEntry | DirEntry;

export type FilesIndex = {
  role: FilesRole;
  /** `''` for the root listing, whose entries are the zones as directories */
  path: string;
  entries: FilesEntry[];
};

/** A refusal or a failure of the host. `code` is the host's own error code string, uninterpreted. */
export class FilesHostError extends Error {
  readonly status: number;

  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'FilesHostError';
    this.status = status;
    this.code = code;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An entry name is one path segment: the client builds a path from names, so a name that is a path is refused. */
export const isEntryName = (name: unknown): name is string =>
  typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[/\\\0]/.test(name);

const bad = (what: string): never => {
  throw new FilesHostError(502, `The file host sent a malformed index: ${what}`);
};

const ROLES = ['member', 'mind', 'steward'] as const;
const HASH = /^[0-9a-f]{64}$/;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

const parseEntry = (raw: unknown, i: number): FilesEntry => {
  if (!isRecord(raw)) return bad(`entry ${i} is not an object`);
  const { name, kind, size, mtime, mime, hash } = raw;
  if (!isEntryName(name)) return bad(`entry ${i} has no usable name`);
  if (!count(mtime)) return bad(`"${name}" has no mtime`);
  if (kind === 'dir') return { kind, name, mtime };
  if (kind !== 'file') return bad(`"${name}" has kind ${String(kind)}`);
  if (!count(size)) return bad(`"${name}" has no size`);
  if (typeof mime !== 'string' || mime === '') return bad(`"${name}" has no mime`);
  if (hash !== undefined && (typeof hash !== 'string' || !HASH.test(hash)))
    return bad(`"${name}" has a hash that is not sha256 hex`);
  return { kind, name, size, mtime, mime, ...(hash === undefined ? {} : { hash }) };
};

/** The index response as the client uses it, or a FilesHostError: nothing half-valid is passed on. */
export const parseIndex = (raw: unknown): FilesIndex => {
  if (!isRecord(raw)) return bad('not an object');
  const { role, path, entries } = raw;
  if (typeof path !== 'string') return bad('no path');
  if (!Array.isArray(entries)) return bad('no entries');
  return {
    role: ROLES.find((r) => r === role) ?? 'other',
    path,
    entries: entries.map(parseEntry),
  };
};

/** `base` and one listed entry name, joined; `base` is `''` or a path the host gave. */
export const joinPath = (base: string, name: string): string => {
  if (!isEntryName(name)) throw new Error(`not an entry name: ${JSON.stringify(name)}`);
  return base === '' ? name : `${base.replace(/\/+$/, '')}/${name}`;
};

/** The path one level up; `''` at a zone root's parent. */
export const parentPath = (path: string): string => path.split('/').slice(0, -1).join('/');

export type TokenSource = (opts?: { fresh?: boolean }) => Promise<string>;

/** A Matrix OpenID token for the host, cached until a minute before it expires. The host verifies it against the
 * homeserver; the user's access token never leaves the client. */
export const openIdTokenSource = (
  mx: Pick<MatrixClient, 'getOpenIdToken'>,
  now: () => number = Date.now
): TokenSource => {
  let cached: { token: string; until: number } | undefined;
  return async ({ fresh = false } = {}) => {
    if (!fresh && cached && now() < cached.until) return cached.token;
    const t = await mx.getOpenIdToken();
    cached = { token: t.access_token, until: now() + Math.max(0, t.expires_in - 60) * 1000 };
    return t.access_token;
  };
};

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type FilesHost = {
  list: (path: string, signal?: AbortSignal) => Promise<FilesIndex>;
  /** The bytes of a file, whole or a `Range` (206). The caller reads the body; a refusal throws. */
  file: (path: string, opts?: { range?: string; signal?: AbortSignal }) => Promise<Response>;
};

const failure = async (res: Response): Promise<FilesHostError> => {
  let code: string | undefined;
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const body: unknown = await res.json();
    if (isRecord(body)) {
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.error === 'string') message = body.error;
    }
  } catch {
    // a body that is not JSON keeps the status text
  }
  return new FilesHostError(res.status, message, code);
};

export const createFilesHost = (opts: {
  /** the host's base URL, e.g. https://files.example/ (a placeholder until Eureka names it) */
  host: string;
  token: TokenSource;
  fetchFn?: FetchFn;
}): FilesHost => {
  const base = opts.host.replace(/\/+$/, '');
  const fetchFn: FetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));

  // One retry with a fresh token on 401: a cached token may have expired at the host before it did here.
  const call = async (url: string, headers: Record<string, string>, signal?: AbortSignal) => {
    const send = async (fresh: boolean) =>
      fetchFn(url, {
        headers: { ...headers, Authorization: `Bearer ${await opts.token({ fresh })}` },
        signal,
      });
    let res = await send(false);
    if (res.status === 401) res = await send(true);
    if (!res.ok) throw await failure(res);
    return res;
  };

  return {
    list: async (path, signal) =>
      parseIndex(
        await (
          await call(
            `${base}/index?path=${encodeURIComponent(path)}`,
            { Accept: 'application/json' },
            signal
          )
        ).json()
      ),
    file: (path, o = {}) =>
      call(
        `${base}/file?path=${encodeURIComponent(path)}`,
        o.range ? { Range: o.range } : {},
        o.signal
      ),
  };
};
