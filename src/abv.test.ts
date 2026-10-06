import { describe, expect, it } from 'vitest';
import { abv, abvAdvanced, abvSimple } from './abv';

/**
 * Golden values for both ABV formulas at known OG/FG pairs.
 *
 * Worked longhand, e.g. for 1.055 → 1.015:
 * ```
 * simple   = (1.055 − 1.015) × 131.25 = 0.040 × 131.25            = 5.250 %
 * advanced = 76.08 × 0.040 / (1.775 − 1.055) × (1.015 / 0.794)
 *          = 3.0432 / 0.720 × 1.278338 = 4.226667 × 1.278338      = 5.403 %
 * ```
 * Tolerance: 0.001 % absolute (3 decimal places), since both are closed forms.
 */
const GOLDEN: readonly (readonly [number, number, number, number])[] = [
  [1.055, 1.015, 5.25, 5.4031],
  [1.045, 1.01, 4.5937, 4.64],
  [1.06, 1.012, 6.3, 6.5098],
  [1.09, 1.02, 9.1875, 9.9875],
];

describe('abvSimple', () => {
  it.each(GOLDEN)('OG %f FG %f → %f %%', (og, fg, simple) => {
    expect(abvSimple(og, fg)).toBeCloseTo(simple, 3);
  });

  it('is exactly 131.25 points per gravity point', () => {
    expect(abvSimple(1.001, 1.0)).toBeCloseTo(0.13125, 9);
  });

  it('is zero when nothing fermented', () => {
    expect(abvSimple(1.05, 1.05)).toBe(0);
  });
});

describe('abvAdvanced', () => {
  it.each(GOLDEN)('OG %f FG %f → %f %%', (og, fg, _simple, advanced) => {
    expect(abvAdvanced(og, fg)).toBeCloseTo(advanced, 3);
  });

  it('is zero when nothing fermented', () => {
    expect(abvAdvanced(1.05, 1.05)).toBe(0);
  });

  it('agrees with the simple formula to within 0.2 %% at sessionable strengths', () => {
    expect(Math.abs(abvAdvanced(1.045, 1.01) - abvSimple(1.045, 1.01))).toBeLessThan(0.2);
  });

  it('diverges upward from the simple formula on big beers', () => {
    // This is why the engine defaults to the advanced formula.
    expect(abvAdvanced(1.09, 1.02)).toBeGreaterThan(abvSimple(1.09, 1.02) + 0.5);
  });

  it('is monotonic in the gravity drop', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let fg = 1.03; fg >= 1.0; fg -= 0.001) {
      const value = abvAdvanced(1.06, fg);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe('abv selector', () => {
  it('defaults to the advanced formula', () => {
    expect(abv(1.055, 1.015)).toBe(abvAdvanced(1.055, 1.015));
  });

  it('honours the simple selection', () => {
    expect(abv(1.055, 1.015, 'simple')).toBe(abvSimple(1.055, 1.015));
  });
});
