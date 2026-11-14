import React, { useState } from 'react';
import { Text } from 'folds';
import { PoseAvatar } from '../../components/message/pose/PoseAvatar';
import { MINDS } from '../../components/message/pose/poses';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { AnswerRow, Desk, buildDesk, DeskRow } from './buildDesk';
import { useSkyInk } from '../../hooks/useTheme';
import { scrimStyle } from '../scene/skyInk';
import { ForkList } from './forkContract';
import { deskMood } from './deskMood';
import { raisedAge } from './age';
import * as css from './DeskView.css';

/** Slice 1 has no session: every viewer is signed out, and the note says why it cannot be used. */
export const SIGN_IN_NOTE = 'Answering opens with sign-in. Until then you can read the questions.';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const date = (iso: string) => iso.slice(0, 10);

const OUTCOME: Record<AnswerRow['outcome'], string> = {
  Counted: 'Answer',
  Revision: 'Revision',
  Retraction: 'Retraction',
  Refused: 'Refused',
};

/** One answer as served: its outcome, what it chose, its note when the server sent one, and whether it counts. */
const answerLine = (a: AnswerRow) =>
  [
    OUTCOME[a.outcome] + (a.code ? ` (${a.code})` : ''),
    a.target && `of ${a.target}`,
    a.choice,
    a.note !== undefined && `"${a.note}"`,
  ]
    .filter(Boolean)
    .join(' ');

function Answers({ answers }: { answers: AnswerRow[] }) {
  if (answers.length === 0) return <p className={css.Quiet}>No answers yet.</p>;
  return (
    <ul className={css.Options}>
      {answers.map((a) => (
        <li key={a.answerId} className={css.Option}>
          {`${answerLine(a)} (${date(a.at)})`}
          {a.counted && ' (counted)'}
        </li>
      ))}
    </ul>
  );
}

/** Phones list titles and a tap opens one; wide screens show every row open. Derived, so rotating never leaves it stale. */
export const rowOpen = (phone: boolean, tapped: boolean) => !phone || tapped;

function Row({ row, now }: { row: DeskRow; now: number }) {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const [tapped, setTapped] = useState(false);
  const open = rowOpen(phone, tapped);
  if (row.kind === 'unverified') {
    return (
      <li className={css.Row}>
        <p className={css.Quiet}>
          A question here does not match the hash it was published with, so it is not shown.
        </p>
      </li>
    );
  }
  const noteId = `note-${row.forkId}`;
  return (
    <li className={css.Row}>
      <h3 className={css.Title}>
        {phone ? (
          <button
            type="button"
            className={css.Fold}
            aria-expanded={open}
            onClick={() => setTapped(!tapped)}
          >
            {row.title}
          </button>
        ) : (
          row.title
        )}
      </h3>
      {open && (
        <>
          {raisedAge(row.raisedAt, now) && (
            <p className={css.Quiet}>{raisedAge(row.raisedAt, now)}</p>
          )}
          {row.deciderCount !== undefined && row.answererCount !== undefined && (
            <p className={css.Quiet}>
              {`${plural(row.deciderCount, 'decider')} · ${plural(row.answererCount, 'answerer')}`}
            </p>
          )}
          <p className={css.Body}>{row.context}</p>
          <ul className={css.Options}>
            {row.options.map((o) => (
              <li key={o.id} className={css.Option}>
                {`${o.id}  ${o.text}`}
                {o.recommended && ' (recommended)'}
              </li>
            ))}
          </ul>
          {row.depends.map((d) => (
            <p key={d} className={css.Quiet}>
              {`Waits on: "${d}"`}
            </p>
          ))}
          <span id={`${noteId}-label`}>Your note</span>
          <textarea
            className={css.Note}
            disabled
            aria-labelledby={`${noteId}-label`}
            aria-describedby={`${noteId}-why`}
          />
          <p id={`${noteId}-why`} className={css.Quiet}>
            {SIGN_IN_NOTE}
          </p>
          <Answers answers={row.answers} />
        </>
      )}
    </li>
  );
}

function Status({ desk, label }: { desk: Desk; label: string }) {
  if (!desk.published) return <p>{`${label}'s questions have not been published yet.`}</p>;
  return (
    <p role="status">
      {desk.counts.open === 0
        ? `Nothing is waiting on you from ${label}. `
        : `${desk.counts.open} open.`}
    </p>
  );
}

type DeskViewProps = {
  /** The Mind's key, as the navigator groups it. */
  mind: string;
  label: string;
  list?: ForkList;
  /** Fork ids whose options_hash failed the recompute (optionsHash.ts). */
  unverified?: ReadonlySet<string>;
  /** The clock the ages are read against; the page's own, a test's fixed one. */
  now?: number;
};

/** One Mind's desk, read-only: a stream of rows, the recorded rulings, and the booth Persona. */
export function DeskView({ mind, label, list, unverified, now = Date.now() }: DeskViewProps) {
  const desk = buildDesk(list, unverified);
  const skyInk = useSkyInk();
  // Slice 1 has no session, so nothing on the desk is the viewer's answer yet.
  const mood = deskMood(desk.counts.open, 0);
  return (
    <section aria-label={`${label}'s desk`}>
      <Status desk={desk} label={label} />
      <div className={css.Layout}>
        <ol className={css.Rows}>
          {desk.open.map((row) => (
            <Row key={row.forkId} row={row} now={now} />
          ))}
        </ol>
        {/* Only Minds with art in the catalogue get a booth; none gets another Mind's face. */}
        {desk.published && MINDS.includes(mind) && (
          <div className={css.Booth}>
            <PoseAvatar mind={mind} pose={mood.pose} userId={mind} />
            <Text className={css.BoothLine} size="T200" aria-live="polite">
              {mood.line}
            </Text>
          </div>
        )}
      </div>
      {desk.recorded.length > 0 && (
        <div className={css.Recorded} style={scrimStyle(skyInk)}>
          <h3 className={css.Title}>Recorded as rulings</h3>
          <ul className={css.Options}>
            {desk.recorded.map((r) => (
              <li key={r.forkId} className={css.Option}>
                {`${r.title} (${r.rulingId})`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
