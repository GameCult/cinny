import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ClientConfigProvider } from '../../../hooks/useClientConfig';
import type { ClientConfig } from '../../../hooks/useClientConfig';
import { AutoDiscoveryInfoProvider } from '../../../hooks/useAutoDiscoveryInfo';
import type { AutoDiscoveryInfo } from '../../../cs-api';
import { RegisterRoute } from './RegisterRoute';

// The in-client form needs a homeserver; the route test only needs to know whether it was asked for.
vi.mock('./Register', () => ({ Register: () => <div>in-client register form</div> }));

const plain: AutoDiscoveryInfo = { 'm.homeserver': { base_url: 'https://hs.example' } };
const mas: AutoDiscoveryInfo = {
  ...plain,
  'org.matrix.msc2965.authentication': { account: 'https://auth.example/account' },
};

const render = (config: ClientConfig, info: AutoDiscoveryInfo = plain) =>
  renderToString(
    <AutoDiscoveryInfoProvider value={info}>
      <ClientConfigProvider value={config}>
        <RegisterRoute />
      </ClientConfigProvider>
    </AutoDiscoveryInfoProvider>
  );

describe('the /register route', () => {
  it('with the switch on offers only the account service link, not the in-client form', () => {
    const html = render({ registration: { enabled: true, url: 'https://accounts.example/join' } });
    expect(html).toContain('href="https://accounts.example/join"');
    expect(html).not.toContain('in-client register form');
  });

  it('with the switch off shows the in-client form', () => {
    expect(
      render({ registration: { enabled: false, url: 'https://accounts.example/join' } })
    ).toContain('in-client register form');
    expect(render({})).toContain('in-client register form');
  });

  it('with the switch on but an unusable url falls back to the form', () => {
    expect(
      render({ registration: { enabled: true, url: 'ftp://accounts.example/join' } })
    ).toContain('in-client register form');
  });

  it('under MAS with no configured entry shows the account page notice, not the form', () => {
    const html = render({}, mas);
    expect(html).toContain('href="https://auth.example/account"');
    expect(html).not.toContain('in-client register form');
  });

  it('under MAS a configured entry keeps its own page, not the notice or the form', () => {
    const html = render(
      { registration: { enabled: true, url: 'https://accounts.example/join' } },
      mas
    );
    expect(html).toContain('href="https://accounts.example/join"');
    expect(html).not.toContain('auth.example/account');
    expect(html).not.toContain('in-client register form');
  });
});
