import { afterEach, describe, expect, it, vi } from 'vitest';
import { silhouette } from './silhouette';

// A w x h image whose opaque pixels are the given columns [from, to) on each row.
const fakeImage = (w: number, h: number, solid: (y: number) => [number, number] | null) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const span = solid(y);
    if (span) for (let x = span[0]; x < span[1]; x += 1) data[(y * w + x) * 4 + 3] = 255;
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ canvas, drawImage: vi.fn(), getImageData: () => ({ data }) }),
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return { clientWidth: w, clientHeight: h } as HTMLImageElement;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('silhouette', () => {
  // Art in columns 20..60 from row 8 down; rows 0..7 are empty.
  const art = (y: number): [number, number] | null => (y < 8 ? null : [20, 60]);

  it('hugs the right edge of the art when the text sits to its right', () => {
    const poly = silhouette(fakeImage(100, 16, art), true);
    expect(poly).toBe(
      'polygon(0px 0, 0px 0px, 0px 4px, 60px 8px, 60px 12px, 60px 16px, 0px 16px) border-box'
    );
  });

  it('hugs the left edge of the art when the text sits to its left', () => {
    const poly = silhouette(fakeImage(100, 16, art), false);
    expect(poly).toBe(
      'polygon(100px 0, 100px 0px, 100px 4px, 20px 8px, 20px 12px, 20px 16px, 100px 16px) border-box'
    );
  });

  it('takes the widest row of a band, so no row of the art pokes out of the polygon', () => {
    // Row 5 reaches x=90; its band's edge row (y=8 covers rows 4..8) must include it.
    const poly = silhouette(
      fakeImage(100, 16, (y) => (y === 5 ? [20, 90] : null)),
      true
    );
    expect(poly).toContain('90px 8px');
  });

  it('has no shape before the image has a size or where there is no canvas', () => {
    expect(
      silhouette({ clientWidth: 0, clientHeight: 0 } as HTMLImageElement, true)
    ).toBeUndefined();
  });

  it('traces only the visible part of a cropped portrait, drawn at its offset', () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        canvas,
        drawImage,
        getImageData: () => ({ data: new Uint8ClampedArray(40 * 8 * 4) }),
      }),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
    const img = { clientWidth: 100, clientHeight: 20 } as HTMLImageElement;
    silhouette(img, true, { x: 0, y: 12, width: 40, height: 8 });
    expect([canvas.width, canvas.height]).toEqual([40, 8]);
    expect(drawImage).toHaveBeenCalledWith(img, 0, -12, 100, 20);
  });
});
