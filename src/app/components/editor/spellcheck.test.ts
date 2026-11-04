import { describe, expect, it } from 'vitest';
import { composerSpellcheckAttributes, defaultComposerSpellcheck } from './spellcheck';

const media = (coarse: boolean) => (query: string) => ({
  matches: query === '(pointer: coarse)' && coarse,
});

describe('composer spellcheck default', () => {
  it('is off when the primary pointer is coarse (phone)', () => {
    expect(defaultComposerSpellcheck(media(true))).toBe(false);
  });
  it('is on for a fine pointer (desktop)', () => {
    expect(defaultComposerSpellcheck(media(false))).toBe(true);
  });
  it('is on when matchMedia is unavailable', () => {
    expect(defaultComposerSpellcheck(undefined)).toBe(true);
  });
});

describe('composer spellcheck attributes', () => {
  it('off disables both spellcheck and autocorrect', () => {
    expect(composerSpellcheckAttributes(false)).toEqual({ spellCheck: false, autoCorrect: 'off' });
  });
  it('on enables spellcheck and leaves autocorrect to the platform', () => {
    expect(composerSpellcheckAttributes(true)).toEqual({ spellCheck: true });
  });
});
