import { describe, expect, it, vi } from 'vitest';
import { DING_VOLUME, createDingPlayer, motifFor, parseManifest, pickDing } from './dings';

const manifest = parseManifest({
  neutral: { mention: 'neutral/mention.ogg', message: 'neutral/message.ogg' },
  senders: {
    eureka: { mention: 'eureka/mention.ogg', message: 'eureka/message.ogg', dm: 'eureka/dm.ogg' },
    nibu: { message: 'nibu/message.ogg' },
  },
})!;

describe('dings manifest', () => {
  it('is read defensively: junk is no manifest, bad paths are dropped', () => {
    expect(parseManifest(undefined)).toBeUndefined();
    expect(parseManifest('x')).toBeUndefined();
    expect(parseManifest({ neutral: 3, senders: [] })).toBeUndefined();
    const m = parseManifest({
      neutral: { message: '../../etc/passwd.ogg', mention: 'https://evil.example/a.ogg' },
      senders: { void: { message: 'void/message.wav', dm: 'void/dm.ogg', mention: '/abs.ogg' } },
    })!;
    expect(m.neutral).toEqual({});
    expect(m.senders.void).toEqual({ dm: 'void/dm.ogg' });
  });
});

describe('which ding plays', () => {
  it('uses the sender instrument for the motif', () => {
    expect(pickDing(manifest, 'eureka', 'mention')).toEqual({
      path: 'eureka/mention.ogg',
      volume: DING_VOLUME.mention,
    });
  });

  it('falls back to the neutral ding for an unknown sender', () => {
    expect(pickDing(manifest, 'stranger', 'message')?.path).toBe('neutral/message.ogg');
  });

  it('falls back to neutral when the sender has no clip for that motif', () => {
    expect(pickDing(manifest, 'nibu', 'mention')?.path).toBe('neutral/mention.ogg');
  });

  it('is silent when neither the sender nor neutral has a clip', () => {
    expect(pickDing(manifest, 'eureka', 'invite')).toBeUndefined();
    expect(pickDing(manifest, 'stranger', 'dm')).toBeUndefined();
  });

  it('is loud for mentions and DMs and quiet for ordinary messages', () => {
    expect(DING_VOLUME.mention).toBe(1);
    expect(DING_VOLUME.dm).toBe(1);
    expect(DING_VOLUME.message).toBeLessThan(DING_VOLUME.invite);
    expect(DING_VOLUME.invite).toBeLessThan(DING_VOLUME.mention);
  });

  it('names the motif: invite over mention over DM over message', () => {
    expect(motifFor({ invite: true, highlight: true, direct: true })).toBe('invite');
    expect(motifFor({ highlight: true, direct: true })).toBe('mention');
    expect(motifFor({ highlight: false, direct: true })).toBe('dm');
    expect(motifFor({ highlight: false, direct: false })).toBe('message');
  });
});

describe('audio unlock', () => {
  const make = () => {
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: (t: string, f: () => void) => listeners.set(t, f),
      removeEventListener: (t: string) => listeners.delete(t),
    };
    const played: Array<{ url: string; volume: number }> = [];
    const player = createDingPlayer((url) => {
      const clip = { volume: 1, play: vi.fn(async () => undefined) };
      played.push({
        url,
        get volume() {
          return clip.volume;
        },
      } as never);
      return clip;
    }, target);
    return { listeners, player, played };
  };

  it('does not play before the first user gesture, and plays after it', () => {
    const { listeners, player, played } = make();
    expect(player.play('a.ogg', 1)).toBe(false);
    expect(played).toHaveLength(0);
    listeners.get('pointerdown')!();
    expect(player.play('a.ogg', 0.3)).toBe(true);
    expect(played).toHaveLength(1);
    expect(played[0].volume).toBe(0.3);
  });

  it('stops listening once unlocked', () => {
    const { listeners, player } = make();
    listeners.get('keydown')!();
    expect(listeners.size).toBe(0);
    expect(player.unlocked()).toBe(true);
  });

  it('a clip the browser refuses does not throw', async () => {
    const target = {
      addEventListener: (_t: string, f: () => void) => f(),
      removeEventListener: () => undefined,
    };
    const player = createDingPlayer(
      () => ({ volume: 1, play: () => Promise.reject(new Error('NotAllowedError')) }),
      target
    );
    expect(() => player.play('a.ogg', 1)).not.toThrow();
    await Promise.resolve();
  });
});
