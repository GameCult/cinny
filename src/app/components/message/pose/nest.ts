// A pose nests into the corner of its bubble: the sprite's body sits in the bubble's padding and is
// cut off by the bubble's edge, so nothing hangs outside it.

/** [x0, y0, x1, y1] in image pixels, origin top-left, x1/y1 exclusive. */
export type Box = [number, number, number, number];

// Share of the room between the safe box and the image edge that the bubble edge may cut away.
// Aqua's measurement says all of it can go; half leaves the outline a little air.
export const CROP_SHARE = 0.5;

export type NestView = {
  /** The visible region of the image, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
};

// The part of the image that shows, for a sprite in the bubble's top-right (`right`) or top-left
// corner. Only the corner's two sides are cropped: the side towards the bubble's edge and the top.
// The far side and the bottom stay whole; the bubble's bottom edge cuts the bust.
export const nestView = (
  safe: Box,
  size: [number, number],
  right: boolean,
  share = CROP_SHARE
): NestView => {
  const [w, h] = size;
  const [x0, y0, x1] = safe;
  const side = Math.round(share * (right ? w - x1 : x0));
  const top = Math.round(share * y0);
  const x = right ? 0 : side;
  return { x, y: top, width: w - side, height: h - top };
};

// Bounds of the pixels whose alpha exceeds `min`, as a safe box for art with no measured one.
export const alphaBounds = (
  data: ArrayLike<number>,
  w: number,
  h: number,
  min = 8
): Box | undefined => {
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (data[(y * w + x) * 4 + 3] > min) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x + 1);
        y0 = Math.min(y0, y);
        y1 = y + 1;
      }
    }
  }
  return x1 > x0 ? [x0, y0, x1, y1] : undefined;
};
