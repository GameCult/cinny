import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DingManifest, Motif, dingsEnabled, parseManifest, pickDing } from './dings';

// The staged v4 set (Aqua, AquaSynth merge 21e83ec, page minds.gamecult.org/aqua/dings-voices-dd9be66). Nobody has heard it; these tests check the manifest
// against this code, not the sound.
const DINGS = join(__dirname, '../../../../public/dings');
const raw = JSON.parse(readFileSync(join(DINGS, 'manifest.json'), 'utf8'));
const manifest = parseManifest(raw) as DingManifest;
// sha256 prefixes of the 32 clips as staged by Aqua; Nibu's four are proposals/nibu3 (same samples, own Ogg serial).
const V4_SHA: Record<string, string> = {
  'aqua/mention': 'cedb63552008',
  'aqua/dm': '5b996d01c770',
  'aqua/message': '8be19ccd505a',
  'aqua/invite': '462e63687f0b',
  'eureka/mention': '7afe0bcc90d0',
  'eureka/dm': '3909d70b0d45',
  'eureka/message': '0b466cd4b437',
  'eureka/invite': '837e1bbbdacf',
  'heimdall/mention': '36051569eb2c',
  'heimdall/dm': '26ebc4158d51',
  'heimdall/message': 'c383d6ce3da0',
  'heimdall/invite': 'fd47e9a97bb2',
  'kiko/mention': 'e73d2d586f4e',
  'kiko/dm': 'b3e39946ab70',
  'kiko/message': '6730b9df5bfa',
  'kiko/invite': '1a3c1d118b9e',
  'libby/mention': 'eb9f3ac60b02',
  'libby/dm': '77dfd01cc3ca',
  'libby/message': '257b84a114a2',
  'libby/invite': '8ef7e91100b8',
  'nibu/mention': '56484d731df3',
  'nibu/dm': '573f5db4de4b',
  'nibu/message': '30f6a5c9ce54',
  'nibu/invite': 'bb36c0975f35',
  'void/mention': 'dee69f4af562',
  'void/dm': '92e3ebbc0b29',
  'void/message': 'fadc5556b681',
  'void/invite': 'd602121389d8',
  'weksa/mention': 'db46a36ab3c5',
  'weksa/dm': 'efe993382a46',
  'weksa/message': '00e323635949',
  'weksa/invite': '9bf03a36758b',
};
const MOTIFS: Motif[] = ['mention', 'dm', 'message', 'invite'];
const VOICES = ['aqua', 'eureka', 'heimdall', 'kiko', 'libby', 'nibu', 'void', 'weksa'];

// Vorbis-in-Ogg duration: last page's granule position over the sample rate in the id header.
const oggMs = (file: string): number => {
  const b = readFileSync(join(DINGS, file));
  const id = b.indexOf('\x01vorbis', 0, 'latin1');
  const rate = b.readUInt32LE(id + 12);
  const last = b.lastIndexOf('OggS', b.length, 'latin1');
  return (Number(b.readBigUInt64LE(last + 6)) / rate) * 1000;
};

describe('dings switch', () => {
  it('is off unless the config says exactly true', () => {
    expect(dingsEnabled(undefined)).toBe(false);
    expect(dingsEnabled({})).toBe(false);
    expect(dingsEnabled({ enabled: false })).toBe(false);
    expect(dingsEnabled({ enabled: 'true' as unknown as boolean })).toBe(false);
    expect(dingsEnabled({ enabled: true })).toBe(true);
  });

  it('ships off in config.json', () => {
    const config = JSON.parse(readFileSync(join(__dirname, '../../../../config.json'), 'utf8'));
    expect(config.dings).toEqual({ enabled: false });
    expect(dingsEnabled(config.dings)).toBe(false);
  });
});

describe('v4 manifest against the parser', () => {
  it('survives parseManifest whole: no path or motif is dropped', () => {
    expect(manifest.neutral).toEqual(raw.neutral);
    expect(Object.keys(manifest.senders).sort()).toEqual(VOICES);
    VOICES.forEach((v) => expect(manifest.senders[v]).toEqual(raw.senders[v]));
    MOTIFS.forEach((m) => expect(manifest.neutral[m]).toBeDefined());
  });

  it('names a file that exists for every clip, and no file the manifest omits', () => {
    const paths = [
      ...Object.values(manifest.neutral),
      ...Object.values(manifest.senders).flatMap((c) => Object.values(c)),
    ];
    expect(paths).toHaveLength(4 + VOICES.length * 4);
    paths.forEach((p) => expect(existsSync(join(DINGS, p as string)), p).toBe(true));
  });

  it('maps a sender localpart to that sender folder, per motif', () => {
    VOICES.forEach((v) =>
      MOTIFS.forEach((m) => expect(pickDing(manifest, v, m)?.path).toBe(`senders/${v}/${m}.ogg`))
    );
  });

  it('an unknown sender and an invite get the neutral clip', () => {
    MOTIFS.forEach((m) => expect(pickDing(manifest, 'someone', m)?.path).toBe(`neutral/${m}.ogg`));
  });

  it('Nibu carries pick 3 (8 kHz 5-bit smoothed sine) for every event: senders/nibu, never the proposals folder', () => {
    MOTIFS.forEach((m) => {
      const path = pickDing(manifest, 'nibu', m)?.path as string;
      expect(path).toBe(`senders/nibu/${m}.ogg`);
      expect(path).not.toContain('proposals');
    });
  });

  it("every voice file is Aqua's v4 render (sha256 prefix)", () => {
    const hash = (file: string) =>
      createHash('sha256')
        .update(readFileSync(join(DINGS, file)))
        .digest('hex')
        .slice(0, 12);
    expect(Object.keys(V4_SHA).length).toBe(VOICES.length * MOTIFS.length);
    Object.entries(V4_SHA).forEach(([k, want]) => expect(hash(`senders/${k}.ogg`)).toBe(want));
  });

  it('keeps the clip lengths the design assumes: message under 400 ms, nothing over 600 ms', () => {
    VOICES.forEach((v) => {
      expect(oggMs(`senders/${v}/message.ogg`)).toBeLessThan(400);
      MOTIFS.forEach((m) => expect(oggMs(`senders/${v}/${m}.ogg`)).toBeLessThan(601));
    });
  });
});
