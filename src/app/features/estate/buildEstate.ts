/**
 * The estate index: the only code that decides which rooms the navigator lists,
 * in which tier and steward group, and whether each is joined, invited or joinable.
 *
 * The server's /hierarchy of the root Space is the access rule. A room the
 * hierarchy does not return is never listed, whatever the client store knows;
 * a room it returns is never hidden by the client.
 */

export const STEWARDSHIPS_EVENT_TYPE = 'org.gamecult.stewardships';

export type EstateHierarchyRoom = {
  room_id: string;
  name?: string;
  canonical_alias?: string;
  room_type?: string;
  children_state?: { state_key: string; content?: { via?: string[] } }[];
};

/** Mind localpart to the repos she stewards, as projected on the root Space. */
export type Stewardships = Record<string, unknown>;

export type EstateMembership = 'joined' | 'invited' | 'joinable';

export type EstateRoom = {
  roomId: string;
  name: string;
  state: EstateMembership;
  /** Servers to join through, from the hierarchy's children_state. */
  via: string[];
  /** The Space tier the room sits in; null for direct messages. */
  parentId: string | null;
};

export type EstateGroup = {
  mind: string;
  label: string;
  rooms: EstateRoom[];
};

export type EstateTier = {
  id: string;
  label: string;
  /** Rooms without a steward. */
  loose: EstateRoom[];
  groups: EstateGroup[];
};

export type EstateInput = {
  rootId: string;
  /** Rooms from the server's hierarchy of the root, in hierarchy order. */
  hierarchy: readonly EstateHierarchyRoom[];
  stewardships: Stewardships | undefined;
  /** The user's own membership per room id, from the client store. */
  membership: ReadonlyMap<string, 'join' | 'invite'>;
  directRoomIds: readonly string[];
  /** Display names for Minds, keyed by localpart. */
  mindLabels?: ReadonlyMap<string, string>;
};

export const DIRECT_TIER_ID = 'direct';

const SPACE_TYPE = 'm.space';

const repoName = (repo: string): string => repo.split('/').pop()!.toLowerCase();

/**
 * The single place a room's steward is derived: the canonical alias localpart,
 * case-insensitively, against the repo names in the stewardships lists.
 * (Follow-up ratatoskr:follow_up:stewardships-carry-room-ids swaps this to room ids.)
 */
export const stewardOfRoom = (
  canonicalAlias: string | undefined,
  stewardships: Stewardships | undefined
): string | undefined => {
  if (!canonicalAlias || !stewardships) return undefined;
  const local = canonicalAlias.replace(/^#/, '').split(':')[0].toLowerCase();
  const mind = Object.keys(stewardships).find((m) => {
    const repos = stewardships[m];
    return Array.isArray(repos) && repos.some((r) => typeof r === 'string' && repoName(r) === local);
  });
  return mind;
};

const stateOf = (
  roomId: string,
  membership: ReadonlyMap<string, 'join' | 'invite'>
): EstateMembership => {
  const m = membership.get(roomId);
  if (m === 'join') return 'joined';
  if (m === 'invite') return 'invited';
  return 'joinable';
};

const roomLabel = (r: EstateHierarchyRoom): string => r.name || r.canonical_alias || r.room_id;

export const buildEstate = ({
  rootId,
  hierarchy,
  stewardships,
  membership,
  directRoomIds,
  mindLabels,
}: EstateInput): EstateTier[] => {
  const direct = new Set(directRoomIds);
  const byId = new Map(hierarchy.map((r) => [r.room_id, r]));
  const spaces = hierarchy.filter((r) => r.room_type === SPACE_TYPE);
  const root = byId.get(rootId);

  // Root first, then every sub-Space in hierarchy order.
  const tierSpaces = root ? [root, ...spaces.filter((s) => s.room_id !== rootId)] : spaces;

  const tiers: EstateTier[] = tierSpaces.map((space) => {
    const childIds = new Set((space.children_state ?? []).map((c) => c.state_key));
    const tier: EstateTier = { id: space.room_id, label: roomLabel(space), loose: [], groups: [] };
    const groups = new Map<string, EstateGroup>();

    hierarchy.forEach((r) => {
      if (r.room_type === SPACE_TYPE || !childIds.has(r.room_id) || direct.has(r.room_id)) return;
      const via = space.children_state?.find((c) => c.state_key === r.room_id)?.content?.via ?? [];
      const room: EstateRoom = {
        roomId: r.room_id,
        name: roomLabel(r),
        state: stateOf(r.room_id, membership),
        via,
        parentId: space.room_id,
      };
      const mind = stewardOfRoom(r.canonical_alias, stewardships);
      if (!mind) {
        tier.loose.push(room);
        return;
      }
      let group = groups.get(mind);
      if (!group) {
        group = { mind, label: mindLabels?.get(mind) ?? mind, rooms: [] };
        groups.set(mind, group);
      }
      group.rooms.push(room);
    });

    tier.groups = [...groups.values()].sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    );
    return tier;
  });

  const directTier: EstateTier = {
    id: DIRECT_TIER_ID,
    label: 'Direct Messages',
    loose: directRoomIds.map((roomId) => ({
      roomId,
      name: roomId,
      state: stateOf(roomId, membership),
      via: [],
      parentId: null,
    })),
    groups: [],
  };

  const listed = tiers.filter((t) => t.loose.length > 0 || t.groups.length > 0);
  return directTier.loose.length > 0 ? [...listed, directTier] : listed;
};
