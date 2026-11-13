import { describe, it } from 'vitest';
import { expectPhoneHitClasses, expectSizeTie } from './phoneHitTestKit';

// Every IconButton of the call bars carries the phone hit-area variant of its drawn size, in source order
// (mic, sound, video, share, chat; the menu button; the call-status mic, sound, video, share).
describe('icon buttons in the call controls', () => {
  it.each([
    ['features/call/Controls.tsx', Array(5).fill('PhoneHitSpread40')],
    ['features/call/CallControls.tsx', ['PhoneHitSpread40']],
    ['features/call-status/CallControl.tsx', Array(4).fill('PhoneHitSpread26')],
  ])('%s', (file, want) => {
    expectPhoneHitClasses(file as string, want as string[]);
    expectSizeTie(file as string);
  });
});
