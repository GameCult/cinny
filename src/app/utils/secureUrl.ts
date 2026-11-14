// Plain http is for a developer's own machine only; a stranger's page is https.
const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname.endsWith('.localhost') ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]';

/** True for an https url, or an http url on localhost. Anything else, including non-urls, is false. */
export const isSecureOrLocalUrl = (value: string): boolean => {
  try {
    const { protocol, hostname } = new URL(value);
    return protocol === 'https:' || (protocol === 'http:' && isLocalHost(hostname));
  } catch {
    return false;
  }
};
