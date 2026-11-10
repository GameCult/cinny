import { DeskAnswer, ForkEntry, ForkList } from './forkContract';

export type AnswerRow = {
  answerId: string;
  outcome: DeskAnswer['outcome'];
  /** The option's text for a choice. */
  choice?: string;
  /** Verbatim, and only when the server sent one. */
  note?: string;
  /** The answer a Revision or Retraction points at. */
  target?: string;
  /** A refusal's code. */
  code?: string;
  at: string;
  /** The record's counted answer: marked as served, never derived here. */
  counted: boolean;
};

export type DeskRow =
  /** Its published options_hash is not the hash of what it shows: neither shown nor counted. */
  | { kind: 'unverified'; forkId: string }
  | {
      kind: 'question';
      forkId: string;
      title: string;
      context: string;
      options: { id: string; text: string; recommended: boolean }[];
      /** The recommendation resolved to its option's text; absent if it names no option. */
      recommended?: string;
      depends: string[];
      /** In admission order, as served. */
      answers: AnswerRow[];
    };

export type Desk = {
  /** False until the list first arrives: "not published yet", never "no questions". */
  published: boolean;
  /** Oldest first, by the card's admission ordinal. */
  open: DeskRow[];
  /** Closed with a ruling id. A card closed with no ruling (withdrawn) is not listed. */
  recorded: { forkId: string; title: string; rulingId: string }[];
  /** Verified open questions on the page, for the booth mood. */
  counts: { open: number };
};

const answerRow = (a: DeskAnswer, entry: ForkEntry): AnswerRow => ({
  answerId: a.answer_id,
  outcome: a.outcome,
  choice:
    a.choice === null
      ? undefined
      : entry.card.options.find((o) => o.id === a.choice)?.text ?? a.choice,
  note: a.note ?? undefined,
  target: a.of ?? a.retracts ?? undefined,
  code: a.code ?? undefined,
  at: a.answered_at,
  counted: entry.record.counted_answer_id === a.answer_id,
});

export const buildDesk = (
  list: ForkList | undefined,
  unverified: ReadonlySet<string> = new Set()
): Desk => {
  if (!list) return { published: false, open: [], recorded: [], counts: { open: 0 } };
  const open: DeskRow[] = [];
  const recorded: Desk['recorded'] = [];
  [...list.forks]
    .sort((a, b) => a.card.order - b.card.order)
    .forEach((entry) => {
      const { card, record } = entry;
      if (card.status === 'closed') {
        if (card.ruling !== null)
          recorded.push({ forkId: card.fork_id, title: card.title, rulingId: card.ruling });
        return;
      }
      if (unverified.has(card.fork_id)) {
        open.push({ kind: 'unverified', forkId: card.fork_id });
        return;
      }
      open.push({
        kind: 'question',
        forkId: card.fork_id,
        title: card.title,
        context: card.context,
        options: card.options.map((o) => ({ ...o, recommended: o.id === card.recommendation })),
        recommended: card.options.find((o) => o.id === card.recommendation)?.text,
        depends: card.depends,
        answers: record.answers.map((a) => answerRow(a, entry)),
      });
    });
  return {
    published: true,
    open,
    recorded,
    counts: { open: open.filter((r) => r.kind === 'question').length },
  };
};
