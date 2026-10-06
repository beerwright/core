/**
 * Starter calculator golden values.
 *
 * There are two kinds of test here.
 *
 * Transcription tests pin Braukaiser's published model point by point. They're
 * exact: the numbers come from arithmetic on coefficients he printed, so the
 * tolerance is floating-point noise, not experimental error. If one of these
 * fails, someone has changed the model's constants.
 *
 * Worked examples run a real batch end to end, computed longhand in the
 * comment above each one so a reader can check the result by hand. Their
 * tolerance is 0.1 billion cells, which only allows for rounding. The model's
 * own accuracy is Kai's "+/- 15 % or more". These tests only check that the
 * code computes the model correctly.
 *
 * Source for every published figure:
 * <http://braukaiser.com/blog/blog/2012/11/03/estimating-yeast-growth/>
 * (currently 500ing; archived at
 * <http://web.archive.org/web/20200106150147id_/http://braukaiser.com/blog/blog/2012/11/03/estimating-yeast-growth/>),
 * cross-checked against Brewer's Friend's and Homebrew Dad's implementations.
 */

import { describe, expect, it } from 'vitest';
import {
  ALE_PITCH_RATE,
  availableCells,
  CELLS_PER_GRAM_DRY_BILLION,
  CELLS_PER_LIQUID_PACK_BILLION,
  DRY_SACHET_GRAMS,
  dryYeastSachets,
  GROWTH_CEASES_INOCULATION_RATE,
  LAGER_PITCH_RATE,
  LOW_PITCH_RATE,
  MAX_GROWTH_PER_GRAM,
  packViability,
  planStarter,
  STARTER_DME_GRAMS_PER_LITRE,
  slurryViability,
  starterDmeGrams,
  starterGrowth,
  starterGrowthRate,
  starterVolumeL,
  targetPitchCells,
  UNSTIRRED_GROWTH_PER_GRAM,
} from './starter';
import { sgToPlato } from './units/gravity';

/** Dates are offsets from a fixed "now", so the tests don't change over time. */
const NOW = new Date('2026-05-30T00:00:00.000Z');
const daysBefore = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('pitch rates', () => {
  it('carries the White & Zainasheff figures', () => {
    expect(ALE_PITCH_RATE).toBe(0.75);
    expect(LAGER_PITCH_RATE).toBe(1.5);
    expect(LAGER_PITCH_RATE).toBe(2 * ALE_PITCH_RATE);
    expect(LOW_PITCH_RATE).toBeLessThan(ALE_PITCH_RATE);
  });

  /**
   * 19 L of 1.048 ale wort at the standard ale rate, longhand:
   * ```
   * °P    = −616.868 + 1111.14×1.048 − 630.272×1.048² + 135.997×1.048³
   *       = −616.868 + 1164.4747 − 692.2303 + 156.5356
   *       = 11.9121 °P
   * cells = 0.75 × 19 × 11.9121 = 169.75 bn
   * ```
   * **Tolerance: 0.01 bn.**
   */
  it('needs 169.7 bn cells for 19 L of 1.048 at the ale rate', () => {
    expect(sgToPlato(1.048)).toBeCloseTo(11.9121, 4);
    expect(targetPitchCells(19, 1.048, ALE_PITCH_RATE)).toBeCloseTo(169.75, 2);
  });

  it('doubles for a lager and scales with volume and gravity', () => {
    const ale = targetPitchCells(19, 1.048, ALE_PITCH_RATE);
    expect(targetPitchCells(19, 1.048, LAGER_PITCH_RATE)).toBeCloseTo(2 * ale, 9);
    expect(targetPitchCells(38, 1.048, ALE_PITCH_RATE)).toBeCloseTo(2 * ale, 9);
    expect(targetPitchCells(19, 1.09, ALE_PITCH_RATE)).toBeGreaterThan(ale);
  });

  it('is zero for water and for no wort', () => {
    expect(targetPitchCells(19, 1.0, ALE_PITCH_RATE)).toBe(0);
    expect(targetPitchCells(0, 1.048, ALE_PITCH_RATE)).toBe(0);
  });
});

describe('viability', () => {
  /**
   * The same decay curve `yeast.ts` uses. See `packViability` for why the
   * starter calculator doesn't use a separate linear one.
   * ```
   * 30 d:  0.79^1 = 0.790
   * 90 d:  0.79^3 = 0.4930
   * 180 d: 0.79^6 = 0.2431
   * ```
   */
  it.each([
    [0, 1],
    [30, 0.79],
    [90, 0.493039],
    [180, 0.2430874],
  ])('a liquid pack %i days old is %f viable', (days, expected) => {
    expect(packViability(daysBefore(days), NOW, 'liquid')).toBeCloseTo(expected, 6);
  });

  it('decays a White Labs pack on White Labs’ own curve, known by its name', () => {
    // 0.946^5 for a five-month-old pouch. The liquid default would give 31 %.
    expect(
      packViability(daysBefore(150), NOW, 'liquid', 'White Labs California Ale Yeast®'),
    ).toBeCloseTo(0.7576, 3);
    expect(packViability(daysBefore(150), NOW, 'liquid', 'Wyeast 1056')).toBeCloseTo(0.3077, 3);
  });

  it('decays dry yeast far more slowly', () => {
    expect(packViability(daysBefore(90), NOW, 'dry')).toBeCloseTo(0.884736, 6);
  });

  it('never rises with age', () => {
    for (const form of ['liquid', 'dry'] as const) {
      let previous = Number.POSITIVE_INFINITY;
      for (let days = 0; days <= 720; days += 15) {
        const viability = packViability(daysBefore(days), NOW, form);
        expect(viability).toBeLessThanOrEqual(previous);
        expect(viability).toBeGreaterThan(0);
        previous = viability;
      }
    }
  });

  /**
   * Harvested slurry uses the liquid curve, counted from the harvest date. The
   * reasoning, and the fact that there's no measurement behind it, are on
   * `slurryViability`.
   */
  it('decays a harvested slurry on the liquid curve, not the dry one', () => {
    for (const days of [0, 14, 30, 90, 180]) {
      expect(slurryViability(daysBefore(days), NOW)).toBe(
        packViability(daysBefore(days), NOW, 'liquid'),
      );
    }
    expect(slurryViability(daysBefore(90), NOW)).not.toBeCloseTo(
      packViability(daysBefore(90), NOW, 'dry'),
      3,
    );
  });

  it('reads about half-fresh at three months, which is all it claims', () => {
    expect(Math.round(slurryViability(daysBefore(90), NOW) * 100)).toBe(49);
  });
});

describe('cells on hand', () => {
  it('uses the lab conventions', () => {
    expect(CELLS_PER_LIQUID_PACK_BILLION).toBe(100);
    expect(CELLS_PER_GRAM_DRY_BILLION).toBe(10);
    expect(availableCells({ form: 'liquid', packs: 2 }, 1)).toBe(200);
    expect(availableCells({ form: 'dry', gramsDry: 11.5 }, 1)).toBe(115);
    // A dry entry counted in sachets instead of grams.
    expect(availableCells({ form: 'dry', packs: 2 }, 1)).toBe(2 * DRY_SACHET_GRAMS * 10);
  });

  it('applies viability and accepts per-lab overrides', () => {
    expect(availableCells({ form: 'liquid', packs: 1 }, 0.5)).toBe(50);
    expect(availableCells({ form: 'liquid', packs: 1, cellsPerPackBillion: 200 }, 1)).toBe(200);
    expect(availableCells({ form: 'dry', gramsDry: 10, cellsPerGramBillion: 6 }, 1)).toBe(60);
  });

  it('cannot go negative', () => {
    expect(availableCells({ form: 'liquid', packs: -1 }, 1)).toBe(0);
    expect(availableCells({ form: 'liquid', packs: 1 }, -1)).toBe(0);
  });
});

describe('dry yeast', () => {
  /**
   * The dry branch is a division, and it never offers a starter. See
   * `dryYeastSachets` for why a starter makes a dry pitch worse. 19 L of 1.048
   * needs 169.75 bn. An 11.5 g sachet at the 10 bn/g convention is 115 bn, so
   * 169.75 / 115 = 1.48 → 2 sachets, 23 g, 230 bn.
   */
  it('rounds up to whole sachets', () => {
    const plan = dryYeastSachets(targetPitchCells(19, 1.048, ALE_PITCH_RATE));
    expect(plan.sachets).toBe(2);
    expect(plan.gramsDry).toBeCloseTo(23, 6);
    expect(plan.cellsBillion).toBeCloseTo(230, 6);
  });

  it('takes the lab figures and the viability of what is on the shelf', () => {
    expect(dryYeastSachets(500, { gramsPerSachet: 500, cellsPerGramBillion: 10 }).sachets).toBe(1);
    // Half-viable sachets go half as far, so twice as many are needed. 460 bn
    // is four fresh sachets with nothing left over, so rounding doesn't affect it.
    expect(dryYeastSachets(460).sachets).toBe(4);
    expect(dryYeastSachets(460, { viability: 0.5 }).sachets).toBe(8);
  });

  it('needs none for no pitch', () => {
    expect(dryYeastSachets(0).sachets).toBe(0);
  });
});

describe('starter wort', () => {
  it('is the 10:1 water-to-DME convention', () => {
    expect(STARTER_DME_GRAMS_PER_LITRE).toBe(100);
    expect(starterDmeGrams(2)).toBe(200);
    expect(starterVolumeL(200)).toBe(2);
  });
});

describe('Braukaiser growth model — stirred', () => {
  /**
   * Kai's pseudo-code, transcribed:
   * ```
   * initial cells < 1.4 B/g          → 1.4 B/g
   * 1.4 ≤ initial cells ≤ 3.5 B/g    → 2.33 − 0.67 × initial cells
   * else                             → no growth
   * ```
   * Longhand: 2.33 − 0.67 × 1.4 = 1.392; × 2.0 → 0.99; × 3.0 → 0.32; the line's
   * own root is 2.33 / 0.67 = 3.4776 and it is clamped to zero above that.
   *
   * Tolerance: 1e-6 B/g. This is arithmetic on published coefficients, not a
   * measurement, so a looser tolerance could hide a changed constant.
   */
  it.each([
    [0, 1.4],
    [0.5, 1.4],
    [1.0, 1.4],
    [1.399, 1.4],
    // The published discontinuity: 1.400 → 1.392 the instant the rate reaches 1.4.
    [1.4, 1.392],
    [2.0, 0.99],
    [3.0, 0.32],
    [3.477612, 0],
    [3.5, 0],
    [3.6, 0],
    [10, 0],
  ])('%f B/g inoculation → %f B/g growth', (inoculation, growth) => {
    expect(starterGrowthRate(inoculation)).toBeCloseTo(growth, 6);
  });

  it('steps down by 0.008 B/g at the plateau edge, and is not smoothed', () => {
    expect(starterGrowthRate(1.3999)).toBe(MAX_GROWTH_PER_GRAM);
    expect(starterGrowthRate(1.4)).toBeCloseTo(1.392, 6);
    expect(MAX_GROWTH_PER_GRAM - starterGrowthRate(1.4)).toBeCloseTo(0.008, 6);
  });

  it('rejects nonsense inoculation rates rather than extrapolating', () => {
    expect(starterGrowthRate(-1)).toBe(0);
    expect(starterGrowthRate(Number.NaN)).toBe(0);
  });
});

describe('Braukaiser growth model — unstirred', () => {
  /**
   * Flat across the whole 0–3.5 B/g range, per Kai for `still` and per Homebrew
   * Dad's chart read-off for `shaken`. These aren't a fraction of the stirred
   * curve. See `UNSTIRRED_GROWTH_PER_GRAM` for why the modes aren't related by
   * a factor, and for the crossing point this keeps.
   */
  it.each([
    ['still', 0.4],
    ['shaken', 0.62],
  ] as const)('%s grows a flat %f B/g up to the cut-off', (method, rate) => {
    for (const inoculation of [0, 0.5, 1.4, 2.0, 3.0, GROWTH_CEASES_INOCULATION_RATE]) {
      expect(starterGrowthRate(inoculation, method)).toBeCloseTo(rate, 6);
    }
    expect(starterGrowthRate(3.6, method)).toBe(0);
  });

  it('beats the stir plate only above 2.5 B/g, which is the published shape', () => {
    // At practical inoculation rates, stirring wins by a factor of 2–3.5.
    for (const inoculation of [0, 0.25, 0.5, 1.0, 1.399]) {
      expect(starterGrowthRate(inoculation)).toBeGreaterThan(
        starterGrowthRate(inoculation, 'shaken'),
      );
      expect(starterGrowthRate(inoculation, 'shaken')).toBeGreaterThan(
        starterGrowthRate(inoculation, 'still'),
      );
    }
    // Kai's sedimentation argument predicts this crossing, so it's pinned to
    // stop anyone "fixing" it. The stirred decline falls to the shaken band's
    // 0.62 B/g at (2.33 − 0.62) / 0.67 = 2.5522 B/g.
    expect(starterGrowthRate(2.5522388)).toBeCloseTo(UNSTIRRED_GROWTH_PER_GRAM.shaken, 6);
    expect(starterGrowthRate(3.0, 'shaken')).toBeGreaterThan(starterGrowthRate(3.0));
  });
});

describe('starterGrowth', () => {
  /**
   * Growth is additive. Kai: "Growth is new cells added to the initial ones",
   * and every implementation does `initial + DME × growthRate`.
   *
   * 100 bn into 2 L (200 g DME), longhand:
   * ```
   * inoculation = 100 / 200 = 0.5 B/g   → on the plateau
   * growth      = 1.4 B/g
   * new         = 1.4 × 200 = 280 bn
   * final       = 100 + 280 = 380 bn
   * ```
   */
  it('adds new cells to the pitched ones', () => {
    const grown = starterGrowth(100, starterDmeGrams(2));
    expect(grown.inoculationRate).toBeCloseTo(0.5, 9);
    expect(grown.growthRate).toBeCloseTo(1.4, 9);
    expect(grown.newCellsBillion).toBeCloseTo(280, 6);
    expect(grown.finalCellsBillion).toBeCloseTo(380, 6);
    expect(grown.volumeL).toBe(2);
  });

  /**
   * Just past the breakpoint: 150 bn into 1 L (100 g).
   * ```
   * inoculation = 1.5 B/g   → the fitted decline
   * growth      = 2.33 − 0.67 × 1.5 = 1.325 B/g
   * new         = 132.5 bn ; final = 282.5 bn
   * ```
   */
  it('follows the decline above 1.4 B/g', () => {
    const grown = starterGrowth(150, starterDmeGrams(1));
    expect(grown.growthRate).toBeCloseTo(1.325, 9);
    expect(grown.finalCellsBillion).toBeCloseTo(282.5, 6);
  });

  it('returns the pitch untouched above the cut-off — cells are never lost', () => {
    const grown = starterGrowth(400, starterDmeGrams(1));
    expect(grown.inoculationRate).toBeCloseTo(4, 9);
    expect(grown.newCellsBillion).toBe(0);
    expect(grown.finalCellsBillion).toBe(400);
  });

  it('makes nothing from no extract', () => {
    expect(starterGrowth(100, 0).finalCellsBillion).toBe(100);
  });

  it('never yields fewer cells for more DME', () => {
    for (const method of ['stir-plate', 'shaken', 'still'] as const) {
      for (const cells of [10, 49.3, 100, 250, 400]) {
        let previous = -1;
        for (let dme = 0; dme <= 800; dme += 25) {
          const final = starterGrowth(cells, dme, method).finalCellsBillion;
          expect(final).toBeGreaterThanOrEqual(previous);
          previous = final;
        }
      }
    }
  });
});

describe('planStarter', () => {
  /**
   * **The worked example.** 19 L of 1.048 American pale ale, one 100 bn liquid
   * pack packaged 90 days ago, stir plate. Longhand:
   *
   * ```
   * target      = 0.75 × 19 × 11.9121 °P            = 169.75 bn
   * viability   = 0.79^(90/30) = 0.79³              = 0.4930
   * on hand     = 100 × 0.4930                      = 49.30 bn
   * shortfall                                        = 120.44 bn
   *
   * try 0.75 L (75 g):  49.30/75  = 0.657 B/g → 1.4 → +105 → 154.30  ✗
   * try 1.00 L (100 g): 49.30/100 = 0.493 B/g → 1.4 → +140 → 189.30  ✓
   * ```
   *
   * So the answer is a 1 L stir-plate starter from 100 g of DME, yielding
   * 189 bn. That's the smallest quarter-litre step that clears 169.75.
   * **Tolerance: 0.1 bn.**
   */
  it('plans a 1 L stir-plate starter for a 3-month-old pack in a 19 L pale ale', () => {
    const target = targetPitchCells(19, 1.048, ALE_PITCH_RATE);
    const onHand = availableCells(
      { form: 'liquid', packs: 1 },
      packViability(daysBefore(90), NOW, 'liquid'),
    );
    expect(onHand).toBeCloseTo(49.3, 1);

    const plan = planStarter(target, onHand);
    expect(plan.needed).toBe(true);
    expect(plan.reachable).toBe(true);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.volumeL).toBe(1);
    expect(plan.steps[0]?.dmeGrams).toBe(100);
    expect(plan.steps[0]?.growthRate).toBeCloseTo(1.4, 9);
    expect(plan.finalCellsBillion).toBeCloseTo(189.3, 1);
    expect(plan.totalDmeGrams).toBe(100);
    expect(plan.finalCellsBillion).toBeGreaterThanOrEqual(target);
  });

  /**
   * The same batch without a stir plate. The model's flat bands make the
   * starter two to three times bigger for the same answer:
   * ```
   * shaken (0.62 B/g): 2.00 L → 200 g → +124 bn → 173.30 bn
   * still  (0.40 B/g): 3.25 L → 325 g → +130 bn → 179.30 bn
   * ```
   */
  it.each([
    ['shaken', 2, 173.3],
    ['still', 3.25, 179.3],
  ] as const)('needs a %s starter of %f L', (method, volumeL, finalCells) => {
    const target = targetPitchCells(19, 1.048, ALE_PITCH_RATE);
    const onHand = availableCells(
      { form: 'liquid', packs: 1 },
      packViability(daysBefore(90), NOW, 'liquid'),
    );
    const plan = planStarter(target, onHand, { method });
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.volumeL).toBe(volumeL);
    expect(plan.finalCellsBillion).toBeCloseTo(finalCells, 1);
    expect(plan.notes.join(' ')).toContain('stir plate');
  });

  /**
   * **Two steps.** 40 L of 1.070 lager (17.0556 °P) at the lager rate, from one
   * six-month-old pack. Longhand:
   *
   * ```
   * target    = 1.5 × 40 × 17.0556 = 1023.33 bn
   * viability = 0.79^6             = 0.2431
   * on hand   = 24.31 bn
   *
   * A single 4 L step tops out at 24.31 + 1.4×400 = 584.31 bn, not enough.
   * On the plateau every gram of DME is worth 1.4 bn wherever it is spent, so
   * the cheapest pair is the smallest total volume that reaches the target:
   *   24.31 + 140 × (v₁ + v₂) ≥ 1023.33  →  v₁ + v₂ ≥ 7.14 L  →  7.25 L
   * with v₂ ≤ 4 L, that is 3.25 L then 4 L:
   *   step 1: 325 g, 0.075 B/g → 1.4 → +455 → 479.31 bn
   *   step 2: 400 g, 1.198 B/g → 1.4 → +560 → 1039.31 bn  ✓
   * ```
   *
   * **Tolerance: 0.1 bn.**
   */
  it('steps twice for a 40 L lager from a six-month-old pack', () => {
    const target = targetPitchCells(40, 1.07, LAGER_PITCH_RATE);
    expect(target).toBeCloseTo(1023.33, 2);
    const onHand = availableCells(
      { form: 'liquid', packs: 1 },
      packViability(daysBefore(180), NOW, 'liquid'),
    );
    expect(onHand).toBeCloseTo(24.31, 2);

    const plan = planStarter(target, onHand);
    expect(plan.reachable).toBe(true);
    expect(plan.steps.map((step) => step.volumeL)).toEqual([3.25, 4]);
    expect(plan.steps[0]?.finalCellsBillion).toBeCloseTo(479.31, 1);
    expect(plan.finalCellsBillion).toBeCloseTo(1039.31, 1);
    expect(plan.totalDmeGrams).toBe(725);
    expect(plan.notes.join(' ')).toContain('decant');
  });

  /**
   * **The refusal.** 46 L of the same 1.070 lager (a double batch) from one
   * three-month-old pack. Target 1176.83 bn against 49.30 bn on hand.
   *
   * Two 4 L steps can't do it. The best pair is 4 L then 4 L, and the second
   * step is inoculated at 609.30 / 400 = 1.52 B/g, off the plateau and onto the
   * decline (2.33 − 0.67 × 1.52 = 1.309), so it yields 1133 bn, 44 bn short.
   * The planner won't add a third step. It reports that starting from 4× the
   * yeast makes it reachable:
   * 4 × 49.30 = 197.2 bn → 4 L → 757.2 bn → 4 L at 1.89 B/g → 1182 bn ✓
   */
  it('refuses a third step and says how many packs would fix it', () => {
    const target = targetPitchCells(46, 1.07, LAGER_PITCH_RATE);
    expect(target).toBeCloseTo(1176.83, 2);
    const onHand = availableCells(
      { form: 'liquid', packs: 1 },
      packViability(daysBefore(90), NOW, 'liquid'),
    );

    const plan = planStarter(target, onHand);
    expect(plan.needed).toBe(true);
    expect(plan.reachable).toBe(false);
    expect(plan.steps).toEqual([]);
    expect(plan.suggestedPackMultiplier).toBe(4);
    expect(plan.notes.join(' ')).toContain('4 packs');

    // Check the suggestion: four packs do make it reachable.
    const withFour = planStarter(target, onHand * 4);
    expect(withFour.reachable).toBe(true);
  });

  it('reports the target unreachable when even ten packs will not do it', () => {
    const plan = planStarter(targetPitchCells(60, 1.08, LAGER_PITCH_RATE), 49.3);
    expect(plan.reachable).toBe(false);
    expect(plan.suggestedPackMultiplier).toBeNull();
    expect(plan.notes.join(' ')).toContain('bigger vessel');
  });

  it('says no starter is needed when two fresh packs already make the rate', () => {
    const target = targetPitchCells(19, 1.048, ALE_PITCH_RATE);
    const plan = planStarter(target, availableCells({ form: 'liquid', packs: 2 }, 1));
    expect(plan.needed).toBe(false);
    expect(plan.steps).toEqual([]);
    expect(plan.totalDmeGrams).toBe(0);
    expect(plan.finalCellsBillion).toBe(200);
    expect(plan.notes.join(' ')).toContain('No starter required');
  });

  it('plans in quarter-litre steps and never overruns the vessel', () => {
    for (let target = 60; target <= 900; target += 17) {
      const plan = planStarter(target, 40);
      if (!plan.reachable) continue;
      for (const step of plan.steps) {
        expect(step.volumeL).toBeLessThanOrEqual(4);
        expect((step.volumeL * 100) % 25).toBe(0);
      }
      expect(plan.finalCellsBillion).toBeGreaterThanOrEqual(target - 1e-9);
    }
  });

  it('never asks for more DME to reach a smaller target', () => {
    let previous = 0;
    for (let target = 60; target <= 900; target += 20) {
      const plan = planStarter(target, 40);
      if (!plan.reachable) break;
      expect(plan.totalDmeGrams).toBeGreaterThanOrEqual(previous);
      previous = plan.totalDmeGrams;
    }
  });

  it('never asks for more DME when the brewer has more yeast', () => {
    const target = targetPitchCells(23, 1.06, LAGER_PITCH_RATE);
    let previous = Number.POSITIVE_INFINITY;
    for (let onHand = 20; onHand <= 400; onHand += 20) {
      const plan = planStarter(target, onHand);
      expect(plan.reachable).toBe(true);
      expect(plan.totalDmeGrams).toBeLessThanOrEqual(previous);
      previous = plan.totalDmeGrams;
    }
  });

  it('honours a bigger vessel', () => {
    const target = targetPitchCells(46, 1.07, LAGER_PITCH_RATE);
    expect(planStarter(target, 49.3).reachable).toBe(false);
    expect(planStarter(target, 49.3, { maxStepL: 8 }).reachable).toBe(true);
  });
});
