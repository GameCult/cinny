// The share panel's state machine, apart from React and Matrix: what is picked, what phase the
// send is in, and the rules that keep a room to one send at a time. ShareSet.tsx draws it.
import { ShareResult, remainingAfter, resultNote } from './shareSet';

export type Picked = { name: string; type: string; size?: number };

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

const MIB = 1024 * 1024;

/**
 * Files the homeserver would refuse for size (its `m.upload.size`, which Synapse enforces as a
 * limit, so a file of exactly that size goes), split from the rest before anything is sent. A
 * missing cap or size refuses nothing.
 */
export const splitBySize = <F extends Picked>(files: F[], cap: number | undefined) => {
  const over = (f: F) => cap !== undefined && f.size !== undefined && f.size > cap;
  return { sendable: files.filter((f) => !over(f)), tooLarge: files.filter(over) };
};

const tooLargeNote = (names: string[], cap: number): string =>
  `Too large for this server (limit ${Math.round((cap / MIB) * 10) / 10} MB): ${names.join(', ')}`;

export type ShareDeps<F extends Picked> = {
  roomId: string;
  isEncrypted: () => boolean;
  /** Sends the files as one album; reports each settled file through onFile. */
  run: (files: F[], title: string, onFile: () => void, signal: AbortSignal) => Promise<ShareResult>;
  /** The homeserver's upload cap in bytes (`m.upload.size`), when it states one. */
  maxBytes?: () => number | undefined;
  /** Called after a send that reached the room, whatever it left unsent. */
  onSent?: () => void;
};

/** Rooms with a share in flight. Module-level: leaving the page unmounts the panel, not the send. */
const sending = new Set<string>();

export const createShareController = <F extends Picked>(deps: ShareDeps<F>) => {
  let state: ShareState<F> = { files: [], title: '', phase: { kind: 'idle' }, epoch: 0 };
  const listeners = new Set<() => void>();
  let running: AbortController | undefined;
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
    // Files over the cap are named and dropped from the pick before any upload or album root: a
    // retry cannot help them, and a root with nothing under it is a lone message nobody lists.
    const cap = deps.maxBytes?.();
    const { sendable, tooLarge } = splitBySize(state.files, cap);
    const sizeNote = tooLarge.length
      ? tooLargeNote(
          tooLarge.map((f) => f.name),
          cap as number
        )
      : '';
    if (sendable.length === 0) {
      const phase: SharePhase = { kind: 'done', text: `Nothing was shared. ${sizeNote}` };
      set({ files: [], title: '', epoch: state.epoch + 1, phase });
      return;
    }
    sending.add(deps.roomId);
    const abort = new AbortController();
    running = abort;
    const { title } = state;
    const files = sendable;
    set({ files, phase: { kind: 'sending', done: 0 } });
    let settled = 0;
    try {
      const res = await deps.run(
        files,
        title,
        () => {
          settled += 1;
          set({ phase: { kind: 'sending', done: settled } });
        },
        abort.signal
      );
      deps.onSent?.();
      const left = remainingAfter(files, res);
      const phase: SharePhase = {
        kind: 'done',
        text: sizeNote ? `${resultNote(res)} ${sizeNote}` : resultNote(res),
      };
      // One notification: no state is ever drawn with the pick emptied and the send still running.
      if (left.length === 0) set({ files: [], title: '', epoch: state.epoch + 1, phase });
      else set({ files: left, phase });
    } catch (e: any) {
      const failure = `Could not share: ${e?.message ?? 'send failed'}`;
      set({ phase: { kind: 'done', text: sizeNote ? `${failure}. ${sizeNote}` : failure } });
    } finally {
      running = undefined;
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
    /** Stops a send in flight: the running upload is aborted and the rest are left picked. */
    stop: () => running?.abort(),
    send,
  };
};

export type ShareController<F extends Picked> = ReturnType<typeof createShareController<F>>;
