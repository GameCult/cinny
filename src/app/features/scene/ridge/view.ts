// The one View: where the sky's camera stands and looks, and where the ridge planes sit against it. A baked place's manifest
// (`view` and `place`, manifest v1) is a View; a sky with no planes uses FALLBACK_VIEW. `windowFor` is the single owner of the
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

/** The sky of a scene with no planes (a failed load): Vienna facing south-west, with the numbers of the six-key Vienna bake. */
export const FALLBACK_VIEW: View = {
  place: { id: 'vienna', lat: 48.1929826, lon: 16.3534237, altitudeKm: 0.183 },
  lookAzDeg: 214,
  windowDeg: 72,
  planeW: 1280,
  planeH: 600,
  pxPerDegH: 1280 / 72,
  horizonRow: 314.5,
};

/** The share of the viewport height the plane's height is at least scaled to, and the slack each side of the viewport kept for drift. Authored, tunable by eye. */
export const RIDGE_BAND_FRAC = 0.6;
export const DRIFT_FRAC = 0.05;

export interface Window {
  camera: Camera;
  /** The planes in viewport pixels: scaled size, anchored to the viewport's bottom edge and centred on `lookAzDeg`. */
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
      horizonAt: (viewportH - scale * (view.planeH - view.horizonRow)) / viewportH,
    },
    plane: { scale, w: scale * view.planeW, h: scale * view.planeH, bottom: 0 },
    driftPx: (scale * view.planeW - viewportW) / 2,
  };
}
