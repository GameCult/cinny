import { Text, color, config } from 'folds';
import React from 'react';
import { TRAINING_NOTICE_TEXT } from '../../utils/trainingNotice';

// One line per room, pinned above the composer.
export function RoomTrainingLine() {
  return (
    <Text
      size="T200"
      style={{ padding: `${config.space.S100} 0`, color: color.SurfaceVariant.OnContainer }}
    >
      {TRAINING_NOTICE_TEXT}
    </Text>
  );
}
