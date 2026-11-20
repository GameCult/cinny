// The one View: where the sky's camera stands and looks, and where the ridge cards sit against it. A baked place's manifest
// (`view` and `place`, manifest v2) is a View; a sky with no planes uses FALLBACK_VIEW. `windowFor` is the single owner of the
// registration between sky and ridge: one View and a viewport in, the sky Camera and the plane's placement out. Nothing else
// chooses a field of view, a horizon row or an azimuth.

/** Where the observer stands. `id` names the baked place (it keys a rebuild); `altitudeKm` is the ground height, eye height excluded. */
export interface Place {
  id: string;
  lat: number;
  lon: number;
  altitudeKm: number;
}

/** The manifest's `view`: the baked window of the sky the planes cover. Angles are degrees, planes are in plane pixels. */
export interface ManifestView {
  /** Compass azimuth at the centre of the planes, degrees clockwise from north. */
  lookAzDeg: number;
  /** Horizontal angle the planes span. */
  windowDeg: number;
  planeW: number;
  planeH: number;
  pxPerDegH: number;
  /** Plane pixels per degree of elevation (the baker draws the vertical exaggerated: it is not `pxPerDegH`). */
  pxPerDegV: number;
  /** Row of the horizon in the plane, from its top. */
  horizonRow: number;
}

export interface View extends ManifestView {
  place: Place;
}

/**
 * The camera of the sky. Angle-linear, as the planes are (`pxPerDegH` is constant across a plane): a pixel's azimuth is
 * `azimuthDeg + (x - 0.5) * hfovDeg` and its elevation is `(horizonAt - y) * vfovDeg`, x and y as fractions of the viewport.
 */
export interface Camera {
  /** Compass azimuth at the centre column. */
  azimuthDeg: number;
  hfovDeg: number;
  vfovDeg: number;
  /** Where the horizon sits down the viewport, as a fraction of its height (0 top). */
  horizonAt: number;
}

/** The sky of a scene with no planes (a failed load): Vienna facing south-west, with the numbers of the Vienna bake. */
export const FALLBACK_VIEW: View = {
  place: { id: 'vienna', lat: 48.1929826, lon: 16.3534237, altitudeKm: 0.183 },
  lookAzDeg: 214,
  windowDeg: 72,
  planeW: 1280,
  planeH: 600,
  pxPerDegH: 1280 / 72,
  pxPerDegV: 177.8,
  horizonRow: 314.5,
};

/** The share of the viewport height the plane's height is at least scaled to, and the slack each side of the viewport kept for drift. Authored, tunable by eye. */
export const RIDGE_BAND_FRAC = 0.6;
export const DRIFT_FRAC = 0.05;
/**
 * Where the horizon sits down the viewport, as a fraction of its height: one constant for every sky state and every viewport (ruling
 * ridge-frame-more-sky-fixed-pitch: the camera pitch never changes between day and night). The plane extends below the viewport bottom and
 * the near plain is cropped. 0.95 shows about 35 degrees of sky above the horizon in a 16:9 cell. Authored, tunable by eye.
 */
export const HORIZON_AT = 0.95;

export interface Window {
  camera: Camera;
  /** The planes in viewport pixels: scaled size, centred on `lookAzDeg`, placed so the horizon row lands at `HORIZON_AT` of the height. `bottom` is the distance of the plane's foot above the viewport's bottom edge: negative, the plane runs on below it. */
  plane: { scale: number; w: number; h: number; bottom: number };
  /** How far the plane may slide sideways from centre and still cover the viewport. */
  driftPx: number;
}

export function windowFor(view: View, viewportW: number, viewportH: number): Window {
  const scale = Math.max(
    (RIDGE_BAND_FRAC * viewportH) / view.planeH,
    (viewportW * (1 + 2 * DRIFT_FRAC)) / view.planeW
  );
  const hfovDeg = viewportW / (scale * view.pxPerDegH);
  return {
    camera: {
      azimuthDeg: view.lookAzDeg,
      hfovDeg,
      vfovDeg: (hfovDeg * viewportH) / viewportW,
      horizonAt: HORIZON_AT,
    },
    plane: {
      scale,
      w: scale * view.planeW,
      h: scale * view.planeH,
      bottom: (1 - HORIZON_AT) * viewportH - scale * (view.planeH - view.horizonRow),
    },
    driftPx: (scale * view.planeW - viewportW) / 2,
  };
}

/** What `cardMotion` reads of a manifest: the cards' scales, the baker's heading range and the View. */
interface CardRig {
  view: View;
  camera: { headingMaxDeg: number };
  cards: readonly { scale: number }[];
}

export interface CardMotion {
  /** The heading either side of the look azimuth the drift turns through, degrees. */
  headingDeg: number;
  /** Per card, in manifest order (nearest first): the static scale the baker derived and how far it pans, in viewport px, at the end of the drift. */
  cards: { scale: number; reachPx: number }[];
}

/**
 * Where each card goes on a viewport: the single owner of pan reach and heading range (ruling ridge-camera-on-circle). The heading is the baker's
 * `headingMaxDeg` unless a card could no longer cover the viewport at it, so it is capped by the card that would uncover first: card i is `scale` times
 * wider on screen, and shown at heading delta d it needs `half viewport / scale + d x pxPerDegH` of its half width. Card i pans `scale` x heading x
 * `pxPerDegH` plane pixels, at the plane's scale. One scale per card on both axes; nothing is reprojected inside a card (ruling ridge-cards-per-card-slide).
 */
export function cardMotion(m: CardRig, win: Window): CardMotion {
  const half = (win.plane.w - 2 * win.driftPx) / (2 * win.plane.scale); // half the viewport, in plane px
  const cap = Math.min(
    ...m.cards.map((c) => (m.view.planeW / 2 - half / c.scale) / m.view.pxPerDegH)
  );
  const headingDeg = Math.max(0, Math.min(m.camera.headingMaxDeg, cap));
  return {
    headingDeg,
    cards: m.cards.map((c) => ({
      scale: c.scale,
      reachPx: c.scale * headingDeg * m.view.pxPerDegH * win.plane.scale,
    })),
  };
}
