import { describe, expect, it } from 'vitest';
import { buildEstate, EstateHierarchyRoom, EstateInput, stewardOfChild } from './buildEstate';

const ROOT = '!root:gamecult.org';
const PROJECTS = '!projects:gamecult.org';

/** A Space whose child entries may carry the steward Mind, as the accounts script writes it. */
const space = (
  id: string,
  name: string,
  children: string[],
  stewards: Record<string, string> = {}
): EstateHierarchyRoom => ({
  room_id: id,
  name,
  room_type: 'm.space',
  children_state: children.map((c) => ({
    state_key: c,
    content: {
      via: ['gamecult.org'],
      ...(stewards[c] ? { 'org.gamecult.steward': { mind: stewards[c], repo: 'x' } } : {}),
    },
  })),
});
const room = (id: string, name: string, alias?: string): EstateHierarchyRoom => ({
  room_id: id,
  name,
  canonical_alias: alias,
});

const hierarchy = [
  space(ROOT, 'GameCult', ['!general:gamecult.org', PROJECTS]),
  room('!general:gamecult.org', 'General', '#general:gamecult.org'),
  space(
    PROJECTS,
    'Projects',
    ['!cultlib:gamecult.org', '!aeth:gamecult.org', '!misc:gamecult.org'],
    { '!cultlib:gamecult.org': 'eureka', '!aeth:gamecult.org': 'void' }
  ),
  room('!cultlib:gamecult.org', 'CultLib', '#cultlib:gamecult.org'),
  room('!aeth:gamecult.org', 'Aetheria', '#Aetheria:gamecult.org'),
  room('!misc:gamecult.org', 'Misc', '#misc:gamecult.org'),
];

const input = (over: Partial<EstateInput> = {}): EstateInput => ({
  rootId: ROOT,
  hierarchy,
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
    const tiers = buildEstate(
      input({ membership: new Map([['!cultlib:gamecult.org', 'invite']]) })
    );
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

  it('groups rooms by steward Mind from the steward on each Space child entry', () => {
    const projects = buildEstate(input()).find((t) => t.id === PROJECTS)!;
    expect(projects.groups.map((g) => [g.mind, g.rooms.map((r) => r.roomId)])).toEqual([
      ['eureka', ['!cultlib:gamecult.org']],
      ['void', ['!aeth:gamecult.org']],
    ]);
  });

  it('sorts steward groups by display label', () => {
    const projects = buildEstate(
      input({
        mindLabels: new Map([
          ['eureka', 'Zed'],
          ['void', 'Alpha'],
        ]),
      })
    ).find((t) => t.id === PROJECTS)!;
    expect(projects.groups.map((g) => g.label)).toEqual(['Alpha', 'Zed']);
  });

  it('lists a room with no alias match loose in its tier', () => {
    const projects = buildEstate(input()).find((t) => t.id === PROJECTS)!;
    expect(projects.loose.map((r) => r.roomId)).toEqual(['!misc:gamecult.org']);
  });

  it('groups an invited-only user by the same child-entry stewards, with no root state', () => {
    const invitee = new Map<string, 'join' | 'invite'>([
      [ROOT, 'invite'],
      [PROJECTS, 'invite'],
      ['!cultlib:gamecult.org', 'invite'],
      ['!aeth:gamecult.org', 'invite'],
    ]);
    const projects = buildEstate(input({ membership: invitee })).find((t) => t.id === PROJECTS)!;
    expect(projects.groups.map((g) => [g.mind, g.rooms.map((r) => r.state)])).toEqual([
      ['eureka', ['invited']],
      ['void', ['invited']],
    ]);
  });

  it('ignores a steward that is not a non-empty string', () => {
    const odd = (steward: unknown): EstateHierarchyRoom[] => [
      {
        ...space(ROOT, 'GameCult', ['!a:gamecult.org']),
        children_state: [
          { state_key: '!a:gamecult.org', content: { 'org.gamecult.steward': { mind: steward } } },
        ],
      },
      room('!a:gamecult.org', 'A'),
    ];
    [42, '', undefined, null].forEach((m) => {
      const t = buildEstate(input({ hierarchy: odd(m) }))[0];
      expect(t.groups).toEqual([]);
      expect(t.loose).toHaveLength(1);
    });
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
    expect(tiers.map((t) => t.label)).toEqual([
      'GameCult',
      'Projects',
      'Workshop',
      'Direct Messages',
    ]);
    expect(tiers[3].loose[0].direct).toBe(true);
    expect(tiers[0].loose.map((r) => r.name)).toEqual(['General']);
    expect(tiers[3].loose[0]).toMatchObject({ roomId: '!dm:gamecult.org', parentId: null });
  });

  it('takes join servers from the matching children_state entry', () => {
    const tiers = buildEstate(
      input({
        hierarchy: [
          {
            ...space(ROOT, 'GameCult', ['!a:gamecult.org', '!b:gamecult.org']),
            children_state: [
              { state_key: '!a:gamecult.org', content: { via: ['one.example'] } },
              { state_key: '!b:gamecult.org', content: { via: ['two.example'] } },
            ],
          },
          room('!a:gamecult.org', 'A'),
          room('!b:gamecult.org', 'B'),
        ],
      })
    );
    expect(find(tiers, '!a:gamecult.org')?.via).toEqual(['one.example']);
    expect(find(tiers, '!b:gamecult.org')?.via).toEqual(['two.example']);
  });

  it('puts every room of one Mind in a single group', () => {
    const tiers = buildEstate(
      input({
        hierarchy: [
          ...hierarchy.slice(0, 2),
          space(PROJECTS, 'Projects', ['!cultlib:gamecult.org', '!aeth:gamecult.org'], {
            '!cultlib:gamecult.org': 'eureka',
            '!aeth:gamecult.org': 'eureka',
          }),
          ...hierarchy.slice(3, 5),
        ],
      })
    );
    const projects = tiers.find((t) => t.id === PROJECTS)!;
    expect(projects.groups).toHaveLength(1);
    expect(projects.groups[0].rooms.map((r) => r.roomId)).toEqual([
      '!cultlib:gamecult.org',
      '!aeth:gamecult.org',
    ]);
  });

  it('sorts group labels without regard to case', () => {
    const projects = buildEstate(
      input({
        mindLabels: new Map([
          ['eureka', 'beta'],
          ['void', 'Alpha'],
        ]),
      })
    ).find((t) => t.id === PROJECTS)!;
    expect(projects.groups.map((g) => g.label)).toEqual(['Alpha', 'beta']);
  });

  it('omits a tier whose Space returned no rooms and the Direct tier when there are no DMs', () => {
    const tiers = buildEstate(
      input({
        hierarchy: [
          space(ROOT, 'GameCult', ['!general:gamecult.org', PROJECTS]),
          room('!general:gamecult.org', 'General'),
          space(PROJECTS, 'Projects', ['!hidden:gamecult.org']),
        ],
      })
    );
    expect(tiers.map((t) => t.id)).toEqual([ROOT]);
  });

  it('puts direct messages in the final tier, off any Space', () => {
    const tiers = buildEstate(input({ directRoomIds: ['!dm:gamecult.org'] }));
    expect(tiers[tiers.length - 1]).toMatchObject({ id: 'direct', groups: [] });
  });

  it('is identical for identical inputs', () => {
    expect(buildEstate(input())).toEqual(buildEstate(input()));
  });
});

describe('stewardOfChild', () => {
  it('reads the Mind from the org.gamecult.steward key of the child content', () => {
    expect(stewardOfChild({ via: ['x'], 'org.gamecult.steward': { mind: 'void' } })).toBe('void');
  });

  it('has no steward without the key, content or a string Mind', () => {
    expect(stewardOfChild(undefined)).toBeUndefined();
    expect(stewardOfChild({ via: ['x'] })).toBeUndefined();
    expect(stewardOfChild({ 'org.gamecult.steward': {} })).toBeUndefined();
  });
});

describe('Elsewhere', () => {
  const strays = (over: Partial<EstateInput>) =>
    buildEstate(input({ membership: new Map([['!adhoc:x', 'join']]), ...over })).find(
      (t) => t.id === 'elsewhere'
    );

  it('lists a joined non-DM room the hierarchy does not return, named from the store', () => {
    const t = strays({
      strayRoomIds: ['!adhoc:x'],
      roomNames: new Map([['!adhoc:x', 'Meeting']]),
    })!;
    expect(t.label).toBe('Elsewhere');
    expect(t.loose).toEqual([
      {
        roomId: '!adhoc:x',
        name: 'Meeting',
        state: 'joined',
        via: [],
        parentId: null,
        direct: false,
      },
    ]);
  });

  it('does not repeat a room the hierarchy lists or a DM, and is last before Direct', () => {
    const tiers = buildEstate(
      input({
        membership: new Map([
          ['!general:gamecult.org', 'join'],
          ['!dm:x', 'join'],
          ['!adhoc:x', 'join'],
        ]),
        strayRoomIds: ['!general:gamecult.org', '!dm:x', '!adhoc:x'],
        directRoomIds: ['!dm:x'],
      })
    );
    expect(tiers.map((t) => t.id)).toEqual([ROOT, PROJECTS, 'elsewhere', 'direct']);
    expect(tiers[2].loose.map((r) => r.roomId)).toEqual(['!adhoc:x']);
  });

  it('never lists a room the user has not joined', () => {
    expect(
      strays({ membership: new Map([['!adhoc:x', 'invite']]), strayRoomIds: ['!adhoc:x'] })
    ).toBeUndefined();
  });

  it('is absent when there are no strays', () => {
    expect(strays({})).toBeUndefined();
  });
});

describe('direct invites', () => {
  it('lists an invited DM in the Direct tier as invited, named from the store', () => {
    const tiers = buildEstate(
      input({
        membership: new Map([['!dm:x', 'invite']]),
        directRoomIds: ['!dm:x'],
        roomNames: new Map([['!dm:x', 'Void']]),
      })
    );
    expect(tiers[tiers.length - 1].loose).toEqual([
      { roomId: '!dm:x', name: 'Void', state: 'invited', via: [], parentId: null, direct: true },
    ]);
  });
});
