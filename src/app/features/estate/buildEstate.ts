/**
 * The estate index: the only code that decides which rooms the navigator lists,
 * in which tier and steward group, and whether each is joined, invited or joinable.
 *
 * The server's /hierarchy of the root Space is the access rule. A room the
 * hierarchy does not return is never listed, whatever the client store knows;
 * a room it returns is never hidden by the client. The one licensed addition is
 * the user's own joined rooms that sit outside the Space (the Elsewhere tier).
 *
 * A room's steward is read from the hierarchy too: the content of the
 * m.space.child entry that lists the room carries org.gamecult.steward, which an
 * invited-only member can read (she cannot read the Space's state).
 */

export type EstateHierarchyRoom = {
  room_id: string;
  name?: string;
  canonical_alias?: string;
  room_type?: string;
  children_state?: { state_key: string; content?: SpaceChildContent }[];
};

export const STEWARD_KEY = 'org.gamecult.steward';

export type SpaceChildContent = {
  via?: string[];
  /** The Mind who stewards the room, as the accounts script writes it. */
  [STEWARD_KEY]?: { mind?: unknown };
};

export type EstateMembership = 'joined' | 'invited' | 'joinable';

export type EstateRoom = {
  roomId: string;
  name: string;
  state: EstateMembership;
  /** Servers to join through, from the hierarchy's children_state. */
  via: string[];
  /** The Space tier the room sits in; null for direct messages and Elsewhere rooms. */
  parentId: string | null;
  direct: boolean;
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
  /** The user's own membership per room id, from the client store. */
  membership: ReadonlyMap<string, 'join' | 'invite'>;
  /** Joined and invited direct messages. */
  directRoomIds: readonly string[];
  /** Joined non-DM, non-Space rooms, whether or not the hierarchy lists them. */
  strayRoomIds?: readonly string[];
  /** Names for rooms the hierarchy does not name (direct and stray rooms). */
  roomNames?: ReadonlyMap<string, string>;
  /** Display names for Minds, keyed by localpart. */
  mindLabels?: ReadonlyMap<string, string>;
};

export const DIRECT_TIER_ID = 'direct';
export const ELSEWHERE_TIER_ID = 'elsewhere';

const SPACE_TYPE = 'm.space';

/** The Mind a Space child entry names as the room's steward, if any. */
export const stewardOfChild = (content: SpaceChildContent | undefined): string | undefined => {
  const mind = content?.[STEWARD_KEY]?.mind;
  return typeof mind === 'string' && mind !== '' ? mind : undefined;
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
  membership,
  directRoomIds,
  strayRoomIds = [],
  roomNames,
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
      const content = space.children_state?.find((c) => c.state_key === r.room_id)?.content;
      const room: EstateRoom = {
        roomId: r.room_id,
        name: roomLabel(r),
        state: stateOf(r.room_id, membership),
        via: content?.via ?? [],
        parentId: space.room_id,
        direct: false,
      };
      const mind = stewardOfChild(content);
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
      name: roomNames?.get(roomId) ?? roomId,
      state: stateOf(roomId, membership),
      via: [],
      parentId: null,
      direct: true,
    })),
    groups: [],
  };

  const listedIds = new Set(hierarchy.map((r) => r.room_id));
  const elsewhereTier: EstateTier = {
    id: ELSEWHERE_TIER_ID,
    label: 'Elsewhere',
    loose: strayRoomIds
      .filter((id) => !listedIds.has(id) && !direct.has(id) && membership.get(id) === 'join')
      .map((roomId) => ({
        roomId,
        name: roomNames?.get(roomId) ?? roomId,
        state: 'joined' as const,
        via: [],
        parentId: null,
        direct: false,
      })),
    groups: [],
  };

  const listed = tiers.filter((t) => t.loose.length > 0 || t.groups.length > 0);
  return [
    ...listed,
    ...(elsewhereTier.loose.length > 0 ? [elsewhereTier] : []),
    ...(directTier.loose.length > 0 ? [directTier] : []),
  ];
};
