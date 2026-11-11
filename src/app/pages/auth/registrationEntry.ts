import type { ClientConfig } from '../../hooks/useClientConfig';
import { TRAINING_NOTICE_VERSION, trainingNoticeText } from '../../utils/trainingNotice';

export type RegistrationEntry = { url: string; notice: string; noticeVersion: number };

/**
 * The sign-up entry the sign-in page may show: the account service's registration page, when the
 * switch is on and the configured url is a plain http(s) address. Anything else is no entry. The
 * consent sentence and its version are trainingNotice.ts's, the ones a room shows.
 */
export const registrationEntry = (config: ClientConfig): RegistrationEntry | undefined => {
  const { enabled, url } = config.registration ?? {};
  if (enabled !== true || typeof url !== 'string') return undefined;
  try {
    const { protocol } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return undefined;
  } catch {
    return undefined;
  }
  return {
    url,
    notice: trainingNoticeText(config.previewDemo),
    noticeVersion: TRAINING_NOTICE_VERSION,
  };
};
