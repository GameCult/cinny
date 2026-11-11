import type { ClientConfig } from '../../hooks/useClientConfig';
import { TRAINING_NOTICE_VERSION, trainingNoticeText } from '../../utils/trainingNotice';

export type RegistrationEntry = { url: string; notice: string; noticeVersion: number };

// Plain http is for a developer's own machine only; a stranger's sign-up page is https.
const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]';

/**
 * The sign-up entry the sign-in page may show: the account service's registration page, when the
 * switch is on and the configured url is an https address (http only for localhost). Anything else is no entry. The
 * consent sentence and its version are trainingNotice.ts's, the ones a room shows.
 */
export const registrationEntry = (config: ClientConfig): RegistrationEntry | undefined => {
  const { enabled, url } = config.registration ?? {};
  if (enabled !== true || typeof url !== 'string') return undefined;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' && !(protocol === 'http:' && isLocalHost(hostname))) return undefined;
  } catch {
    return undefined;
  }
  return {
    url,
    notice: trainingNoticeText(config.previewDemo),
    noticeVersion: TRAINING_NOTICE_VERSION,
  };
};
