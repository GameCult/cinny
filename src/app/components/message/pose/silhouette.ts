const SOLID = 0.35 * 255;
const ROW = 4;

// The edge of the portrait that the text wraps against, as a polygon in border-box pixels.
// `shape-outside: url()` cannot do this: the browser sizes that image at its natural size and
// anchors it at the margin box, which the phone layout's negative top margin shifts down by the
// overhang, so the exclusion neither matches the art's size nor its place.
//
// `view` is the part of the displayed image that shows (the button's box, in displayed pixels):
// the portrait is cropped by the bubble, so the polygon is traced over what is left of the art.
export type View = { x: number; y: number; width: number; height: number };

export const silhouette = (
  img: HTMLImageElement,
  textOnRight: boolean,
  view?: View
): string | undefined => {
  const w = Math.round(view?.width ?? img.clientWidth);
  const h = Math.round(view?.height ?? img.clientHeight);
  const ctx = w > 0 && h > 0 ? document.createElement('canvas').getContext('2d') : null;
  if (!ctx) return undefined;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.drawImage(img, 0 - (view?.x ?? 0), 0 - (view?.y ?? 0), img.clientWidth, img.clientHeight);
  const { data } = ctx.getImageData(0, 0, w, h);
  const outer = textOnRight ? 0 : w;
  const edge: string[] = [];
  for (let y = 0; y <= h; y += ROW) {
    let x = outer;
    // A band's edge is the extreme solid pixel over its rows, so no row pokes out of the polygon.
    for (let r = Math.max(0, y - ROW); r < Math.min(h, y + 1); r += 1) {
      for (let i = 0; i < w; i += 1) {
        const px = textOnRight ? w - 1 - i : i;
        if (data[(r * w + px) * 4 + 3] > SOLID) {
          x = textOnRight ? Math.max(x, px + 1) : Math.min(x, px);
          break;
        }
      }
    }
    edge.push(`${x}px ${y}px`);
  }
  return `polygon(${outer}px 0, ${edge.join(', ')}, ${outer}px ${h}px) border-box`;
};
