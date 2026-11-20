/**
 * Deterministic random numbers for the demo-history generator: same seed → same data, on every machine.
 * `Rng` is a mulberry32 stream; `fork(label)` derives an independent stream (so adding a draw in one part of the generator
 * never shifts the data of another part); `unit(...)` is a stateless hash for "is driver 7 working on day 31?" style questions.
 */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

export class Rng {
  private a: number;
  constructor(public readonly seed: number) { this.a = seed >>> 0; }
  /** Uniform in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  fork(label: string | number): Rng { return new Rng(hashStr(`${this.seed}:${label}`)); }
  /** Integer in [lo, hi] (inclusive). */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  float(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** items = [value, weight][] */
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let x = this.next() * total;
    for (const [v, w] of items) { x -= w; if (x < 0) return v; }
    return items[items.length - 1][0];
  }
  /** Standard normal via Box–Muller. */
  gauss(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  normal(mean: number, sd: number): number { return mean + sd * this.gauss(); }
  /** Log-normal with the given MEDIAN and shape sigma. */
  logNormal(median: number, sigma: number): number { return median * Math.exp(sigma * this.gauss()); }
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 40) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const l = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= this.next(); } while (p > l);
    return k - 1;
  }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  sample<T>(arr: readonly T[], n: number): T[] { return this.shuffle(arr).slice(0, n); }
  /** Beta-ish skewed value in [0,1]: higher `a` pushes toward 1. */
  skew(a: number, b: number): number {
    // Johnk's generator for Beta(a, b), a,b > 0
    for (let i = 0; i < 50; i++) {
      const x = Math.pow(this.next(), 1 / a), y = Math.pow(this.next(), 1 / b);
      if (x + y <= 1 && x + y > 0) return x / (x + y);
    }
    return a / (a + b);
  }
}

/** Stateless deterministic uniform [0,1) from a seed and any keys. */
export function unit(seed: number, ...keys: Array<string | number>): number {
  return hashStr(`${seed}|${keys.join("|")}`) / 4294967296;
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round2 = (x: number) => Math.round(x * 100) / 100;
