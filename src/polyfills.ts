/* eslint-disable no-extend-native, func-names */
// Safari 14 (iPadOS 14) lacks these; the bundle (ours and matrix-js-sdk) calls them at runtime. Safari 15.4 has all.
// Loaded first by src/index.tsx. Each is installed only when missing.

function at<T>(this: ArrayLike<T>, n: number): T | undefined {
  const len = this.length;
  const i = Math.trunc(n) || 0;
  const k = i < 0 ? len + i : i;
  return k < 0 || k >= len ? undefined : this[k];
}
if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', { value: at, writable: true, configurable: true });
if (!String.prototype.at)
  Object.defineProperty(String.prototype, 'at', { value: at, writable: true, configurable: true });

if (!(Array.prototype as unknown as Record<string, unknown>).findLast)
  Object.defineProperty(Array.prototype, 'findLast', {
    value: function <T>(this: T[], fn: (v: T, i: number, a: T[]) => unknown, thisArg?: unknown) {
      for (let i = this.length - 1; i >= 0; i -= 1) if (fn.call(thisArg, this[i], i, this)) return this[i];
      return undefined;
    },
    writable: true,
    configurable: true,
  });
if (!(Array.prototype as unknown as Record<string, unknown>).findLastIndex)
  Object.defineProperty(Array.prototype, 'findLastIndex', {
    value: function <T>(this: T[], fn: (v: T, i: number, a: T[]) => unknown, thisArg?: unknown) {
      for (let i = this.length - 1; i >= 0; i -= 1) if (fn.call(thisArg, this[i], i, this)) return i;
      return -1;
    },
    writable: true,
    configurable: true,
  });

if (!(Object as unknown as Record<string, unknown>).hasOwn)
  Object.defineProperty(Object, 'hasOwn', {
    value: (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k),
    writable: true,
    configurable: true,
  });

// Structured clone for the data the client clones: plain objects, arrays, Map, Set, Date, RegExp, typed arrays, with cycles.
if (typeof (globalThis as { structuredClone?: unknown }).structuredClone !== 'function') {
  const clone = (v: unknown, seen: Map<unknown, unknown>): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return new RegExp(v.source, v.flags);
    if (ArrayBuffer.isView(v)) return (v as unknown as { slice: () => unknown }).slice();
    if (v instanceof ArrayBuffer) return v.slice(0);
    if (v instanceof Map) {
      const m = new Map();
      seen.set(v, m);
      v.forEach((val, key) => m.set(clone(key, seen), clone(val, seen)));
      return m;
    }
    if (v instanceof Set) {
      const s = new Set();
      seen.set(v, s);
      v.forEach((val) => s.add(clone(val, seen)));
      return s;
    }
    const out: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : {};
    seen.set(v, out);
    Object.keys(v).forEach((k) => {
      (out as Record<string, unknown>)[k] = clone((v as Record<string, unknown>)[k], seen);
    });
    return out;
  };
  (globalThis as { structuredClone?: unknown }).structuredClone = (v: unknown) => clone(v, new Map());
}

export {};
