import { useEffect, useState } from 'react';
import { ForkList } from './forkContract';
import { unverifiedOrAll } from './optionsHash';

/**
 * The fork ids of `list` whose options_hash fails the recompute: the one verified filter, shared by the desk page
 * and the navigator's count. Undefined until the check has landed, so no caller reads a count that a card is
 * about to be withdrawn from. `list` must be a stable reference (memoized by the caller): a new one re-runs the check.
 */
export const useUnverified = (list: ForkList | undefined): ReadonlySet<string> | undefined => {
  const [bad, setBad] = useState<ReadonlySet<string>>();
  useEffect(() => {
    let live = true;
    setBad(undefined);
    unverifiedOrAll(list?.forks ?? []).then((found) => live && setBad(found));
    return () => {
      live = false;
    };
  }, [list]);
  return bad;
};
