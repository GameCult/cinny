// Frame cadence from rAF timestamps: what `?probe=1` shows, and what the still-image fallback
// decides on. Pure, so it is tested without a browser.

export interface FrameStats {
  /** Frame intervals counted. */
  n: number;
  medianMs: number;
  p95Ms: number;
}

/** The fallback's threshold and window, from the brief: p95 over 33 ms across 2 s. */
export const SLOW_P95_MS = 33;
export const WINDOW_MS = 2000;
/** The first frames pay for layout, canvas upload and JIT; they say nothing about steady cadence. */
export const WARMUP_FRAMES = 5;

const quantile = (sorted: readonly number[], q: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

export function frameStats(intervals: readonly number[]): FrameStats {
  const s = [...intervals].sort((a, b) => a - b);
  return { n: s.length, medianMs: quantile(s, 0.5), p95Ms: quantile(s, 0.95) };
}

export class FrameSampler {
  private last: number | undefined;
  private skipped = 0;
  private startedAt: number | undefined;
  private readonly intervals: number[] = [];

  /** Feed each rAF timestamp. Returns true once a full window has been measured. */
  push(now: number): boolean {
    const prev = this.last;
    this.last = now;
    if (prev === undefined) return false;
    if (this.skipped < WARMUP_FRAMES) {
      this.skipped += 1;
      return false;
    }
    this.startedAt ??= prev;
    this.intervals.push(now - prev);
    return now - this.startedAt >= WINDOW_MS;
  }

  /** A pause (hidden tab, resize) breaks the series: its gap is not a slow frame. */
  reset(): void {
    this.last = undefined;
    this.skipped = 0;
    this.startedAt = undefined;
    this.intervals.length = 0;
  }

  stats(): FrameStats {
    return frameStats(this.intervals);
  }

  slow(): boolean {
    return this.stats().p95Ms > SLOW_P95_MS;
  }
}
