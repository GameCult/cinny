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
      /** When the question was first admitted, as served; absent when the card carries none. */
      raisedAt?: string;
      /** Counts as served: the same in the decider and the withheld view, so they show either way. Absent when the served number is outside the contract's range or not an integer. */
      deciderCount?: number;
      answererCount?: number;
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
  /** The list's own open_count: the one count the navigator, the status line and the booth share. */
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

const validCount = (n: number, min: number, max: number): number | undefined =>
  Number.isInteger(n) && n >= min && n <= max ? n : undefined;

export const buildDesk = (
  list: ForkList | undefined,
  unverified: ReadonlySet<string> = new Set()
): Desk => {
  if (!list) return { published: false, open: [], recorded: [], counts: { open: 0 } };
  const open: DeskRow[] = [];
  const recorded: Desk['recorded'] = [];
  list.forks.forEach((entry) => {
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
      raisedAt: card.raised_at ?? undefined,
      deciderCount: validCount(card.decider_count, 1, 64),
      answererCount: validCount(record.answerer_count, 0, Infinity),
      answers: record.answers.map((a) => answerRow(a, entry)),
    });
  });
  return {
    published: true,
    open,
    recorded,
    counts: { open: list.open_count },
  };
};
