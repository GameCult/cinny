import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AutoDiscoveryInfoProvider } from '../../hooks/useAutoDiscoveryInfo';
import { AuthServerProvider } from '../../hooks/useAuthServer';
import { AuthFlowsProvider } from '../../hooks/useAuthFlows';
import { ClientConfigProvider } from '../../hooks/useClientConfig';
import type { ClientConfig } from '../../hooks/useClientConfig';
import type { AutoDiscoveryInfo } from '../../cs-api';
import { setSoftLogout } from '../../state/softLogout';
import { Login } from './login/Login';
import { ResetPassword } from './reset-password/ResetPassword';

vi.mock('../../../client/initMatrix', () => ({ clearLoginData: vi.fn() }));
// folds' Overlay portals into document, which the server renderer has none of.
vi.mock('folds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('folds')>()),
  Overlay: () => null,
}));
vi.mock('./reset-password/PasswordResetForm', () => ({
  PasswordResetForm: () => <div>in-client reset form</div>,
}));

const plain: AutoDiscoveryInfo = { 'm.homeserver': { base_url: 'https://hs.example' } };
const mas: AutoDiscoveryInfo = {
  ...plain,
  'org.matrix.msc2965.authentication': { account: 'https://auth.example/account' },
};
const entryConfig: ClientConfig = {
  registration: { enabled: true, url: 'https://accounts.example/join' },
};
const flows = {
  loginFlows: { flows: [{ type: 'm.login.password' }] },
  registerFlows: { status: 400 },
} as never;

const render = (ui: React.ReactElement, info: AutoDiscoveryInfo, config: ClientConfig = {}) =>
  renderToString(
    <MemoryRouter>
      <AutoDiscoveryInfoProvider value={info}>
        <AuthServerProvider value="hs.example">
          <AuthFlowsProvider value={flows}>
            <ClientConfigProvider value={config}>{ui}</ClientConfigProvider>
          </AuthFlowsProvider>
        </AuthServerProvider>
      </AutoDiscoveryInfoProvider>
    </MemoryRouter>
  );

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', { location: { origin: 'https://app.example', search: '' } });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Login register entries', () => {
  it('non-MAS without an entry: the bare Register link, no notice', () => {
    const html = render(<Login />, plain);
    expect(html).toContain('Register</a>');
    expect(html).not.toContain('managed by your sign-in service');
  });
  it('non-MAS with an entry: the entry and its notice', () => {
    const html = render(<Login />, plain, entryConfig);
    expect(html).toContain('href="https://accounts.example/join"');
  });
  it('MAS without an entry: the account page notice, no bare Register link', () => {
    const html = render(<Login />, mas);
    expect(html).toContain('managed by your sign-in service');
    expect(html).toContain('href="https://auth.example/account"');
    expect(html).not.toContain('Register</a>');
  });
  it('MAS with an entry: the entry stays, no MAS notice', () => {
    const html = render(<Login />, mas, entryConfig);
    expect(html).toContain('href="https://accounts.example/join"');
    expect(html).not.toContain('managed by your sign-in service');
  });
});

describe('PasswordLoginForm through Login', () => {
  it('shows Forgot Password only without MAS', () => {
    expect(render(<Login />, plain)).toContain('Forget Password?');
    expect(render(<Login />, mas)).not.toContain('Forget Password?');
  });
  it('fixes the username and offers someone else only with a soft record', () => {
    expect(render(<Login />, plain)).not.toContain('readOnly');
    expect(render(<Login />, plain)).not.toContain('Sign in as someone else');
    setSoftLogout({ userId: '@a:hs.example', deviceId: 'DEV' });
    const html = render(<Login />, plain);
    expect(html).toContain('value="@a:hs.example"');
    expect(html).toMatch(/readonly/i);
    expect(html).toContain('Sign in as someone else');
  });
});

describe('ResetPassword', () => {
  it('shows the notice under MAS and the form otherwise', () => {
    const under = render(<ResetPassword />, mas);
    expect(under).toContain('href="https://auth.example/account"');
    expect(under).not.toContain('in-client reset form');
    const plainHtml = render(<ResetPassword />, plain);
    expect(plainHtml).toContain('in-client reset form');
    expect(plainHtml).not.toContain('managed by your sign-in service');
  });
});
