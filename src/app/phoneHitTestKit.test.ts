import { describe, expect, it } from 'vitest';
import { drawnPx, expectSizeTie, iconButtons } from './phoneHitTestKit';

describe('phone hit test kit', () => {
  it('reads <IconButton only, not a longer component name', () => {
    const src =
      '<IconButtonGroup><IconButton size="300"><Icon /></IconButton><IconButton\n/></IconButtonGroup>';
    expect(iconButtons(src).map((b) => b.tag)).toEqual([
      '<IconButton size="300">',
      '<IconButton\n/>',
    ]);
  });

  it('derives a drawn size from literal size props, defaults being 400', () => {
    expect(drawnPx('<IconButton size="300">', '<Icon size="50" />')).toEqual({ px: 24 });
    expect(drawnPx('<IconButton>', '<Icon />')).toEqual({ px: 40 });
  });

  it('reads <Icon only, not a longer component name', () => {
    expect(
      drawnPx('<IconButton size="300">', '<IconBadge size="100" /><Icon size="50" />')
    ).toEqual({
      px: 24,
    });
  });

  it('calls a size undetermined when props are spread into the IconButton or the Icon', () => {
    expect(drawnPx('<IconButton {...props}>', '<Icon size="50" />')).toHaveProperty('undetermined');
    expect(drawnPx('<IconButton size="300" {...props}>', '<Icon />')).toHaveProperty(
      'undetermined'
    );
    expect(drawnPx('<IconButton size="300">', '<Icon {...iconProps} />')).toHaveProperty(
      'undetermined'
    );
    expect(drawnPx('<IconButton size={size}>', '<Icon />')).toHaveProperty('undetermined');
  });

  it('fails a file with no IconButton, which would otherwise pass vacuously', () => {
    expect(() => expectSizeTie('styles/PhoneHit.css.ts')).toThrow(/no IconButton/);
  });
});
