export type ZoneView = 'albums' | 'timeline';

/** The view a file-zone room shows. A link to an event always wins; else the user's choice; else albums. */
export const zoneView = (choice: ZoneView | undefined, eventId: string | undefined): ZoneView =>
  eventId ? 'timeline' : choice ?? 'albums';
