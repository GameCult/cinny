export const FILE_ZONE_TYPE = 'org.gamecult.file_zone';

/** The shared Commons room's key in the carried `file_zones` map, and its alias on the home server. */
export const COMMONS_KEY = 'commons';
export const commonsAlias = (server: string): string => `#${COMMONS_KEY}:${server}`;

export type FileZoneRoom = {
  roomId: string;
  /** Canonical and alternative aliases. */
  aliases?: string[];
  /** The `type` of the room's m.room.create content. */
  createType?: string;
  /** The home server name; the Commons alias on it makes the room a file zone. */
  server?: string;
};

/** A room is the file zone when its create type says so, it holds the Commons alias on the home server, or the client config lists it. */
export const isFileZone = (room: FileZoneRoom, config: { fileZoneRooms?: string[] }): boolean =>
  room.createType === FILE_ZONE_TYPE ||
  (!!room.server && !!room.aliases?.includes(commonsAlias(room.server))) ||
  !!config.fileZoneRooms?.some((r) => r === room.roomId || room.aliases?.includes(r));
