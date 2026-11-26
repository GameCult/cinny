import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkyChoice } from '../ridge/skyMoment';
import { FALLBACK_VIEW } from '../ridge/view';
import {
  MENU_CHOICES,
  SkyMomentPicker,
  TimeSubmenu,
  choiceLabel,
  useNativeChange,
} from './TimeSubmenu';

// The component's hooks are held still, as in RoomOutbox.actions.test.tsx: state is its initial value, refs are plain boxes, effects are
// kept to be run once the test has put an element in each ref. The element tree it returns is read and its native events are dispatched
// on a fake input, so no DOM is needed.
const held = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  choice: { kind: 'auto' } as unknown,
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (init: unknown) => [
    typeof init === 'function' ? (init as () => unknown)() : init,
    () => undefined,
  ];
  const useRef = (init: unknown) => ({ current: init });
  const useEffect = (fn: () => unknown) => {
    held.effects.push(fn);
  };
  return {
    ...actual,
    default: { ...actual, useState, useRef, useEffect },
    useState,
    useRef,
    useEffect,
  };
});
vi.mock('../../../hooks/useSkyState', () => ({
  useSkyChoice: () => held.choice,
  useDrawnPlace: () => FALLBACK_VIEW.place,
}));

type El = { type?: unknown; ref?: unknown; props?: Record<string, unknown> };
/** Every element reachable through any prop (children, `content`, `after`). */
const walk = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (node && typeof node === 'object' && 'props' in node) {
    const el = node as El;
    return [el, ...Object.values(el.props ?? {}).flatMap(walk)];
  }
  return [];
};
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as El).props?.children);
  }
  return '';
};
/** A stand-in input: a real EventTarget with a value. */
const fakeInput = (value: string) => Object.assign(new EventTarget(), { value });
const fire = (el: EventTarget, type: 'input' | 'change') => el.dispatchEvent(new Event(type));

beforeEach(() => {
  held.effects.length = 0;
  held.choice = { kind: 'auto' };
});

describe('the Time submenu choices', () => {
  const tree = () => walk(TimeSubmenu());
  const radios = () => tree().filter((e) => e.props?.role === 'radio');

  it('lists Auto and the six named moments, then Pick a moment', () => {
    expect(MENU_CHOICES.map(choiceLabel)).toEqual([
      'Auto',
      'Dawn',
      'Morning',
      'Noon',
      'Golden hour',
      'Dusk',
      'Night',
    ]);
    expect(tree().find((e) => e.props?.role === 'radiogroup')?.props?.['aria-label']).toBe('Time');
    expect(radios().map((e) => textOf(e))).toEqual([
      'Auto',
      'Dawn',
      'Morning',
      'Noon',
      'Golden hour',
      'Dusk',
      'Night',
      'Pick a moment',
    ]);
  });

  it.each([
    [{ kind: 'auto' }, 0],
    [{ kind: 'named', id: 'dawn' }, 1],
    [{ kind: 'named', id: 'night' }, 6],
    [{ kind: 'free', date: '2026-12-21', minutes: 400 }, 7],
  ] as Array<[SkyChoice, number]>)('aria-checked follows the choice %j', (choice, checked) => {
    held.choice = choice;
    radios().forEach((e, i) => expect(e.props?.['aria-checked'], `item ${i}`).toBe(i === checked));
  });
});

describe('committing on change, not on input', () => {
  it('a native input event commits nothing and the change event commits once', () => {
    const commits: string[] = [];
    const ref = useNativeChange<HTMLInputElement>((el) => commits.push(el.value));
    const target = fakeInput('600');
    (ref as { current: unknown }).current = target;
    held.effects.forEach((run) => run());
    for (let i = 0; i < 5; i += 1) fire(target, 'input');
    expect(commits).toEqual([]);
    fire(target, 'change');
    expect(commits).toEqual(['600']);
  });

  it('the picker commits the slider on release only, with the date it holds, and the date on change when it is a date in range', () => {
    const commits: unknown[] = [];
    const tree = walk(
      SkyMomentPicker({
        seed: { kind: 'free', date: '2026-12-21', minutes: 600 },
        tz: 'Europe/Vienna',
        onCommit: (c) => commits.push(c),
      })
    );
    const input = (type: string) => tree.find((e) => e.type === 'input' && e.props?.type === type);
    const date = fakeInput('2026-12-21');
    const slider = fakeInput('600');
    (input('date')?.ref as { current: unknown }).current = date;
    (input('range')?.ref as { current: unknown }).current = slider;
    held.effects.forEach((run) => run());

    slider.value = '735';
    fire(slider, 'input');
    fire(slider, 'input');
    expect(commits).toEqual([]);
    fire(slider, 'change');
    expect(commits).toEqual([{ kind: 'free', date: '2026-12-21', minutes: 735 }]);

    date.value = '2026-07-15';
    fire(date, 'change');
    expect(commits[1]).toEqual({ kind: 'free', date: '2026-07-15', minutes: 735 });
    date.value = '1800-01-01';
    fire(date, 'change');
    date.value = '';
    fire(date, 'change');
    expect(commits).toHaveLength(2);
    expect(input('range')?.props).toMatchObject({ min: 0, max: 1439, step: 5 });
    expect(input('date')?.props).toMatchObject({ min: '1900-01-01', max: '2100-12-31' });
  });

  it('the picker shows the place-local time and the zone beside the slider', () => {
    const tree = SkyMomentPicker({
      seed: { kind: 'free', date: '2026-12-21', minutes: 400 },
      tz: 'Europe/Vienna',
      onCommit: () => undefined,
    });
    expect(textOf(tree)).toMatch(/^06:40 \S+/);
  });
});
