import React, { useState } from 'react';
import { Box, Icon, Icons, MenuItem, Text } from 'folds';
import { setCamera } from '../cameraState';
import type { CameraChoice } from '../cameraState';
import { useCamera, useCameraHeld } from '../../../hooks/useSceneView';
import type { RotationMode } from '../ridge/heading';
import type { RidgeManifest } from '../ridge/manifest';
import { maxSpeed, offsetRange, SPEED_CEILING_DEG_S, windowFor } from '../ridge/view';
import { useNativeChange } from './TimeSubmenu';

export const MODE_CHOICES: ReadonlyArray<{ mode: RotationMode; label: string }> = [
  { mode: 'still', label: 'No rotation' },
  { mode: 'offset', label: 'Rotate parallax offset only' },
  { mode: 'both', label: 'Rotate offset and view direction' },
];

const SPEED_STEP = 0.1;
const OFFSET_STEP = 5;

/** The speed slider's bounds: nothing to the fastest the baked place sustains in the mode picked (`view.ts` `maxSpeed`), the ceiling with no bake to ask. */
export const speedBounds = (
  manifest: RidgeManifest | undefined,
  mode: RotationMode
): [number, number] => [
  0,
  Math.floor((manifest ? maxSpeed(manifest, mode) : SPEED_CEILING_DEG_S) / SPEED_STEP) * SPEED_STEP,
];

/** The offset slider's bounds in metres, signed: `view.ts` `offsetRange` for the mode on this viewport, rounded in to the slider's step. */
export const offsetBounds = (
  manifest: RidgeManifest,
  size: { w: number; h: number },
  mode: RotationMode
): [number, number] => {
  const [lo, hi] = offsetRange(manifest, windowFor(manifest.view, size.w, size.h), mode);
  return [Math.ceil(lo / OFFSET_STEP) * OFFSET_STEP, Math.floor(hi / OFFSET_STEP) * OFFSET_STEP];
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const signed = (m: number): string => `${m > 0 ? '+' : ''}${m} m`;

/** A slider that commits on release (the native change event), the readout following the drag. */
function Slider({
  label,
  min,
  max,
  step,
  value,
  readout,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  readout: (v: number) => string;
  onCommit: (v: number) => void;
}) {
  const [shown, setShown] = useState(value);
  const ref = useNativeChange<HTMLInputElement>((el) => onCommit(Number(el.value)));
  return (
    <Box direction="Column" gap="100">
      <Box justifyContent="SpaceBetween" gap="200">
        <Text size="T300">{label}</Text>
        <Text size="T200" priority="300">
          {readout(shown)}
        </Text>
      </Box>
      <input
        ref={ref}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onInput={(evt) => setShown(Number(evt.currentTarget.value))}
      />
    </Box>
  );
}

/**
 * The View submenu of the scene view: the rotation mode, its speed and the camera's parallax offset, written to the camera store (`cameraState.ts`), which the
 * heading owner reads. The sliders commit on release; the speed is bounded by what the baked place sustains in the mode, the offset by `offsetRange`, which
 * is signed (ruling ridge-camera-offset-signed). Picking a mode resumes a rotation a manual turn held (ruling ridge-view-turn-handback).
 */
export function ViewSubmenu({
  manifest,
  size,
}: {
  manifest: RidgeManifest | undefined;
  /** The viewport the scene is drawn on, px: the offset's bound depends on it. */
  size: { w: number; h: number };
}) {
  const cam: CameraChoice = useCamera();
  const held = useCameraHeld();
  const [, speedMax] = speedBounds(manifest, cam.mode);
  const range = manifest ? offsetBounds(manifest, size, cam.mode) : undefined;
  return (
    <Box direction="Column" gap="300">
      <Box direction="Column" gap="100" role="radiogroup" aria-label="Rotation">
        {MODE_CHOICES.map(({ mode, label }) => {
          const checked = cam.mode === mode;
          return (
            <MenuItem
              key={mode}
              size="300"
              variant="Surface"
              radii="300"
              role="radio"
              aria-checked={checked}
              onClick={() => setCamera({ mode })}
              after={checked ? <Icon size="100" src={Icons.Check} /> : undefined}
            >
              <Box grow="Yes">
                <Text size="T300">{label}</Text>
              </Box>
            </MenuItem>
          );
        })}
        {held && (
          <Text size="T200" priority="300">
            Held where you turned it. Pick a rotation to let it turn again.
          </Text>
        )}
      </Box>
      <Slider
        key={`speed:${speedMax}`}
        label="Rotation speed"
        min={0}
        max={speedMax}
        step={SPEED_STEP}
        value={clamp(Math.abs(cam.speedDegPerS), 0, speedMax)}
        readout={(v) => `${v.toFixed(1)} deg/s`}
        onCommit={(speedDegPerS) => setCamera({ speedDegPerS })}
      />
      {range && (
        <Slider
          key={`offset:${range[0]}:${range[1]}`}
          label="Parallax offset"
          min={range[0]}
          max={range[1]}
          step={OFFSET_STEP}
          value={Math.round(clamp(cam.offsetM, range[0], range[1]))}
          readout={signed}
          onCommit={(offsetM) => setCamera({ offsetM })}
        />
      )}
    </Box>
  );
}
