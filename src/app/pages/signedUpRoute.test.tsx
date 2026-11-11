import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Route, createRoutesFromElements } from 'react-router-dom';
import { StaticRouter, createStaticHandler } from 'react-router-dom/server';
import { ClientConfigProvider } from '../hooks/useClientConfig';
import type { ClientConfig } from '../hooks/useClientConfig';
import { SIGNED_UP_PATH } from './paths';

const config: ClientConfig = { registration: { enabled: true, url: 'https://accounts.example/' } };

// The routes read localStorage when imported (settings atoms); the node environment has none.
let authRoutes: typeof import('./auth/authRoutes').authRoutes;
let SignedUp: typeof import('./auth').SignedUp;
beforeAll(async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  ({ authRoutes } = await import('./auth/authRoutes'));
  ({ SignedUp } = await import('./auth'));
}, 120_000);

const matchPath = async (path: string) => {
  const { query } = createStaticHandler(createRoutesFromElements(<Route>{authRoutes()}</Route>));
  const context = await query(new Request(`http://localhost${path}`));
  if (context instanceof Response) {
    throw new Error(`redirected to ${context.headers.get('Location')}`);
  }
  return context.matches;
};

describe('the sign-up return page in the real route table', () => {
  it('is its own route, outside AuthLayout (which would send it to sign in)', async () => {
    const matches = await matchPath(SIGNED_UP_PATH);
    // the pathless root, then the page itself: no layout route in between
    expect(matches?.map((m) => m.route.path)).toEqual([undefined, SIGNED_UP_PATH]);
  });

  it('renders its words, not the sign-in form, when the switch is on', () => {
    const html = renderToString(
      <ClientConfigProvider value={config}>
        <StaticRouter location={SIGNED_UP_PATH}>
          <SignedUp />
        </StaticRouter>
      </ClientConfigProvider>
    );
    expect(html).toContain('Follow the steps from the sign-up page');
  });
});
