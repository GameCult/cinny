export type ZoneView = 'albums' | 'timeline';

/** The view a file-zone room shows: the user's choice, else the timeline for an event deep link, else albums. */
export const zoneView = (choice: ZoneView | undefined, eventId: string | undefined): ZoneView =>
  choice ?? (eventId ? 'timeline' : 'albums');
