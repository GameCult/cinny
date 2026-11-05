import React from 'react';
import classNames from 'classnames';
import * as css from '../layout/layout.css';
import { poseSrc } from './poses';

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
  return (
    <button
      type="button"
      className={classNames(css.PoseButton, alt && css.PoseButtonAlt, enter && css.EnterPortrait)}
      // On phones the bubble text wraps around the portrait's silhouette.
      style={{ shapeOutside: `url(${src})` }}
      data-user-id={userId}
      data-pose={pose}
      onClick={onClick}
    >
      <img className={css.PosePortrait} src={src} alt={`${mind}, ${pose}`} draggable={false} />
    </button>
  );
}
