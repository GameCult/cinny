import { describe, expect, it } from 'vitest';
import { ReceiptEvent, hashForSend, readLine, readersOf, sha256Hex } from './fileReceipt';

describe('sha256Hex', () => {
  it('hashes the bytes: the FIPS 180 vector for "abc"', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
  it('hashes empty input', async () => {
    expect(await sha256Hex(new Blob([]))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

describe('hashForSend', () => {
  it('gives no hash, and does not throw, when the blob cannot be read', async () => {
    const broken = { arrayBuffer: () => Promise.reject(new Error('gone')) } as unknown as Blob;
    expect(await hashForSend(broken)).toBeUndefined();
  });
});

describe('readLine', () => {
  it('names each reader', () => {
    const name = (s: string) => s.slice(1, s.indexOf(':'));
    expect(
      readLine(
        [
          { sender: '@void:x', ts: 1 },
          { sender: '@eureka:x', ts: 2 },
        ],
        name
      )
    ).toBe('fetched for void, eureka');
  });
});

describe('readersOf: receipts anywhere in the room, thread reply or plain event', () => {
  const HASH = 'a'.repeat(64);
  const file = { info: { sha256: HASH } };
  const receipt = (
    id: string,
    ts: number,
    sender: string,
    sha: unknown | undefined,
    fileId: string | undefined,
    relates?: object
  ): ReceiptEvent => ({
    event_id: id,
    type: 'org.gamecult.file_received',
    sender,
    origin_server_ts: ts,
    content: {
      ...(relates ? { 'm.relates_to': relates } : {}),
      'org.gamecult.file_received': {
        event_id: fileId ?? '$f',
        sha256: sha === undefined ? HASH : sha,
      },
    },
  });
  const readers = (events: ReceiptEvent[], content: Record<string, unknown> | undefined) =>
    readersOf(events, '$f', content, 'gamecult.org').map((r) => r.sender);

  it('counts a threadless receipt, as a composer file with no album root gets', () => {
    expect(readers([receipt('$1', 5, '@void:gamecult.org', undefined, undefined)], file)).toEqual([
      '@void:gamecult.org',
    ]);
  });
  it('counts a thread reply the same way', () => {
    const t = { rel_type: 'm.thread', event_id: '$root' };
    expect(readers([receipt('$1', 5, '@eureka:gamecult.org', HASH, '$f', t)], file)).toEqual([
      '@eureka:gamecult.org',
    ]);
  });
  it('refuses lookalike localparts and foreign servers', () => {
    expect(
      readers(
        [
          receipt('$1', 1, '@void2:gamecult.org', undefined, undefined),
          receipt('$2', 2, '@voidd:gamecult.org', undefined, undefined),
          receipt('$3', 3, '@Void:gamecult.org', undefined, undefined),
          receipt('$4', 4, '@void:evil.example', undefined, undefined),
          receipt('$5', 5, '@void:gamecult.org.evil.example', undefined, undefined),
          receipt('$6', 6, '@mallory:gamecult.org', undefined, undefined),
        ],
        file
      )
    ).toEqual([]);
  });
  it('shows nothing for a mismatched hash, a file with no hash, or another file', () => {
    expect(
      readers([receipt('$1', 1, '@void:gamecult.org', 'b'.repeat(64), undefined)], file)
    ).toEqual([]);
    expect(
      readers([receipt('$1', 1, '@void:gamecult.org', undefined, undefined)], { info: {} })
    ).toEqual([]);
    expect(
      readers([receipt('$1', 1, '@void:gamecult.org', undefined, undefined)], undefined)
    ).toEqual([]);
    expect(readers([receipt('$1', 1, '@void:gamecult.org', HASH, '$other')], file)).toEqual([]);
  });
  it('keeps one entry per Mind, the latest, oldest first', () => {
    expect(
      readersOf(
        [
          receipt('$1', 30, '@void:gamecult.org', undefined, undefined),
          receipt('$2', 10, '@void:gamecult.org', undefined, undefined),
          receipt('$3', 20, '@aqua:gamecult.org', undefined, undefined),
        ],
        '$f',
        file,
        'gamecult.org'
      )
    ).toEqual([
      { sender: '@aqua:gamecult.org', ts: 20 },
      { sender: '@void:gamecult.org', ts: 30 },
    ]);
  });
  it('ignores a redacted receipt and a malformed one', () => {
    const redacted = {
      ...receipt('$1', 1, '@void:gamecult.org', undefined, undefined),
      unsigned: { redacted_because: {} },
    };
    expect(
      readers(
        [
          redacted,
          receipt('$2', 2, '@void:gamecult.org', 7, undefined),
          {
            ...receipt('$3', 3, '@void:gamecult.org', undefined, undefined),
            type: 'm.room.message',
          },
        ],
        file
      )
    ).toEqual([]);
  });

  describe('an m.reference to the file', () => {
    const ref = (id: string) => ({ rel_type: 'm.reference', event_id: id });
    it('counts when it names the same event as the content', () => {
      expect(
        readers([receipt('$1', 1, '@void:gamecult.org', HASH, '$f', ref('$f'))], file)
      ).toEqual(['@void:gamecult.org']);
    });
    it('counts for nothing when it names another event', () => {
      expect(
        readers([receipt('$1', 1, '@void:gamecult.org', HASH, '$f', ref('$other'))], file)
      ).toEqual([]);
    });
    it('draws one entry per Mind however many receipts exist', () => {
      expect(
        readers(
          [
            receipt('$1', 1, '@void:gamecult.org', HASH, '$f', ref('$f')),
            receipt('$2', 2, '@void:gamecult.org', HASH, '$f'),
            receipt('$3', 3, '@void:gamecult.org', HASH, '$f', ref('$f')),
          ],
          file
        )
      ).toEqual(['@void:gamecult.org']);
    });
  });
});
