import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../hooks/useScreenSize';
import { DeskEntry } from './DeskEntry';
import { DeskView, SIGN_IN_NOTE } from './DeskView';
import { STATES } from './fixtures';
import { setDeskSource } from './source';

const view = (
  state: keyof typeof STATES | 'unpublished',
  size: ScreenSize,
  mind = 'void',
  unverified = new Set<string>()
) =>
  renderToStaticMarkup(
    <ScreenSizeProvider value={size}>
      <DeskView
        mind={mind}
        label="Void"
        list={state === 'unpublished' ? undefined : STATES[state]}
        unverified={unverified}
      />
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
  it('keeps the note disabled and says why in a sentence the field points at', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    expect(html).toMatch(/<textarea[^>]* disabled=""/);
    expect(html).toContain(SIGN_IN_NOTE);
    expect(SIGN_IN_NOTE).toMatch(/sign-in/);
    expect(html).toMatch(/aria-describedby="note-[^"]+-why"/);
  });
  it('shows the depends line as the text it is', () => {
    expect(view('blocked', ScreenSize.Desktop)).toContain(
      'Waits on: &quot;Needs the first one settled&quot;'
    );
  });
  it('says No answers yet on a row without answers', () => {
    expect(view('noAnswers', ScreenSize.Desktop)).toContain('No answers yet.');
  });
  it('lists settled questions as recorded rulings with the ruling id', () => {
    const html = view('settled', ScreenSize.Desktop);
    expect(html).toContain('Recorded as rulings');
    expect(html).toContain('Question done (ruling:done-1)');
    expect(html).not.toContain('Question shut');
  });
  it('shows each outcome quietly, marks the counted answer, and renders a note only when sent', () => {
    const html = view('answered', ScreenSize.Desktop);
    expect(html).toContain(
      'Answer First way &quot;Because it is first.&quot; (2026-11-09) (counted)'
    );
    expect(html).toContain('Revision of n1 Third way (2026-11-09)');
    expect(html).toContain('Retraction of n2 (2026-11-09)');
    expect(html).toContain('Refused (not_a_decider) Second way &quot;Let me in.&quot;');
    expect(html).toContain('Answer &quot;Either, if measured first.&quot;');
    expect(html.match(/\(counted\)/g)).toHaveLength(1);
    expect(html).not.toContain('&quot;null&quot;');
  });
  it('says nothing is waiting when empty, and that nothing is published when it never arrived', () => {
    expect(view('empty', ScreenSize.Desktop)).toContain('Nothing is waiting on you from Void.');
    expect(view('unpublished', ScreenSize.Desktop)).toContain(
      'Void&#x27;s questions have not been published yet.'
    );
  });
  it('seats the Mind in the booth with the pose for the desk mood', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    expect(html).toContain('data-pose="thinking"');
    expect(html).toContain('Just one fork on the desk.');
  });
  it('makes the booth portrait a plain image: no button, no tab stop', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    const booth = html.slice(html.indexOf('data-pose'));
    expect(booth).toContain('<img');
    expect(html).not.toMatch(/<button[^>]*data-pose/);
    expect(html).not.toMatch(/<[a-z]+[^>]*data-pose[^>]*tabindex/);
    expect(html).toMatch(/<span[^>]*data-pose/);
  });
  it('withdraws a card whose hash does not match and does not count it open', () => {
    const html = view('noAnswers', ScreenSize.Desktop, 'void', new Set(['c:question:plain']));
    expect(html).toContain('does not match the hash it was published with');
    expect(html).not.toContain('First way');
    expect(html).not.toContain('Just one fork');
    expect(html).toContain('Nothing is waiting');
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
  it('reads the count the list states, not a count of the forks it carries', () => {
    setDeskSource(() => ({ ...STATES.empty, open_count: 5 }));
    expect(entry('void')).toContain('Desk · 5 open');
  });
  it('is absent at zero open, when nothing is published, and when only settled forks exist', () => {
    setDeskSource(() => STATES.empty);
    expect(entry('void')).toBe('');
    setDeskSource(() => undefined);
    expect(entry('void')).toBe('');
    setDeskSource(() => ({ ...STATES.settled, open_count: 0 }));
    expect(entry('void')).toBe('');
  });
});
