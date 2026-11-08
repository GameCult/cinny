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

/** What the progress handler saw of one upload, for the failure text. */
export type UploadTrace = {
  startedAt: number;
  firstProgressAt?: number;
  loaded?: number;
  total?: number;
  /** Summary of an earlier attempt of the same upload, when this one is a retry. */
  previous?: string;
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
    if (trace.previous) parts.push(`retried (attempt 1: ${trace.previous})`);
  }
  const error = `Upload failed: ${message ? `${name}: ${message}` : name} (${parts.join(', ')})`;
  const err = new MatrixError({ error, errcode: name });
  (err as any).cause = e;
  return err;
};

// An abort before any progress, within this long, is retried once: the request most likely died on
// a reused connection before a byte left, and the failed attempt discards that connection. Nothing
// here has shown that is the cause; the failure text records both attempts so it can be checked.
const RETRY_WINDOW_MS = 3000;

export const uploadContent = async (
  mx: MatrixClient,
  file: TUploadContent,
  options: ContentUploadOptions
) => {
  const { name, fileType, hideFilename, onProgress, onPromise, onSuccess, onError } = options;

  let previous: string | undefined;
  for (let attempt = 1; ; attempt += 1) {
    const trace: UploadTrace = { startedAt: Date.now(), previous };
    const abortController = new AbortController();
    const uploadPromise = mx.uploadContent(file, {
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
      const retry =
        attempt === 1 &&
        e?.name === 'AbortError' &&
        !abortController.signal.aborted &&
        trace.firstProgressAt === undefined &&
        elapsed < RETRY_WINDOW_MS;
      if (!retry) {
        // eslint-disable-next-line no-await-in-loop
        onError(await uploadFailure(e, file, trace));
        return;
      }
      previous = `AbortError after ${elapsed}ms, no progress`;
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
