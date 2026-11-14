import { ForkCard, ForkEntry } from './forkContract';

// The hash and its canonical bytes are specified in CultLib contracts/cultnet/governance/fork-card.md
// ("Options hash", rule owner: Heimdall's binding file 1.2); the vectors in optionsHashVectors.json pin this code to it.

const jstr = (s: string): string => {
  let out = '"';
  // eslint-disable-next-line no-restricted-syntax
  for (const ch of s.normalize('NFC')) {
    const o = ch.codePointAt(0) as number;
    const named: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' };
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (named[o]) out += named[o];
    else out += o < 0x20 ? `\\u${o.toString(16).padStart(4, '0')}` : ch;
  }
  return `${out}"`;
};

export type Shown = Pick<ForkCard, 'title' | 'context' | 'options' | 'recommendation' | 'depends'>;

/** The five shown members as RFC 8785 JSON, keys already in sorted order. */
export const canonicalShown = (c: Shown): string =>
  `{"context":${jstr(c.context)},"depends":[${c.depends.map(jstr).join(',')}],"options":[${c.options
    .map((o) => `{"id":${jstr(o.id)},"text":${jstr(o.text)}}`)
    .join(',')}],"recommendation":${jstr(c.recommendation)},"title":${jstr(c.title)}}`;

export const shownOf = (c: ForkCard): Shown => ({
  title: c.title,
  context: c.context,
  options: c.options,
  recommendation: c.recommendation,
  depends: c.depends,
});

export const optionsHash = async (c: Shown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalShown(c));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Fork ids whose published `options_hash` is not the hash of what the card shows. */
export const unverifiedForks = async (forks: ForkEntry[]): Promise<Set<string>> => {
  const bad = new Set<string>();
  await Promise.all(
    forks.map(async ({ card }) => {
      if ((await optionsHash(shownOf(card))) !== card.options_hash) bad.add(card.fork_id);
    })
  );
  return bad;
};

/**
 * `unverifiedForks`, except that a check that cannot run (no `crypto.subtle` on an insecure origin, a rejected
 * digest) withdraws every card: a card nobody could verify is neither shown nor counted.
 */
export const unverifiedOrAll = async (forks: ForkEntry[]): Promise<Set<string>> =>
  unverifiedForks(forks).catch(() => new Set(forks.map(({ card }) => card.fork_id)));
