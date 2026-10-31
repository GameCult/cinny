/**
 * Splits runs of rooms that carry an `org.gamecult.steward` state event into
 * collapsible per-steward groups. Pure: the caller supplies the lookups, so the
 * grouping is testable without a Matrix client.
 */
export const STEWARD_EVENT_TYPE = 'org.gamecult.steward';

export type HierarchyLike = { roomId: string; parentId?: string; space?: true };

export type StewardEntry<T extends HierarchyLike> =
  | { type: 'item'; item: T }
  | { type: 'group'; id: string; label: string; open: boolean; count: number };

export const makeStewardGroupId = (spaceId: string, parentId: string, steward: string) =>
  `${spaceId}|${parentId}|steward:${steward}`;

export type StewardGroupOptions = {
  spaceId: string;
  /** steward name of a room, or undefined when the room has no (valid) steward state */
  stewardOf: (roomId: string) => string | undefined;
  isGroupOpen: (groupId: string) => boolean;
  /** rooms that stay visible inside a collapsed group (selected, unread, in a call) */
  keepVisible: (roomId: string) => boolean;
};

const byLabel = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b);

export const groupByStewards = <T extends HierarchyLike>(
  items: T[],
  { spaceId, stewardOf, isGroupOpen, keepVisible }: StewardGroupOptions
): StewardEntry<T>[] => {
  const out: StewardEntry<T>[] = [];

  const flush = (run: T[]) => {
    if (run.length === 0) return;
    const groups = new Map<string, T[]>();
    const loose: T[] = [];
    run.forEach((item) => {
      const steward = stewardOf(item.roomId);
      if (steward === undefined) {
        loose.push(item);
        return;
      }
      const list = groups.get(steward);
      if (list) list.push(item);
      else groups.set(steward, [item]);
    });

    // No steward state anywhere in this run: leave the list exactly as Cinny built it.
    if (groups.size === 0) {
      run.forEach((item) => out.push({ type: 'item', item }));
      return;
    }

    loose.forEach((item) => out.push({ type: 'item', item }));
    Array.from(groups.keys())
      .sort(byLabel)
      .forEach((steward) => {
        const rooms = groups.get(steward) ?? [];
        const id = makeStewardGroupId(spaceId, rooms[0].parentId ?? spaceId, steward);
        const open = isGroupOpen(id);
        out.push({ type: 'group', id, label: steward, open, count: rooms.length });
        rooms
          .filter((item) => open || keepVisible(item.roomId))
          .forEach((item) => out.push({ type: 'item', item }));
      });
  };

  let run: T[] = [];
  items.forEach((item) => {
    if (item.space) {
      flush(run);
      run = [];
      out.push({ type: 'item', item });
      return;
    }
    run.push(item);
  });
  flush(run);
  return out;
};

/** Reads `steward` from raw state event content; anything unusable is "no steward". */
export const parseSteward = (content: unknown): string | undefined => {
  if (typeof content !== 'object' || content === null) return undefined;
  const { steward } = content as { steward?: unknown };
  if (typeof steward !== 'string') return undefined;
  const trimmed = steward.trim();
  return trimmed === '' ? undefined : trimmed;
};
