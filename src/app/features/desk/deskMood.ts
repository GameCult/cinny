/**
 * The booth Persona's reactions, from the original Fork Desk's mood() and choose() rules. A pure function of
 * what is on the desk and the last thing that happened; it is the desk's character, so each rule is tested.
 */

/** The original's nine moods. */
export type Mood =
  | 'idle'
  | 'neutral'
  | 'thinking'
  | 'happy'
  | 'surprised'
  | 'note'
  | 'determined'
  | 'triumph'
  | 'concerned';

/** What last happened; `none` means nothing since the page opened or the last event wore off. */
export type DeskEvent =
  | { type: 'none' }
  | { type: 'picked'; choice: string; recommended?: string }
  | { type: 'cleared' }
  | { type: 'sendFailed' }
  | { type: 'newFork' };

/**
 * Each mood on the shared cast-art labels (neutral, happy, amused, thinking, annoyed, surprised) that every
 * Mind has, so the booth never asks a Mind for art it lacks.
 */
export const MOOD_POSE: Record<Mood, string> = {
  idle: 'neutral',
  neutral: 'neutral',
  thinking: 'thinking',
  happy: 'happy',
  surprised: 'surprised',
  note: 'thinking',
  determined: 'thinking',
  triumph: 'happy',
  concerned: 'surprised',
};

export type DeskMood = { mood: Mood; pose: string; line: string };

const say = (mood: Mood, line: string): DeskMood => ({ mood, pose: MOOD_POSE[mood], line });

export const deskMood = (
  open: number,
  answered: number,
  event: DeskEvent = { type: 'none' }
): DeskMood => {
  switch (event.type) {
    case 'sendFailed':
      return say('concerned', "That one didn't save. Give it another try in a moment?");
    case 'newFork':
      return say('surprised', 'New fork on the desk!');
    case 'cleared':
      return say('note', 'Pick cleared. Your note can carry the answer on its own.');
    case 'picked':
      return event.recommended !== undefined && event.choice === event.recommended
        ? say('happy', "That's the one I'd have picked too.")
        : say('surprised', 'Off-script. A line in the note on why helps the next brief.');
    default:
      break;
  }
  if (open === 0) return say('neutral', "Desk's clear. I'll wave when something lands.");
  if (answered >= open)
    return say('triumph', 'All answered! I will carry these back and admit them.');
  if (answered === 0) {
    return say(
      'thinking',
      open === 1 ? 'Just one fork on the desk.' : `${open} forks on the desk. No rush.`
    );
  }
  return say('determined', `${open - answered} to go.`);
};
