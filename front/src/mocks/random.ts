/** Детерминированный генератор: одинаковый seed — одинаковые данные. */
export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: string) {
  let a = hashString(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)];
export const between = (r: () => number, min: number, max: number) => min + r() * (max - min);
export const intBetween = (r: () => number, min: number, max: number) => Math.floor(between(r, min, max + 1));
