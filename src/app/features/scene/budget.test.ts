import { describe, expect, it } from 'vitest';
import { BudgetLadder, LEVELS } from './budget';

describe('budget ladder', () => {
  it('steps down after a whole window over budget and never back up', () => {
    const ladder = new BudgetLadder(4, 5);
    Array.from({ length: 4 }).forEach(() => expect(ladder.push(9)).toBe(false));
    expect(ladder.push(9)).toBe(true);
    expect(ladder.index).toBe(1);
    Array.from({ length: 100 }).forEach(() => ladder.push(0.1)); // fast frames never raise the level
    expect(ladder.index).toBe(1);
  });

  it('judges the median, so one slow frame does not step down', () => {
    const ladder = new BudgetLadder(4, 5);
    [1, 1, 50, 1, 1].forEach((ms) => ladder.push(ms));
    expect(ladder.index).toBe(0);
  });

  it('stops at the last level', () => {
    const ladder = new BudgetLadder(4, 1);
    Array.from({ length: 20 }).forEach(() => ladder.push(99));
    expect(ladder.index).toBe(LEVELS.length - 1);
  });

  it('every level is cheaper than the one before in each cost axis', () => {
    LEVELS.slice(1).forEach((lv, i) => {
      const before = LEVELS[i];
      expect(lv.solidScale).toBeLessThan(before.solidScale);
      expect(lv.atmosphereScale).toBeLessThan(before.atmosphereScale);
      expect(lv.cloudSteps).toBeLessThan(before.cloudSteps);
      expect(lv.traceSteps).toBeLessThan(before.traceSteps);
    });
  });

  it('starts at the level it is given, clamped into the ladder', () => {
    expect(new BudgetLadder(4, 5, 2).index).toBe(2);
    expect(new BudgetLadder(4, 5, 99).index).toBe(LEVELS.length - 1);
    expect(new BudgetLadder(4, 5, -3).index).toBe(0);
  });
});
