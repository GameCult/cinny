import catalogue from './catalogue.json';

// Pose labels travel in the event content under POSE_KEY. The catalogue
// (cast-art poses/catalogue.json, synced by `npm run sync:poses`) is the only
// list of Minds, labels and art paths the client knows.
export const POSE_KEY = 'org.gamecult.pose';
export const NEUTRAL = 'neutral';

type MindEntry = {
  shared: Record<string, string>;
  signatures: Record<string, string>;
};
const minds = catalogue.minds as Record<string, MindEntry>;

// A sender is a known Mind when its Matrix localpart or the first word of its
// display name is the Mind's name, case-insensitively.
export const mindOfSender = (localpart?: string, displayName?: string): string | undefined => {
  const candidates = [localpart, displayName?.split(/\s+/)[0]];
  return candidates
    .map((c) => c?.toLowerCase())
    .find((c): c is string => c !== undefined && Object.prototype.hasOwnProperty.call(minds, c));
};

const artPath = (mind: string, label: string): string | undefined => {
  const entry = Object.prototype.hasOwnProperty.call(minds, mind) ? minds[mind] : undefined;
  if (!entry) return undefined;
  const has = (o: Record<string, string>) => Object.prototype.hasOwnProperty.call(o, label);
  if (has(entry.shared)) return entry.shared[label];
  return has(entry.signatures) ? entry.signatures[label] : undefined;
};

// Unknown, missing or non-string labels, and another Mind's signature, fall back to neutral.
export const resolvePose = (mind: string, label: unknown): string => {
  if (typeof label !== 'string') return NEUTRAL;
  const l = label.trim().toLowerCase();
  return artPath(mind, l) ? l : NEUTRAL;
};

export const poseSrc = (mind: string, pose: string, base = '/'): string =>
  `${base}public/poses/${artPath(mind, pose) ?? artPath(mind, NEUTRAL)}`;

export type PoseStatus = { mind: string; pose: string; since: number };
export type PoseEvent = {
  sender: string;
  localpart?: string;
  name?: string;
  ts: number;
  label: unknown;
};

// Latest pose per Mind in a room's events (oldest first), and when that pose
// began: the first of its unbroken run of messages carrying the same pose.
export const poseStatuses = (events: PoseEvent[]): PoseStatus[] => {
  const bySender = new Map<string, { mind: string; run: { pose: string; ts: number }[] }>();
  events.forEach((e) => {
    const mind = mindOfSender(e.localpart, e.name);
    if (!mind) return;
    const entry = bySender.get(e.sender) ?? { mind, run: [] };
    entry.run.push({ pose: resolvePose(mind, e.label), ts: e.ts });
    bySender.set(e.sender, entry);
  });
  return [...bySender.values()].map(({ mind, run }) => {
    const last = run[run.length - 1];
    let i = run.length - 1;
    while (i > 0 && run[i - 1].pose === last.pose) i -= 1;
    return { mind, pose: last.pose, since: run[i].ts };
  });
};

const two = (n: number) => String(n).padStart(2, '0');

// Client-status text. Rendered locally only; it is never sent to a room.
export const poseStatusLine = ({ mind, pose, since }: PoseStatus): string => {
  const d = new Date(since);
  const name = mind.charAt(0).toUpperCase() + mind.slice(1);
  return `Ratatoskr: ${name} is ${pose}, since ${two(d.getHours())}:${two(d.getMinutes())}`;
};
