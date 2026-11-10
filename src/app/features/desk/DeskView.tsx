import React, { useState } from 'react';
import { Text } from 'folds';
import { PoseAvatar } from '../../components/message/pose/PoseAvatar';
import { MINDS } from '../../components/message/pose/poses';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { AnswerRow, Desk, DeskRow, buildDesk } from './buildDesk';
import { DeskProjection } from './feedback';
import { deskMood } from './deskMood';
import * as css from './DeskView.css';

/** Slice 1 has no session: every viewer is signed out, and the note says why it cannot be used. */
export const SIGN_IN_NOTE = 'Answering opens with sign-in. Until then you can read the questions.';

const date = (iso: string) => iso.slice(0, 10);

const age = (row: Extract<DeskRow, { kind: 'question' }>) => {
  if (row.longOpen) return `Open for ${row.ageDays} days`;
  if (row.ageDays === 0) return 'Asked today';
  return row.ageDays === 1 ? 'Asked 1 day ago' : `Asked ${row.ageDays} days ago`;
};

function Answers({ answers }: { answers: AnswerRow[] }) {
  if (answers.length === 0) return <p className={css.Quiet}>No answers yet.</p>;
  return (
    <ul className={css.Options}>
      {answers.map((a) => (
        <li key={a.recordId} className={css.Option}>
          {`${a.who}, ${a.kind.toLowerCase()}: `}
          {a.withheld ?? [a.choice, a.text && `"${a.text}"`].filter(Boolean).join(' ')}
          {` (${date(a.at)})`}
        </li>
      ))}
    </ul>
  );
}

function Row({ row }: { row: DeskRow }) {
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  // Phones list titles; a tap opens one. Wide screens show every row open.
  const [open, setOpen] = useState(!phone);
  if (row.kind === 'unverified') {
    return (
      <li className={css.Row}>
        <p className={css.Quiet}>
          A question here does not match the hash it was published with, so it is not shown.
        </p>
      </li>
    );
  }
  if (row.kind === 'hidden') {
    return (
      <li className={css.Row}>
        <p className={css.Quiet}>
          {`A question here is hidden by ${row.hidden.by}, ${date(row.hidden.at)}, ${
            row.hidden.reason
          }.`}
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
            onClick={() => setOpen(!open)}
          >
            {row.title}
          </button>
        ) : (
          row.title
        )}
      </h3>
      <p className={css.Quiet}>{age(row)}</p>
      {open && (
        <>
          <p className={css.Body}>{row.body}</p>
          <ul className={css.Options}>
            {row.options.map((o) => (
              <li key={o.id} className={css.Option}>
                {`${o.id}  ${o.text}`}
                {o.recommended && ' (recommended)'}
              </li>
            ))}
          </ul>
          {row.depends.map((d) => (
            <p key={d.text} className={css.Quiet}>
              {`Waits on: "${d.text}"${d.status ? ` (${d.status})` : ''}`}
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
        : `${desk.counts.open} open. `}
      {`Synced ${desk.syncedAt && date(desk.syncedAt)}.`}
      {desk.stale && ' This may be out of date.'}
    </p>
  );
}

type DeskViewProps = {
  /** The Mind's key, as the navigator groups it. */
  mind: string;
  label: string;
  projection?: DeskProjection;
  now: number;
  /** Fork ids whose options_hash failed the recompute (optionsHash.ts). */
  unverified?: ReadonlySet<string>;
};

/** One Mind's desk, read-only: a stream of rows, the recorded rulings, and the booth Persona. */
export function DeskView({ mind, label, projection, now, unverified }: DeskViewProps) {
  const desk = buildDesk(projection, now, undefined, unverified);
  const mood = deskMood(desk.counts.open, desk.counts.answered);
  return (
    <section aria-label={`${label}'s desk`}>
      <Status desk={desk} label={label} />
      <div className={css.Layout}>
        <ol className={css.Rows}>
          {desk.open.map((row) => (
            <Row key={row.forkId} row={row} />
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
        <>
          <h3 className={css.Title}>Recorded as rulings</h3>
          <ul className={css.Options}>
            {desk.recorded.map((r) => (
              <li key={r.forkId} className={css.Option}>
                {`${r.title} (${r.rulingId})`}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
