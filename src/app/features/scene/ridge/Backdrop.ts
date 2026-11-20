// The ridge cards the scene composes, lit: every card's two files fetched and decoded exactly as the baker wrote them, then lit once for the sky
// (`lightCards.ts`). Failure is a value (null), never a throw.
import type { RidgeManifest } from './manifest';
import type { PhysicalSky } from './physicalSky';
import { lightCards } from './lightCards';
import type { CardBitmaps, LitCard } from './lightCards';

export interface Backdrop {
  manifest: RidgeManifest;
  /** Nearest first, as the manifest lists them. */
  cards: LitCard[];
}

export interface BackdropDeps {
  fetchBlob: (url: string) => Promise<Blob>;
  light: (manifest: RidgeManifest, bitmaps: CardBitmaps[], sky: PhysicalSky) => LitCard[];
}

const fetchBlob = async (url: string): Promise<Blob> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ridge: ${url} answered ${res.status}`);
  return res.blob();
};

/** Straight alpha and the file's own values: the colour card's alpha is coverage and the geometry card's channels are data, so neither may be premultiplied or colour-managed. */
const decode = (blob: Blob): Promise<ImageBitmap> =>
  createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });

export async function loadBackdrop(
  manifest: RidgeManifest,
  sky: PhysicalSky,
  deps: Partial<BackdropDeps> = {}
): Promise<Backdrop | null> {
  const get = deps.fetchBlob ?? fetchBlob;
  const light = deps.light ?? lightCards;
  const open: ImageBitmap[] = [];
  try {
    const files = manifest.cards.flatMap((c) => [c.colour, c.geometry]);
    const settled = await Promise.allSettled(
      files.map(async (f) => decode(await get(`${manifest.dir}${f}`)))
    );
    settled.forEach((s) => s.status === 'fulfilled' && open.push(s.value));
    const failed = settled.find((s) => s.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const bitmaps = manifest.cards.map((_, i) => ({
      colour: open[2 * i],
      geometry: open[2 * i + 1],
    }));
    return { manifest, cards: light(manifest, bitmaps, sky) };
  } catch {
    return null;
  } finally {
    open.forEach((b) => b.close?.());
  }
}
