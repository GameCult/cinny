// The share panel's state machine, apart from React and Matrix: what is picked, what phase the
// send is in, and the rules that keep a room to one send at a time. ShareSet.tsx draws it.
import { ShareResult, remainingAfter, resultNote } from './shareSet';

export type Picked = { name: string; type: string };

export type SharePhase =
  | { kind: 'idle' }
  | { kind: 'sending'; done: number }
  | { kind: 'done'; text: string };

export type ShareState<F extends Picked> = {
  files: F[];
  title: string;
  phase: SharePhase;
  /** Bumps whenever the pick is emptied, so the file input can be remounted and re-pick the same files. */
  epoch: number;
};

export const ENCRYPTED_NOTE = 'Not shared: this room is encrypted.';

export type ShareDeps<F extends Picked> = {
  roomId: string;
  isEncrypted: () => boolean;
  /** Sends the files as one album; reports each settled file through onFile. */
  run: (files: F[], title: string, onFile: () => void) => Promise<ShareResult>;
  /** Called after a send that reached the room, whatever it left unsent. */
  onSent?: () => void;
};

/** Rooms with a share in flight. Module-level: leaving the page unmounts the panel, not the send. */
const sending = new Set<string>();

export const createShareController = <F extends Picked>(deps: ShareDeps<F>) => {
  let state: ShareState<F> = { files: [], title: '', phase: { kind: 'idle' }, epoch: 0 };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ShareState<F>>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const clear = () => set({ files: [], title: '', epoch: state.epoch + 1 });

  const send = async () => {
    if (sending.has(deps.roomId) || state.files.length === 0) return;
    if (deps.isEncrypted()) {
      set({ phase: { kind: 'done', text: ENCRYPTED_NOTE } });
      return;
    }
    sending.add(deps.roomId);
    const { files, title } = state;
    set({ phase: { kind: 'sending', done: 0 } });
    let settled = 0;
    try {
      const res = await deps.run(files, title, () => {
        settled += 1;
        set({ phase: { kind: 'sending', done: settled } });
      });
      deps.onSent?.();
      const left = remainingAfter(files, res);
      if (left.length === 0) clear();
      else set({ files: left });
      set({ phase: { kind: 'done', text: resultNote(res) } });
    } catch (e: any) {
      set({ phase: { kind: 'done', text: `Could not share: ${e?.message ?? 'send failed'}` } });
    } finally {
      sending.delete(deps.roomId);
    }
  };

  return {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    pick: (files: F[]) => set({ files, phase: { kind: 'idle' } }),
    setTitle: (title: string) => set({ title }),
    cancel: clear,
    send,
  };
};

export type ShareController<F extends Picked> = ReturnType<typeof createShareController<F>>;
