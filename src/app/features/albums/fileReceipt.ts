// The file-zone Mind contract (docs/file-zone-mind-contract.md): the plaintext hash a sender writes
// into a file event, and the receipt a Mind answers with.

import type { FileReader } from './buildAlbums';

/** Hex sha256 of the plaintext bytes, written at `content.info[FILE_HASH_KEY]` in unencrypted rooms. */
export const FILE_HASH_KEY = 'sha256';

/** A Mind's receipt: event type, and the content key holding { event_id, sha256, size }. Inert: nothing in it is fetched or trusted but the sender and the hash. */
export const FILE_RECEIVED = 'org.gamecult.file_received';

export const sha256Hex = async (data: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** The hash to write for a file about to be sent in an unencrypted room; none when it cannot be computed. */
export const hashForSend = async (data: Blob): Promise<string | undefined> => {
  try {
    return await sha256Hex(data);
  } catch {
    return undefined;
  }
};

export const readLine = (readBy: FileReader[], name: (sender: string) => string): string =>
  `read by ${readBy.map((r) => name(r.sender)).join(', ')}`;
