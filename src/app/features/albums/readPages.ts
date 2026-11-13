/** One page of a Matrix paginated endpoint: its events and the token for the next page, if any. */
export type Page<T> = { chunk?: T[]; next_batch?: string };

/** Pages read per endpoint at most, so a runaway zone cannot hold the phone in a loop. */
export const MAX_PAGES = 20;

/**
 * Reads every page of an endpoint by following `next_batch`, up to `maxPages`. `truncated` is true
 * when the cap stopped the read with more still to come, so a caller can say the list is partial.
 */
export const readPages = async <T>(
  fetchPage: (from: string | undefined) => Promise<Page<T>>,
  maxPages = MAX_PAGES
): Promise<{ items: T[]; truncated: boolean }> => {
  const items: T[] = [];
  let from: string | undefined;
  for (let n = 0; n < maxPages; n += 1) {
    // eslint-disable-next-line no-await-in-loop
    const page = await fetchPage(from);
    items.push(...(page.chunk ?? []));
    // An empty page ends the read even if a token is returned: a server that keeps handing out
    // tokens with nothing behind them would otherwise spend every page of the cap.
    if (!page.next_batch || !page.chunk?.length) return { items, truncated: false };
    from = page.next_batch;
  }
  return { items, truncated: true };
};
