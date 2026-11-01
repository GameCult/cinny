import { describe, expect, it } from 'vitest';
import { mindOfSender, poseSrc, resolvePose } from './poses';

describe('resolvePose', () => {
  it('keeps shared and own-signature labels', () => {
    expect(resolvePose('aqua', 'amused')).toBe('amused');
    expect(resolvePose('aqua', 'conduct')).toBe('conduct');
    expect(resolvePose('kiko', ' Debug ')).toBe('debug');
  });
  it('falls back to neutral for missing, unknown, non-string or foreign-signature labels', () => {
    expect(resolvePose('aqua', undefined)).toBe('neutral');
    expect(resolvePose('aqua', 'smug')).toBe('neutral');
    expect(resolvePose('aqua', 7)).toBe('neutral');
    expect(resolvePose('aqua', 'probe')).toBe('neutral');
    expect(resolvePose('nobody', 'probe')).toBe('neutral');
  });
});

describe('mindOfSender', () => {
  it('matches localpart or first display-name word', () => {
    expect(mindOfSender('Eureka')).toBe('eureka');
    expect(mindOfSender('x', 'Libby the Archivist')).toBe('libby');
  });
  it('ignores humans and Object prototype names', () => {
    expect(mindOfSender('alice', 'Alice')).toBeUndefined();
    expect(mindOfSender('constructor')).toBeUndefined();
    expect(mindOfSender()).toBeUndefined();
  });
});

describe('poseSrc', () => {
  it('builds the asset path', () => {
    expect(poseSrc('nibu', 'glitch', '/app/')).toBe('/app/public/poses/nibu/glitch.webp');
  });
});
