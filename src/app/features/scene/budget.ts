// The adaptive step-down. The ladder only descends within a session; nothing here ever steps up.

export interface Level {
  /** Pass 1 resolution as a fraction of the canvas. */
  solidScale: number;
  /** Pass 2 resolution as a fraction of the canvas. */
  atmosphereScale: number;
  /** Cloud march steps. */
  cloudSteps: number;
  /** Sphere-trace step cap. */
  traceSteps: number;
}

export const LEVELS: readonly Level[] = [
  { solidScale: 0.75, atmosphereScale: 0.5, cloudSteps: 12, traceSteps: 96 },
  { solidScale: 0.6, atmosphereScale: 0.4, cloudSteps: 8, traceSteps: 80 },
  { solidScale: 0.5, atmosphereScale: 0.33, cloudSteps: 6, traceSteps: 64 },
  { solidScale: 0.4, atmosphereScale: 0.25, cloudSteps: 4, traceSteps: 48 },
];

/** Median of the last `window` frame times above `budgetMs` for a whole window steps down one level. */
export class BudgetLadder<L = Level> {
  private level: number;

  private recent: number[] = [];

  private readonly budgetMs: number;

  private readonly window: number;

  private readonly levels: readonly L[];

  /**
   * `startLevel` lets a weak device begin below level 0; it is clamped into the ladder. `levels`
   * defaults to the ray-march ladder; another scene passes its own.
   */
  constructor(
    budgetMs: number,
    window = 45,
    startLevel = 0,
    levels: readonly L[] = LEVELS as unknown as readonly L[]
  ) {
    this.budgetMs = budgetMs;
    this.window = window;
    this.levels = levels;
    this.level = Math.min(Math.max(startLevel, 0), levels.length - 1);
  }

  get current(): L {
    return this.levels[this.level];
  }

  get index(): number {
    return this.level;
  }

  /** Feed one frame's GPU (or cadence) time. Returns true when the level changed. */
  push(ms: number): boolean {
    this.recent.push(ms);
    if (this.recent.length < this.window) return false;
    const sorted = [...this.recent].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.recent = [];
    if (median > this.budgetMs && this.level < this.levels.length - 1) {
      this.level += 1;
      return true;
    }
    return false;
  }
}
