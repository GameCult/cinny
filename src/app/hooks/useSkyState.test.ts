import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSkyClock } from '../features/scene/skyState';
import { useSkyMinute } from './useSkyState';

// useSkyMinute is state and one effect: react is held so the effect can be run and cleaned up by hand.
const held = vi.hoisted(() => ({
  value: undefined as unknown,
  sets: [] as Date[],
  effect: undefined as undefined | (() => (() => void) | undefined),
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const useState = (init: unknown) => {
    held.value ??= typeof init === 'function' ? (init as () => unknown)() : init;
    return [held.value, (v: Date) => held.sets.push(v)];
  };
  const useEffect = (fn: () => (() => void) | undefined) => {
    held.effect = fn;
  };
  return { ...actual, useState, useEffect };
});

const at = (iso: string) => setSkyClock(() => new Date(iso));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  held.value = undefined;
  held.sets.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  setSkyClock();
});

describe('the sky minute', () => {
  it('while live, re-reads the sky clock at each minute boundary and stops when the effect is cleaned up', () => {
    at('2030-06-21T10:00:30Z');
    expect(useSkyMinute(true)).toEqual(new Date('2030-06-21T10:00:30Z'));
    const stop = held.effect?.();
    held.sets.length = 0;
    at('2030-06-21T10:01:00Z');
    vi.advanceTimersByTime(29_999);
    expect(held.sets).toHaveLength(0); // not before the minute turns
    vi.advanceTimersByTime(1);
    expect(held.sets).toEqual([new Date('2030-06-21T10:01:00Z')]);
    at('2030-06-21T10:02:00Z');
    vi.advanceTimersByTime(60_000);
    expect(held.sets).toHaveLength(2);
    stop?.();
    vi.advanceTimersByTime(10 * 60_000);
    expect(held.sets).toHaveLength(2);
  });

  it('not live, sets no timer and reads the sky clock at every render', () => {
    at('2030-06-21T10:00:30Z');
    useSkyMinute(false);
    const stop = held.effect?.();
    expect(stop).toBeUndefined();
    held.sets.length = 0;
    vi.advanceTimersByTime(10 * 60_000);
    expect(held.sets).toHaveLength(0);
    at('2030-06-22T01:00:00Z');
    expect(useSkyMinute(false)).toEqual(new Date('2030-06-22T01:00:00Z'));
  });
});
