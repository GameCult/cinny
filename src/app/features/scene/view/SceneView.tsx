import React, { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, IconButton, Icons } from 'folds';
import FocusTrap from 'focus-trap-react';
import { PhoneHit } from '../../../styles/PhoneHit.css';
import { useRidgeManifest, useSceneViewState } from '../../../hooks/useSceneView';
import { closeSceneView, setSubmenu } from '../sceneView';
import type { Submenu } from '../sceneView';
import { FALLBACK_VIEW } from '../ridge/view';
import * as css from './SceneView.css';
import { createTurner, pxPerDegreeOf } from './turning';
import { PlaceSubmenu } from './PlaceSubmenu';
import { SkySubmenu } from './SkySubmenu';
import { TimeSubmenu } from './TimeSubmenu';
import { ViewSubmenu } from './ViewSubmenu';

type IconSrc = React.ComponentProps<typeof Icon>['src'];

/** The rail after Return, in order. */
export const SUBMENUS: ReadonlyArray<{ id: Submenu; label: string; icon: IconSrc }> = [
  { id: 'view', label: 'View', icon: Icons.Eye },
  { id: 'time', label: 'Time', icon: Icons.Clock },
  { id: 'sky', label: 'Sky', icon: Icons.Star },
  { id: 'place', label: 'Place', icon: Icons.Pin },
];

/** One icon of the rail: 44 px to tap on a phone (PhoneHit). */
function RailButton({
  label,
  icon,
  pressed,
  tabIndex,
  buttonRef,
  onClick,
}: {
  label: string;
  icon: IconSrc;
  pressed?: boolean;
  tabIndex: number;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onClick: () => void;
}) {
  return (
    <IconButton
      ref={buttonRef}
      className={PhoneHit}
      variant="Background"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      tabIndex={tabIndex}
      onClick={onClick}
    >
      <Icon src={icon} size="200" />
    </IconButton>
  );
}

/**
 * The icon rail, a vertical toolbar: Return first, then a submenu each. Roving focus: one stop in the Tab order, the arrow keys (Home, End) move along it.
 * `active` is the submenu whose panel is up.
 */
export function Rail({
  items,
  active,
  onReturn,
  onPick,
}: {
  items: typeof SUBMENUS;
  active: Submenu | undefined;
  onReturn: () => void;
  onPick: (id: Submenu) => void;
}) {
  const [stop, setStop] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const count = items.length + 1;
  const goTo = (to: number) => {
    const next = (to + count) % count;
    setStop(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (evt: KeyboardEvent) => {
    const moves: Record<string, number | undefined> = {
      ArrowDown: stop + 1,
      ArrowUp: stop - 1,
      Home: 0,
      End: count - 1,
    };
    const to = moves[evt.key];
    if (typeof to !== 'number') return;
    evt.preventDefault();
    goTo(to);
  };
  return (
    <div
      className={css.Rail}
      role="toolbar"
      aria-label="Scene view"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
    >
      <RailButton
        label="Return"
        icon={Icons.ArrowLeft}
        tabIndex={stop === 0 ? 0 : -1}
        buttonRef={(el) => {
          buttons.current[0] = el;
        }}
        onClick={onReturn}
      />
      {items.map((item, i) => (
        <RailButton
          key={item.id}
          label={item.label}
          icon={item.icon}
          pressed={active === item.id}
          tabIndex={stop === i + 1 ? 0 : -1}
          buttonRef={(el) => {
            buttons.current[i + 1] = el;
          }}
          onClick={() => {
            setStop(i + 1);
            onPick(item.id);
          }}
        />
      ))}
    </div>
  );
}

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLSelectElement ||
  t instanceof HTMLTextAreaElement;

/**
 * The scene view (sceneView.ts opens it): the whole viewport is a surface that turns the view by hand, and over it, top left, the rail of submenus and the
 * one panel that is up. Return, Escape and the browser's Back all close it. The chat behind it stays mounted; nothing here navigates.
 */
export default function SceneView() {
  const { submenu } = useSceneViewState();
  const manifest = useRidgeManifest();
  const surface = useRef<HTMLDivElement>(null);
  const [turning, setTurning] = useState(false);
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    const read = () => {
      const el = surface.current;
      setSize({
        w: el?.clientWidth || window.innerWidth,
        h: el?.clientHeight || window.innerHeight,
      });
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  // The turner reads the viewport and the place at each event, so a resize or a late manifest changes nothing it holds.
  const latest = useRef({ manifest, size });
  latest.current = { manifest, size };
  const turner = useMemo(
    () =>
      createTurner(() =>
        pxPerDegreeOf(
          latest.current.manifest?.view ?? FALLBACK_VIEW,
          latest.current.size.w,
          latest.current.size.h
        )
      ),
    []
  );

  useEffect(() => {
    const onKey = (evt: globalThis.KeyboardEvent) => {
      if (evt.key === 'Escape') {
        evt.stopPropagation();
        closeSceneView();
      } else if (!typing(evt.target) && !evt.altKey && !evt.ctrlKey && !evt.metaKey) {
        if (turner.key(evt.key, evt.shiftKey)) evt.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turner]);

  const release = () => {
    turner.up();
    setTurning(false);
  };

  return (
    <FocusTrap
      focusTrapOptions={{
        initialFocus: '[aria-label="Return"]',
        fallbackFocus: '[aria-label="Return"]',
        escapeDeactivates: false,
        returnFocusOnDeactivate: false,
        allowOutsideClick: true,
      }}
    >
      <div className={css.Root} data-turning={turning}>
        <div
          ref={surface}
          className={css.Surface}
          onPointerDown={(evt) => {
            if (!evt.isPrimary || (evt.pointerType === 'mouse' && evt.button !== 0)) return;
            evt.currentTarget.setPointerCapture?.(evt.pointerId);
            turner.down(evt.clientX);
            setTurning(true);
          }}
          onPointerMove={(evt) => turner.move(evt.clientX)}
          onPointerUp={release}
          onPointerCancel={release}
          onWheel={(evt) => {
            if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY)) turner.wheel(evt.deltaX);
          }}
        />
        <div className={css.Chrome}>
          <Rail items={SUBMENUS} active={submenu} onReturn={closeSceneView} onPick={setSubmenu} />
          {submenu && (
            <section
              className={css.Panel}
              aria-label={SUBMENUS.find((s) => s.id === submenu)?.label}
            >
              {submenu === 'view' && <ViewSubmenu manifest={manifest} size={size} />}
              {submenu === 'time' && <TimeSubmenu />}
              {submenu === 'sky' && <SkySubmenu />}
              {submenu === 'place' && <PlaceSubmenu manifest={manifest} />}
            </section>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}
