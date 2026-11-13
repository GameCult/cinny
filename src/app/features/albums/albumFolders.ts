// Pure: folders are albums whose title is a `/`-separated path (docs/commons-files-desk.md, "Folders").
// No wire change: the album is still one thread root; the folder tree is only how the list is grouped.
import { Album, UNTITLED } from './buildAlbums';

/** A path as segments. Empty segments and surrounding space drop out; `.` and `..` are ordinary names, never navigation. */
export const splitPath = (title: string): string[] =>
  title
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

export type FolderEntry = {
  name: string;
  /** Segments from the root to this folder. */
  path: string[];
  /** Albums at any depth below. */
  albums: number;
  /** The newest album ts below, for ordering. */
  ts: number;
};

export type AlbumEntry = { album: Album; leaf: string };

export type FolderListing = { folders: FolderEntry[]; albums: AlbumEntry[] };

const startsWith = (path: string[], prefix: string[]) => prefix.every((seg, i) => path[i] === seg);

/**
 * What one folder shows: its direct sub-folders and the albums titled exactly at its path plus a leaf.
 * An album titled `x` and a folder `x/` coexist at the same level; neither hides the other. Newest first, both lists.
 */
export const listFolder = (albums: readonly Album[], at: string[]): FolderListing => {
  const folders = new Map<string, FolderEntry>();
  const direct: AlbumEntry[] = [];
  albums.forEach((album) => {
    const segs = splitPath(album.title);
    if (segs.length === 0) {
      // An untitled or all-slash title lives at the root under the title as written.
      if (at.length === 0) direct.push({ album, leaf: album.title.trim() || UNTITLED });
      return;
    }
    if (!startsWith(segs, at)) return;
    // An album titled exactly at this path sits in the parent, not inside the folder it shares a name with.
    if (segs.length <= at.length) return;
    if (segs.length === at.length + 1) {
      direct.push({ album, leaf: segs[segs.length - 1] });
      return;
    }
    const name = segs[at.length];
    const f = folders.get(name) ?? { name, path: [...at, name], albums: 0, ts: 0 };
    f.albums += 1;
    f.ts = Math.max(f.ts, album.ts);
    folders.set(name, f);
  });
  return {
    folders: [...folders.values()].sort((a, b) => b.ts - a.ts),
    albums: direct.sort((a, b) => b.album.ts - a.album.ts),
  };
};

/** The folder an album sits in: its title path without the leaf. */
export const folderOf = (album: Album): string[] => splitPath(album.title).slice(0, -1);

/**
 * The title a share sends into `folder`: the folder path then what the sender typed. The typed title
 * may itself contain `/`, which just goes deeper. An empty typed title falls back to `fallback`.
 */
export const titleIn = (folder: string[], typed: string, fallback: string): string => {
  const leaf = splitPath(typed).join('/') || fallback;
  return [...folder, leaf].join('/');
};

export const pathLabel = (path: string[]): string => path.join(' / ');
