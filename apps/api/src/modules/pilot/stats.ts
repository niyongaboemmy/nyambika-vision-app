/** Small, dependency-free statistics for the pilot dashboard. */

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 erf approximation, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface ZTest {
  pA: number;
  pB: number;
  /** pB − pA (absolute lift). */
  diff: number;
  /** (pB − pA) / pA, null when pA = 0. */
  lift: number | null;
  z: number | null;
  /** Two-sided p-value. */
  p: number | null;
  significant: boolean;
  /** 95% CI of the difference (unpooled standard error). */
  ci: [number, number] | null;
}

/**
 * Pooled two-proportion z-test, arm B against control A. Returns nulls when either arm is empty
 * or the pooled variance is zero (both 0% or both 100%).
 */
export function zTest(xA: number, nA: number, xB: number, nB: number, alpha = 0.05): ZTest {
  const pA = nA ? xA / nA : 0;
  const pB = nB ? xB / nB : 0;
  const diff = pB - pA;
  const lift = pA > 0 ? diff / pA : null;
  if (!nA || !nB) return { pA, pB, diff, lift, z: null, p: null, significant: false, ci: null };
  const pool = (xA + xB) / (nA + nB);
  const se = Math.sqrt(pool * (1 - pool) * (1 / nA + 1 / nB));
  const seU = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const ci: [number, number] = [diff - 1.959964 * seU, diff + 1.959964 * seU];
  if (se === 0) return { pA, pB, diff, lift, z: null, p: null, significant: false, ci };
  const z = diff / se;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { pA, pB, diff, lift, z, p, significant: p < alpha, ci };
}

/** Linear-interpolated percentile (q in [0, 1]); null for an empty sample. */
export function percentile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Net Promoter Score (−100..100) from 0–10 answers; null when there are none. */
export function nps(scores: number[]): number | null {
  if (!scores.length) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}
