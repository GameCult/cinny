import { Box, Checkbox, Text, color, config } from 'folds';
import React from 'react';

export const TRAINING_NOTICE =
  "Everything said on this server may be used to train GameCult's AI stewards. We never ingest Discord content.";

type TrainingNoticeProps = {
  // Registration passes this to require a ticked acknowledgement; login shows the notice only.
  acknowledge?: { checked: boolean; onToggle: () => void };
};

export function TrainingNotice({ acknowledge }: TrainingNoticeProps) {
  return (
    <Box
      direction="Column"
      gap="200"
      style={{
        padding: config.space.S300,
        borderRadius: config.radii.R300,
        backgroundColor: color.SurfaceVariant.Container,
        color: color.SurfaceVariant.OnContainer,
        border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
      }}
    >
      <Text size="T300">{TRAINING_NOTICE}</Text>
      {acknowledge && (
        <Text
          as="label"
          size="T300"
          style={{ display: 'flex', alignItems: 'center', gap: config.space.S200 }}
        >
          <Checkbox
            name="trainingAck"
            size="300"
            variant="Primary"
            required
            checked={acknowledge.checked}
            onClick={acknowledge.onToggle}
          />
          I understand and agree.
        </Text>
      )}
    </Box>
  );
}
