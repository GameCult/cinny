import { describe, expect, it } from 'vitest';
import { buildEstate, EstateHierarchyRoom, EstateInput, stewardOfRoom } from './buildEstate';

const ROOT = '!root:gamecult.org';
const PROJECTS = '!projects:gamecult.org';

const space = (id: string, name: string, children: string[]): EstateHierarchyRoom => ({
  room_id: id,
  name,
  room_type: 'm.space',
  children_state: children.map((c) => ({ state_key: c, content: { via: ['gamecult.org'] } })),
});
const room = (id: string, name: string, alias?: string): EstateHierarchyRoom => ({
  room_id: id,
  name,
  canonical_alias: alias,
});

const hierarchy = [
  space(ROOT, 'GameCult', ['!general:gamecult.org', PROJECTS]),
  room('!general:gamecult.org', 'General', '#general:gamecult.org'),
  space(PROJECTS, 'Projects', ['!cultlib:gamecult.org', '!aeth:gamecult.org', '!misc:gamecult.org']),
  room('!cultlib:gamecult.org', 'CultLib', '#cultlib:gamecult.org'),
  room('!aeth:gamecult.org', 'Aetheria', '#Aetheria:gamecult.org'),
  room('!misc:gamecult.org', 'Misc', '#misc:gamecult.org'),
];

const stewardships = { eureka: ['GameCult/CultLib'], void: ['GameCult/aetheria'] };

const input = (over: Partial<EstateInput> = {}): EstateInput => ({
  rootId: ROOT,
  hierarchy,
  stewardships,
  membership: new Map(),
  directRoomIds: [],
  ...over,
});

const find = (tiers: ReturnType<typeof buildEstate>, roomId: string) =>
  tiers
    .flatMap((t) => [...t.loose, ...t.groups.flatMap((g) => g.rooms)])
    .find((r) => r.roomId === roomId);

describe('buildEstate', () => {
  it('lists an invited project room as invited', () => {
    const tiers = buildEstate(input({ membership: new Map([['!cultlib:gamecult.org', 'invite']]) }));
    expect(find(tiers, '!cultlib:gamecult.org')?.state).toBe('invited');
  });

  it('lists a hierarchy room the user has not joined as joinable, beside joined ones', () => {
    const tiers = buildEstate(input({ membership: new Map([['!general:gamecult.org', 'join']]) }));
    expect(find(tiers, '!general:gamecult.org')?.state).toBe('joined');
    expect(find(tiers, '!aeth:gamecult.org')?.state).toBe('joinable');
    expect(find(tiers, '!aeth:gamecult.org')?.via).toEqual(['gamecult.org']);
  });

  it('omits a room absent from the hierarchy even when the client store knows it', () => {
    const hidden = '!estate-secret:gamecult.org';
    const tiers = buildEstate(
      input({
        membership: new Map([[hidden, 'join']]),
        // The root names the room as a child, but the server did not return it.
        hierarchy: [
          space(ROOT, 'GameCult', ['!general:gamecult.org', PROJECTS, hidden]),
          ...hierarchy.slice(1),
        ],
      })
    );
    expect(find(tiers, hidden)).toBeUndefined();
  });

  it('lists every room the server returned, whatever the user may join', () => {
    const tiers = buildEstate(input());
    expect(tiers.flatMap((t) => [...t.loose, ...t.groups.flatMap((g) => g.rooms)])).toHaveLength(4);
  });

  it('groups rooms by steward Mind from stewardships plus canonical alias, case-insensitively', () => {
    const projects = buildEstate(input()).find((t) => t.id === PROJECTS)!;
    expect(projects.groups.map((g) => [g.mind, g.rooms.map((r) => r.roomId)])).toEqual([
      ['eureka', ['!cultlib:gamecult.org']],
      ['void', ['!aeth:gamecult.org']],
    ]);
  });

  it('sorts steward groups by display label', () => {
    const projects = buildEstate(
      input({ mindLabels: new Map([['eureka', 'Zed'], ['void', 'Alpha']]) })
    ).find((t) => t.id === PROJECTS)!;
    expect(projects.groups.map((g) => g.label)).toEqual(['Alpha', 'Zed']);
  });

  it('lists a room with no alias match loose in its tier', () => {
    const projects = buildEstate(input()).find((t) => t.id === PROJECTS)!;
    expect(projects.loose.map((r) => r.roomId)).toEqual(['!misc:gamecult.org']);
  });

  it('degrades to loose rows when the stewardships are unreadable', () => {
    const projects = buildEstate(input({ stewardships: undefined })).find(
      (t) => t.id === PROJECTS
    )!;
    expect(projects.groups).toEqual([]);
    expect(projects.loose).toHaveLength(3);
  });

  it('makes one tier per sub-Space in hierarchy order, root rooms first, Direct last', () => {
    const second = '!second:gamecult.org';
    const tiers = buildEstate(
      input({
        hierarchy: [
          space(ROOT, 'GameCult', ['!general:gamecult.org', PROJECTS, second]),
          ...hierarchy.slice(1),
          space(second, 'Workshop', ['!w1:gamecult.org']),
          room('!w1:gamecult.org', 'Bench'),
        ],
        directRoomIds: ['!dm:gamecult.org'],
        membership: new Map([['!dm:gamecult.org', 'join']]),
      })
    );
    expect(tiers.map((t) => t.label)).toEqual(['GameCult', 'Projects', 'Workshop', 'Direct Messages']);
    expect(tiers[0].loose.map((r) => r.name)).toEqual(['General']);
    expect(tiers[3].loose[0]).toMatchObject({ roomId: '!dm:gamecult.org', parentId: null });
  });

  it('is identical for identical inputs', () => {
    expect(buildEstate(input())).toEqual(buildEstate(input()));
  });
});

describe('stewardOfRoom', () => {
  it('matches the alias localpart to the repo name, ignoring case and the org prefix', () => {
    expect(stewardOfRoom('#CULTLIB:gamecult.org', stewardships)).toBe('eureka');
    expect(stewardOfRoom('#aetheria:gamecult.org', stewardships)).toBe('void');
  });

  it('has no steward without an alias, a match or readable stewardships', () => {
    expect(stewardOfRoom(undefined, stewardships)).toBeUndefined();
    expect(stewardOfRoom('#unknown:gamecult.org', stewardships)).toBeUndefined();
    expect(stewardOfRoom('#cultlib:gamecult.org', { eureka: 'GameCult/CultLib' })).toBeUndefined();
  });
});
