import {
  Answer,
  DeskProjection,
  Hidden,
  Question,
  QuestionStatus,
  isHiddenQuestion,
} from './feedback';

/** Past two heartbeats the projection may be out of date (provisional, doc section 8). */
export const STALE_MS = 30 * 60 * 1000;
/** Past this a question shows how long it has waited; it is never demoted or hidden (provisional). */
export const LONG_OPEN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AnswerRow = {
  recordId: string;
  /** Never a handle: the name at answer time, or the words for an account that has none. */
  who: string;
  kind: Answer['kind'];
  /** The option's text for a choice. */
  choice?: string;
  text?: string;
  at: string;
  /** Why the content is not shown: hidden by the Mind, or the author's account was erased. */
  withheld?: string;
};

export type DeskRow =
  | { kind: 'hidden'; forkId: string; hidden: Hidden }
  /** Its published options_hash is not the hash of what it shows: neither shown nor counted. */
  | { kind: 'unverified'; forkId: string }
  | {
      kind: 'question';
      forkId: string;
      title: string;
      body: string;
      options: { id: string; text: string; recommended: boolean }[];
      /** The recommendation resolved to its option's text; absent if it names no option. */
      recommended?: string;
      depends: { text: string; status?: QuestionStatus['state'] }[];
      ageDays: number;
      longOpen: boolean;
      answers: AnswerRow[];
    };

export type Desk = {
  /** False until the projection first arrives: "not published yet", never "no questions". */
  published: boolean;
  syncedAt?: string;
  stale: boolean;
  /** Oldest first. */
  open: DeskRow[];
  /** Settled questions with the Mind's ruling id. Closed (withdrawn) questions are not listed. */
  recorded: { forkId: string; title: string; rulingId: string }[];
  /** Derived for the booth mood. The page tallies nothing about answers. */
  counts: { open: number; answered: number };
};

const ageDays = (iso: string, now: number) =>
  Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS));

const answerRow = (a: Answer, q: Question): AnswerRow => {
  let withheld: string | undefined;
  if (a.hidden)
    withheld = `Hidden by ${a.hidden.by}, ${a.hidden.at.slice(0, 10)}, ${a.hidden.reason}`;
  else if (a.erased) withheld = 'Author erased their account';
  const choice = withheld ? undefined : a.answer?.choice;
  return {
    recordId: a.recordId,
    who: a.erased ? 'erased account' : a.displayName ?? 'an account',
    kind: a.kind,
    choice:
      choice === undefined ? undefined : q.options.find((o) => o.id === choice)?.text ?? choice,
    text: withheld ? undefined : a.answer?.text,
    at: a.answered_at,
    withheld,
  };
};

/** Earlier answers by the same account fold under their latest; the page never counts them. */
const standing = (answers: Answer[]): Answer[] => {
  const latest = new Map<string, Answer>();
  answers.forEach((a) => {
    const key = a.answerer ?? a.recordId;
    const held = latest.get(key);
    if (!held || held.answered_at <= a.answered_at) latest.set(key, a);
  });
  return [...latest.values()].sort((a, b) => a.answered_at.localeCompare(b.answered_at));
};

/** Open questions the page would list: the one rule the navigator's count and the desk share. */
export const countOpen = (p?: DeskProjection): number =>
  p?.questions.filter((q) => !isHiddenQuestion(q) && q.status.state === 'open').length ?? 0;

export const buildDesk = (
  p: DeskProjection | undefined,
  now: number,
  viewerId?: string,
  unverified: ReadonlySet<string> = new Set()
): Desk => {
  if (!p?.syncedAt) {
    return {
      published: false,
      stale: false,
      open: [],
      recorded: [],
      counts: { open: 0, answered: 0 },
    };
  }
  const known = new Map<string, Question>();
  p.questions.forEach((q) => !isHiddenQuestion(q) && known.set(q.fork_id, q));

  const open: DeskRow[] = [];
  const recorded: Desk['recorded'] = [];
  let answered = 0;
  [...p.questions]
    .sort((a, b) => {
      const at = (q: typeof a) => (isHiddenQuestion(q) ? '' : q.askedAt);
      return at(a).localeCompare(at(b));
    })
    .forEach((q) => {
      if (isHiddenQuestion(q)) {
        open.push({ kind: 'hidden', forkId: q.fork_id, hidden: q.hidden });
        return;
      }
      if (q.status.state === 'answered') {
        recorded.push({ forkId: q.fork_id, title: q.title, rulingId: q.status.rulingId });
        return;
      }
      if (q.status.state !== 'open') return;
      if (unverified.has(q.fork_id)) {
        open.push({ kind: 'unverified', forkId: q.fork_id });
        return;
      }
      const mine = standing(p.answers.filter((a) => a.fork_id === q.fork_id));
      if (viewerId && mine.some((a) => a.answerer === viewerId && !a.hidden)) answered += 1;
      const days = ageDays(q.askedAt, now);
      open.push({
        kind: 'question',
        forkId: q.fork_id,
        title: q.title,
        body: q.body,
        options: q.options.map((o) => ({ ...o, recommended: o.id === q.recommendation })),
        recommended: q.options.find((o) => o.id === q.recommendation)?.text,
        depends: q.dependsOn.map((d) => ({
          text: d.text,
          status: d.questionId ? known.get(d.questionId)?.status.state : undefined,
        })),
        ageDays: days,
        longOpen: days > LONG_OPEN_DAYS,
        answers: mine.map((a) => answerRow(a, q)),
      });
    });

  return {
    published: true,
    syncedAt: p.syncedAt,
    stale: now - Date.parse(p.syncedAt) > STALE_MS,
    open,
    recorded,
    counts: { open: open.filter((r) => r.kind === 'question').length, answered },
  };
};
