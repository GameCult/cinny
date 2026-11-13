import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

// Viewer headers and the UIA stages. The back/close button sits beside a title that is not tappable, so it is a
// plain PhoneHit; the zoom out/in buttons sit either side of a tappable zoom Chip, so they spread at their drawn
// 24 px (IconButton size 300 around a 16 px Icon).
// Not covered: the two scroll arrows of components/url-preview/UrlPreviewCard.tsx. They are position: absolute and
// PhoneHit sets position: relative on phones, which would pull them into the flow; they need a variant that keeps
// the position, which PhoneHit.css.ts does not have yet.
const files: [string, string[]][] = [
  ['components/uia-stages/PasswordStage.tsx', ['PhoneHit']],
  ['components/uia-stages/SSOStage.tsx', ['PhoneHit']],
  ['components/UIAFlowOverlay.tsx', ['PhoneHit']],
  ['components/text-viewer/TextViewer.tsx', ['PhoneHit']],
  ['components/image-editor/ImageEditor.tsx', ['PhoneHit']],
  ['components/image-viewer/ImageViewer.tsx', ['PhoneHit', 'PhoneHitSpread24', 'PhoneHitSpread24']],
  ['components/Pdf-viewer/PdfViewer.tsx', ['PhoneHit', 'PhoneHitSpread24', 'PhoneHitSpread24']],
];

describe.each(files)('phone hit area: %s', (file, want) => {
  it('gives each icon button the variant of its surroundings', () => {
    expectPhoneHitClasses(file, want);
  });
  it('ties each sized variant to the size the button draws', () => {
    expectSizeTie(file);
  });
});
