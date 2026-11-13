import { style } from '@vanilla-extract/css';
import { MOBILE_BREAKPOINT } from '../hooks/useScreenSize';

// Phone tap target for an icon button: on a phone the button's hit area is 44 x 44 px centred on the drawn
// button (a ::after the button's own click reaches), so nothing drawn changes size. A button with neighbours
// 44 px closer than that would take their taps, so the `Spread` classes also give it horizontal margin of half
// the shortfall: the row grows by that, on phones only, and the hit areas meet instead of overlapping.
// Vertical room is cheaper than horizontal on a phone, so only the horizontal axis pays.
export const PHONE_TAP = 44;
const PHONE = `screen and (max-width: ${MOBILE_BREAKPOINT}px)`;

const hitArea = {
  '@media': {
    [PHONE]: {
      content: '""',
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: `max(100%, ${PHONE_TAP}px)`,
      height: `max(100%, ${PHONE_TAP}px)`,
      transform: 'translate(-50%, -50%)',
    },
  },
} as const;

/** An icon button on its own: the hit area grows, nothing else moves. */
export const PhoneHit = style({
  '@media': { [PHONE]: { position: 'relative' } },
  selectors: { '&::after': hitArea },
});

/** For a button that is already positioned (absolute or fixed) by its own class: PhoneHit's `position: relative`
 * would fight that class by stylesheet order, and the positioned button already contains its ::after. */
export const PhoneHitInPlace = style({ selectors: { '&::after': hitArea } });

const spreads = new Map<number, string>();

/** An icon button in a row, `visual` px wide: the row opens up so its 44 px hit area meets its neighbours'. */
const spread = (visual: number) => {
  const cls = style(
    [PhoneHit, { '@media': { [PHONE]: { marginInline: (PHONE_TAP - visual) / 2 } } }],
    `PhoneHitSpread${visual}`
  );
  spreads.set(visual, cls);
  return cls;
};

export const PhoneHitSpread24 = spread(24);
export const PhoneHitSpread26 = spread(26);
export const PhoneHitSpread28 = spread(28);
export const PhoneHitSpread32 = spread(32);
export const PhoneHitSpread36 = spread(36);
export const PhoneHitSpread40 = spread(40);

/** For a button in a clipping container (a Menu's overflow hidden eats a hit area drawn outside the box): the row
 * opens up on both axes, so the 44 px sits inside the container. It is the Spread class of the same size plus the
 * block margin, so the two axes cannot disagree about the size. */
const room = (visual: number) => {
  const spreadClass = spreads.get(visual);
  if (!spreadClass) throw new Error(`PhoneHitRoom${visual} needs a PhoneHitSpread${visual}`);
  return style(
    [spreadClass, { '@media': { [PHONE]: { marginBlock: (PHONE_TAP - visual) / 2 } } }],
    `PhoneHitRoom${visual}`
  );
};

export const PhoneHitRoom26 = room(26);
export const PhoneHitRoom36 = room(36);
