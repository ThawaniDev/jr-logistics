/**
 * "State = base + the patches that happened before `asOf`".
 * Every generated entity (request, offer, parcel, ticket …) is built like the real code would have built it: a base row plus a list of timed patches
 * (some of them functions of the state before them, e.g. `slotsFilled + 1`). Patches may be added in any order; `state(asOf)` applies them in time order and
 * silently drops everything that has not happened yet — which is how the newest jobs end up "in progress" instead of finished.
 */
type Rec = Record<string, unknown>;
export type Patch<T> = Partial<T> | ((s: T) => Partial<T>);

export class Tl<T extends Rec> {
  private ps: Array<{ t: number; i: number; p: Patch<T> }> = [];
  constructor(readonly base: T, private readonly touchKey: string | null = "updatedAt") {}
  at(t: number, p: Patch<T>): this { this.ps.push({ t, i: this.ps.length, p }); return this; }
  private sorted() { return this.ps.slice().sort((a, b) => a.t - b.t || a.i - b.i); }
  state(asOf: number): T {
    let s: T = { ...this.base };
    let last = -Infinity;
    for (const { t, p } of this.sorted()) {
      if (t > asOf) break;
      s = { ...s, ...(typeof p === "function" ? p(s) : p) };
      last = t;
    }
    if (this.touchKey && last > -Infinity) (s as Rec)[this.touchKey] = new Date(last);
    return s;
  }
  /** Time of the last patch that has happened by `asOf` (null = none yet). */
  lastT(asOf: number): number | null { let l: number | null = null; for (const { t } of this.sorted()) { if (t > asOf) break; l = t; } return l; }
  /** True when at least one patch is still in the future. */
  pending(asOf: number): boolean { return this.ps.some((x) => x.t > asOf); }
}

/** Events recorded during the simulation; `emit` keeps only what has happened by `asOf`. */
export interface Timed { t: number }
export const upTo = <T extends Timed>(list: T[], asOf: number): T[] => list.filter((e) => e.t <= asOf).sort((a, b) => a.t - b.t);
