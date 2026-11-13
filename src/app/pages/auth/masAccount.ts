import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { isSecureOrLocalUrl } from '../../utils/secureUrl';
import type { AutoDiscoveryInfo } from '../../cs-api';

const usable = (value: unknown): string | undefined =>
  typeof value === 'string' && isSecureOrLocalUrl(value) ? value : undefined;

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
