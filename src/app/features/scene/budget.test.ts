import { describe, expect, it } from 'vitest';
import { BudgetLadder, LEVELS } from './budget';

describe('budget ladder', () => {
  it('steps down after a whole window over budget and never back up', () => {
    const ladder = new BudgetLadder(4, 5);
    for (let i = 0; i < 4; i++) expect(ladder.push(9)).toBe(false);
    expect(ladder.push(9)).toBe(true);
    expect(ladder.index).toBe(1);
    for (let i = 0; i < 100; i++) ladder.push(0.1); // fast frames never raise the level
    expect(ladder.index).toBe(1);
  });

  it('judges the median, so one slow frame does not step down', () => {
    const ladder = new BudgetLadder(4, 5);
    for (const ms of [1, 1, 50, 1, 1]) ladder.push(ms);
    expect(ladder.index).toBe(0);
  });

  it('stops at the last level', () => {
    const ladder = new BudgetLadder(4, 1);
    for (let i = 0; i < 20; i++) ladder.push(99);
    expect(ladder.index).toBe(LEVELS.length - 1);
  });

  it('every level is cheaper than the one before in each cost axis', () => {
    for (let i = 1; i < LEVELS.length; i++) {
      expect(LEVELS[i].solidScale).toBeLessThan(LEVELS[i - 1].solidScale);
      expect(LEVELS[i].atmosphereScale).toBeLessThan(LEVELS[i - 1].atmosphereScale);
      expect(LEVELS[i].cloudSteps).toBeLessThan(LEVELS[i - 1].cloudSteps);
      expect(LEVELS[i].traceSteps).toBeLessThan(LEVELS[i - 1].traceSteps);
    }
  });
});
