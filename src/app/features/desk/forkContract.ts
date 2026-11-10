/**
 * The desk's typed view of the documents Bifrost serves for a Mind's desk: CultLib's
 * contracts/cultnet/governance/fork-card.md (gamecult.fork.list.v0 / entry / card / record, and the stored
 * gamecult.desk_answer.v0). Read-only: the page decodes them as served and derives nothing from them (the counted
 * answer is the record's `counted_answer_id`, not the page's opinion), so nothing here has a write shape.
 * Every key is written by the server, nil where absent.
 */

export type ForkOption = { id: string; text: string };

export type ForkCard = {
  schemaVersion: 'gamecult.fork.card.v0';
  /** `<campaign>:question:<label>`. */
  fork_id: string;
  title: string;
  context: string;
  options: ForkOption[];
  /** An option id; never nil. Never preselected. */
  recommendation: string;
  /** Prose lines, each verbatim; a line may read like a reference but is only text. */
  depends: string[];
  /** An option id, or nil. Not shown by the desk. */
  leans: string | null;
  /** Not shown by the desk. */
  flag: string | null;
  raised_in: { kind: string; id: string } | null;
  deciders: string[];
  status: 'open' | 'closed';
  /** The ruling id when a ruling closed the fork; nil when open, and nil on a closed card withdrawn with no ruling. */
  ruling: string | null;
  ruled_from: string[];
  /** The admission ordinal. */
  order: number;
  /**
   * Publisher's hash of the five shown members. The desk recomputes it (optionsHash.ts, pinned to the CultLib
   * vectors) and withdraws a card whose hash differs.
   */
  options_hash: string;
};

/** One stored answer, told apart by `outcome` (and `code` for a refusal). */
export type DeskAnswer = {
  schemaVersion: 'gamecult.desk_answer.v0';
  /** `n<seq>`. */
  answer_id: string;
  fork_id: string;
  outcome: 'Counted' | 'Revision' | 'Retraction' | 'Refused';
  /** A Revision's target. */
  of: string | null;
  /** A Retraction's target (or a refused retraction's). */
  retracts: string | null;
  /** A refusal's code. */
  code: string | null;
  options_hash: string;
  choice: string | null;
  /** The decider's own words, verbatim; nil for everyone Bifrost does not show notes to. */
  note: string | null;
  answered_at: string;
  received_at: string;
  claim_in_future: boolean;
  answerer: string;
  authority: string;
  request_id: string;
};

export type ForkRecord = {
  schemaVersion: 'gamecult.fork.record.v0';
  fork_id: string;
  options_hash: string;
  /** Derived by the receiver; the page renders it and never recomputes it. */
  counted_answer_id: string | null;
  /** In admission order. */
  answers: DeskAnswer[];
};

export type ForkEntry = {
  schemaVersion: 'gamecult.fork.entry.v0';
  card: ForkCard;
  record: ForkRecord;
};

/** What the page holds for one Mind's desk. */
export type ForkList = {
  schemaVersion: 'gamecult.fork.list.v0';
  mind: string;
  /** `s<N>`: the same stamp is the same state. */
  stamp: string;
  open_count: number;
  recorded_count: number;
  forks: ForkEntry[];
  next_cursor: string | null;
};
