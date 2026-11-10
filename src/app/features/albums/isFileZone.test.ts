import { describe, expect, it } from 'vitest';
import { isFileZone } from './isFileZone';

const room = { roomId: '!f:x', aliases: ['#files:x'] };

describe('isFileZone', () => {
  it('is true for the file-zone create type', () => {
    expect(isFileZone({ ...room, createType: 'org.gamecult.file_zone' }, {})).toBe(true);
  });
  it('is false for other create types and for plain rooms', () => {
    expect(isFileZone({ ...room, createType: 'm.space' }, {})).toBe(false);
    expect(isFileZone(room, {})).toBe(false);
    expect(isFileZone(room, { fileZoneRooms: [] })).toBe(false);
  });
  it('is true when the room id or an alias is configured', () => {
    expect(isFileZone(room, { fileZoneRooms: ['!f:x'] })).toBe(true);
    expect(isFileZone(room, { fileZoneRooms: ['#other:x', '#files:x'] })).toBe(true);
  });
  it('is false when only another room is configured', () => {
    expect(isFileZone(room, { fileZoneRooms: ['!g:x', '#g:x'] })).toBe(false);
  });
});
