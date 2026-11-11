import { describe, expect, it } from 'vitest';
import { classifyPose, messagePose } from './sentiment';

describe('classifyPose', () => {
  it.each([
    ['concerned', 'Sorry, that build failed with an error'],
    ['annoyed', 'ugh, this again'],
    ['surprised', 'wow, no way'],
    ['determined', "on it, I'll fix that"],
    ['amused', 'hahaha that is funny'],
    ['happy', 'thanks, great work'],
    ['thinking', 'should we ship it?'],
    ['neutral', 'Merged the branch.'],
  ])('%s', (label, text) => expect(classifyPose(text)).toBe(label));
  it('is neutral for empty or non-string text', () => {
    expect(classifyPose('')).toBe('neutral');
    expect(classifyPose(undefined)).toBe('neutral');
    expect(classifyPose(5)).toBe('neutral');
  });
  it('is deterministic', () => {
    expect(classifyPose('thanks?')).toBe(classifyPose('thanks?'));
  });
});

describe('messagePose', () => {
  it('lets an explicit label win over the text', () => {
    expect(messagePose('aqua', { body: 'thanks!', 'org.gamecult.pose': 'annoyed' })).toBe(
      'annoyed'
    );
  });
  it('keeps an unknown explicit label neutral instead of classifying', () => {
    expect(messagePose('aqua', { body: 'thanks!', 'org.gamecult.pose': 'conduct' })).toBe(
      'neutral'
    );
  });
  it('classifies when there is no label, and drops labels the Mind lacks', () => {
    expect(messagePose('aqua', { body: 'thanks!' })).toBe('happy');
    expect(messagePose('aqua', { body: 'sorry' })).toBe('concerned');
    expect(messagePose('kiko', { body: 'sorry' })).toBe('neutral');
    expect(messagePose('aqua', {})).toBe('neutral');
  });
});
