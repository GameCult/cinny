import { describe, expect, it, vi } from 'vitest';
import { FrameTable, readFrame, STALE_AFTER_S, type ActivityFrame, type LiveFrame } from './frame';
import { drawnCreatures, PLACEHOLDER_SIZE_SCALE } from './scene';
import { DEFAULT_VOICE_CAP, planVoices, type SoundscapePrefs } from './voices';
import { isWeakDevice } from './device';
import { createAudioSocket, silentSource, type ActivitySource } from './socket';

const frame = (o: Partial<LiveFrame> = {}): LiveFrame => ({
  mind: 'void',
  estate: 'mind',
  kind: 'Working',
  energy: 'Mid',
  size: 'M',
  neutral: false,
  override: 'None',
  seq: 1,
  at: 100,
  ...o,
});
const neutralFrame = (o: Partial<ActivityFrame> = {}): ActivityFrame =>
  ({ ...frame(), ...o, neutral: true } as unknown as ActivityFrame);
/** A raw frame as a producer sends it, with the named keys omitted. */
const without = (f: object, ...keys: string[]) =>
  Object.fromEntries(Object.entries(f).filter(([k]) => !keys.includes(k)));
const noop = () => undefined;
const on: SoundscapePrefs = { enabled: true, muted: false, volume: 0.5, voiceCap: 4 };

describe('neutral overrides everything', () => {
  it('draws nothing and sounds nothing for any kind, energy, size or estate', () => {
    const cases = (['human', 'mind', 'persona'] as const).flatMap((estate) =>
      (['Speaking', 'Alert', 'Working'] as const).flatMap((kind) =>
        (['High', 'Peak'] as const).flatMap((energy) =>
          (['S', 'M', 'L'] as const).map((size) => neutralFrame({ estate, kind, energy, size }))
        )
      )
    );
    expect(cases).toHaveLength(54);
    cases.forEach((f) => {
      expect(drawnCreatures([f])).toEqual([]);
      expect(planVoices([f], on)).toEqual([]);
    });
  });
  it('is not the same as an absent frame: absent reads as idle, neutral as hidden', () => {
    const t = new FrameTable();
    t.offer(frame({ at: 100 }));
    expect(drawnCreatures(t.fresh(100 + STALE_AFTER_S + 1))).toEqual([]);
    expect(drawnCreatures(t.fresh(100)).length).toBe(1);
  });
});

describe('neutral is read first', () => {
  it('yields no size, kind or energy, even when the producer sent them', () => {
    (['human', 'mind', 'persona'] as const).forEach((estate) => {
      const f = readFrame({
        ...frame({ estate, kind: 'Speaking', energy: 'High' }),
        neutral: true,
      });
      expect(f).toBeDefined();
      expect(f?.neutral).toBe(true);
      expect(f?.size).toBeUndefined();
      expect(Object.keys(f ?? {})).not.toContain('size');
      expect(f?.kind).toBeUndefined();
      expect(f?.energy).toBeUndefined();
      expect(Object.keys(f ?? {})).not.toContain('kind');
      expect(Object.keys(f ?? {})).not.toContain('energy');
    });
  });
  it('a neutral human with kind omitted is not an Idle', () => {
    const bare = without(frame({ estate: 'human' }), 'kind', 'energy');
    const f = readFrame({ ...bare, neutral: true });
    expect(f?.kind).toBeUndefined();
    expect(drawnCreatures([f as ActivityFrame])).toEqual([]);
    expect(planVoices([f as ActivityFrame], on)).toEqual([]);
  });
});

describe('human kinds are the provisional subset', () => {
  it.each(['Reading', 'Thinking', 'Waiting', 'Alert'] as const)('clamps %s to Idle', (kind) => {
    expect(readFrame(frame({ estate: 'human', kind }))?.kind).toBe('Idle');
  });
  it('keeps Idle, Working and Speaking', () => {
    (['Idle', 'Working', 'Speaking'] as const).forEach((kind) =>
      expect(readFrame(frame({ estate: 'human', kind }))?.kind).toBe(kind)
    );
  });
  it('an omitted kind is Idle for a non-neutral human only', () => {
    const noKind = without(frame({ estate: 'human' }), 'kind');
    expect(readFrame(noKind)?.kind).toBe('Idle');
    expect(readFrame({ ...noKind, neutral: true })?.kind).toBeUndefined();
  });
  it('minds and personas keep all seven kinds, and omitted is malformed for them', () => {
    (['mind', 'persona'] as const).forEach((estate) => {
      (['Idle', 'Reading', 'Thinking', 'Working', 'Speaking', 'Waiting', 'Alert'] as const).forEach(
        (kind) => expect(readFrame(frame({ estate, kind }))?.kind).toBe(kind)
      );
      const noKind = without(frame({ estate }), 'kind');
      expect(readFrame(noKind)).toBeUndefined();
    });
  });
});

describe('human energy is clamped to three buckets by the consumer', () => {
  it('turns Peak into High for humans only', () => {
    expect(readFrame(frame({ estate: 'human', energy: 'Peak' }))?.energy).toBe('High');
    expect(readFrame(frame({ estate: 'mind', energy: 'Peak' }))?.energy).toBe('Peak');
    expect(readFrame(frame({ estate: 'persona', energy: 'Peak' }))?.energy).toBe('Peak');
  });
  it('keeps the clamp through the voice plan', () => {
    const t = new FrameTable();
    t.offer(frame({ estate: 'human', energy: 'Peak' }));
    expect(planVoices(t.fresh(100), on)[0].energy).toBe('High');
  });
});

describe('activity is a stub, never the room member list', () => {
  it('the silent source and the socket yield nothing, however many members a room has', () => {
    const members = ['@a:x', '@b:x', '@c:x'];
    const sock = createAudioSocket({
      source: silentSource,
      sink: { play: noop },
      prefs: () => on,
      device: () => ({}),
      nowS: () => 100,
    });
    expect(members.length).toBeGreaterThan(0);
    expect(sock.tick()).toEqual([]);
    expect(sock.drawn()).toEqual([]);
  });
  it('only frames the source pushes produce voices', () => {
    const pushes: ((raw: unknown) => void)[] = [];
    const source: ActivitySource = {
      subscribe: (cb) => {
        pushes.push(cb);
        return noop;
      },
    };
    const sock = createAudioSocket({
      source,
      sink: { play: noop },
      prefs: () => on,
      device: () => ({}),
      nowS: () => 100,
    });
    pushes[0](frame({ mind: 'aqua' }));
    expect(sock.tick().map((v) => v.mind)).toEqual(['aqua']);
  });
});

describe('no vote weights', () => {
  it('drops fields the grammar does not define, and the plan carries only user volume as gain', () => {
    const f = readFrame({ ...frame(), weight: 9, votes: 40, roomId: '!r:x', brief: 'secret' });
    expect(Object.keys(f ?? {}).sort()).toEqual(
      ['at', 'energy', 'estate', 'kind', 'mind', 'neutral', 'override', 'seq', 'size'].sort()
    );
    const t = new FrameTable();
    t.offer({ ...frame(), weight: 9 });
    expect(planVoices(t.fresh(100), on)[0].gain).toBe(0.5);
  });
});

describe('size scales are placeholders', () => {
  it('live in the renderer table, not in the frame, and change nothing about voices', () => {
    expect(PLACEHOLDER_SIZE_SCALE).toEqual({ S: 0.7, M: 1, L: 1.4 });
    const s = planVoices([frame({ size: 'S' })], on);
    const l = planVoices([frame({ size: 'L' })], on);
    expect(s).toEqual(l);
  });
});

describe('socket defaults and limits', () => {
  it('ships off, muted, with the proposed cap', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const { getSettings } = await import('../../state/settings');
    const s = getSettings();
    expect(s.soundscapeEnabled).toBe(false);
    expect(s.soundscapeMuted).toBe(true);
    expect(s.soundscapeVoiceCap).toBe(DEFAULT_VOICE_CAP);
  });
  it('master mute, disabled flag and zero volume all silence', () => {
    const f = [frame()];
    expect(planVoices(f, { ...on, muted: true })).toEqual([]);
    expect(planVoices(f, { ...on, enabled: false })).toEqual([]);
    expect(planVoices(f, { ...on, volume: 0 })).toEqual([]);
  });
  it('caps voices, dropping the lowest energy first', () => {
    const f = ['a', 'b', 'c', 'd', 'e'].map((mind, i) =>
      frame({ mind, energy: (['Low', 'Mid', 'High', 'Peak', 'Mid'] as const)[i] })
    );
    const voices = planVoices(f, { ...on, voiceCap: 4 }).map((v) => v.mind);
    expect(voices).toHaveLength(4);
    expect(voices).not.toContain('a');
  });
  it('Muted silences the voice but the creature is still drawn; Idle/Waiting are silent', () => {
    const f = [frame({ override: 'Muted' }), frame({ mind: 'x', kind: 'Idle' })];
    expect(planVoices(f, on)).toEqual([]);
    expect(drawnCreatures(f)).toHaveLength(2);
  });
  it('is off on weak phones even when the flag is on, and unknown hints are not weak', () => {
    expect(isWeakDevice({ deviceMemory: 2 })).toBe(true);
    expect(isWeakDevice({ hardwareConcurrency: 2 })).toBe(true);
    expect(isWeakDevice({})).toBe(false);
    const played: number[] = [];
    const sock = createAudioSocket({
      source: {
        subscribe: (cb) => {
          cb(frame());
          return noop;
        },
      },
      sink: { play: (c) => played.push(c.length) },
      prefs: () => on,
      device: () => ({ deviceMemory: 1 }),
      nowS: () => 100,
    });
    expect(sock.tick()).toEqual([]);
    expect(played).toEqual([0]);
  });
  it('drops frames with seq <= last, and malformed frames', () => {
    const t = new FrameTable();
    expect(t.offer(frame({ seq: 5 }))).toBe(true);
    expect(t.offer(frame({ seq: 5 }))).toBe(false);
    expect(t.offer(frame({ seq: 4 }))).toBe(false);
    expect(t.offer({ ...frame(), kind: 'Dancing' })).toBe(false);
  });
});

describe('neutral carries no size', () => {
  it('reads without a size, and a live frame without one is malformed', () => {
    const raw = frame();
    expect(readFrame({ ...without(raw, 'size', 'kind', 'energy'), neutral: true })).toBeDefined();
    expect(readFrame(without(raw, 'size'))).toBeUndefined();
  });
});
