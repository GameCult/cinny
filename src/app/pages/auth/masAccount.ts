import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import type { AutoDiscoveryInfo } from '../../cs-api';

// Plain http is for a developer's own machine only.
const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]';

const usable = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const { protocol, hostname } = new URL(value);
    if (protocol === 'https:' || (protocol === 'http:' && isLocalHost(hostname))) return value;
  } catch {
    // not a url
  }
  return undefined;
};

/**
 * The account page of the sign-in service fronting this homeserver (MAS), when discovery
 * advertises one: the account url, else the issuer, the same preference the devices page uses.
 * Undefined means the homeserver manages its own accounts.
 */
export const masAccountUrl = (info: AutoDiscoveryInfo): string | undefined => {
  const auth = info['org.matrix.msc2965.authentication'];
  return usable(auth?.account) ?? usable(auth?.issuer);
};

export const useMasAccountUrl = (): string | undefined => masAccountUrl(useAutoDiscoveryInfo());
