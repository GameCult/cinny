import { describe, expect, it } from 'vitest';
import { hashForSend, readLine, sha256Hex } from './fileReceipt';

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
  const name = (s: string) => s.slice(1, s.indexOf(':'));
  it('names each reader and flags a hash that differs', () => {
    expect(
      readLine(
        [
          { sender: '@void:x', ts: 1, hash: 'match' },
          { sender: '@eureka:x', ts: 2, hash: 'differs' },
          { sender: '@aqua:x', ts: 3, hash: 'unchecked' },
        ],
        name
      )
    ).toBe('read by void, eureka (hash differs), aqua');
  });
});
