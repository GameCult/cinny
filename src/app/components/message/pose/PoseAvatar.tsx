import React, { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import * as css from '../layout/layout.css';
import { poseSrc } from './poses';
import { silhouette } from './silhouette';

type PoseAvatarProps = {
  mind: string;
  pose: string;
  userId: string;
  /** Float on the right on phones. */
  alt?: boolean;
  /** Play the first-appearance pop. */
  enter?: boolean;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
};

export function PoseAvatar({ mind, pose, userId, alt, enter, onClick }: PoseAvatarProps) {
  const src = poseSrc(mind, pose, import.meta.env.BASE_URL);
  const imgRef = useRef<HTMLImageElement>(null);
  const [shape, setShape] = useState<string>();

  // On phones the bubble text wraps around the portrait's silhouette. Retraced when the art
  // loads and when the portrait's width changes with the viewport.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    const trace = () => {
      if (!img.complete || img.naturalWidth === 0) return;
      try {
        setShape(silhouette(img, !alt));
      } catch {
        setShape(undefined);
      }
    };
    trace();
    img.addEventListener('load', trace);
    const resize = new ResizeObserver(trace);
    resize.observe(img);
    return () => {
      img.removeEventListener('load', trace);
      resize.disconnect();
    };
  }, [src, alt]);

  return (
    <button
      type="button"
      className={classNames(css.PoseButton, alt && css.PoseButtonAlt, enter && css.EnterPortrait)}
      style={{ shapeOutside: shape }}
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
    </button>
  );
}
