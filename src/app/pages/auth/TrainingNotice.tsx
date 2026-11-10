import { Box, Checkbox, Text, color, config } from 'folds';
import React from 'react';
import { useClientConfig } from '../../hooks/useClientConfig';
import { trainingNoticeText } from '../../utils/trainingNotice';

type TrainingNoticeProps = {
  checked: boolean;
  onToggle: () => void;
};

// Registration only: ticking it is the newcomer's acceptance of the current notice version.
export function TrainingNotice({ checked, onToggle }: TrainingNoticeProps) {
  const { previewDemo } = useClientConfig();
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
          checked={checked}
          onClick={onToggle}
        />
        {trainingNoticeText(previewDemo)}
      </Text>
    </Box>
  );
}
