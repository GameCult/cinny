import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debugOverlaysAllowed, overlayRequested } from './debugOverlays';

let search = '';
beforeEach(() => {
  search = '';
  vi.stubGlobal('window', {
    get location() {
      return { search };
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('debugOverlaysAllowed', () => {
  it('a production build allows nothing by default', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PREVIEW_DEMO', '');
    expect(debugOverlaysAllowed(undefined)).toBe(false);
    expect(debugOverlaysAllowed({ tier: 'full' })).toBe(false);
    expect(debugOverlaysAllowed({ tier: 'full', debugOverlays: false })).toBe(false);
  });

  it('a dev build, a demo preview build or an explicit config flag allows them', () => {
    vi.stubEnv('DEV', true);
    expect(debugOverlaysAllowed(undefined)).toBe(true);
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_PREVIEW_DEMO', '1');
    expect(debugOverlaysAllowed(undefined)).toBe(true);
    vi.stubEnv('VITE_PREVIEW_DEMO', '');
    expect(debugOverlaysAllowed({ debugOverlays: true })).toBe(true);
  });
});

describe('overlayRequested', () => {
  it('needs both the query and the permission', () => {
    search = '?probe=1';
    expect(overlayRequested('probe', true)).toBe(true);
    expect(overlayRequested('probe', false)).toBe(false);
    expect(overlayRequested('tierlabel', true)).toBe(false);
    search = '?tierlabel=1';
    expect(overlayRequested('tierlabel', true)).toBe(true);
    search = '';
    expect(overlayRequested('probe', true)).toBe(false);
  });
});
