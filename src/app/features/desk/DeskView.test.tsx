import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../hooks/useScreenSize';
import { DeskEntry } from './DeskEntry';
import { DeskView, SIGN_IN_NOTE } from './DeskView';
import { NOW, STATES } from './fixtures';
import { setDeskSource } from './source';

const view = (state: keyof typeof STATES, size: ScreenSize, mind = 'void') =>
  renderToStaticMarkup(
    <ScreenSizeProvider value={size}>
      <DeskView mind={mind} label="Void" projection={STATES[state]} now={NOW} />
    </ScreenSizeProvider>
  );

describe('DeskView', () => {
  it('folds a row behind its title on a phone, with the fold button saying so', () => {
    const html = view('noAnswers', ScreenSize.Mobile);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Question plain');
    expect(html).not.toContain('Context for plain');
    expect(html).not.toContain('First way');
  });
  it('shows the row open, with no fold button, on a wide screen', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    expect(html).not.toContain('aria-expanded');
    expect(html).toContain('Context for plain');
    expect(html).toContain('First way');
  });
  it('states the recommendation in words, on that option only', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    expect(html.match(/\(recommended\)/g)).toHaveLength(1);
    expect(html).toContain('B  Second way (recommended)');
  });
  it('shows the depends line with the dependency status', () => {
    expect(view('blocked', ScreenSize.Desktop)).toContain(
      'Waits on: &quot;Needs the first one settled&quot; (open)'
    );
  });
  it('keeps the note disabled and says why in a sentence the field points at', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    expect(html).toMatch(/<textarea[^>]* disabled=""/);
    expect(html).toContain(SIGN_IN_NOTE);
    expect(SIGN_IN_NOTE).toMatch(/sign-in/);
    expect(html).toMatch(/aria-describedby="note-[^"]+-why"/);
  });
  it('says No answers yet on a row without answers', () => {
    expect(view('noAnswers', ScreenSize.Desktop)).toContain('No answers yet.');
  });
  it('shows how long a long-open question has waited', () => {
    expect(view('longOpen', ScreenSize.Desktop)).toContain('Open for 21 days');
  });
  it('lists settled questions as recorded rulings with the ruling id', () => {
    const html = view('settled', ScreenSize.Desktop);
    expect(html).toContain('Recorded as rulings');
    expect(html).toContain('Question done (ruling:done-1)');
    expect(html).not.toContain('Question shut');
  });
  it('says it may be out of date when stale, and says nothing of the kind when fresh', () => {
    expect(view('stale', ScreenSize.Desktop)).toContain('may be out of date');
    expect(view('noAnswers', ScreenSize.Desktop)).not.toContain('out of date');
  });
  it('says nothing is waiting when empty, and that nothing is published when it never arrived', () => {
    expect(view('empty', ScreenSize.Desktop)).toContain('Nothing is waiting on you from Void.');
    expect(view('unpublished', ScreenSize.Desktop)).toContain(
      'Void&#x27;s questions have not been published yet.'
    );
  });
  it('shows hidden and erased rows as withheld stubs', () => {
    expect(view('hidden', ScreenSize.Desktop)).toContain('hidden by Kiko');
    expect(view('erased', ScreenSize.Desktop)).toContain('erased account');
  });
  it('seats the Mind in the booth with the pose for the desk mood', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    expect(html).toContain('data-pose="thinking"');
    expect(html).toContain('Just one fork on the desk.');
  });
  it('shows no booth for a Mind without art rather than another face', () => {
    expect(view('noAnswers', ScreenSize.Desktop, 'nobody')).not.toContain('data-pose');
  });
  it('shows no booth before anything is published', () => {
    expect(view('unpublished', ScreenSize.Desktop)).not.toContain('data-pose');
  });
});

describe('DeskEntry', () => {
  afterEach(() => setDeskSource(() => undefined));
  const entry = (mind: string) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <DeskEntry mind={mind} />
      </MemoryRouter>
    );
  it('reads "Desk · N open" and links to that Mind\'s desk', () => {
    setDeskSource(() => STATES.blocked);
    const html = entry('void');
    expect(html).toContain('Desk · 2 open');
    expect(html).toContain('href="/desk/void"');
  });
  it('is absent at zero open, when nothing is published, and when only settled forks exist', () => {
    setDeskSource(() => STATES.empty);
    expect(entry('void')).toBe('');
    setDeskSource(() => undefined);
    expect(entry('void')).toBe('');
    setDeskSource(() => ({ ...STATES.settled, questions: STATES.settled.questions.slice(0, 2) }));
    expect(entry('void')).toBe('');
  });
});
