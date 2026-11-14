import {
  EncryptedAttachmentInfo,
  decryptAttachment,
  encryptAttachment,
} from 'browser-encrypt-attachment';
import {
  EventTimeline,
  MatrixClient,
  MatrixError,
  MatrixEvent,
  Room,
  RoomMember,
  UploadProgress,
  UploadResponse,
} from 'matrix-js-sdk';
import to from 'await-to-js';
import { IImageInfo, IThumbnailContent, IVideoInfo } from '../../types/matrix/common';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { getStateEvent } from './room';
import { Membership, StateEvent } from '../../types/matrix/room';
import { NO_INFO, UploadFailureInfo } from './uploadReason';

const DOMAIN_REGEX = /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/;

export const isServerName = (serverName: string): boolean => DOMAIN_REGEX.test(serverName);

const matchMxId = (id: string): RegExpMatchArray | null => id.match(/^([@$+#])([^\s:]+):(\S+)$/);

const validMxId = (id: string): boolean => !!matchMxId(id);

export const getMxIdServer = (userId: string): string | undefined => matchMxId(userId)?.[3];

export const getMxIdLocalPart = (userId: string): string | undefined => matchMxId(userId)?.[2];

export const isUserId = (id: string): boolean => validMxId(id) && id.startsWith('@');

export const isRoomId = (id: string): boolean => id.startsWith('!');

export const isRoomAlias = (id: string): boolean => validMxId(id) && id.startsWith('#');

export const getCanonicalAliasRoomId = (mx: MatrixClient, alias: string): string | undefined =>
  mx
    .getRooms()
    ?.find(
      (room) =>
        room.getCanonicalAlias() === alias &&
        getStateEvent(room, StateEvent.RoomTombstone) === undefined
    )?.roomId;

export const getCanonicalAliasOrRoomId = (mx: MatrixClient, roomId: string): string => {
  const room = mx.getRoom(roomId);
  if (!room) return roomId;
  if (getStateEvent(room, StateEvent.RoomTombstone) !== undefined) return roomId;
  const alias = room.getCanonicalAlias();
  if (alias && getCanonicalAliasRoomId(mx, alias) === roomId) {
    return alias;
  }
  return roomId;
};

export const getImageInfo = (img: HTMLImageElement, fileOrBlob: File | Blob): IImageInfo => {
  const info: IImageInfo = {};
  info.w = img.width;
  info.h = img.height;
  info.mimetype = fileOrBlob.type;
  info.size = fileOrBlob.size;
  return info;
};

export const getVideoInfo = (video: HTMLVideoElement, fileOrBlob: File | Blob): IVideoInfo => {
  const info: IVideoInfo = {};
  info.duration = Number.isNaN(video.duration) ? undefined : Math.floor(video.duration * 1000);
  info.w = video.videoWidth;
  info.h = video.videoHeight;
  info.mimetype = fileOrBlob.type;
  info.size = fileOrBlob.size;
  return info;
};

export const getThumbnailContent = (thumbnailInfo: {
  thumbnail: File | Blob;
  encInfo: EncryptedAttachmentInfo | undefined;
  mxc: string;
  width: number;
  height: number;
}): IThumbnailContent => {
  const { thumbnail, encInfo, mxc, width, height } = thumbnailInfo;

  const content: IThumbnailContent = {
    thumbnail_info: {
      mimetype: thumbnail.type,
      size: thumbnail.size,
      w: width,
      h: height,
    },
  };
  if (encInfo) {
    content.thumbnail_file = {
      ...encInfo,
      url: mxc,
    };
  } else {
    content.thumbnail_url = mxc;
  }
  return content;
};

export const encryptFile = async (
  file: File | Blob
): Promise<{
  encInfo: EncryptedAttachmentInfo;
  file: File;
  originalFile: File | Blob;
}> => {
  const dataBuffer = await file.arrayBuffer();
  const encryptedAttachment = await encryptAttachment(dataBuffer);
  const encFile = new File([encryptedAttachment.data], file.name, {
    type: file.type,
  });
  return {
    encInfo: encryptedAttachment.info,
    file: encFile,
    originalFile: file,
  };
};

export const decryptFile = async (
  dataBuffer: ArrayBuffer,
  type: string,
  encInfo: EncryptedAttachmentInfo
): Promise<Blob> => {
  const dataArray = await decryptAttachment(dataBuffer, encInfo);
  const blob = new Blob([dataArray], { type });
  return blob;
};

export type TUploadContent = File | Blob;

export type ContentUploadOptions = {
  name?: string;
  fileType?: string;
  hideFilename?: boolean;
  onPromise?: (promise: Promise<UploadResponse>) => void;
  onProgress?: (progress: UploadProgress) => void;
  onSuccess: (mxc: string) => void;
  onError: (error: MatrixError) => void;
  /** Read at failure time: what the owning component did since the upload attached. */
  describeLifecycle?: () => string;
};

let lastUserActivity = Date.now();
export const noteUserActivity = () => {
  lastUserActivity = Date.now();
};
if (typeof window !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((type) =>
    window.addEventListener(type, noteUserActivity, { capture: true, passive: true })
  );
}

export type AbortCall = { api: string; frames: string };

/** What the progress handler saw of one upload, for the failure text. */
export type UploadTrace = {
  startedAt: number;
  firstProgressAt?: number;
  loaded?: number;
  total?: number;
  /** Summary of an earlier attempt of the same upload, when this one is a retry. */
  previous?: string;
  /** abort() calls the page made while this attempt ran; absent when not probed. */
  aborts?: AbortCall[];
  /** What the owning component did since the upload attached. */
  lifecycle?: string;
  /** Upload XHR events and end state, and whether our own signal was aborted. */
  xhr?: string;
  signalAborted?: boolean;
};

const MAX_FRAMES = 6;
const MAX_ABORT_CALLS = 4;

/**
 * An Error stack as `file:line:col < file:line:col`, at most six frames. The error line and the
 * probe's own frame are dropped; origins and function names are not kept.
 */
export const formatAbortStack = (stack: string): string => {
  const frames = stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at ') || l.includes('@'))
    .map((l) => {
      const m = /([^/\s()@]+):(\d+):(\d+)\)?$/.exec(l);
      return m ? `${m[1]}:${m[2]}:${m[3]}` : undefined;
    })
    .filter((f): f is string => f !== undefined)
    .slice(1, 1 + MAX_FRAMES);
  return frames.length > 0 ? frames.join(' < ') : 'no stack';
};

export type ComponentLifecycle = {
  attachedAt: number;
  rendersAtAttach: number;
  renders: number[];
  unmountedAt?: number;
};

/** What the component that owns an upload did after the upload attached to it. */
export const describeComponentLifecycle = (life: ComponentLifecycle): string => {
  const since = life.renders.slice(life.rendersAtAttach);
  const quick = since.filter((t) => t - life.attachedAt <= 300).length;
  const unmount =
    life.unmountedAt === undefined
      ? 'not unmounted'
      : `unmounted +${life.unmountedAt - life.attachedAt}ms`;
  return `component: ${since.length} renders since attach (${quick} within 300ms), ${unmount}`;
};

export type XhrRecord = {
  xhr: XMLHttpRequest;
  method: string;
  path: string;
  startedAt: number;
  events: string[];
};

type Probe = { calls: AbortCall[]; xhrs: XhrRecord[] };

const probes = new Set<Probe>();
let restoreProbe: (() => void) | undefined;
const xhrTargets = new WeakMap<object, { method: string; path: string }>();

const XHR_EVENTS = ['loadstart', 'error', 'abort', 'timeout', 'load', 'loadend'];
const MAX_XHR_EVENTS = 12;

/* eslint-disable no-param-reassign */
const patchAbort = (proto: { abort: (...a: any[]) => any }, api: string) => {
  const original = proto.abort;
  const wrapper = function abortProbe(this: unknown, ...args: any[]) {
    const frames = formatAbortStack(new Error().stack ?? '');
    probes.forEach(({ calls }) => {
      if (calls.length < MAX_ABORT_CALLS) calls.push({ api, frames });
    });
    return original.apply(this, args);
  };
  proto.abort = wrapper;
  return () => {
    if (proto.abort === wrapper) proto.abort = original;
  };
};

// Upload XHRs only; the path is kept and the query (it holds the access token) is dropped.
const patchXhr = (proto: XMLHttpRequest) => {
  const { open, send } = proto;
  const openWrapper = function openProbe(this: XMLHttpRequest, ...args: any[]) {
    try {
      const url = new URL(String(args[1]), 'http://x');
      if (url.pathname.includes('/upload')) {
        xhrTargets.set(this, { method: String(args[0]).toUpperCase(), path: url.pathname });
      }
    } catch {
      // not a URL we can read; the request is not recorded
    }
    return (open as any).apply(this, args);
  };
  const sendWrapper = function sendProbe(this: XMLHttpRequest, ...args: any[]) {
    const target = xhrTargets.get(this);
    if (target && probes.size > 0) {
      const startedAt = Date.now();
      const events: string[] = [];
      const note = (name: string) => () => {
        if (events.length < MAX_XHR_EVENTS) events.push(`${name} +${Date.now() - startedAt}ms`);
      };
      XHR_EVENTS.forEach((ev) => this.addEventListener(ev, note(ev)));
      XHR_EVENTS.forEach((ev) => this.upload?.addEventListener(ev, note(`upload.${ev}`)));
      this.upload?.addEventListener(
        'progress',
        (() => {
          let first = true;
          return () => {
            if (first) note('upload.progress')();
            first = false;
          };
        })()
      );
      const record: XhrRecord = { xhr: this, ...target, startedAt, events };
      probes.forEach((probe) => probe.xhrs.push(record));
    }
    return (send as any).apply(this, args);
  };
  (proto as any).open = openWrapper;
  (proto as any).send = sendWrapper;
  return () => {
    if ((proto as any).open === openWrapper) (proto as any).open = open;
    if ((proto as any).send === sendWrapper) (proto as any).send = send;
  };
};
/* eslint-enable no-param-reassign */

const describeXhr = (r: XhrRecord): string =>
  `${r.method} ${r.path} readyState ${r.xhr.readyState} status ${
    r.xhr.status
  } events [${r.events.join(', ')}]`;

/**
 * Records, until stopped, every XMLHttpRequest.abort and AbortController.abort the page makes and
 * the lifecycle events and end state of upload XHRs. The prototypes are wrapped while at least one
 * probe runs and restored when the last one stops; the wrappers change no behaviour.
 */
export const startAbortProbe = () => {
  const probe: Probe = { calls: [], xhrs: [] };
  if (probes.size === 0) {
    const restores: (() => void)[] = [];
    if (typeof XMLHttpRequest !== 'undefined') {
      restores.push(patchAbort(XMLHttpRequest.prototype, 'XHR.abort'));
      restores.push(patchXhr(XMLHttpRequest.prototype));
    }
    if (typeof AbortController !== 'undefined') {
      restores.push(patchAbort(AbortController.prototype, 'AbortController.abort'));
    }
    restoreProbe = () => restores.forEach((r) => r());
  }
  probes.add(probe);
  return {
    calls: probe.calls,
    xhrs: probe.xhrs,
    describeXhrs: () =>
      probe.xhrs.length === 0 ? 'xhr: none seen' : `xhr: ${probe.xhrs.map(describeXhr).join('; ')}`,
    stop: () => {
      probes.delete(probe);
      if (probes.size === 0) {
        restoreProbe?.();
        restoreProbe = undefined;
      }
    },
  };
};

const describeNetwork = (): string => {
  const online =
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online';
  const c = typeof navigator !== 'undefined' ? (navigator as any).connection : undefined;
  const net = c
    ? `${c.effectiveType ?? '?'} rtt ${c.rtt ?? '?'}ms down ${c.downlink ?? '?'}Mbps saveData ${
        c.saveData ? 'on' : 'off'
      }`
    : 'n/a';
  const tab = typeof document !== 'undefined' ? document.visibilityState : 'n/a';
  return `${online}, net ${net}, tab ${tab}`;
};

/**
 * Describe why an upload died. The SDK reports an XHR with status 0 as an AbortError
 * DOMException with an empty message, so the text carries what the client can observe: file
 * size, type and readability, connectivity, tab visibility, idle time, progress, time to fail.
 */
export const uploadFailure = async (
  e: any,
  file: TUploadContent,
  trace?: UploadTrace
): Promise<MatrixError> => {
  const now = Date.now();
  const name = typeof e?.name === 'string' && e.name ? e.name : 'Error';
  const message = typeof e?.message === 'string' ? e.message : '';
  let readable: string;
  try {
    await file.arrayBuffer();
    readable = 'file readable';
  } catch (readErr: any) {
    readable = `file unreadable (${readErr?.name ?? 'unknown'})`;
  }
  const parts = [`${file.size} bytes`, file.type || 'unknown type', readable, describeNetwork()];
  parts.push(`idle ${now - lastUserActivity}ms`);
  if (trace) {
    parts.push(
      trace.firstProgressAt === undefined
        ? 'no progress'
        : `first progress ${trace.firstProgressAt - trace.startedAt}ms ${trace.loaded ?? 0}/${
            trace.total ?? '?'
          }B`
    );
    parts.push(`failed after ${now - trace.startedAt}ms`);
    if (trace.aborts) {
      parts.push(
        trace.aborts.length === 0
          ? 'abort calls: none'
          : `abort calls: ${trace.aborts.map((a) => `${a.api} ${a.frames}`).join('; ')}`
      );
    }
    if (trace.xhr) parts.push(trace.xhr);
    if (trace.signalAborted !== undefined) parts.push(`signal.aborted ${trace.signalAborted}`);
    if (trace.lifecycle) parts.push(trace.lifecycle);
    if (trace.previous) parts.push(`retried (attempt 1: ${trace.previous})`);
  }
  const error = `Upload failed: ${message ? `${name}: ${message}` : name} (${parts.join(', ')})`;
  // A homeserver refusal keeps its own errcode (M_TOO_LARGE ...), which is what names it to the sender.
  const errcode = typeof e?.errcode === 'string' && e.errcode.startsWith('M_') ? e.errcode : name;
  const err = new MatrixError({ error, errcode });
  (err as any).cause = e;
  const info: UploadFailureInfo = {
    unreadable: readable !== 'file readable',
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
    hidden: typeof document !== 'undefined' && document?.visibilityState === 'hidden',
    aborted: name === 'AbortError',
    progressed: trace?.firstProgressAt !== undefined,
    stopped: trace?.signalAborted === true,
  };
  (err as any).info = info;
  return err;
};

// An abort before any progress, within this long, is retried once: the request most likely died on
// a reused connection before a byte left, and the failed attempt discards that connection. Nothing
// here has shown that is the cause; the failure text records both attempts so it can be checked.
const RETRY_WINDOW_MS = 3000;

const copyInMemory = async (file: TUploadContent): Promise<TUploadContent> => {
  const bytes = await file.arrayBuffer();
  return typeof File !== 'undefined' && file instanceof File
    ? new File([bytes], file.name, { type: file.type, lastModified: file.lastModified })
    : new Blob([bytes], { type: file.type });
};

export const uploadContent = async (
  mx: MatrixClient,
  file: TUploadContent,
  options: ContentUploadOptions
) => {
  const {
    name,
    fileType,
    hideFilename,
    onProgress,
    onPromise,
    onSuccess,
    onError,
    describeLifecycle,
  } = options;

  let previous: string | undefined;
  for (let attempt = 1; ; attempt += 1) {
    // The browser may hold a picked file as a handle it cannot always re-read (e.g. content://), so
    // each attempt uploads a copy held in memory; a file that cannot be read fails here, named.
    let body: TUploadContent;
    try {
      // eslint-disable-next-line no-await-in-loop
      body = await copyInMemory(file);
    } catch (readErr: any) {
      const errcode = readErr?.name || 'Error';
      const unreadable = new MatrixError({
        error: `Upload failed: file unreadable before upload (${errcode}) (${file.size} bytes, ${
          file.type || 'unknown type'
        })`,
        errcode,
      });
      (unreadable as any).info = { ...NO_INFO, unreadable: true };
      onError(unreadable);
      return;
    }
    const probe = startAbortProbe();
    const trace: UploadTrace = { startedAt: Date.now(), previous, aborts: probe.calls };
    const abortController = new AbortController();
    try {
      const uploadPromise = mx.uploadContent(body, {
        name,
        type: fileType,
        includeFilename: !hideFilename,
        abortController,
        progressHandler: (progress) => {
          if (trace.firstProgressAt === undefined) trace.firstProgressAt = Date.now();
          trace.loaded = progress.loaded;
          trace.total = progress.total;
          onProgress?.(progress);
        },
      });
      onPromise?.(uploadPromise);
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await uploadPromise;
        const mxc = data.content_uri;
        if (mxc) onSuccess(mxc);
        else onError(new MatrixError(data));
        return;
      } catch (e: any) {
        const elapsed = Date.now() - trace.startedAt;
        trace.xhr = probe.describeXhrs();
        trace.signalAborted = abortController.signal.aborted;
        const retry =
          attempt === 1 &&
          e?.name === 'AbortError' &&
          !abortController.signal.aborted &&
          trace.firstProgressAt === undefined &&
          elapsed < RETRY_WINDOW_MS;
        if (!retry) {
          trace.lifecycle = describeLifecycle?.();
          // eslint-disable-next-line no-await-in-loop
          onError(await uploadFailure(e, file, trace));
          return;
        }
        previous = `AbortError after ${elapsed}ms, no progress, ${
          trace.aborts?.length
            ? `abort calls: ${trace.aborts.map((a) => `${a.api} ${a.frames}`).join('; ')}`
            : 'abort calls: none'
        }, ${trace.xhr}`;
      }
    } finally {
      probe.stop();
    }
  }
};

export const matrixEventByRecency = (m1: MatrixEvent, m2: MatrixEvent) => m2.getTs() - m1.getTs();

export const factoryEventSentBy = (senderId: string) => (ev: MatrixEvent) =>
  ev.getSender() === senderId;

export const eventWithShortcode = (ev: MatrixEvent) =>
  typeof ev.getContent().shortcode === 'string';

export const getDMRoomFor = (mx: MatrixClient, userId: string): Room | undefined => {
  const dmLikeRooms = mx
    .getRooms()
    .filter(
      (room) =>
        room.getMyMembership() === Membership.Join &&
        room.hasEncryptionStateEvent() &&
        room.getMembers().length <= 2
    );

  return dmLikeRooms.find((room) => room.getMember(userId));
};

export const guessDmRoomUserId = (room: Room, myUserId: string): string => {
  const getOldestMember = (members: RoomMember[]): RoomMember | undefined => {
    let oldestMemberTs: number | undefined;
    let oldestMember: RoomMember | undefined;

    const pickOldestMember = (member: RoomMember) => {
      if (member.userId === myUserId) return;

      if (
        oldestMemberTs === undefined ||
        (member.events.member && member.events.member.getTs() < oldestMemberTs)
      ) {
        oldestMember = member;
        oldestMemberTs = member.events.member?.getTs();
      }
    };

    members.forEach(pickOldestMember);

    return oldestMember;
  };

  // Pick the joined user who's been here longest (and isn't us),
  const member = getOldestMember(room.getJoinedMembers());
  if (member) return member.userId;

  // if there are no joined members other than us, use the oldest member
  const member1 = getOldestMember(
    room.getLiveTimeline().getState(EventTimeline.FORWARDS)?.getMembers() ?? []
  );
  return member1?.userId ?? myUserId;
};

type MDirectContent = Record<string, string[]>;

const mDirectWrites = new WeakMap<MatrixClient, Promise<unknown>>();

/**
 * The only writer of m.direct. m.direct is one account-data event that every
 * edit replaces whole, so edits run one at a time, each reading the content the
 * previous one wrote. `edit` returns the new content, or undefined for no write.
 */
export const updateMDirect = (
  mx: MatrixClient,
  edit: (current: MDirectContent) => MDirectContent | undefined
): Promise<void> => {
  const run = (mDirectWrites.get(mx) ?? Promise.resolve()).then(async () => {
    const event = mx.getAccountData(AccountDataEvent.Direct as any);
    const next = edit(event ? structuredClone(event.getContent()) : {});
    if (next) await mx.setAccountData(AccountDataEvent.Direct as any, next as any);
  });
  mDirectWrites.set(
    mx,
    run.catch(() => undefined)
  );
  return run;
};

/** A room can be a DM for one person only: it leaves every other user's list. */
export const addRoomIdToMDirect = (
  mx: MatrixClient,
  roomId: string,
  userId: string
): Promise<void> =>
  updateMDirect(mx, (current) => {
    const next = structuredClone(current);
    Object.keys(next).forEach((targetUserId) => {
      if (targetUserId !== userId) {
        next[targetUserId] = next[targetUserId].filter((id) => id !== roomId);
      }
    });
    const roomIds = next[userId] ?? [];
    if (!roomIds.includes(roomId)) roomIds.push(roomId);
    next[userId] = roomIds;
    return next;
  });

export const removeRoomIdFromMDirect = (mx: MatrixClient, roomId: string): Promise<void> =>
  updateMDirect(mx, (current) => {
    const next: MDirectContent = {};
    Object.keys(current).forEach((userId) => {
      next[userId] = current[userId].filter((id) => id !== roomId);
    });
    return next;
  });

export const mxcUrlToHttp = (
  mx: MatrixClient,
  mxcUrl: string,
  useAuthentication?: boolean,
  width?: number,
  height?: number,
  resizeMethod?: string,
  allowDirectLinks?: boolean,
  allowRedirects?: boolean
): string | null =>
  mx.mxcUrlToHttp(
    mxcUrl,
    width,
    height,
    resizeMethod,
    allowDirectLinks,
    allowRedirects,
    useAuthentication
  );

export const downloadMedia = async (src: string): Promise<Blob> => {
  // this request is authenticated by service worker
  const res = await fetch(src, { method: 'GET' });
  const blob = await res.blob();
  return blob;
};

export const downloadEncryptedMedia = async (
  src: string,
  decryptContent: (buf: ArrayBuffer) => Promise<Blob>
): Promise<Blob> => {
  const encryptedContent = await downloadMedia(src);
  const decryptedContent = await decryptContent(await encryptedContent.arrayBuffer());

  return decryptedContent;
};

export const rateLimitedActions = async <T, R = void>(
  data: T[],
  callback: (item: T, index: number) => Promise<R>,
  maxRetryCount?: number
) => {
  let retryCount = 0;

  let actionInterval = 0;

  const sleepForMs = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const performAction = async (dataItem: T, index: number) => {
    const [err] = await to<R, MatrixError>(callback(dataItem, index));

    if (err?.httpStatus === 429) {
      if (retryCount === maxRetryCount) {
        return;
      }

      const waitMS = err.getRetryAfterMs() ?? 3000;
      actionInterval = waitMS * 1.5;
      await sleepForMs(waitMS);
      retryCount += 1;

      await performAction(dataItem, index);
    }
  };

  for (let i = 0; i < data.length; i += 1) {
    const dataItem = data[i];
    retryCount = 0;
    // eslint-disable-next-line no-await-in-loop
    await performAction(dataItem, i);
    if (actionInterval > 0) {
      // eslint-disable-next-line no-await-in-loop
      await sleepForMs(actionInterval);
    }
  }
};

export const knockSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6'];
  return !unsupportedVersion.includes(version);
};
export const restrictedSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7'];
  return !unsupportedVersion.includes(version);
};
export const knockRestrictedSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return !unsupportedVersion.includes(version);
};
export const creatorsSupported = (version: string): boolean => {
  const unsupportedVersion = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  return !unsupportedVersion.includes(version);
};
