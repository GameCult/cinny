import React from 'react';
import * as css from '../layout/layout.css';
import { poseSrc } from './poses';

type PoseAvatarProps = {
  mind: string;
  pose: string;
  userId: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
};

export function PoseAvatar({ mind, pose, userId, onClick }: PoseAvatarProps) {
  return (
    <button
      type="button"
      className={css.PoseButton}
      data-user-id={userId}
      data-pose={pose}
      onClick={onClick}
    >
      <img
        className={css.PosePortrait}
        src={poseSrc(mind, pose, import.meta.env.BASE_URL)}
        alt={`${mind}, ${pose}`}
        loading="lazy"
        draggable={false}
      />
    </button>
  );
}
