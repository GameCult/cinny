// A tiny label naming which terrain path is on screen ('full', 'low', 'still', or 'sky-only' where WebGL2 is missing),
// so a screenshot of a preview says what it shows. Built into preview builds only (VITE_PREVIEW_DEMO=1), or by `?tierlabel=1`.
const wanted = (): boolean =>
  import.meta.env?.VITE_PREVIEW_DEMO === '1' ||
  new URLSearchParams(window.location.search).get('tierlabel') === '1';

/** Adds the label to the canvas's parent; returns its remover, or null when no label is wanted. */
export function showTierLabel(canvas: HTMLCanvasElement, text: string): (() => void) | null {
  const parent = canvas.parentElement;
  if (!parent || !wanted()) return null;
  const el = document.createElement('div');
  el.textContent = `terrain · ${text}`;
  Object.assign(el.style, {
    position: 'absolute',
    left: '2px',
    top: '16px',
    font: '10px monospace',
    color: 'rgba(255,255,255,.75)',
    background: 'rgba(0,0,0,.4)',
    padding: '1px 5px',
    borderRadius: '3px',
    pointerEvents: 'none',
  });
  parent.appendChild(el);
  return () => el.remove();
}
