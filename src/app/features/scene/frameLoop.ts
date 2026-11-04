// The frame cadence both scenes share: a 30 fps cap, a pause while the tab is hidden, a bounded run
// under reduced motion, one frame for a still, and an end for good when the context is lost.

/** Cap: a scene draws at most this often. */
export const FRAME_INTERVAL_MS = 1000 / 30;
/** Frames a reduced-motion scene draws after it starts or after login(), then stops. */
const REDUCED_MOTION_FRAMES = 32;

export interface FrameLoopOptions {
  canvas: HTMLCanvasElement;
  /** Draw one frame and stop. */
  still: boolean;
  /** Ignore the cap and the visibility pause (measurement). */
  unthrottled?: boolean;
  render(now: number): void;
  /** A frame arrived well after the cap allows: the device is not keeping up. */
  onSlow?(): void;
  /** Frames are about to start again after a pause (first start, tab visible, resize, thaw). */
  onResume?(): void;
  /** The WebGL context was lost. The loop has already stopped for good. */
  onContextLost?(): void;
}

export interface FrameLoop {
  /** The user prefers reduced motion right now. */
  readonly frozen: boolean;
  readonly disposed: boolean;
  /** Start frames if none are scheduled. */
  wake(): void;
  /** A new bounded run under reduced motion, then wake. A still ignores it. */
  restart(): void;
  stop(): void;
}

export function startFrameLoop(o: FrameLoopOptions): FrameLoop {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let raf = 0;
  let lastRendered = -Infinity;
  let framesLeft = o.still ? 1 : Infinity; // a still frame, or reduced motion, bounds this
  let disposed = false;

  const tick = (now: number) => {
    raf = 0;
    if (disposed) return;
    const due = o.unthrottled || now - lastRendered >= FRAME_INTERVAL_MS - 2;
    if (due) {
      if (lastRendered > 0 && now - lastRendered > FRAME_INTERVAL_MS * 1.5) o.onSlow?.();
      lastRendered = now;
      o.render(now);
      framesLeft -= 1;
    }
    if (framesLeft > 0 && (o.unthrottled || document.visibilityState === 'visible'))
      raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (disposed || raf) return;
    if (reducedMotion?.matches && framesLeft <= 0) return;
    o.onResume?.();
    raf = requestAnimationFrame(tick);
  };
  const undo: Array<() => void> = [];
  const listen = (target: EventTarget, type: string, handler: (e: Event) => void) => {
    target.addEventListener(type, handler);
    undo.push(() => target.removeEventListener(type, handler));
  };
  const stop = () => {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    undo.forEach((f) => f());
  };
  if (!o.unthrottled) {
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') wake();
    });
  }
  listen(window, 'resize', () => wake());
  // A lost context takes every texture and program with it and nothing here rebuilds them, so the
  // scene ends and the host decides what to show. preventDefault: otherwise the browser never
  // restores the context, which is what we want, and a restore would find a dead scene.
  listen(o.canvas, 'webglcontextlost', (e) => {
    e.preventDefault();
    stop();
    o.onContextLost?.();
  });
  if (reducedMotion?.matches && !o.still) framesLeft = REDUCED_MOTION_FRAMES;
  // The preference can flip while the scene lives: freeze to a bounded run, or thaw to a free one.
  if (reducedMotion && !o.still) {
    listen(reducedMotion, 'change', () => {
      framesLeft = reducedMotion.matches ? REDUCED_MOTION_FRAMES : Infinity;
      wake();
    });
  }
  wake();

  return {
    get frozen() {
      return reducedMotion?.matches ?? false;
    },
    get disposed() {
      return disposed;
    },
    wake,
    restart() {
      if (o.still || disposed) return;
      if (reducedMotion?.matches) framesLeft = REDUCED_MOTION_FRAMES;
      wake();
    },
    stop,
  };
}
