import { describe, expect, it } from 'vitest';
import { BURTON_ON_TRENT, DUBLIN, PILSEN } from './fixtures/water-profiles';
import type { SaltAddition, WaterProfile } from './types';
import {
  applySalts,
  ION_ADVISORY_RANGE_PPM,
  ionPpm,
  RO_WATER,
  saltIonPpmPerGramPerLitre,
  sulfateChlorideRatio,
  WATER_IONS,
  waterProfile,
  withUnmeasured,
} from './water';
import {
  DEFAULT_ION_TOLERANCE_PPM,
  DEFAULT_SOLVER_SALTS,
  saltContributionBreakdown,
  solveWaterProfile,
  solveWaterRule,
} from './waterSolver';

/** A soft-ish tap water: some minerals, moderate alkalinity. */
const TAP: WaterProfile = waterProfile({
  name: 'Tap',
  calciumPpm: 20,
  magnesiumPpm: 5,
  sodiumPpm: 10,
  chloridePpm: 15,
  sulfatePpm: 20,
  alkalinityPpmAsCaCO3: 40,
});

/** A classic "hoppy pale ale" target. */
const HOPPY_TARGET: WaterProfile = waterProfile({
  name: 'Hoppy pale',
  calciumPpm: 110,
  magnesiumPpm: 10,
  sodiumPpm: 15,
  chloridePpm: 55,
  sulfatePpm: 200,
  bicarbonatePpm: 0,
});

/** A "balanced amber" target, reachable from RO with two salts. */
const BALANCED_TARGET: WaterProfile = waterProfile({
  name: 'Balanced',
  calciumPpm: 80,
  magnesiumPpm: 0,
  sodiumPpm: 0,
  chloridePpm: 75,
  sulfatePpm: 75,
  bicarbonatePpm: 0,
});

/**
 * A target worked out backwards from a known salt schedule, so it's exactly
 * reachable: 8 g gypsum + 4 g calcium chloride dihydrate + 2 g Epsom in 28 L.
 *
 * ```
 * Ca  = (8 × 232.787 + 4 × 272.607) / 28 = (1862.30 + 1090.43) / 28 = 105.45
 * SO₄ = (8 × 557.933 + 2 × 389.732) / 28 = (4463.47 +  779.46) / 28 = 187.25
 * Cl  =  4 × 482.312 / 28 = 68.90
 * Mg  =  2 ×  98.614 / 28 =  7.04
 * ```
 */
const REACHABLE_TARGET: WaterProfile = waterProfile({
  name: 'Reachable',
  calciumPpm: 105.45,
  magnesiumPpm: 7.04,
  sodiumPpm: 0,
  chloridePpm: 68.9,
  sulfatePpm: 187.25,
  bicarbonatePpm: 0,
});

const VOLUMES = { mashVolumeL: 16, spargeVolumeL: 12 };

describe('solver basics', () => {
  it('uses no salts at all when the source already is the target', () => {
    const result = solveWaterProfile({ source: TAP, target: TAP, volumes: VOLUMES });
    expect(result.additions).toEqual([]);
    expect(result.score).toBeCloseTo(0, 9);
    expect(result.withinTolerance).toBe(true);
  });

  it('excludes chalk and slaked lime by default', () => {
    expect(DEFAULT_SOLVER_SALTS).not.toContain('chalk');
    expect(DEFAULT_SOLVER_SALTS).not.toContain('slaked-lime');
    expect(DEFAULT_SOLVER_SALTS).not.toContain('calcium-chloride-anhydrous');
  });

  it('never reaches for a salt outside the allowed list', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      allowedSalts: ['gypsum'],
    });
    expect(result.additions.every((a) => a.salt === 'gypsum')).toBe(true);
  });

  it('honours the maximum salt count', () => {
    for (const maxSalts of [1, 2, 3, 4]) {
      const result = solveWaterProfile({
        source: TAP,
        target: HOPPY_TARGET,
        volumes: VOLUMES,
        maxSalts,
      });
      expect(result.additions.length).toBeLessThanOrEqual(maxSalts);
    }
  });

  it('is deterministic across repeated runs', () => {
    const run = () =>
      JSON.stringify(
        solveWaterProfile({ source: TAP, target: HOPPY_TARGET, volumes: VOLUMES }).additions,
      );
    expect(run()).toBe(run());
    expect(run()).toBe(run());
  });

  it('runs a typical solve in a fraction of a millisecond', () => {
    const start = Date.now();
    const runs = 200;
    for (let i = 0; i < runs; i += 1) {
      solveWaterProfile({ source: TAP, target: HOPPY_TARGET, volumes: VOLUMES });
    }
    const perRun = (Date.now() - start) / runs;
    // A loose bound so slow CI machines pass. In practice it's well under a
    // millisecond.
    expect(perRun).toBeLessThan(20);
  });
});

describe('solver arithmetic, cross-checked by hand', () => {
  /**
   * Hand-computed check. From RO water, hitting 80 ppm Ca / 75 ppm Cl /
   * 75 ppm SO₄ over 28 L needs, in ppm per gram per litre:
   *
   * ```
   * gypsum       Ca 232.79   SO₄ 557.94
   * CaCl₂·2H₂O   Ca 272.61   Cl  482.31
   *
   * sulfate:  75 = g_gyp / 28 × 557.94   → g_gyp = 75 × 28 / 557.94 = 3.764 g
   * chloride: 75 = g_cc  / 28 × 482.31   → g_cc  = 75 × 28 / 482.31 = 4.354 g
   * calcium:  3.764/28 × 232.79 + 4.354/28 × 272.61 = 31.29 + 42.39 = 73.7 ppm
   * ```
   *
   * so the target's 80 ppm Ca can't be hit exactly with those two salts. The
   * solver trades a little chloride/sulfate overshoot for the calcium.
   * Tolerance: 0.5 g on each dose, 6 ppm on each ion.
   */
  it('hits a two-salt target from RO', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: BALANCED_TARGET,
      volumes: VOLUMES,
      maxSalts: 2,
    });
    expect(result.additions.map((a) => a.salt).sort()).toEqual([
      'calcium-chloride-dihydrate',
      'gypsum',
    ]);
    const gypsum = result.additions.find((a) => a.salt === 'gypsum');
    const chloride = result.additions.find((a) => a.salt === 'calcium-chloride-dihydrate');
    expect(gypsum?.grams).toBeCloseTo(3.8, 0);
    expect(chloride?.grams).toBeCloseTo(4.4, 0);
    for (const ion of ['calcium', 'chloride', 'sulfate'] as const) {
      const fit = result.fit.find((f) => f.ion === ion);
      expect(Math.abs(fit?.deltaPpm ?? 99)).toBeLessThan(8);
    }
  });

  /**
   * Feeding the solver's answer back through the ion accounting should
   * reproduce the profile it reported. Tolerance: 1e-9 ppm. It's the same
   * arithmetic, so any difference would be a bug.
   */
  it('round trips its answer through applySalts', () => {
    for (const target of [HOPPY_TARGET, BALANCED_TARGET, DUBLIN.profile]) {
      const result = solveWaterProfile({ source: TAP, target, volumes: VOLUMES });
      const replayed = applySalts({
        source: result.dilutedSource,
        additions: result.additions,
        volumes: VOLUMES,
      });
      for (const ion of WATER_IONS) {
        expect(ionPpm(replayed.total, ion)).toBeCloseTo(ionPpm(result.achieved, ion), 9);
      }
    }
  });

  /**
   * Every ion the solver can reach should land inside its tolerance. Bicarbonate
   * is excluded from this assertion for targets below the source, because no
   * salt removes it.
   */
  it('lands every ion inside tolerance for a reachable target', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: REACHABLE_TARGET,
      volumes: VOLUMES,
    });
    for (const fit of result.fit) {
      expect(Math.abs(fit.deltaPpm)).toBeLessThanOrEqual(fit.tolerancePpm);
    }
    expect(result.withinTolerance).toBe(true);
    // It also recovers the schedule the target was built from, to the 0.1 g scale.
    expect(result.additions.find((a) => a.salt === 'gypsum')?.grams).toBeCloseTo(8, 1);
    expect(
      result.additions.find((a) => a.salt === 'calcium-chloride-dihydrate')?.grams,
    ).toBeCloseTo(4, 1);
    expect(result.additions.find((a) => a.salt === 'epsom-salt')?.grams).toBeCloseTo(2, 1);
  });

  it('cannot hit a five-ion target with only three salts, and says so', () => {
    // Ca, Mg, Na, Cl and SO₄ are five constraints, and three salts give three
    // degrees of freedom. The solver returns the least-squares compromise.
    const result = solveWaterProfile({ source: RO_WATER, target: HOPPY_TARGET, volumes: VOLUMES });
    expect(result.withinTolerance).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    const better = solveWaterProfile({
      source: RO_WATER,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      maxSalts: 5,
    });
    expect(better.score).toBeLessThan(result.score);
  });

  it('reports the tolerances it used', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: REACHABLE_TARGET,
      volumes: VOLUMES,
    });
    for (const fit of result.fit) {
      expect(fit.tolerancePpm).toBe(DEFAULT_ION_TOLERANCE_PPM[fit.ion]);
    }
  });

  it('respects a tightened tolerance by weighting that ion harder', () => {
    const loose = solveWaterProfile({
      source: TAP,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      tolerancePpm: { calcium: 50 },
    });
    const tight = solveWaterProfile({
      source: TAP,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      tolerancePpm: { calcium: 2 },
    });
    const calciumError = (r: typeof loose): number =>
      Math.abs(r.fit.find((f) => f.ion === 'calcium')?.deltaPpm ?? 0);
    expect(calciumError(tight)).toBeLessThanOrEqual(calciumError(loose) + 1e-9);
  });

  it('ignores an ion given zero weight', () => {
    const result = solveWaterProfile({
      source: TAP,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      weights: { bicarbonate: 0 },
    });
    expect(result.fit.find((f) => f.ion === 'bicarbonate')?.withinTolerance).toBe(true);
  });
});

describe('fewer salts wins', () => {
  it('uses one salt when one salt will do', () => {
    const target = waterProfile({ calciumPpm: 100, sulfatePpm: 239.7 });
    const result = solveWaterProfile({ source: RO_WATER, target, volumes: VOLUMES });
    expect(result.additions.length).toBe(1);
    expect(result.additions[0]?.salt).toBe('gypsum');
  });

  it('does not add a third salt for a negligible improvement', () => {
    const two = solveWaterProfile({
      source: RO_WATER,
      target: BALANCED_TARGET,
      volumes: VOLUMES,
      maxSalts: 2,
    });
    const three = solveWaterProfile({
      source: RO_WATER,
      target: BALANCED_TARGET,
      volumes: VOLUMES,
      maxSalts: 3,
    });
    // Allowing a third salt shouldn't make the answer worse, and if it barely
    // helps the solver should stay at two.
    expect(three.score).toBeLessThanOrEqual(two.score + 1e-9);
    if (three.score > two.score - 0.05) expect(three.additions.length).toBe(2);
  });

  it('takes the third salt when it improves the fit', () => {
    const target = waterProfile({
      calciumPpm: 100,
      magnesiumPpm: 20,
      sodiumPpm: 0,
      chloridePpm: 60,
      sulfatePpm: 180,
    });
    const result = solveWaterProfile({ source: RO_WATER, target, volumes: VOLUMES });
    expect(result.additions.length).toBe(3);
    expect(result.withinTolerance).toBe(true);
  });

  it('never returns a dose below the minimum weighable amount', () => {
    const result = solveWaterProfile({
      source: TAP,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      minSaltGrams: 1,
    });
    for (const addition of result.additions) expect(addition.grams).toBeGreaterThanOrEqual(1);
  });
});

describe('rounding to a real scale', () => {
  it('rounds doses to 0.1 g by default and reports the fit of the rounded doses', () => {
    const result = solveWaterProfile({ source: TAP, target: HOPPY_TARGET, volumes: VOLUMES });
    for (const addition of result.additions) {
      expect(Math.abs(addition.grams * 10 - Math.round(addition.grams * 10))).toBeLessThan(1e-9);
    }
  });

  it('honours a coarser scale', () => {
    const result = solveWaterProfile({
      source: TAP,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      roundToGrams: 0.5,
    });
    for (const addition of result.additions) {
      expect(Math.abs(addition.grams * 2 - Math.round(addition.grams * 2))).toBeLessThan(1e-9);
    }
  });

  it('can be told not to round at all', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: waterProfile({ calciumPpm: 100, sulfatePpm: 239.7 }),
      volumes: VOLUMES,
      roundToGrams: 0,
    });
    // 100 ppm Ca over 28 L needs 100 × 28 / 232.79 = 12.028 g of gypsum.
    expect(result.additions[0]?.grams).toBeCloseTo(12.028, 2);
  });
});

describe('splitting between mash and sparge', () => {
  it('splits proportionally by default so both waters match', () => {
    const result = solveWaterProfile({ source: TAP, target: HOPPY_TARGET, volumes: VOLUMES });
    expect(result.additions.every((a) => a.target === 'total')).toBe(true);
    for (const ion of WATER_IONS) {
      expect(ionPpm(result.treated.mash, ion)).toBeCloseTo(ionPpm(result.treated.sparge, ion), 9);
    }
  });

  it('puts everything in the mash and fits the mash water when asked', () => {
    const result = solveWaterProfile({
      source: TAP,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      splitStrategy: 'mash-only',
    });
    expect(result.additions.every((a) => a.target === 'mash')).toBe(true);
    expect(result.achieved).toEqual(result.treated.mash);
    for (const ion of WATER_IONS) {
      expect(ionPpm(result.treated.sparge, ion)).toBeCloseTo(ionPpm(TAP, ion), 9);
    }
    const calcium = result.fit.find((f) => f.ion === 'calcium');
    expect(Math.abs(calcium?.deltaPpm ?? 99)).toBeLessThanOrEqual(calcium?.tolerancePpm ?? 0);
  });

  it('needs less salt for a mash-only dose than for the whole volume', () => {
    const total = solveWaterProfile({ source: TAP, target: HOPPY_TARGET, volumes: VOLUMES });
    const mashOnly = solveWaterProfile({
      source: TAP,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      splitStrategy: 'mash-only',
    });
    const sum = (r: typeof total): number => r.additions.reduce((s, a) => s + a.grams, 0);
    expect(sum(mashOnly)).toBeLessThan(sum(total));
  });
});

describe('dilution', () => {
  it('uses a caller-specified dilution and reports it', () => {
    const result = solveWaterProfile({
      source: BURTON_ON_TRENT.profile,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      dilutionFraction: 0.75,
    });
    expect(result.dilutionFraction).toBe(0.75);
    expect(result.dilutedSource.sulfatePpm).toBeCloseTo(725 * 0.25, 6);
  });

  /**
   * No salt can remove Burton's 725 ppm of sulfate, so without dilution the
   * solver can't reach a 200 ppm sulfate target. Turning the dilution search on
   * lets it find one.
   */
  it('finds a dilution that makes an over-mineralised source reachable', () => {
    const undiluted = solveWaterProfile({
      source: BURTON_ON_TRENT.profile,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
    });
    const searched = solveWaterProfile({
      source: BURTON_ON_TRENT.profile,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
      searchDilution: true,
    });
    expect(undiluted.withinTolerance).toBe(false);
    expect(searched.dilutionFraction).toBeGreaterThan(0.5);
    expect(searched.score).toBeLessThan(undiluted.score);
  });

  it('does not spend RO water to shave an ion that is already inside tolerance', () => {
    const result = solveWaterProfile({
      source: PILSEN.profile,
      target: BALANCED_TARGET,
      volumes: VOLUMES,
      searchDilution: true,
    });
    expect(result.dilutionFraction).toBeLessThan(0.2);
  });

  it('is deterministic with the dilution search on', () => {
    const run = () =>
      solveWaterProfile({
        source: BURTON_ON_TRENT.profile,
        target: HOPPY_TARGET,
        volumes: VOLUMES,
        searchDilution: true,
      }).dilutionFraction;
    expect(run()).toBe(run());
  });
});

describe('warnings', () => {
  it('says when an ion is already above the target and cannot be removed', () => {
    const result = solveWaterProfile({
      source: BURTON_ON_TRENT.profile,
      target: HOPPY_TARGET,
      volumes: VOLUMES,
    });
    expect(result.warnings.some((w) => w.toLowerCase().includes('dilute with ro water'))).toBe(
      true,
    );
  });

  it('says when an ion falls short of the target', () => {
    const target = waterProfile({ calciumPpm: 100, sulfatePpm: 200, chloridePpm: 50 });
    const result = solveWaterProfile({
      source: RO_WATER,
      target,
      volumes: VOLUMES,
      allowedSalts: ['table-salt'],
    });
    expect(result.warnings.some((w) => w.includes('short of the target'))).toBe(true);
  });

  /**
   * For an unmeasured ion the solver works out "the target wants 75 ppm, you
   * have 0, add calcium chloride". Nothing in the fit shows that the 0 was a
   * placeholder, so the solver has to warn about it.
   */
  it('says when it dosed against an ion the source never measured', () => {
    const source = withUnmeasured(waterProfile({ calciumPpm: 40 }), ['chloride']);
    const result = solveWaterProfile({ source, target: BALANCED_TARGET, volumes: VOLUMES });
    expect(
      result.warnings.some((w) => w.includes('Cl⁻') && w.includes('not in your water report')),
    ).toBe(true);
    // Sulfate was measured, so it gets no such caveat.
    expect(result.warnings.some((w) => w.includes('SO₄²⁻ is not in your water report'))).toBe(
      false,
    );
  });

  it('flags chalk when it is explicitly allowed and used', () => {
    const target = waterProfile({ calciumPpm: 100, bicarbonatePpm: 300 });
    const result = solveWaterProfile({
      source: RO_WATER,
      target,
      volumes: VOLUMES,
      allowedSalts: ['chalk', 'gypsum'],
    });
    expect(result.additions.some((a) => a.salt === 'chalk')).toBe(true);
    expect(result.warnings.some((w) => w.includes('does not reliably dissolve'))).toBe(true);
  });
});

describe('explanations and breakdown', () => {
  it('explains what it did', () => {
    const result = solveWaterProfile({ source: TAP, target: HOPPY_TARGET, volumes: VOLUMES });
    expect(result.explain.formula).toBe('nnls-subset-enumeration');
    expect(result.explain.inputs.maxSalts).toBe(3);
    expect(result.explain.inputs.saltsUsed).toBe(result.additions.length);
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
  });

  it('attributes each ion to the salt that supplied it', () => {
    const breakdown = saltContributionBreakdown([{ salt: 'gypsum', grams: 5.6 }], 28);
    // 5.6 / 28 = 0.2 g/L × 232.79 = 46.56 ppm Ca.
    expect(breakdown[0]?.ions.calciumPpm).toBeCloseTo(46.558, 3);
    expect(breakdown[0]?.ions.sulfatePpm).toBeCloseTo(111.587, 2);
    expect(breakdown[0]?.ions.chloridePpm).toBe(0);
  });

  it('the breakdown sums to what applySalts produces', () => {
    const additions = [
      { salt: 'gypsum' as const, grams: 5 },
      { salt: 'calcium-chloride-dihydrate' as const, grams: 3 },
    ];
    const breakdown = saltContributionBreakdown(additions, 28);
    const summed = breakdown.reduce((sum, b) => sum + b.ions.calciumPpm, 0);
    const treated = applySalts({
      source: RO_WATER,
      additions: additions.map((a) => ({ ...a, target: 'mash' as const })),
      volumes: { mashVolumeL: 28, spargeVolumeL: 0 },
    });
    expect(treated.mash.calciumPpm).toBeCloseTo(summed, 9);
  });
});

describe('edge cases', () => {
  it('handles a zero-volume brew without dividing by zero', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: HOPPY_TARGET,
      volumes: { mashVolumeL: 0, spargeVolumeL: 0 },
    });
    for (const ion of WATER_IONS) expect(Number.isFinite(ionPpm(result.achieved, ion))).toBe(true);
  });

  it('handles a no-sparge brew', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: REACHABLE_TARGET,
      volumes: { mashVolumeL: 30, spargeVolumeL: 0 },
    });
    expect(result.withinTolerance).toBe(true);
    expect(result.treated.split.every((s) => s.spargeGrams === 0)).toBe(true);
  });

  it('returns no salts when the target is entirely below the source', () => {
    const result = solveWaterProfile({
      source: BURTON_ON_TRENT.profile,
      target: PILSEN.profile,
      volumes: VOLUMES,
    });
    expect(result.additions).toEqual([]);
  });

  it('never produces a NaN', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: RO_WATER,
      volumes: VOLUMES,
      maxSalts: 0,
    });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.additions).toEqual([]);
  });

  it('skips the collinear calcium chloride pair instead of blowing up', () => {
    const result = solveWaterProfile({
      source: RO_WATER,
      target: waterProfile({ calciumPpm: 80, chloridePpm: 140 }),
      volumes: VOLUMES,
      allowedSalts: ['calcium-chloride-dihydrate', 'calcium-chloride-anhydrous'],
      maxSalts: 2,
    });
    expect(result.additions.length).toBe(1);
    expect(Number.isFinite(result.score)).toBe(true);
  });

  it('gets the same water from either calcium chloride form, at different masses', () => {
    const target = waterProfile({ calciumPpm: 80, chloridePpm: 141.5 });
    const dihydrate = solveWaterProfile({
      source: RO_WATER,
      target,
      volumes: VOLUMES,
      allowedSalts: ['calcium-chloride-dihydrate'],
      roundToGrams: 0,
    });
    const anhydrous = solveWaterProfile({
      source: RO_WATER,
      target,
      volumes: VOLUMES,
      allowedSalts: ['calcium-chloride-anhydrous'],
      roundToGrams: 0,
    });
    const ratio = (dihydrate.additions[0]?.grams ?? 0) / (anhydrous.additions[0]?.grams ?? 1);
    expect(ratio).toBeCloseTo(
      saltIonPpmPerGramPerLitre('calcium-chloride-anhydrous').calcium /
        saltIonPpmPerGramPerLitre('calcium-chloride-dihydrate').calcium,
      6,
    );
    expect(dihydrate.achieved.calciumPpm).toBeCloseTo(anhydrous.achieved.calciumPpm, 6);
  });
});

// ---------------------------------------------------------------------------
// The rule solver
// ---------------------------------------------------------------------------

/** Part-treated water: it clears a 50 ppm floor on its own and sits at SO₄:Cl 2.5. */
const PART_TREATED: WaterProfile = waterProfile({
  name: 'Part treated',
  calciumPpm: 80,
  magnesiumPpm: 0,
  sodiumPpm: 0,
  chloridePpm: 40,
  sulfatePpm: 100,
  bicarbonatePpm: 0,
});

/** A Burton-like water: 29 parts sulfate to one of chloride. */
const BURTON_LIKE: WaterProfile = waterProfile({
  name: 'Burton-like',
  calciumPpm: 275,
  magnesiumPpm: 45,
  sodiumPpm: 55,
  chloridePpm: 25,
  sulfatePpm: 725,
  bicarbonatePpm: 300,
});

/** Soft water a gypsum dose can carry over a 50 ppm floor on its way to a balance. */
const SOFT: WaterProfile = waterProfile({
  name: 'Soft',
  calciumPpm: 40,
  magnesiumPpm: 0,
  sodiumPpm: 0,
  chloridePpm: 50,
  sulfatePpm: 50,
  bicarbonatePpm: 0,
});

/** Hard water that a half-and-half RO cut brings back into range. */
const HARD: WaterProfile = waterProfile({
  name: 'Hard',
  calciumPpm: 200,
  magnesiumPpm: 20,
  sodiumPpm: 30,
  chloridePpm: 60,
  sulfatePpm: 300,
  bicarbonatePpm: 100,
});

/** The water a schedule produces, recomputed from the doses alone. */
const replay = (source: WaterProfile, result: { additions: readonly SaltAddition[] }) =>
  applySalts({ source, additions: result.additions, volumes: VOLUMES }).total;

describe('the rule solver', () => {
  /**
   * Hand-computed check. RO water, floor 50 ppm Ca, aim SO₄:Cl = 2. Both
   * rows are active, so gypsum (g) and calcium chloride dihydrate (c), in grams
   * per litre, solve
   *
   * ```
   * balance: 557.933 g − 2 × 482.312 c = 2 × 0 − 0  → g = 1.72893 c
   * floor:   232.787 g +     272.607 c = 50 − 0
   *          → (402.460 + 272.607) c = 50 → c = 0.074067, g = 0.128055
   * ```
   *
   * Over 28 L that's 3.586 g gypsum and 2.074 g calcium chloride, which the
   * 0.1 g scale rounds to 3.6 and 2.1, giving Ca 50.38 ppm, SO₄ 71.73,
   * Cl 36.17, ratio 1.983. Tolerance: 0.5 ppm on the floor, 1 % on the ratio.
   */
  it('lands on the floor and on the balance from RO, with the two calcium salts', () => {
    const result = solveWaterRule({
      source: RO_WATER,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
    });
    expect(result.additions.map((a) => a.salt)).toEqual(['gypsum', 'calcium-chloride-dihydrate']);

    const water = replay(RO_WATER, result);
    expect(Math.abs(water.calciumPpm - 50)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sulfateChlorideRatio(water) - 2) / 2).toBeLessThan(0.01);
    expect(result.rule.calciumMet).toBe(true);
    expect(result.rule.ratioMet).toBe(true);
    expect(result.rule.reachable).toBe(true);
    expect(result.rule.band).toBe('balanced');
    expect(result.withinTolerance).toBe(true);
  });

  /**
   * Burton at SO₄ 725 / Cl 25 can be brought down to 1.0 on paper, with 40 g
   * of calcium chloride in 28 L. That lands chloride at 724 ppm against a
   * 150 ppm comfortable maximum, and calcium at 670. Nobody should weigh that
   * out, so it's refused, and the warning names the ion that would overshoot
   * and the ppm it would reach.
   */
  it('refuses a balance no sane dose can reach, and names the ion it would ruin', () => {
    const result = solveWaterRule({
      source: BURTON_LIKE,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 1 },
      volumes: VOLUMES,
    });
    expect(result.additions).toEqual([]);
    expect(result.rule.reachable).toBe(false);
    expect(result.rule.ratioMet).toBe(false);
    const warning = result.warnings.find((w) => w.startsWith('Landing a 1.0 balance'));
    expect(warning).toContain('chloride to 724 ppm');
    expect(warning).toContain('150 ppm');
  });

  /**
   * Hand-computed check. 80 ppm calcium already clears the floor, so the
   * calcium row is dropped and one salt sets the balance. Going from 2.5 to 3
   * needs sulfate: `557.933 g = 3 × 40 − 100 = 20` → 0.035847 g/L → 1.004 g
   * over 28 L, rounding to 1.0 g. SO₄ 119.93, Cl 40, ratio 2.998; Ca 88.3.
   */
  it('uses gypsum alone to raise the balance when the floor is already clear', () => {
    const result = solveWaterRule({
      source: PART_TREATED,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 3 },
      volumes: VOLUMES,
    });
    expect(result.additions.map((a) => a.salt)).toEqual(['gypsum']);
    expect(result.additions[0]?.grams).toBeCloseTo(1, 5);

    const water = replay(PART_TREATED, result);
    expect(water.calciumPpm).toBeGreaterThan(50);
    expect(Math.abs(sulfateChlorideRatio(water) - 3) / 3).toBeLessThan(0.01);
    expect(result.rule.calciumMet).toBe(true);
    expect(result.rule.ratioMet).toBe(true);
    expect(result.withinTolerance).toBe(true);
  });

  /**
   * The opposite case. 2.5 down to 1.0 needs chloride, `−482.312 c = 40 − 100`, so
   * 0.12440 g/L → 3.483 g → 3.5 g of calcium chloride. Cl 100.29, SO₄ 100.
   */
  it('uses calcium chloride alone to lower the balance', () => {
    const result = solveWaterRule({
      source: PART_TREATED,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 1 },
      volumes: VOLUMES,
    });
    expect(result.additions.map((a) => a.salt)).toEqual(['calcium-chloride-dihydrate']);
    expect(result.additions[0]?.grams).toBeCloseTo(3.5, 5);

    const water = replay(PART_TREATED, result);
    expect(Math.abs(sulfateChlorideRatio(water) - 1)).toBeLessThan(0.01);
    expect(result.rule.reachable).toBe(true);
    // Calcium lands at 114 against a floor of 80. Clearing the floor satisfies
    // the rule, so the extra 34 ppm isn't an error.
    expect(result.withinTolerance).toBe(true);
    expect(result.maxAbsErrorPpm).toBeLessThan(1);
  });

  it('refuses a ratio or a floor it cannot mean anything by', () => {
    const rule = (ratio: number, floor = 50) =>
      solveWaterRule({
        source: RO_WATER,
        rule: { minCalciumPpm: floor, sulfateChlorideRatio: ratio },
        volumes: VOLUMES,
      });
    expect(() => rule(0.05)).toThrow(RangeError);
    expect(() => rule(0.05)).toThrow(/0\.1/);
    expect(() => rule(12)).toThrow(RangeError);
    expect(() => rule(12)).toThrow(/9/);
    expect(() => rule(2, -1)).toThrow(RangeError);
    expect(() => rule(2, Number.NaN)).toThrow(RangeError);
  });

  it('names the salt the balance needs rather than routing around it', () => {
    const result = solveWaterRule({
      source: RO_WATER,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
      allowedSalts: ['gypsum'],
    });
    expect(result.additions).toEqual([]);
    expect(result.rule.reachable).toBe(false);
    // Nothing was dosed, so the balance isn't met, whatever the untreated
    // water's ratio is.
    expect(result.rule.ratioMet).toBe(false);
    expect(result.warnings.some((w) => w.includes('calcium chloride'))).toBe(true);
  });

  it('is deterministic — the same input twice is the same result', () => {
    const input = {
      source: PART_TREATED,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
    };
    expect(solveWaterRule(input)).toEqual(solveWaterRule(input));
  });

  /**
   * Hand-computed check. Half RO leaves Ca 100, SO₄ 150, Cl 30, a 5.0
   * balance. Down to 2.0 needs `−2 × 482.312 c = 2 × 30 − 150`, so c = 0.09330
   * g/L → 2.612 g → 2.6 g. Cl 74.79, SO₄ 150, ratio 2.006, Ca 125.3.
   */
  it('honours a dilution exactly as the profile solver does', () => {
    const result = solveWaterRule({
      source: HARD,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
      dilutionFraction: 0.5,
    });
    expect(result.dilutedSource.calciumPpm).toBeCloseTo(100, 6);
    expect(result.dilutedSource.sulfatePpm).toBeCloseTo(150, 6);
    expect(result.dilutionFraction).toBe(0.5);
    expect(result.additions.map((a) => a.salt)).toEqual(['calcium-chloride-dihydrate']);

    const water = replay(result.dilutedSource, result);
    expect(Math.abs(sulfateChlorideRatio(water) - 2) / 2).toBeLessThan(0.01);
    expect(result.rule.calciumMet).toBe(true);
    expect(result.rule.ratioMet).toBe(true);
  });

  it('reports the unconstrained ions against the source, and calcium against the floor', () => {
    const fromRo = solveWaterRule({
      source: RO_WATER,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
    });
    for (const ion of ['sodium', 'magnesium', 'bicarbonate'] as const) {
      const row = fromRo.fit.find((f) => f.ion === ion);
      expect(row?.targetPpm).toBe(ionPpm(fromRo.dilutedSource, ion));
      expect(row?.withinTolerance).toBe(true);
    }
    expect(fromRo.fit.find((f) => f.ion === 'calcium')?.targetPpm).toBe(50);

    const fromPartTreated = solveWaterRule({
      source: PART_TREATED,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 3 },
      volumes: VOLUMES,
    });
    expect(fromPartTreated.fit.find((f) => f.ion === 'calcium')?.targetPpm).toBe(80);
  });

  /**
   * Hand-computed check, for the case that treating the floor as a strict
   * equality gets wrong. Ca 40 / SO₄ 50 / Cl 50 aiming at 3 with a 50 ppm
   * floor: pinning calcium to exactly 50 solves to gypsum 2.39 g and calcium
   * chloride −1.01 g, which reads as unreachable for a rule that one salt
   * satisfies. `557.933 g = 3 × 50 − 50 = 100` → 0.179234 g/L → 5.019 g over
   * 28 L → 5.0 g, which carries calcium to 40 + 41.6 = 81.6, past the floor on
   * its own. Clearing the floor satisfies it.
   */
  it('lets the balance salt carry calcium over the floor rather than pinning it there', () => {
    const result = solveWaterRule({
      source: SOFT,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 3 },
      volumes: VOLUMES,
    });
    expect(result.additions.map((a) => a.salt)).toEqual(['gypsum']);
    expect(result.additions[0]?.grams).toBeCloseTo(5, 5);

    const water = replay(SOFT, result);
    expect(water.calciumPpm).toBeCloseTo(81.57, 1);
    expect(Math.abs(sulfateChlorideRatio(water) - 3) / 3).toBeLessThan(0.01);
    expect(result.rule.calciumMet).toBe(true);
    expect(result.rule.ratioMet).toBe(true);
    expect(result.rule.reachable).toBe(true);
    expect(result.withinTolerance).toBe(true);
  });

  /**
   * Hand-computed check. The same water against a 120 ppm floor: gypsum alone
   * only reaches 81.6, so the floor becomes a row of its own and both salts are
   * solved together:
   *
   * ```
   * balance: 557.933 g − 3 × 482.312 c = 100
   * floor:   232.787 g +     272.607 c = 80
   *          → c = 0.043682, g = 0.292516 g/L → 8.19 g and 1.22 g over 28 L
   * ```
   *
   * Both are strictly positive, as they always are once the balance alone has
   * been tried first. Ca 119.86, SO₄ 213.4, Cl 70.7, ratio 3.020.
   */
  it('solves both rows together only when the balance salt leaves calcium short', () => {
    const result = solveWaterRule({
      source: SOFT,
      rule: { minCalciumPpm: 120, sulfateChlorideRatio: 3 },
      volumes: VOLUMES,
    });
    expect(result.additions.map((a) => a.salt)).toEqual(['gypsum', 'calcium-chloride-dihydrate']);
    expect(result.additions[0]?.grams).toBeCloseTo(8.2, 5);
    expect(result.additions[1]?.grams).toBeCloseTo(1.2, 5);

    const water = replay(SOFT, result);
    expect(Math.abs(water.calciumPpm - 120)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sulfateChlorideRatio(water) - 3) / 3).toBeLessThan(0.01);
    expect(result.rule.calciumMet).toBe(true);
    expect(result.rule.ratioMet).toBe(true);
    expect(result.withinTolerance).toBe(true);
  });

  /**
   * The comfortable maximum is a flavour range and not a hard limit. 13.0 g of
   * gypsum takes this water to a 9:1 balance and 359 ppm sulfate, nine ppm past
   * the 350 in the range, which nobody can taste. The schedule stands, and the
   * water's own warning reports the overshoot.
   */
  it('keeps a schedule that lands an ion just past the comfortable maximum', () => {
    const result = solveWaterRule({
      source: PART_TREATED,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 9 },
      volumes: VOLUMES,
    });
    expect(result.additions.map((a) => a.salt)).toEqual(['gypsum']);
    expect(result.rule.reachable).toBe(true);
    expect(result.rule.ratioMet).toBe(true);

    const water = replay(PART_TREATED, result);
    expect(water.sulfatePpm).toBeGreaterThan(ION_ADVISORY_RANGE_PPM.sulfate.max);
    expect(water.sulfatePpm).toBeLessThan(1.5 * ION_ADVISORY_RANGE_PPM.sulfate.max);
    expect(result.warnings.some((w) => w.includes('above the 350 ppm comfortable maximum'))).toBe(
      true,
    );
  });

  /**
   * The other side of that line. The same rule from a water with 60 ppm
   * chloride needs 22.1 g of gypsum and would land sulfate at 540 ppm, half as
   * much again as the range allows. The warning doesn't suggest dilution,
   * because diluting a water doesn't change its ratio. The rule has to change.
   */
  it('refuses a schedule that lands an ion half as much again past the maximum', () => {
    const result = solveWaterRule({
      source: { ...PART_TREATED, chloridePpm: 60 },
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 9 },
      volumes: VOLUMES,
    });
    expect(result.additions).toEqual([]);
    expect(result.rule.reachable).toBe(false);
    const warning = result.warnings.find((w) => w.startsWith('Landing a 9.0 balance'));
    expect(warning).toContain('sulfate to 540 ppm');
    expect(warning).toContain('350 ppm');
    expect(warning).not.toContain('dilution');
  });

  /**
   * A refused rule has no schedule, so its explanation shouldn't describe one.
   * A note like "One salt sets the balance and the calcium it carries in
   * already clears the floor" next to `saltsUsed: none` would describe doses
   * that were thrown away, and a brewer could act on it.
   */
  it('explains a refusal as a refusal, not as the schedule it discarded', () => {
    const result = solveWaterRule({
      source: { ...PART_TREATED, chloridePpm: 60 },
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 9 },
      volumes: VOLUMES,
    });
    expect(result.rule.reachable).toBe(false);
    expect(result.explain.inputs?.saltsUsed).toBe('none');

    const notes = result.explain.notes ?? [];
    expect(notes[0]).toContain('No schedule');
    // None of the notes a solved schedule gets.
    for (const note of notes) {
      expect(note).not.toContain('One salt sets the balance');
      expect(note).not.toContain('both rows are solved');
      expect(note).not.toContain('Doses are rounded');
    }
    // Which ion would have breached, and at what ppm.
    expect(notes.some((note) => note.includes('sulfate') && note.includes('540 ppm'))).toBe(true);
  });

  /** A solved rule still explains how the doses were worked out. */
  it('still explains a schedule it did prescribe', () => {
    const result = solveWaterRule({
      source: RO_WATER,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
    });
    expect(result.rule.reachable).toBe(true);
    const notes = result.explain.notes ?? [];
    expect(notes.some((note) => note.includes('both rows are solved'))).toBe(true);
    expect(notes.some((note) => note.includes('Doses are rounded'))).toBe(true);
    expect(notes.some((note) => note.includes('No schedule'))).toBe(false);
  });

  /**
   * A water carrying 400 ppm sulfate against 10 ppm chloride, wanting 1.0 and a
   * 50 ppm floor. Because the balance is tried first, one calcium chloride dose
   * satisfies both rows in principle, but it's refused in practice because it
   * would take chloride to 399 ppm.
   *
   * This is also as close as the solver gets to a negative dose. With the
   * balance tried first, step 2's system can't return one: its solution is
   * step 1's point moved up the balance line in a direction whose components
   * are both positive (see `planRuleDoses`). The `negativeDose` branch is a
   * sign check that can't be reached, so there's no water to test it with.
   */
  it('refuses a heavily sulfate-dominated water rather than piling on chloride', () => {
    const result = solveWaterRule({
      source: waterProfile({ calciumPpm: 10, sulfatePpm: 400, chloridePpm: 10 }),
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 1 },
      volumes: VOLUMES,
    });
    expect(result.additions).toEqual([]);
    expect(result.rule.reachable).toBe(false);
    expect(result.rule.calciumMet).toBe(false);
    expect(result.warnings.some((w) => w.includes('chloride to 399 ppm'))).toBe(true);
  });

  /**
   * `mash-only` puts the whole schedule in the mash tun and satisfies the rule
   * on the mash water, leaving the sparge untreated. Doses are rounded to
   * 0.01 g here so the 16 L of mash water isn't also testing the rounding.
   */
  it('satisfies the rule in the mash when the sparge is left alone', () => {
    const result = solveWaterRule({
      source: RO_WATER,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
      splitStrategy: 'mash-only',
      roundToGrams: 0.01,
    });
    expect(result.additions.every((a) => a.target === 'mash')).toBe(true);
    expect(result.achieved).toEqual(result.treated.mash);
    for (const ion of WATER_IONS) {
      expect(ionPpm(result.treated.sparge, ion)).toBeCloseTo(ionPpm(RO_WATER, ion), 9);
    }
    expect(Math.abs(result.treated.mash.calciumPpm - 50)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sulfateChlorideRatio(result.treated.mash) - 2) / 2).toBeLessThan(0.01);
    expect(result.rule.calciumMet).toBe(true);
    expect(result.rule.ratioMet).toBe(true);
  });

  /**
   * A salt too small to be worth weighing is dropped, and the verdict covers
   * what's left. With a 3 g minimum, 2.07 g of calcium chloride is dropped and
   * only gypsum remains, which reaches neither the floor nor the balance,
   * because there's no chloride.
   */
  it('drops a dose below the minimum and says the rule went unmet', () => {
    const result = solveWaterRule({
      source: RO_WATER,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
      minSaltGrams: 3,
    });
    expect(result.additions.map((a) => a.salt)).toEqual(['gypsum']);
    expect(result.rule.calciumMet).toBe(false);
    expect(result.rule.ratioMet).toBe(false);
    expect(result.rule.band).toBe('indeterminate');
    expect(result.withinTolerance).toBe(false);
  });

  it('reports the water the rounded doses make, not the water the ideal ones would', () => {
    const result = solveWaterRule({
      source: RO_WATER,
      rule: { minCalciumPpm: 50, sulfateChlorideRatio: 2 },
      volumes: VOLUMES,
      roundToGrams: 0.1,
    });
    for (const addition of result.additions) {
      expect(addition.grams / 0.1).toBeCloseTo(Math.round(addition.grams / 0.1), 6);
    }
    const water = replay(RO_WATER, result);
    for (const ion of WATER_IONS) {
      expect(ionPpm(result.achieved, ion)).toBeCloseTo(ionPpm(water, ion), 9);
    }
    expect(result.rule.calciumAchievedPpm).toBeCloseTo(water.calciumPpm, 9);
    expect(result.rule.ratioAchieved).toBeCloseTo(sulfateChlorideRatio(water), 9);
  });
});
