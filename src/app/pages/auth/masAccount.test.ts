import { describe, expect, it } from 'vitest';
import { masAccountUrl } from './masAccount';
import type { AutoDiscoveryInfo } from '../../cs-api';

const info = (auth?: unknown): AutoDiscoveryInfo =>
  ({
    'm.homeserver': { base_url: 'https://hs.example' },
    ...(auth === undefined ? {} : { 'org.matrix.msc2965.authentication': auth }),
  } as AutoDiscoveryInfo);

describe('masAccountUrl', () => {
  it('prefers the account url, then the issuer', () => {
    expect(
      masAccountUrl(info({ account: 'https://a.example/acc', issuer: 'https://a.example/' }))
    ).toBe('https://a.example/acc');
    expect(masAccountUrl(info({ issuer: 'https://a.example/' }))).toBe('https://a.example/');
  });
  it('is undefined when nothing is advertised', () => {
    expect(masAccountUrl(info())).toBeUndefined();
    expect(masAccountUrl(info({}))).toBeUndefined();
  });
  it('accepts http only for localhost', () => {
    expect(masAccountUrl(info({ account: 'http://a.example/acc' }))).toBeUndefined();
    expect(masAccountUrl(info({ account: 'http://localhost:8080/acc' }))).toBe(
      'http://localhost:8080/acc'
    );
  });
  it('skips an unusable account url and falls to a usable issuer', () => {
    expect(masAccountUrl(info({ account: 'not a url', issuer: 'https://a.example/' }))).toBe(
      'https://a.example/'
    );
  });
  it('rejects non-strings and non-http schemes', () => {
    expect(masAccountUrl(info({ account: 42, issuer: { x: 1 } }))).toBeUndefined();
    expect(masAccountUrl(info({ account: 'data:text/html,x' }))).toBeUndefined();
    expect(masAccountUrl(info({ account: 'ftp://a.example' }))).toBeUndefined();
  });
});
