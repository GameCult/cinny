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
};

export const getSoftLogout = (storage: Storage = localStorage): SoftLogoutRecord | undefined => {
  const raw = storage.getItem(SOFT_LOGOUT_KEY);
  if (!raw) return undefined;
  try {
    const { userId, deviceId } = JSON.parse(raw) as Partial<SoftLogoutRecord>;
    if (typeof userId === 'string' && typeof deviceId === 'string' && userId && deviceId) {
      return { userId, deviceId };
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
  setSoftLogout({ userId: session.userId, deviceId: session.deviceId }, storage);
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

export type LogoutHandlerPorts = {
  storage: Storage;
  stop: () => void;
  wipe: () => Promise<void>;
  reload: () => void;
  forgetSessionInWorker: () => void;
};

/**
 * The SessionLoggedOut handler. The SDK emits once per failing request and in-flight requests
 * outlive stopClient, so the first event decides and every later one is ignored: a second soft
 * event must never find the token already gone and fall into the wipe.
 */
export const createLogoutHandler = (ports: LogoutHandlerPorts) => {
  let fired = false;
  return async (err: unknown): Promise<void> => {
    if (fired || getSoftLogout(ports.storage)) return;
    fired = true;
    ports.stop();
    // Soft needs a session to remember; without one nothing can vouch for the stores, so wipe.
    if (classifyLogout(err) === 'soft' && beginSoftLogout(ports.storage)) {
      ports.forgetSessionInWorker();
      ports.reload();
      return;
    }
    await ports.wipe();
    ports.reload();
  };
};

/**
 * Settle local data when a login or registration hands back a session: wipe first when a soft
 * logout left stores that belong to someone else, then retire the record.
 */
export const settleLocalData = async (
  response: { user_id: string; device_id: string },
  wipe: () => Promise<void>,
  storage: Storage = localStorage
): Promise<LoginOutcome> => {
  const outcome = decideLoginOutcome(getSoftLogout(storage), response);
  if (outcome === 'wipe') await wipe();
  clearSoftLogout(storage);
  return outcome;
};
