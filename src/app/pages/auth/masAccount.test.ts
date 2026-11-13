import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
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

const src = (p: string) => readFileSync(`${process.cwd()}/src/app/pages/auth/${p}`, 'utf8');

describe('MAS front guards', () => {
  it('Login keeps a configured register entry, else MAS notice, else the bare link', () => {
    const s = src('login/Login.tsx');
    expect(s).toContain('useMasAccountUrl()');
    expect(s).toContain('{registerEntry && <RegisterEntry />}');
    expect(s).toContain('{!registerEntry && masUrl && <MasAccountNotice');
    expect(s).toContain('{!registerEntry && !masUrl && (');
  });
  it('PasswordLoginForm hides the forgot link behind the MAS predicate', () => {
    const s = src('login/PasswordLoginForm.tsx');
    expect(s).toContain('useMasAccountUrl()');
    expect(s).toMatch(/\{!masUrl && \([\s\S]*getResetPasswordPath/);
  });
  it('RegisterRoute and ResetPassword show the notice under MAS', () => {
    ['register/RegisterRoute.tsx', 'reset-password/ResetPassword.tsx'].forEach((p) => {
      const s = src(p);
      expect(s).toContain('useMasAccountUrl()');
      expect(s).toContain('<MasAccountNotice');
    });
  });
  it('every login request path carries the soft-logout device', () => {
    expect(src('login/PasswordLoginForm.tsx').match(/withDevice\(\{/g)).toHaveLength(3);
    expect(src('login/TokenLogin.tsx')).toContain('withSoftLogoutDevice(');
  });
  it('the logout listener and login completion defer to the one wipe', () => {
    const root = readFileSync(`${process.cwd()}/src/app/pages/client/ClientRoot.tsx`, 'utf8');
    expect(root).toContain('createLogoutHandler(');
    expect(root).toContain('wipeLocalData(mx)');
    expect(root).not.toContain('localStorage.clear');
    expect(src('login/loginUtil.ts')).toContain('settleLocalData(loginRes');
    expect(src('register/registerUtil.ts')).toContain('settleLocalData(');
  });
});
