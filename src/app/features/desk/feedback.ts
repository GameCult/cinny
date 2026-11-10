/**
 * The desk's typed view of the feedback projections in docs/mind-feedback-pages.md (sections 5 and 12):
 * org.gamecult.feedback.question.v0 and org.gamecult.feedback.answer.v0. Bifrost serves them; the page
 * reads them and stores nothing. `answerer`, `kind` and `weightPermille` are the receiver's stamp from the
 * verified session; the client never supplies them, so nothing here has a write shape.
 */

export type Hidden = { by: string; at: string; reason: string };

/** The status is derived in the owning Mind; the page shows it and never writes it. */
export type QuestionStatus =
  | { state: 'open' }
  | { state: 'answered'; rulingId: string }
  | { state: 'closed' };

export type Question = {
  /** `<campaign>:question:<label>`. */
  fork_id: string;
  owner: string;
  title: string;
  body: string;
  /** `id` is the option's label. */
  options: { id: string; text: string }[];
  /** An option label; never nil. Never preselected. */
  recommendation: string;
  /** `questionId` only where the line cites one question verbatim. */
  dependsOn: { text: string; questionId?: string }[];
  /** An ISO instant: the question's receipt `committed_at`. */
  askedAt: string;
  status: QuestionStatus;
  /**
   * Publisher's hash of what is shown. The desk recomputes it (optionsHash.ts, pinned to the CultLib vectors)
   * and refuses to show or answer a card whose hash differs. The receiver rejects an answer carrying a hash
   * it did not publish; sending is slice 2.
   */
  options_hash: string;
};

/** A hidden question keeps a stub; title, body, options and answers are withheld. */
export type HiddenQuestion = { fork_id: string; hidden: Hidden };

export type Answer = {
  /** `<question-label>.a<N>`. */
  recordId: string;
  fork_id: string;
  options_hash: string;
  /** Bifrost account id; absent once the account is erased. Receiver-set. */
  answerer?: string;
  /** Name and kind as they were at the moment of the answer; the name is gone once erased. Receiver-set. */
  displayName?: string;
  kind: 'Guest' | 'User' | 'Patron' | 'Member' | 'Mind';
  weightPermille: number;
  /** An option label, free text, or both. Absent while hidden or erased. */
  answer?: { choice?: string; text?: string };
  /** ISO instant the receiver accepted it. */
  answered_at: string;
  hidden?: Hidden;
  erased?: boolean;
};

/** What the page holds for one Mind's desk. `syncedAt` is absent until the projection first arrives. */
export type DeskProjection = {
  mind: string;
  syncedAt?: string;
  questions: (Question | HiddenQuestion)[];
  answers: Answer[];
};

export const isHiddenQuestion = (q: Question | HiddenQuestion): q is HiddenQuestion =>
  'hidden' in q;
