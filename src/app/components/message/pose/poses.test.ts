import { describe, expect, it } from 'vitest';
import catalogue from './catalogue.json';
import { mindOfSender, poseSrc, poseStatusLine, poseStatuses, resolvePose } from './poses';

describe('resolvePose', () => {
  it('keeps shared and own-signature labels from the catalogue', () => {
    expect(resolvePose('aqua', 'amused')).toBe('amused');
    expect(resolvePose('aqua', 'fretful')).toBe('fretful');
    expect(resolvePose('kiko', ' Debug ')).toBe('debug');
    expect(resolvePose('void', 'reading')).toBe('reading');
  });
  it('falls back to neutral for missing, unknown, non-string or foreign-signature labels', () => {
    expect(resolvePose('aqua', undefined)).toBe('neutral');
    expect(resolvePose('aqua', 'conduct')).toBe('neutral');
    expect(resolvePose('aqua', 7)).toBe('neutral');
    expect(resolvePose('aqua', 'probe')).toBe('neutral');
    expect(resolvePose('nobody', 'neutral')).toBe('neutral');
    expect(resolvePose('aqua', 'constructor')).toBe('neutral');
  });
  it('knows every label the catalogue lists, and only those', () => {
    Object.entries(catalogue.minds).forEach(([mind, entry]) => {
      [...Object.keys(entry.shared), ...Object.keys(entry.signatures)].forEach((l) =>
        expect(resolvePose(mind, l)).toBe(l)
      );
    });
  });
});

describe('mindOfSender', () => {
  it('matches localpart or first display-name word', () => {
    expect(mindOfSender('Eureka')).toBe('eureka');
    expect(mindOfSender('x', 'Libby the Archivist')).toBe('libby');
    expect(mindOfSender('void')).toBe('void');
  });
  it('ignores humans and Object prototype names', () => {
    expect(mindOfSender('alice', 'Alice')).toBeUndefined();
    expect(mindOfSender('constructor')).toBeUndefined();
    expect(mindOfSender()).toBeUndefined();
  });
});

describe('poseSrc', () => {
  it('builds the asset path from the catalogue entry', () => {
    expect(poseSrc('eureka', 'hood-smug', '/app/')).toBe('/app/public/poses/eureka/hood-smug.png');
    expect(poseSrc('eureka', 'nope')).toBe('/public/poses/eureka/neutral.png');
  });
});

describe('poseStatuses', () => {
  const ev = (sender: string, ts: number, label: unknown) => ({
    sender,
    localpart: sender,
    ts,
    label,
  });
  it('reports the latest pose per Mind and when its unbroken run began', () => {
    const out = poseStatuses([
      ev('aqua', 1, 'happy'),
      ev('aqua', 2, 'sigh'),
      ev('aqua', 3, 'sigh'),
      ev('alice', 4, 'happy'),
      ev('eureka', 5, 'probe'),
    ]);
    expect(out).toEqual([
      { mind: 'aqua', pose: 'sigh', since: 2 },
      { mind: 'eureka', pose: 'probe', since: 5 },
    ]);
  });
  it('treats unknown labels as neutral runs', () => {
    expect(poseStatuses([ev('void', 1, 'bogus'), ev('void', 2, undefined)])).toEqual([
      { mind: 'void', pose: 'neutral', since: 1 },
    ]);
  });
});

describe('poseStatusLine', () => {
  it('formats the client-status line', () => {
    const since = new Date(2026, 10, 4, 9, 5).getTime();
    expect(poseStatusLine({ mind: 'void', pose: 'reading', since })).toBe(
      'Ratatoskr: Void is reading, since 09:05'
    );
  });
});
