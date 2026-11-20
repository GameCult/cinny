import React, { MouseEventHandler, useEffect, useRef, useState } from 'react';
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
import { useDrawnPlace, useSkyChoice } from '../../hooks/useSkyState';
import { pickSkyChoice, skyNow } from './skyState';
import {
  FREE_DATE_MAX,
  FREE_DATE_MIN,
  MOMENT_IDS,
  isDate,
  seedFree,
  zoneName,
  zonedInstant,
} from './ridge/skyMoment';
import type { MomentId, SkyChoice } from './ridge/skyMoment';
import { FALLBACK_VIEW } from './ridge/view';
import { loadManifest } from './ridge/manifest';
import {
  LINES_CREDIT,
  STARS_CREDIT,
  terrainCredit,
  WEATHER_CREDIT,
  WEATHER_CREDIT_URL,
  WEATHER_DATASET,
} from './ridge/credits';
import { useClientConfig } from '../../hooks/useClientConfig';
import { PhoneHit } from '../../styles/PhoneHit.css';

export const MOMENT_LABEL: Record<MomentId, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  noon: 'Noon',
  golden: 'Golden hour',
  dusk: 'Dusk',
  night: 'Night',
};

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** What the button and the menu call a choice: Auto, the moment's name, or the free moment's place-local date and time. */
export const choiceLabel = (c: SkyChoice): string =>
  c.kind === 'auto'
    ? 'Auto'
    : c.kind === 'named'
    ? MOMENT_LABEL[c.id]
    : `${c.date} ${hhmm(c.minutes)}`;

/** The choices the menu lists, in order. */
export const MENU_CHOICES: readonly SkyChoice[] = [
  { kind: 'auto' },
  ...MOMENT_IDS.map((id): SkyChoice => ({ kind: 'named', id })),
];

const sameChoice = (a: SkyChoice, b: SkyChoice): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Run `onChange` on the element's native `change` event: for a slider, its release, not every `input` tick (React's onChange is the
 * input event). Each commit rebuilds the scene, so a drag must commit once.
 */
export function useNativeChange<T extends HTMLElement>(onChange: (el: T) => void) {
  const ref = useRef<T>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const handler = () => latest.current(el);
    el.addEventListener('change', handler);
    return () => el.removeEventListener('change', handler);
  }, []);
  return ref;
}

type Free = Extract<SkyChoice, { kind: 'free' }>;

/** A date and a time of day at the place, committed when each input changes (the slider on release), never per `input` tick. */
export function SkyMomentPicker({
  seed,
  tz,
  onCommit,
}: {
  seed: Free;
  tz: string;
  onCommit: (c: Free) => void;
}) {
  const [minutes, setMinutes] = useState(seed.minutes);
  const at = useRef({ date: seed.date, minutes: seed.minutes });
  const dateRef = useNativeChange<HTMLInputElement>((el) => {
    if (!isDate(el.value) || el.value < FREE_DATE_MIN || el.value > FREE_DATE_MAX) return;
    at.current.date = el.value;
    onCommit({ kind: 'free', ...at.current });
  });
  const sliderRef = useNativeChange<HTMLInputElement>((el) => {
    at.current.minutes = Number(el.value);
    onCommit({ kind: 'free', ...at.current });
  });
  const zone = zoneName(zonedInstant(at.current.date, minutes, tz), tz);
  return (
    <Box direction="Column" gap="100" style={{ padding: config.space.S200 }}>
      <input
        ref={dateRef}
        type="date"
        aria-label="Date"
        min={FREE_DATE_MIN}
        max={FREE_DATE_MAX}
        defaultValue={seed.date}
      />
      <input
        ref={sliderRef}
        type="range"
        aria-label="Time of day"
        min={0}
        max={1439}
        step={5}
        defaultValue={seed.minutes}
        onInput={(evt) => setMinutes(Number(evt.currentTarget.value))}
      />
      <Text size="T200" priority="300">
        {hhmm(minutes)} {zone}
      </Text>
    </Box>
  );
}

/**
 * One title-bar button that opens the sky choices: Auto, the six named moments of today at the place, and a free date and time. A single
 * button, not a row, so the bar still fits a 320 px phone beside the search button; the menu items carry the names.
 */
export function SkyStateControl() {
  const choice = useSkyChoice();
  const drawn = useDrawnPlace();
  const [picking, setPicking] = useState(false);
  const [cords, setCords] = useState<RectCords>();
  const backgroundScene = useClientConfig().backgroundScene;

  const placeId = backgroundScene?.place;
  const place = drawn ?? FALLBACK_VIEW.place;
  const [credit, setCredit] = useState<string>();
  const ridgeOn = !!backgroundScene && backgroundScene.style !== 'raymarch';
  useEffect(() => {
    if (!ridgeOn) return undefined;
    let live = true;
    loadManifest(import.meta.env.BASE_URL, placeId).then(
      (m) => live && setCredit(terrainCredit(m)),
      () => live && setCredit(undefined)
    );
    return () => {
      live = false;
    };
  }, [ridgeOn, placeId]);
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
            onDeactivate: () => {
              setCords(undefined);
              setPicking(false);
            },
            clickOutsideDeactivates: true,
            isKeyForward: (evt: KeyboardEvent) =>
              evt.key === 'ArrowDown' && !(evt.target instanceof HTMLInputElement),
            isKeyBackward: (evt: KeyboardEvent) =>
              evt.key === 'ArrowUp' && !(evt.target instanceof HTMLInputElement),
            escapeDeactivates: stopPropagation,
          }}
        >
          <Menu role="menu" aria-label="Sky">
            <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
              {MENU_CHOICES.map((c) => {
                const checked = sameChoice(c, choice);
                return (
                  <MenuItem
                    key={choiceLabel(c)}
                    size="300"
                    variant="Surface"
                    radii="300"
                    role="menuitemradio"
                    aria-checked={checked}
                    onClick={() => {
                      pickSkyChoice(c);
                      setCords(undefined);
                    }}
                    after={checked ? <Icon size="100" src={Icons.Check} /> : undefined}
                  >
                    <Box grow="Yes">
                      <Text size="T300">{choiceLabel(c)}</Text>
                    </Box>
                  </MenuItem>
                );
              })}
              <MenuItem
                size="300"
                variant="Surface"
                radii="300"
                role="menuitemradio"
                aria-checked={choice.kind === 'free'}
                aria-expanded={picking}
                onClick={() => setPicking(!picking)}
                after={choice.kind === 'free' ? <Icon size="100" src={Icons.Check} /> : undefined}
              >
                <Box grow="Yes">
                  <Text size="T300">Pick a moment</Text>
                </Box>
              </MenuItem>
              {picking && (
                <SkyMomentPicker
                  seed={seedFree(choice, place, skyNow())}
                  tz={place.tz}
                  onCommit={pickSkyChoice}
                />
              )}
              {ridgeOn && (
                <Box
                  direction="Column"
                  gap="100"
                  style={{ padding: `${config.space.S200}`, maxWidth: '20rem' }}
                >
                  <Text size="L400" priority="300">
                    Data
                  </Text>
                  {credit && (
                    <Text size="T200" priority="300">
                      {credit}
                    </Text>
                  )}
                  <Text size="T200" priority="300">
                    Datenquelle: GeoSphere Austria -{' '}
                    <a href={WEATHER_CREDIT_URL} target="_blank" rel="noreferrer noopener">
                      {WEATHER_CREDIT_URL}
                    </a>
                    . {WEATHER_DATASET}.
                  </Text>
                  <Text size="T200" priority="300">
                    {STARS_CREDIT}.
                  </Text>
                  <Text size="T200" priority="300">
                    {LINES_CREDIT}.
                  </Text>
                </Box>
              )}
            </Box>
          </Menu>
        </FocusTrap>
      }
    >
      <IconButton
        className={PhoneHit}
        variant="Background"
        aria-label={`Sky: ${choiceLabel(choice)}`}
        title={`Sky: ${choiceLabel(choice)}`}
        aria-haspopup="menu"
        aria-expanded={!!cords}
        onClick={open}
      >
        <Icon src={Icons.Bulb} size="200" />
      </IconButton>
    </PopOut>
  );
}
