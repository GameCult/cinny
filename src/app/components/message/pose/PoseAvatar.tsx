import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import * as css from '../layout/layout.css';
import { poseSrc, safeBox } from './poses';
import { alphaBounds, nestView, type Box } from './nest';
import { silhouette } from './silhouette';

type PoseAvatarProps = {
  mind: string;
  pose: string;
  userId: string;
  /** Nest in the bubble's top-right corner instead of the top-left. */
  alt?: boolean;
  /** Play the first-appearance pop. */
  enter?: boolean;
  /** Without it the portrait is a plain image: no button, no tab stop. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

// Safe boxes derived from art's alpha, by source; the art is traced once.
const traced = new Map<string, { box: Box; size: [number, number] }>();
const trace = (img: HTMLImageElement, src: string) => {
  const hit = traced.get(src);
  if (hit) return hit;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return undefined;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.drawImage(img, 0, 0);
  const box = alphaBounds(ctx.getImageData(0, 0, w, h).data, w, h);
  if (!box) return undefined;
  const found = { box, size: [w, h] as [number, number] };
  traced.set(src, found);
  return found;
};

export function PoseAvatar({ mind, pose, userId, alt, enter, onClick }: PoseAvatarProps) {
  const src = poseSrc(mind, pose, import.meta.env.BASE_URL);
  const imgRef = useRef<HTMLImageElement>(null);
  const [shape, setShape] = useState<string>();
  const measured = safeBox(mind, pose);
  const [derived, setDerived] = useState<{ box: Box; size: [number, number] }>();
  const art = measured ?? (derived?.size ? derived : undefined);
  // Measured boxes are cropped by the share Aqua's numbers allow; a box traced from the alpha is
  // already tight to the art, so the bubble may take all of the transparent margin.
  const view = art && nestView(art.box, art.size, !!alt, measured ? undefined : 1);

  // Art with no measured box: find its extent when it loads.
  useEffect(() => {
    setDerived(undefined);
    const img = imgRef.current;
    if (!img || measured) return undefined;
    const find = () => {
      if (!img.complete || img.naturalWidth === 0) return;
      try {
        setDerived(trace(img, src));
      } catch {
        setDerived(undefined);
      }
    };
    find();
    img.addEventListener('load', find);
    return () => img.removeEventListener('load', find);
  }, [src, measured]);

  // The bubble text wraps around the portrait's silhouette. Retraced when the art loads, when its
  // crop is known, and when its width changes with the viewport.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    const retrace = () => {
      if (!img.complete || img.naturalWidth === 0) return;
      try {
        const box = img.parentElement;
        const style = getComputedStyle(img);
        setShape(
          silhouette(
            img,
            !alt,
            box
              ? {
                  x: 0 - parseFloat(style.marginLeft || '0'),
                  y: 0 - parseFloat(style.marginTop || '0'),
                  width: box.clientWidth,
                  height: box.clientHeight,
                }
              : undefined
          )
        );
      } catch {
        setShape(undefined);
      }
    };
    retrace();
    img.addEventListener('load', retrace);
    const resize = new ResizeObserver(retrace);
    resize.observe(img);
    return () => {
      img.removeEventListener('load', retrace);
      resize.disconnect();
    };
  }, [src, alt, view?.x, view?.y, view?.width, view?.height]);

  // Crop fractions are of the image's width, so one set serves every displayed size.
  const frac = (px: number) => `calc(${css.portraitWidth} * ${px / (art?.size[0] ?? 1)})`;
  const cropStyle =
    art && view
      ? ({
          '--pose-bw': frac(view.width),
          '--pose-bh': frac(view.height),
          '--pose-ix': frac(-view.x),
          '--pose-iy': frac(-view.y),
        } as React.CSSProperties)
      : undefined;

  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={classNames(css.PoseButton, alt && css.PoseButtonAlt, enter && css.EnterPortrait)}
      style={{ ...cropStyle, shapeOutside: shape }}
      data-user-id={userId}
      data-pose={pose}
      onClick={onClick}
    >
      <img
        ref={imgRef}
        className={css.PosePortrait}
        src={src}
        alt={`${mind}, ${pose}`}
        draggable={false}
      />
    </Tag>
  );
}
