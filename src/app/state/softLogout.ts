import { useState } from 'react';
import type { LoginRequest } from 'matrix-js-sdk';
import { getFallbackSession } from './sessions';

// A soft logout is the server saying "this token is dead, the device is not": the local stores
// stay, only the access token goes, and this record says whose device to sign back in as.
const SOFT_LOGOUT_KEY = 'ratatoskr_soft_logout';
const ACCESS_TOKEN_KEY = 'cinny_access_token';

export type SoftLogoutRecord = {
  userId: string;
  deviceId: string;
  baseUrl: string;
};

export const getSoftLogout = (storage: Storage = localStorage): SoftLogoutRecord | undefined => {
  const raw = storage.getItem(SOFT_LOGOUT_KEY);
  if (!raw) return undefined;
  try {
    const { userId, deviceId, baseUrl } = JSON.parse(raw) as Partial<SoftLogoutRecord>;
    if (
      typeof userId === 'string' &&
      typeof deviceId === 'string' &&
      typeof baseUrl === 'string' &&
      userId &&
      deviceId &&
      baseUrl
    ) {
      return { userId, deviceId, baseUrl };
    }
  } catch {
    // an unreadable record is no record
  }
  return undefined;
};

export const setSoftLogout = (record: SoftLogoutRecord, storage: Storage = localStorage) => {
  storage.setItem(SOFT_LOGOUT_KEY, JSON.stringify(record));
};

export const clearSoftLogout = (storage: Storage = localStorage) => {
  storage.removeItem(SOFT_LOGOUT_KEY);
};

export type LogoutKind = 'soft' | 'hard';

/** Soft only when the server said so: soft_logout === true. Anything else is hard. */
export const classifyLogout = (err: unknown): LogoutKind => {
  const data = (err as { data?: { soft_logout?: unknown } } | null | undefined)?.data;
  return data?.soft_logout === true ? 'soft' : 'hard';
};

/**
 * Enter the soft-logout state: remember the device, drop only the access token. Returns false
 * (and changes nothing) when there is no session to remember, which the caller treats as hard.
 */
export const beginSoftLogout = (storage: Storage = localStorage): boolean => {
  const session = getFallbackSession(storage);
  if (!session) return false;
  setSoftLogout(
    { userId: session.userId, deviceId: session.deviceId, baseUrl: session.baseUrl },
    storage
  );
  storage.removeItem(ACCESS_TOKEN_KEY);
  return true;
};

/** Every login request while a record stands asks for the same device back. */
export const withSoftLogoutDevice = (
  request: LoginRequest,
  record: SoftLogoutRecord | undefined
): LoginRequest => (record ? { ...request, device_id: record.deviceId } : request);

export type LoginOutcome = 'plain' | 'keep' | 'wipe';

/**
 * What a finished login does to local data. No record: a plain login, as ever. A record that
 * names this very user and device: keep the stores. Any other answer: the stores belong to
 * someone else, wipe them first.
 */
export const decideLoginOutcome = (
  record: SoftLogoutRecord | undefined,
  response: { user_id: string; device_id: string }
): LoginOutcome => {
  if (!record) return 'plain';
  return record.userId === response.user_id && record.deviceId === response.device_id
    ? 'keep'
    : 'wipe';
};

export const useSoftLogout = (): SoftLogoutRecord | undefined => useState(() => getSoftLogout())[0];
