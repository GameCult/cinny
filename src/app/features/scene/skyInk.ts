// The one owner of ink for a sky state: which colour a sender name or a sidebar label wears over the scene,
// per fixed sky state (day, dusk, night) and viewport (phone or not). Pure: the hooks that read the resolved
// sky and the viewport (useSkyInk, hooks/useTheme.ts) only hand their values here.
//
// Names are bare ink over the terrain, so the theme's fitted colours (fitted against panel grounds, skyTokens.js)
// can land on the same luminance as the ridge behind them. The rule is measured, not tuned by eye: keep the
// colour's OKLCH hue and chroma and move its lightness (darker by day and dusk, lighter at night, in 0.005 steps)
// until it clears 4.5:1 (WCAG) against the LIGHTEST 24x12 patch of terrain under the timeline in that state
// and viewport. Measured 2026-11-10 on the demo's terrain scene at 1920x1080 and 390x844 (Chrome, SwiftShader,
// not a GPU; ratatoskr-sidebar-contrast-20261110/results.md, T3). These are the scene's own patches, not
// `skyBackdrop` (skyState.ts): that is the bare sky's extreme (day 0.90, dusk 0.97), which the terrain under the
// timeline never shows, and at night the terrain's snow (0.103, phone 0.149) is lighter than the sky (0.0816).
// Only a person whose theme is the sky's (no explicit theme of their own, sceneThemeId) wears this ink.
import chroma from 'chroma-js';
import { AA, luminance } from '../../../sky/skyTokens.js';
import { baked } from '../../../sky/baked';
import { indexColorMXID } from '../../../util/colorMXID';
import type { FixedSkyState } from './skyBand';
import type { SkyThemeId } from './skyTheme';

export interface SkyInk {
  readonly state: FixedSkyState;
  /** At or under the repo's mobile breakpoint (ScreenSize.Mobile, hooks/useScreenSize.ts); tablets read as desktop. */
  readonly phone: boolean;
}

/**
 * The ink in force: only while the page wears the sky's theme (`themeId`, from sceneThemeId, so a person's explicit
 * theme, which that function lets win over 'auto', keeps its own ink) and a scene runs behind it. Otherwise undefined.
 */
export const sceneInk = (
  themeId: SkyThemeId | undefined,
  sceneOn: boolean,
  state: FixedSkyState,
  phone: boolean
): SkyInk | undefined => (themeId && sceneOn ? { state, phone } : undefined);

/** WCAG relative luminance of the lightest 24x12 patch of terrain behind the timeline. */
export const LIGHTEST_PATCH: Record<FixedSkyState, { desktop: number; phone: number }> = {
  day: { desktop: 0.777, phone: 0.703 },
  dusk: { desktop: 0.531, phone: 0.4 },
  night: { desktop: 0.103, phone: 0.149 },
};

/** Night lightening stops here (OKLCH L): above it every hue reads white, and the hue is what names the sender. */
export const NIGHT_INK_MAX_L = 0.9;

const STEP = 0.005;
const SKY_COLORS = { noonday: baked.noonday.userColors, midnight: baked.midnight.userColors };

const inGamut = (l: number, c: number, h: number): string | undefined => {
  for (let k = c; k > 1e-4; k *= 0.97) {
    const out = chroma.oklch(l, k, h);
    if (!out.clipped()) return out.hex();
  }
  return chroma.oklch(l, 0, 0).hex();
};

/** The ink for a colour (#rrggbb) in this sky state and viewport: itself when it already clears the lightest patch. */
export function inkForState(hex: string, { state, phone }: SkyInk): string {
  if (!chroma.valid(hex)) return hex;
  const patch = LIGHTEST_PATCH[state][phone ? 'phone' : 'desktop'];
  const ratio = (h: string) => {
    const l = luminance(h);
    return (Math.max(l, patch) + 0.05) / (Math.min(l, patch) + 0.05);
  };
  if (ratio(hex) >= AA) return hex;
  const [l0, c0, h0] = chroma(hex).oklch();
  const hue = Number.isNaN(h0) ? 0 : h0;
  const dir = state === 'night' ? 1 : -1;
  let best = hex;
  for (let k = 1; k < 200; k += 1) {
    const l = l0 + dir * k * STEP;
    if (l < 0 || l > (state === 'night' ? NIGHT_INK_MAX_L : 1)) break;
    best = inGamut(l, c0, hue) ?? best;
    if (ratio(best) >= AA) break;
  }
  return best;
}

/** The ink of a user's hash colour (the --mx-uc-1..8 the theme would give) in this sky state and viewport. */
export function userColorInk(userId: string, ink: SkyInk): string {
  const palette = ink.state === 'night' ? SKY_COLORS.midnight : SKY_COLORS.noonday;
  return inkForState(palette[indexColorMXID(userId) - 1], ink);
}

/**
 * The sidebar label ink where it differs from the theme's. Phone Dusk: the dark ink #342d25 reached a median of 3.98:1
 * on the glyph pixels (worst 1.66); the same hue and chroma at OKLCH L 0.257 (#29221a) reaches 4.53 (worst 1.92),
 * measured over the shipped dusk phone shot, halo included. Nothing darker is searched for: the ridge's dusk ochre
 * sits at the dark ink's own luminance, so the worst pixels stay below 4.5. Every other state keeps the theme's
 * ink (undefined): desktop and night were measured as shipped.
 */
export const labelInk = ({ state, phone }: SkyInk): string | undefined =>
  state === 'dusk' && phone ? '#29221a' : undefined;

/**
 * WCAG relative luminance of the lightest pixel under the notice line above the composer on a phone: the dark
 * foreground ridge, the same in every state (measured 2026-11-10 from the Starfire phone shots at 390x844,
 * ratatoskr-dev-preview/phone-room-{day,dusk,night}.png, text region x 15-355 CSS px: median 0.0052, 90th percentile
 * 0.0089, rounded up to 0.01). The labelInk patches above are the lightest terrain behind the timeline; here the
 * ground is dark, so the ink must be light.
 */
export const NOTICE_GROUND = 0.01;

/**
 * The ink of the training-notice line above the composer where the theme's own does not clear AA there. On a phone the
 * line sits on the dark ridge in every state, but Noonday (day, dusk) wears dark ink, 1.2:1 at dusk by the numbers
 * above; Midnight's (night) is already light and stays (undefined). Desktop is unmeasured and stays.
 */
export const noticeInk = ({ state, phone }: SkyInk): string | undefined =>
  phone && state !== 'night' ? baked.midnight.tokens.SurfaceVariant.OnContainer : undefined;
