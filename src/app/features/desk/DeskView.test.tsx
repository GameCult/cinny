import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../../hooks/useScreenSize';
import { SkyInkContextProvider } from '../../hooks/useTheme';
import { SCRIM_GROUND, SCRIM_INK } from '../scene/skyInk';
import { DeskEntry, DeskLink } from './DeskEntry';
import { DeskView, SIGN_IN_NOTE, rowOpen } from './DeskView';
import { ForkList } from './forkContract';
import { STATES } from './fixtures';
import { setDeskSource } from './source';

// useTheme reads the stored settings when it loads.
vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined }));

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
  it('gives the recorded rulings their own ground and ink while a scene runs, none without one', () => {
    const withScene = renderToStaticMarkup(
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <SkyInkContextProvider value={{ state: 'dusk', phone: false }}>
          <DeskView mind="void" label="Void" list={STATES.settled} unverified={new Set()} />
        </SkyInkContextProvider>
      </ScreenSizeProvider>
    );
    // renderToStaticMarkup writes the inline style as the browser would read it back
    expect(withScene).toContain(SCRIM_GROUND.replace(/, /g, ', '));
    expect(withScene).toContain(`color:${SCRIM_INK}`);
    expect(view('settled', ScreenSize.Desktop)).not.toContain('background-color');
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
    expect(html).toContain('Nothing is waiting on you from Void.');
    expect(html).not.toContain('1 open.');
  });
  it('never claims an empty desk while the list says forks are open, whatever rows it could show', () => {
    setDeskSource(() => undefined);
    const html = renderToStaticMarkup(
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <DeskView mind="void" label="Void" list={{ ...STATES.empty, open_count: 3 }} />
      </ScreenSizeProvider>
    );
    expect(html).toContain('3 open.');
    expect(html).not.toContain('Nothing is waiting');
  });
  it('says every row is read-only for a signed-out viewer, in every state the fixtures hold', () => {
    (['noAnswers', 'blocked', 'answered', 'settled'] as const).forEach((state) => {
      const html = view(state, ScreenSize.Desktop);
      const rows = html.match(/<textarea/g)?.length ?? 0;
      expect(rows).toBeGreaterThan(0);
      expect(html.match(/<textarea[^>]* disabled=""/g)).toHaveLength(rows);
      expect(html.split(SIGN_IN_NOTE)).toHaveLength(rows + 1);
    });
  });
  it('shows a guest answer with its text and never an answerer id', () => {
    const html = view('guest', ScreenSize.Desktop);
    expect(html).toContain('Answer Second way &quot;From outside the circle.&quot;');
    expect(html).toContain('1 decider · 2 answerers');
    expect(html).not.toContain('guest-1');
    expect(html).not.toContain('acct-1');
  });
  it('lists a question settled while it had answers as a ruling only, with neither row nor answers nor open count', () => {
    const html = view('settledWhileAnswered', ScreenSize.Desktop);
    expect(html).toContain('Question late (ruling:late-1)');
    expect(html).not.toContain('Context for late');
    expect(html).not.toContain('Arrived after');
    expect(html).toContain('Nothing is waiting on you from Void.');
  });
  it('shows no booth for a Mind without art rather than another face', () => {
    expect(view('noAnswers', ScreenSize.Desktop, 'nobody')).not.toContain('data-pose');
  });
  it('shows no booth before anything is published', () => {
    expect(view('unpublished', ScreenSize.Desktop)).not.toContain('data-pose');
  });
});

describe("a question's age", () => {
  const NOW = Date.parse('2026-11-11T12:00:00Z');
  const listRaised = (raisedAt: string | null): ForkList => {
    const entry = STATES.noAnswers.forks[0];
    return {
      ...STATES.noAnswers,
      forks: [{ ...entry, card: { ...entry.card, raised_at: raisedAt } }],
    };
  };
  const html = (raisedAt: string | null) =>
    renderToStaticMarkup(
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <DeskView mind="void" label="Void" list={listRaised(raisedAt)} now={NOW} />
      </ScreenSizeProvider>
    );
  it('reads days since the card was first admitted', () => {
    expect(html('2026-11-06T12:00:00Z')).toContain('raised 5d ago');
  });
  it('reads hours inside a day, and just now inside an hour', () => {
    expect(html('2026-11-11T07:30:00Z')).toContain('raised 4h ago');
    expect(html('2026-11-11T11:40:00Z')).toContain('raised just now');
  });
  it('shows no age when the card carries none, or an instant that does not parse or is ahead of the clock', () => {
    [
      'null',
      'yesterday',
      '2027-01-01T00:00:00Z',
      '2026-11-06',
      'Nov 6 2026',
      '0',
      '2026-02-30T00:00:00Z',
    ].forEach((v) => {
      expect(html(v === 'null' ? null : v)).not.toContain('raised ');
    });
  });
});

describe('counts when the ids are withheld', () => {
  const withheld = (): ForkList => {
    const entry = STATES.noAnswers.forks[0];
    return {
      ...STATES.noAnswers,
      forks: [
        {
          ...entry,
          card: { ...entry.card, deciders: [], decider_count: 3 },
          record: { ...entry.record, answerer_count: 2 },
        },
      ],
    };
  };
  it('shows how many deciders and answerers there are, naming none', () => {
    const html = renderToStaticMarkup(
      <ScreenSizeProvider value={ScreenSize.Desktop}>
        <DeskView mind="void" label="Void" list={withheld()} />
      </ScreenSizeProvider>
    );
    expect(html).toContain('3 deciders · 2 answerers');
  });
  it('shows no count line for a served count outside the contract', () => {
    const bad = (card: object, record: object): string => {
      const entry = STATES.noAnswers.forks[0];
      const list = {
        ...STATES.noAnswers,
        forks: [{ card: { ...entry.card, ...card }, record: { ...entry.record, ...record } }],
      } as ForkList;
      return renderToStaticMarkup(
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <DeskView mind="void" label="Void" list={list} />
        </ScreenSizeProvider>
      );
    };
    [
      [{ decider_count: 0 }, {}],
      [{ decider_count: 65 }, {}],
      [{ decider_count: undefined }, {}],
      [{}, { answerer_count: -1 }],
      [{}, { answerer_count: 1.5 }],
    ].forEach(([c, r]) => {
      const out = bad(c, r);
      expect(out).not.toContain('undefined');
      expect(out).not.toMatch(/deciders? ·/);
    });
  });
  it('says the singular for one', () => {
    const html = view('noAnswers', ScreenSize.Desktop);
    expect(html).toContain('1 decider · 0 answerers');
  });
});

describe('DeskEntry', () => {
  afterEach(() => setDeskSource(() => undefined));
  const bare = (html: string) => html.replace(/<[^>]*>/g, '');
  const entry = (mind: string) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <DeskEntry mind={mind} />
      </MemoryRouter>
    );
  const link = (open: number) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <DeskLink mind="void" open={open} />
      </MemoryRouter>
    );
  it('reads "Desk · N open" and links to that Mind\'s desk', () => {
    const html = link(2);
    expect(html).toContain('Desk · 2 open');
    expect(html).toContain('href="/desk/void"');
  });
  it('is pinned even at zero open', () => {
    expect(bare(link(0))).toBe('Desk');
    expect(link(0)).toContain('href="/desk/void"');
  });
  it('is pinned when nothing is published, and when only settled forks exist', () => {
    [undefined, { ...STATES.settled, open_count: 0 }].forEach((state) => {
      setDeskSource(() => state);
      expect(bare(entry('void'))).toBe('Desk');
      expect(entry('void')).toContain('href="/desk/void"');
    });
  });
  it('shows no count before the hash check has landed, so a card about to be withdrawn is never counted', () => {
    setDeskSource(() => STATES.blocked);
    expect(bare(entry('void'))).toBe('Desk');
  });
});

describe('a row on a rotating screen', () => {
  it('is open on a wide screen whatever was tapped, and folded on a phone until tapped', () => {
    expect(rowOpen(false, false)).toBe(true);
    expect(rowOpen(false, true)).toBe(true);
    expect(rowOpen(true, false)).toBe(false);
    expect(rowOpen(true, true)).toBe(true);
  });
  it('reads the screen it is on now, not the one it mounted on: wide to phone folds, phone to wide opens', () => {
    const untapped = [false, true, false, true].map((phone) => rowOpen(phone, false));
    expect(untapped).toEqual([true, false, true, false]);
  });
});
