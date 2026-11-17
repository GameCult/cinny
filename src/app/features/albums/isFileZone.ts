export const FILE_ZONE_TYPE = 'org.gamecult.file_zone';

export type FileZoneRoom = {
  roomId: string;
  /** Canonical and alternative aliases. */
  aliases?: string[];
  /** The `type` of the room's m.room.create content. */
  createType?: string;
};

/** A room is the file zone when its create type says so or the client config lists it. */
export const isFileZone = (room: FileZoneRoom, config: { fileZoneRooms?: string[] }): boolean =>
  room.createType === FILE_ZONE_TYPE ||
  !!config.fileZoneRooms?.some((r) => r === room.roomId || room.aliases?.includes(r));
