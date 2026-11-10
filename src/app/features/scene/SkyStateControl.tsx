import React, { MouseEventHandler, useState } from 'react';
import {
  Box,
  config,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
} from 'folds';
import FocusTrap from 'focus-trap-react';
import { stopPropagation } from '../../utils/keyboard';
import { useSkyState } from '../../hooks/useSkyState';
import { SKY_STATES, setSkyState, type SkyState } from './skyState';
import { useClientConfig } from '../../hooks/useClientConfig';
import {
  getSceneStyleOverride,
  SERVED_SCENE_STYLES,
  setSceneStyle,
  type ServedSceneStyle,
} from './sceneStyle';

const STYLE_LABEL: Record<ServedSceneStyle, string> = { terrain: 'Terrain', ridge: 'Ridges' };

const LABEL: Record<SkyState, string> = {
  auto: 'Auto',
  day: 'Day',
  dusk: 'Dusk',
  night: 'Night',
};

/**
 * One title-bar button that opens the four sky states. A single button, not a row, so the bar
 * still fits a 320 px phone beside the search button; the menu items carry the state names.
 */
export function SkyStateControl() {
  const state = useSkyState();
  const [cords, setCords] = useState<RectCords>();
  const configuredStyle = useClientConfig().backgroundScene?.style;
  const sceneStyle: ServedSceneStyle =
    getSceneStyleOverride() ?? (configuredStyle === 'terrain' ? 'terrain' : 'ridge');

  const open: MouseEventHandler<HTMLButtonElement> = (evt) => {
    setCords(evt.currentTarget.getBoundingClientRect());
  };

  return (
    <PopOut
      anchor={cords}
      position="Bottom"
      align="End"
      content={
        <FocusTrap
          focusTrapOptions={{
            initialFocus: '[aria-checked="true"]',
            returnFocusOnDeactivate: true,
            onDeactivate: () => setCords(undefined),
            clickOutsideDeactivates: true,
            isKeyForward: (evt: KeyboardEvent) => evt.key === 'ArrowDown',
            isKeyBackward: (evt: KeyboardEvent) => evt.key === 'ArrowUp',
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu role="menu" aria-label="Sky">
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              {SKY_STATES.map((s) => (
                <MenuItem
                  key={s}
                  size="300"
                  variant="Surface"
                  radii="300"
                  role="menuitemradio"
                  aria-checked={state === s}
                  onClick={() => {
                    setSkyState(s);
                    setCords(undefined);
                  }}
                  after={state === s ? <Icon size="100" src={Icons.Check} /> : undefined}
                >
                  <Box grow="Yes">
                    <Text size="T300">{LABEL[s]}</Text>
                  </Box>
                </MenuItem>
              ))}
              <Text
                size="L400"
                priority="300"
                style={{ padding: `${config.space.S200} ${config.space.S200} 0` }}
              >
                Background
              </Text>
              {SERVED_SCENE_STYLES.map((st) => (
                <MenuItem
                  key={st}
                  size="300"
                  variant="Surface"
                  radii="300"
                  role="menuitemradio"
                  aria-checked={sceneStyle === st}
                  onClick={() => {
                    setCords(undefined);
                    if (st !== sceneStyle) setSceneStyle(st);
                  }}
                  after={sceneStyle === st ? <Icon size="100" src={Icons.Check} /> : undefined}
                >
                  <Box grow="Yes">
                    <Text size="T300">{STYLE_LABEL[st]}</Text>
                  </Box>
                </MenuItem>
              ))}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <IconButton
        variant="Background"
        aria-label={`Sky: ${LABEL[state]}`}
        title={`Sky: ${LABEL[state]}`}
        aria-haspopup="menu"
        aria-expanded={!!cords}
        onClick={open}
      >
        <Icon src={Icons.Bulb} size="200" />
      </IconButton>
    </PopOut>
  );
}
