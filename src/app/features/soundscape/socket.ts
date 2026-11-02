import { FrameTable } from './frame';
import { drawnCreatures } from './scene';
import { planVoices, type SoundscapePrefs, type VoiceCommand } from './voices';
import { isWeakDevice, type DeviceHints } from './device';

/**
 * Where frames come from is `ratatoskr:question:activity-feed-source`, still open. Until the
 * Heimdall session feed exists the only source is `silentSource`. A source never reads a room's
 * member list (A1): being in a room says nothing about being active.
 */
export interface ActivitySource {
  subscribe(onFrame: (raw: unknown) => void): () => void;
}
const noop = () => undefined;
export const silentSource: ActivitySource = { subscribe: () => noop };

/** Receives the plan. No audio assets exist yet, so nothing in this repo sounds. */
export interface VoiceSink {
  play(commands: readonly VoiceCommand[]): void;
}

export interface AudioSocketDeps {
  source: ActivitySource;
  sink: VoiceSink;
  prefs: () => SoundscapePrefs;
  device: () => DeviceHints;
  /** Whole seconds. */
  nowS: () => number;
}

export const createAudioSocket = (deps: AudioSocketDeps) => {
  const table = new FrameTable();
  const unsubscribe = deps.source.subscribe((raw) => table.offer(raw));
  return {
    /** Called by the scheduler tick; a hidden page simply stops calling it (S5). */
    tick(): VoiceCommand[] {
      const prefs = deps.prefs();
      const effective = { ...prefs, enabled: prefs.enabled && !isWeakDevice(deps.device()) };
      const commands = planVoices(table.fresh(deps.nowS()), effective);
      deps.sink.play(commands);
      return commands;
    },
    /** What the orbit renderer draws: the same table, neutral removed. */
    drawn: () => drawnCreatures(table.fresh(deps.nowS())),
    close: unsubscribe,
  };
};
