// The decoded planes the scene composes: only the frames the choice needs. Failure is a value (null), never a throw.
import type { FrameChoice } from './frameChoice';
import type { Frame, PlaneName, RidgeManifest } from './manifest';
import { PLANE_NAMES } from './manifest';

export type Planes = Record<PlaneName, HTMLImageElement>;

export interface Backdrop {
  manifest: RidgeManifest;
  choice: FrameChoice;
  /** Decoded planes of frame a, and of frame b when the choice has one. */
  a: Planes;
  b: Planes | null;
}

export type ImageLoader = (url: string) => Promise<HTMLImageElement>;

/** The browser's decoder: an <img> that has decoded, so the first paint does not wait on it. */
export const loadImage: ImageLoader = async (url) => {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
};

export async function loadBackdrop(
  manifest: RidgeManifest,
  choice: FrameChoice,
  load: ImageLoader = loadImage
): Promise<Backdrop | null> {
  const planes = async (f: Frame): Promise<Planes> => {
    const [far, mid, near] = await Promise.all(
      PLANE_NAMES.map((n) => load(`${manifest.dir}${f.planes[n]}`))
    );
    return { far, mid, near };
  };
  try {
    const [a, b] = await Promise.all([planes(choice.a), choice.b ? planes(choice.b) : null]);
    return { manifest, choice, a, b };
  } catch {
    return null;
  }
}
