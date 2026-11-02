import { describe, expect, it } from 'vitest';
import { trimGlsl } from './cultmathTrim';
import { fragmentSource, Stage } from './shaderSource';
import cultmath from './shaders/CultMath.glsl?raw';

const LIB = `// header
#ifndef LIB_GLSL
#define LIB_GLSL
const float LIB_PI = 3.14;

float lib_half(float v) { return v * 0.5; }
vec2 lib_half(vec2 v) { return v * 0.5; }

// uses the constant and an overload set
float lib_pi_half(float v) { return lib_half(v) * LIB_PI; }

struct LibPair { float a; float b; };

LibPair lib_pair(float v) { LibPair p; p.a = v; p.b = lib_half(v); return p; }
float lib_unused(float v) { return v; }
#endif
`;

describe('trimGlsl', () => {
  it('keeps what a root names and what that reaches, and drops the rest', () => {
    const out = trimGlsl(LIB, ['float x = lib_pi_half(1.0);']);
    expect(out).toContain('lib_pi_half');
    expect(out).toContain('LIB_PI');
    expect(out).toContain('float lib_half');
    expect(out).toContain('vec2 lib_half'); // overloads stay together
    expect(out).not.toContain('lib_unused');
    expect(out).not.toContain('LibPair');
    expect(out).not.toContain('lib_pair');
  });

  it('keeps a struct that a kept function returns', () => {
    const out = trimGlsl(LIB, ['LibPair p = lib_pair(1.0);']);
    expect(out).toContain('struct LibPair');
    expect(out).toContain('lib_half');
    expect(out).not.toContain('lib_pi_half');
  });

  it('keeps the include guard balanced', () => {
    const out = trimGlsl(LIB, ['lib_half(1.0)']);
    expect(out).toMatch(/^#ifndef LIB_GLSL\n#define LIB_GLSL\n/);
    expect(out.trimEnd().endsWith('#endif')).toBe(true);
  });

  it('keeps nothing but the guard for a root that names nothing', () => {
    const out = trimGlsl(LIB, ['void main() {}']);
    expect(out).not.toContain('lib_');
    expect(out).toContain('#ifndef LIB_GLSL');
  });
});

describe('CultMath per shader stage', () => {
  const stages: Stage[] = ['terrain', 'atmosphere', 'resolve', 'composite'];
  const cultmathNames = (text: string) => new Set(text.match(/\bcultmath_\w+/g) ?? []);
  const defined = (src: string, name: string) =>
    new RegExp(`^\\s*(?:float|vec[234]|mat3|int|\\w+)\\s+${name}\\s*\\(`, 'm').test(src);

  it.each(stages)('%s defines every CultMath function it, or Phacelle, calls', (stage) => {
    const src = fragmentSource(stage);
    cultmathNames(src).forEach((n) => expect(defined(src, n), n).toBe(true));
  });

  it.each(stages)('%s is smaller than the whole library', (stage) => {
    expect(fragmentSource(stage).length).toBeLessThan(cultmath.length / 2);
  });

  it('puts the noise a stage calls in that stage and not in the others', () => {
    expect(fragmentSource('terrain')).toContain('cultmath_snoise');
    expect(fragmentSource('composite')).not.toContain('cultmath_snoise');
  });

  it('adds Phacelle to terrain alone, as its own file', () => {
    expect(fragmentSource('terrain')).toContain('cultmath_phacelle');
    stages
      .filter((s) => s !== 'terrain')
      .forEach((s) => expect(fragmentSource(s)).not.toContain('cultmath_phacelle'));
  });
});
