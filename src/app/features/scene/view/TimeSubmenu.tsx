import React, { useEffect, useRef, useState } from 'react';
import { Box, config, Icon, Icons, MenuItem, Text } from 'folds';
import { useDrawnPlace, useSkyChoice } from '../../../hooks/useSkyState';
import { setSkyChoice, skyNow } from '../skyState';
import {
  FREE_DATE_MAX,
  FREE_DATE_MIN,
  MOMENT_IDS,
  isDate,
  seedFree,
  zoneName,
  zonedInstant,
} from '../ridge/skyMoment';
import type { MomentId, SkyChoice } from '../ridge/skyMoment';
import { FALLBACK_VIEW } from '../ridge/view';

export const MOMENT_LABEL: Record<MomentId, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  noon: 'Noon',
  golden: 'Golden hour',
  dusk: 'Dusk',
  night: 'Night',
};

export const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** What the panel calls a choice: Auto, the moment's name, or the free moment's place-local date and time. */
export function choiceLabel(c: SkyChoice): string {
  if (c.kind === 'auto') return 'Auto';
  return c.kind === 'named' ? MOMENT_LABEL[c.id] : `${c.date} ${hhmm(c.minutes)}`;
}

/** The choices the panel lists, in order. */
export const MENU_CHOICES: readonly SkyChoice[] = [
  { kind: 'auto' },
  ...MOMENT_IDS.map((id): SkyChoice => ({ kind: 'named', id })),
];

const sameChoice = (a: SkyChoice, b: SkyChoice): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Run `onChange` on the element's native `change` event: for a slider, its release, not every `input` tick (React's onChange is the
 * input event). Each commit rebuilds the scene or re-issues the rig, so a drag must commit once.
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
 * The Time submenu of the scene view: Auto, the six named moments of today at the place, and a free date and time (ruling ridge-sky-menu-moments, unchanged;
 * this is that menu's contents). A pick goes to the sky choice store, as the menu's did.
 */
export function TimeSubmenu() {
  const choice = useSkyChoice();
  const drawn = useDrawnPlace();
  const [picking, setPicking] = useState(false);
  const place = drawn ?? FALLBACK_VIEW.place;
  return (
    <Box direction="Column" gap="100" role="radiogroup" aria-label="Time">
      {MENU_CHOICES.map((c) => {
        const checked = sameChoice(c, choice);
        return (
          <MenuItem
            key={choiceLabel(c)}
            size="300"
            variant="Surface"
            radii="300"
            role="radio"
            aria-checked={checked}
            onClick={() => setSkyChoice(c)}
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
        role="radio"
        aria-checked={choice.kind === 'free'}
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
          onCommit={setSkyChoice}
        />
      )}
    </Box>
  );
}
