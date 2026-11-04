/** Touch devices (phones) get the keyboard's own dictionary; desktop gets the browser's. */
export const defaultComposerSpellcheck = (
  matchMedia: ((query: string) => { matches: boolean }) | undefined
): boolean => !matchMedia?.('(pointer: coarse)').matches;

/**
 * Attributes for the composer's editable. Off must also switch autocorrect off:
 * spellCheck alone leaves Gboard's suggestion strip and correction modal in place.
 */
export const composerSpellcheckAttributes = (enabled: boolean) =>
  enabled ? ({ spellCheck: true } as const) : ({ spellCheck: false, autoCorrect: 'off' } as const);
