import { describe, expect, it } from 'vitest';
import { buildAlbums, looseFiles, looseNote, TimelineEvent } from './buildAlbums';

// The Commons publisher as it posted before gamecult-ops #121: loose files (no album thread), a
// flat `org.gamecult.publish.replaces` key, no info.sha256. The sender must see that, not a
// silently empty or silently unfolded zone.
const MIND = '@eureka:gamecult.org';
const file = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {},
  ts = 1
): TimelineEvent => ({
  event_id: id,
  type: 'm.room.message',
  sender: MIND,
  origin_server_ts: ts,
  content: { msgtype: 'm.file', body: name, filename: name, url: `mxc://x/${id}`, ...extra },
});
const text = (id: string, body: string): TimelineEvent => ({
  event_id: id,
  type: 'm.room.message',
  sender: MIND,
  origin_server_ts: 1,
  content: { msgtype: 'm.text', body },
});

describe('loose files from a poster that does not thread', () => {
  it('are found, with the names the sender sees', () => {
    const loose = looseFiles([file('$a', 'notes.md'), file('$b', 'plan.pdf')]);
    expect(loose.map((f) => f.name)).toEqual(['notes.md', 'plan.pdf']);
  });

  it('are not the album roots, thread replies (by SDK root or by relation), edits or redactions', () => {
    const events: TimelineEvent[] = [
      text('$root', 'handoff/eureka'),
      { ...file('$r1', 'a.md'), threadRoot: '$root' },
      file('$r2', 'b.md', {
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      }),
      file('$edit', 'c.md', { 'm.relates_to': { rel_type: 'm.replace', event_id: '$r1' } }),
      { ...file('$gone', 'd.md'), unsigned: { redacted_because: {} } },
      file('$loose', 'e.md'),
    ];
    expect(looseFiles(events).map((f) => f.id)).toEqual(['$loose']);
  });

  it('a zone holding only loose files still has no albums, and the note says why', () => {
    const events = [file('$a', 'notes.md')];
    expect(buildAlbums([])).toEqual([]);
    expect(looseNote(looseFiles(events))).toBe(
      '1 file was posted outside an album and is not listed here: notes.md. It is in the Timeline.'
    );
  });

  it('the note names three and counts the rest', () => {
    const many = looseFiles(['a', 'b', 'c', 'd', 'e'].map((n) => file(`$${n}`, `${n}.md`)));
    expect(looseNote(many)).toBe(
      '5 files were posted outside an album and are not listed here: a.md, b.md, c.md and 2 more. They are in the Timeline.'
    );
    expect(looseNote([])).toBe('');
  });
});

describe('the old wire shape inside an album', () => {
  const root = text('$root', 'handoff/eureka');
  const albumOf = (replies: TimelineEvent[]) => buildAlbums([{ root, replies }], 'gamecult.org')[0];

  it('a flat replaces key folds nothing: both versions show, none is hidden', () => {
    const album = albumOf([
      file('$v1', 'plan.md', { 'org.gamecult.publish.sha256': 'aa' }, 1),
      file('$v2', 'plan.md', { 'org.gamecult.publish.replaces': '$v1' }, 2),
    ]);
    expect(album.files.map((f) => f.id)).toEqual(['$v1', '$v2']);
    expect(album.files.every((f) => f.earlier.length === 0)).toBe(true);
  });

  it('the nested shape from the fixed publisher folds as before', () => {
    const album = albumOf([
      file('$v1', 'plan.md', {}, 1),
      file('$v2', 'plan.md', { 'org.gamecult.publish': { replaces: '$v1' } }, 2),
    ]);
    expect(album.files.map((f) => f.id)).toEqual(['$v2']);
    expect(album.files[0].earlier.map((f) => f.id)).toEqual(['$v1']);
  });

  it('a file with no info.sha256 lists fine, with no readers even when a receipt names it', () => {
    const receipt: TimelineEvent = {
      event_id: '$rc',
      type: 'org.gamecult.file_received',
      sender: '@void:gamecult.org',
      origin_server_ts: 5,
      content: { 'org.gamecult.file_received': { event_id: '$v1', sha256: 'aa', size: 1 } },
    };
    const album = albumOf([file('$v1', 'plan.md'), receipt]);
    expect(album.count).toBe(1);
    expect(album.files[0].readBy).toEqual([]);
  });
});
