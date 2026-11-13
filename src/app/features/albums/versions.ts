// Pure: a file event may name the event it supersedes in `org.gamecult.publish.replaces` (the
// publisher writes it on a later final version; docs/commons-files-desk.md, "replaces, not
// m.replace"). Both events stay ordinary files for every other client; this view shows the latest
// of a chain with the earlier ones folded under it. A chain is read from the events alone.

/** Key the publisher writes its provenance under. */
export const PUBLISH_KEY = 'org.gamecult.publish';

/** The event id a file says it replaces, if it says one. */
export const replacesOf = (content: Record<string, unknown>): string | undefined => {
  const id = (content[PUBLISH_KEY] as { replaces?: unknown } | undefined)?.replaces;
  return typeof id === 'string' && id ? id : undefined;
};

type Versioned<F> = F & { earlier: F[] };

/**
 * Files not replaced by another file in the list, oldest first as given, each carrying the files it
 * supersedes (nearest first) in `earlier`. A replacement whose target is missing from the list (a
 * redacted event, another thread) replaces nothing and stands as a head. A replacement by another sender is ignored. A file two others claim to
 * replace sits under both. The walk refuses to revisit a file, so a malformed chain cannot loop (a real event id hashes its content and cannot cycle); files caught in a loop with no head outside it are all shown, none folded.
 */
export const foldVersions = <
  F extends { id: string; sender: string; content: Record<string, unknown> }
>(
  files: Versioned<F>[]
): Versioned<F>[] => {
  const byId = new Map(files.map((f) => [f.id, f]));
  const target = (f: F): F | undefined => {
    const id = replacesOf(f.content);
    const t = id && id !== f.id ? byId.get(id) : undefined;
    // Only the sender of a file can supersede it, so no one else in the thread can fold it away.
    return t && t.sender === f.sender ? t : undefined;
  };
  const replaced = new Set<string>();
  files.forEach((f) => {
    const t = target(f);
    if (t) replaced.add(t.id);
  });
  const chainOf = (head: Versioned<F>): Versioned<F>[] => {
    const out: Versioned<F>[] = [];
    const seen = new Set([head.id]);
    for (let t = target(head); t && !seen.has(t.id); t = target(t)) {
      seen.add(t.id);
      out.push({ ...t, earlier: [] });
    }
    return out;
  };
  const heads = files.filter((f) => !replaced.has(f.id));
  const covered = new Set(heads.flatMap((h) => [h.id, ...chainOf(h).map((e) => e.id)]));
  // Files that replace one another with no head outside the loop are never reached from a head; show
  // each of them as it is rather than let the loop hide itself.
  return files
    .filter((f) => !replaced.has(f.id) || !covered.has(f.id))
    .map((f) => ({ ...f, earlier: replaced.has(f.id) ? [] : chainOf(f) }));
};
