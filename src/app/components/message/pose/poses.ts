import catalogue from './catalogue.json';
import safeBoxes from './safeBoxes.json';
import type { Box } from './nest';

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
export const MINDS = Object.keys(minds);

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

// Safe-crop boxes measured from the art's pixels (Aqua, `aqua-pose-crop-boxes-20261110`): the
// head and headphones plus outline, which the bubble's edge must not cut. [x0, y0, x1, y1, width,
// height] in image pixels. Art with no entry gets its box from the sprite's alpha at load time.
const boxes = safeBoxes as Record<string, Record<string, number[]>>;
export const safeBox = (
  mind: string,
  pose: string
): { box: Box; size: [number, number] } | undefined => {
  const b = Object.prototype.hasOwnProperty.call(boxes, mind) ? boxes[mind][pose] : undefined;
  return b ? { box: [b[0], b[1], b[2], b[3]], size: [b[4], b[5]] } : undefined;
};
