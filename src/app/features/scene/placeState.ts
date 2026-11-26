// The place the viewer picked in the scene view's Place submenu (ruling ridge-places-dropdown-first-four): an id, per viewer, kept in this browser only and never
// shared. It is a wish, not a place: whether it names a baked place is decided by `skyPlace.ts`, the one resolution, which ignores an id the index does not list.
// Main-chunk safe: no sky, no ridge code.
const KEY = 'ratatoskr.skyPlace';
/** A place id as the baker writes it; anything else in storage is no choice. */
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

let choice: string | undefined;
let read = false;
const listeners = new Set<() => void>();

/** The viewer's picked place id, or undefined for none (never picked, refused storage, or garbage in storage). */
export function getPlaceChoice(): string | undefined {
  if (!read) {
    read = true;
    try {
      const v = localStorage.getItem(KEY);
      choice = v !== null && ID.test(v) ? v : undefined;
    } catch {
      choice = undefined;
    }
  }
  return choice;
}

/**
 * Pick a place. Stored when it changed and storage allows (else it holds for this page load). Listeners hear every valid pick, a repeat of the id included: a tap
 * on a place that has not come up (its tiles did not load) is a request to try again, and a listener that has nothing to do for it ignores it.
 */
export function setPlaceChoice(id: string): void {
  if (!ID.test(id)) return;
  if (getPlaceChoice() !== id) {
    choice = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // Storage is refused (private mode, quota): the choice holds for this page load only.
    }
  }
  [...listeners].forEach((cb) => cb());
}

export function subscribePlaceChoice(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** For tests: forget the choice held in memory and read storage afresh at the next ask. */
export const forgetPlaceChoice = (): void => {
  choice = undefined;
  read = false;
};
