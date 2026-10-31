import { describe, expect, it } from 'vitest';
import { groupByStewards, parseSteward, StewardEntry } from './stewardGroups';

const room = (roomId: string, parentId = '!projects') => ({ roomId, parentId });
const space = (roomId: string) => ({ roomId, space: true as const });

const base = {
  spaceId: '!top',
  isGroupOpen: () => true,
  keepVisible: () => false,
};

const names = (out: StewardEntry<{ roomId: string }>[]) =>
  out.map((e) => (e.type === 'group' ? `G:${e.label}:${e.count}` : e.item.roomId));

describe('groupByStewards', () => {
  const stewards: Record<string, string> = { '!a': 'Void', '!b': 'Eureka', '!c': 'Void' };
  const stewardOf = (id: string) => stewards[id];

  it('groups by steward, sorted by name, with unstewarded rooms first', () => {
    const out = groupByStewards([room('!a'), room('!x'), room('!b'), room('!c')], {
      ...base,
      stewardOf,
    });
    expect(names(out)).toEqual(['!x', 'G:Eureka:1', '!b', 'G:Void:2', '!a', '!c']);
  });

  it('collapsed groups hide rooms except kept-visible ones', () => {
    const out = groupByStewards([room('!a'), room('!b'), room('!c')], {
      ...base,
      stewardOf,
      isGroupOpen: () => false,
      keepVisible: (id) => id === '!c',
    });
    expect(names(out)).toEqual(['G:Eureka:1', 'G:Void:2', '!c']);
  });

  it('degrades to the original order when no room has steward state', () => {
    const out = groupByStewards([room('!1'), space('!s'), room('!2', '!s')], {
      ...base,
      stewardOf: () => undefined,
    });
    expect(names(out)).toEqual(['!1', '!s', '!2']);
  });

  it('does not merge runs separated by a space header', () => {
    const out = groupByStewards([room('!a'), space('!s'), room('!c', '!s')], {
      ...base,
      stewardOf,
    });
    expect(out.filter((e) => e.type === 'group')).toHaveLength(2);
  });
});

describe('parseSteward', () => {
  it('accepts a string and rejects junk', () => {
    expect(parseSteward({ steward: ' Void ' })).toBe('Void');
    expect(parseSteward({ steward: 3 })).toBeUndefined();
    expect(parseSteward({ steward: '  ' })).toBeUndefined();
    expect(parseSteward(undefined)).toBeUndefined();
    expect(parseSteward(null)).toBeUndefined();
  });
});
