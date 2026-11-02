/**
 * Keeps the part of CultMath's GLSL that a stage can reach. The vendored file is whole and never
 * edited; each stage compiles only the declarations its own source (and the source concatenated
 * beside it) names, directly or through other kept declarations. Overloads share a name and are
 * kept together.
 */

interface Decl {
  name: string;
  text: string;
}

const GUARD_OPEN = /^#ifndef\s+\w+\s*\n#define\s+\w+\s*\n/m;
const GUARD_CLOSE = /\n#endif\s*$/;

/** Name a top-level declaration defines: function, struct or const. */
function declName(text: string): string | undefined {
  const code = text.replace(/\/\/.*$/gm, '');
  if (!code.includes('{')) return /\b(\w+)\s*=/.exec(code)?.[1];
  return /\bstruct\s+(\w+)/.exec(code)?.[1] ?? /\b(\w+)\s*\(/.exec(code)?.[1];
}

/** Splits at brace depth 0: a declaration ends at the `;` or `}` that returns to depth 0. */
function declarations(body: string): Decl[] {
  const out: Decl[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '/' && body[i + 1] === '/') {
      const eol = body.indexOf('\n', i);
      i = eol < 0 ? body.length : eol;
    } else if (c === '{') {
      depth += 1;
    } else if ((c === '}' || c === ';') && depth - (c === '}' ? 1 : 0) === 0) {
      if (c === '}') depth -= 1;
      // a struct's closing brace is followed by `;`
      const end = c === '}' && /^\s*;/.test(body.slice(i + 1)) ? body.indexOf(';', i) : i;
      const text = body.slice(start, end + 1);
      const name = declName(text);
      if (name) out.push({ name, text });
      start = end + 1;
      i = end;
    } else if (c === '}') {
      depth -= 1;
    }
    i += 1;
  }
  return out;
}

const idents = (text: string): string[] => text.match(/\b[A-Za-z_]\w*\b/g) ?? [];

/** `library` trimmed to what `roots` reach; the include guard is kept. */
export function trimGlsl(library: string, roots: string[]): string {
  const open = GUARD_OPEN.exec(library)?.[0] ?? '';
  const close = GUARD_CLOSE.test(library) ? '\n#endif\n' : '';
  const body = library
    .slice(open ? library.indexOf(open) + open.length : 0)
    .replace(GUARD_CLOSE, '');
  const decls = declarations(body);
  const byName = new Map<string, Decl[]>();
  decls.forEach((d) => byName.set(d.name, [...(byName.get(d.name) ?? []), d]));

  const kept = new Set<Decl>();
  const queue = roots.flatMap(idents);
  while (queue.length) {
    const group = byName.get(queue.pop() ?? '');
    group?.forEach((d) => {
      if (kept.has(d)) return;
      kept.add(d);
      queue.push(...idents(d.text));
    });
  }
  const text = decls
    .filter((d) => kept.has(d))
    .map((d) => d.text.replace(/^\s*\n/, ''))
    .join('\n');
  return `${open}${text}${close}`;
}
