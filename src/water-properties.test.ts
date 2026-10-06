/**
 * Property and edge-case tests for the water and mash-pH modules.
 *
 * These check properties that should hold for any input, beyond the worked
 * examples: monotonicity, scaling invariance, and round trips. The sweeps use
 * a seeded linear-congruential generator instead of `Math.random` so a failure
 * can be reproduced.
 */

import { describe, expect, it } from 'vitest';
import { BURTON_ON_TRENT, DUBLIN, MUNICH, PILSEN } from './fixtures/water-profiles';
import { ACID_DEFINITIONS, acidifyWater, predictMashPh, solveAdditionsForTargetPh } from './mashPh';
import type { AcidId, FermentableAddition, SaltId, WaterProfile } from './types';
import {
  applySalts,
  diluteProfile,
  ionPpm,
  RO_WATER,
  SALT_DEFINITIONS,
  SALT_IDS,
  saltIonPpmPerGramPerLitre,
  WATER_IONS,
  waterProfile,
} from './water';
import { solveWaterProfile } from './waterSolver';

// ---------------------------------------------------------------------------
// A seeded generator, so a failing case is reproducible
// ---------------------------------------------------------------------------

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const grain = (
  name: string,
  amountKg: number,
  colorLovibond: number,
  extra: Partial<FermentableAddition> = {},
): FermentableAddition => ({
  name,
  amountKg,
  class: 'grain',
  use: 'mash',
  colorLovibond,
  ppg: 37,
  ...extra,
});

const PALE_GRIST: readonly FermentableAddition[] = [
  grain('Pale Ale Malt', 4.5, 3),
  grain('Munich Malt', 0.5, 8),
];

const WATERS: readonly WaterProfile[] = [
  RO_WATER,
  PILSEN.profile,
  MUNICH.profile,
  DUBLIN.profile,
  BURTON_ON_TRENT.profile,
  waterProfile({ calciumPpm: 60, magnesiumPpm: 8, alkalinityPpmAsCaCO3: 120 }),
];

// ---------------------------------------------------------------------------

describe('property: acids lower pH, alkalis raise it', () => {
  it.each(Object.keys(ACID_DEFINITIONS) as AcidId[])(
    'every dose of %s strictly lowers the prediction',
    (acid) => {
      const solid = ACID_DEFINITIONS[acid].usuallySolid;
      for (const water of WATERS) {
        let previous = predictMashPh({ grist: PALE_GRIST, water, mashVolumeL: 15 }).ph;
        for (const amount of [0.5, 1, 2, 4, 8]) {
          const next = predictMashPh({
            grist: PALE_GRIST,
            water,
            mashVolumeL: 15,
            acidAdditions: [solid ? { acid, grams: amount } : { acid, millilitres: amount }],
          }).ph;
          expect(next).toBeLessThan(previous);
          previous = next;
        }
      }
    },
  );

  it.each(['baking-soda', 'chalk', 'slaked-lime'] as const)(
    'every dose of %s strictly raises the prediction',
    (salt) => {
      for (const water of WATERS) {
        let previous = predictMashPh({ grist: PALE_GRIST, water, mashVolumeL: 15 }).ph;
        for (const grams of [0.5, 1, 2, 4]) {
          const treated = applySalts({
            source: water,
            additions: [{ salt, grams, target: 'mash' }],
            volumes: { mashVolumeL: 15, spargeVolumeL: 0 },
          });
          const next = predictMashPh({
            grist: PALE_GRIST,
            water: treated.mash,
            mashVolumeL: 15,
          }).ph;
          expect(next).toBeGreaterThan(previous);
          previous = next;
        }
      }
    },
  );

  it('leaves pH almost untouched by the pH-neutral salts’ counter-ions', () => {
    // Gypsum and calcium chloride only move pH through Kolbach's calcium term,
    // which always pushes it down.
    for (const salt of ['gypsum', 'calcium-chloride-dihydrate', 'epsom-salt'] as const) {
      const before = predictMashPh({
        grist: PALE_GRIST,
        water: MUNICH.profile,
        mashVolumeL: 15,
      }).ph;
      const treated = applySalts({
        source: MUNICH.profile,
        additions: [{ salt, grams: 3, target: 'mash' }],
        volumes: { mashVolumeL: 15, spargeVolumeL: 0 },
      });
      const after = predictMashPh({
        grist: PALE_GRIST,
        water: treated.mash,
        mashVolumeL: 15,
      }).ph;
      expect(after).toBeLessThan(before);
    }
    // Table salt has neither calcium nor magnesium, so it changes nothing.
    const treated = applySalts({
      source: MUNICH.profile,
      additions: [{ salt: 'table-salt', grams: 3, target: 'mash' }],
      volumes: { mashVolumeL: 15, spargeVolumeL: 0 },
    });
    expect(
      predictMashPh({ grist: PALE_GRIST, water: treated.mash, mashVolumeL: 15 }).ph,
    ).toBeCloseTo(
      predictMashPh({ grist: PALE_GRIST, water: MUNICH.profile, mashVolumeL: 15 }).ph,
      9,
    );
  });
});

describe('property: dilution moves pH towards the grist’s DI pH', () => {
  it.each([
    ['Dublin', DUBLIN.profile],
    ['Munich', MUNICH.profile],
    ['Burton', BURTON_ON_TRENT.profile],
    ['Pilsen', PILSEN.profile],
  ] as const)('%s', (_name, source) => {
    const diPh = predictMashPh({ grist: PALE_GRIST, water: RO_WATER, mashVolumeL: 15 }).ph;
    let previousDistance = Number.POSITIVE_INFINITY;
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const ph = predictMashPh({
        grist: PALE_GRIST,
        water: diluteProfile(source, fraction),
        mashVolumeL: 15,
      }).ph;
      const distance = Math.abs(ph - diPh);
      expect(distance).toBeLessThanOrEqual(previousDistance + 1e-9);
      previousDistance = distance;
    }
    expect(previousDistance).toBeCloseTo(0, 9);
  });
});

describe('property: scaling', () => {
  it('keeps mash pH invariant when grist and water scale together', () => {
    for (const water of WATERS) {
      const base = predictMashPh({ grist: PALE_GRIST, water, mashVolumeL: 15 }).ph;
      for (const k of [0.5, 2, 4]) {
        const scaled = predictMashPh({
          grist: PALE_GRIST.map((f) => ({ ...f, amountKg: f.amountKg * k })),
          water,
          mashVolumeL: 15 * k,
        }).ph;
        expect(scaled).toBeCloseTo(base, 6);
      }
    }
  });

  it('keeps acid doses proportional when the whole brew scales', () => {
    const dose = (k: number): number =>
      solveAdditionsForTargetPh({
        targetPh: 5.4,
        agent: { kind: 'acid', acid: 'lactic' },
        grist: PALE_GRIST.map((f) => ({ ...f, amountKg: f.amountKg * k })),
        water: MUNICH.profile,
        mashVolumeL: 15 * k,
      }).amount;
    expect(dose(2)).toBeCloseTo(dose(1) * 2, 4);
  });

  it('scales salt ppm inversely with volume', () => {
    const at20 = applySalts({
      source: RO_WATER,
      additions: [{ salt: 'gypsum', grams: 5, target: 'mash' }],
      volumes: { mashVolumeL: 20, spargeVolumeL: 0 },
    });
    const at40 = applySalts({
      source: RO_WATER,
      additions: [{ salt: 'gypsum', grams: 5, target: 'mash' }],
      volumes: { mashVolumeL: 40, spargeVolumeL: 0 },
    });
    expect(at40.mash.calciumPpm).toBeCloseTo(at20.mash.calciumPpm / 2, 9);
  });
});

describe('property: monotonicity in the water', () => {
  it('predicts a higher pH the more alkaline the water', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (const alkalinity of [0, 25, 50, 100, 200, 300]) {
      const ph = predictMashPh({
        grist: PALE_GRIST,
        water: waterProfile({ calciumPpm: 50, alkalinityPpmAsCaCO3: alkalinity }),
        mashVolumeL: 15,
      }).ph;
      expect(ph).toBeGreaterThan(previous);
      previous = ph;
    }
  });

  it('predicts a lower pH the more calcium the water carries', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const calcium of [0, 25, 50, 100, 200]) {
      const ph = predictMashPh({
        grist: PALE_GRIST,
        water: waterProfile({ calciumPpm: calcium, alkalinityPpmAsCaCO3: 150 }),
        mashVolumeL: 15,
      }).ph;
      expect(ph).toBeLessThan(previous);
      previous = ph;
    }
  });

  it('predicts a lower pH the darker the grist', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const roastKg of [0, 0.1, 0.25, 0.5, 1]) {
      const ph = predictMashPh({
        grist: [grain('Pale Ale Malt', 5 - roastKg, 3), grain('Roasted Barley', roastKg, 500)],
        water: MUNICH.profile,
        mashVolumeL: 15,
      }).ph;
      expect(ph).toBeLessThan(previous);
      previous = ph;
    }
  });
});

describe('property: the solver round trips', () => {
  /**
   * Over a seeded sweep of sources and targets, running the solver's schedule
   * back through the ion accounting must reproduce the profile it reported,
   * and every ion it says is inside tolerance has to be.
   * Tolerance: 1e-9 ppm on the replay.
   */
  it('reproduces its reported profile and its own tolerance claims', () => {
    const random = makeRandom(20260815);
    for (let trial = 0; trial < 60; trial += 1) {
      const source = waterProfile({
        calciumPpm: random() * 120,
        magnesiumPpm: random() * 25,
        sodiumPpm: random() * 40,
        chloridePpm: random() * 80,
        sulfatePpm: random() * 150,
        alkalinityPpmAsCaCO3: random() * 200,
      });
      const target = waterProfile({
        calciumPpm: 40 + random() * 120,
        magnesiumPpm: random() * 20,
        sodiumPpm: random() * 30,
        chloridePpm: random() * 120,
        sulfatePpm: random() * 300,
        bicarbonatePpm: random() * 80,
      });
      const volumes = { mashVolumeL: 10 + random() * 20, spargeVolumeL: random() * 15 };
      const result = solveWaterProfile({ source, target, volumes });

      const replayed = applySalts({ source, additions: result.additions, volumes });
      for (const ion of WATER_IONS) {
        expect(ionPpm(replayed.total, ion)).toBeCloseTo(ionPpm(result.achieved, ion), 9);
      }
      for (const fit of result.fit) {
        expect(fit.withinTolerance).toBe(Math.abs(fit.deltaPpm) <= fit.tolerancePpm);
        expect(Number.isFinite(fit.achievedPpm)).toBe(true);
      }
      expect(result.additions.length).toBeLessThanOrEqual(3);
      expect(Number.isFinite(result.score)).toBe(true);
    }
  });

  it('never makes an ion worse than doing nothing at all, on the weighted score', () => {
    const random = makeRandom(4711);
    for (let trial = 0; trial < 40; trial += 1) {
      const source = waterProfile({
        calciumPpm: random() * 60,
        magnesiumPpm: random() * 10,
        sulfatePpm: random() * 60,
        chloridePpm: random() * 40,
        alkalinityPpmAsCaCO3: random() * 60,
      });
      const target = waterProfile({
        calciumPpm: 80 + random() * 60,
        chloridePpm: 40 + random() * 60,
        sulfatePpm: 60 + random() * 200,
      });
      const volumes = { mashVolumeL: 18, spargeVolumeL: 10 };
      const solved = solveWaterProfile({ source, target, volumes });
      const nothing = solveWaterProfile({ source, target, volumes, maxSalts: 0 });
      expect(solved.score).toBeLessThanOrEqual(nothing.score + 1e-9);
    }
  });
});

describe('property: salt stoichiometry', () => {
  it('keeps every ion contribution linear in the mass added', () => {
    for (const salt of SALT_IDS) {
      const perGram = saltIonPpmPerGramPerLitre(salt);
      for (const grams of [0.5, 3, 17.25]) {
        const treated = applySalts({
          source: RO_WATER,
          additions: [{ salt, grams, target: 'mash' }],
          volumes: { mashVolumeL: 25, spargeVolumeL: 0 },
        });
        for (const ion of WATER_IONS) {
          expect(ionPpm(treated.mash, ion)).toBeCloseTo((perGram[ion] * grams) / 25, 9);
        }
      }
    }
  });

  it('gives the ion ratios of a salt independently of dose and volume', () => {
    for (const salt of SALT_IDS) {
      const perGram = saltIonPpmPerGramPerLitre(salt);
      const nonZero = WATER_IONS.filter((ion) => perGram[ion] > 0);
      const first = nonZero[0];
      if (!first || nonZero.length < 2) continue;
      for (const grams of [1, 9]) {
        for (const volume of [10, 33]) {
          const treated = applySalts({
            source: RO_WATER,
            additions: [{ salt, grams, target: 'mash' }],
            volumes: { mashVolumeL: volume, spargeVolumeL: 0 },
          });
          for (const ion of nonZero.slice(1)) {
            expect(ionPpm(treated.mash, ion) / ionPpm(treated.mash, first)).toBeCloseTo(
              perGram[ion] / perGram[first],
              9,
            );
          }
        }
      }
    }
  });

  /**
   * Anhydrous and dihydrate calcium chloride must differ by the ratio of their
   * formula masses, `147.014 / 110.984 = 1.3246414`, in both ions.
   * Tolerance: 1e-12.
   */
  it('separates the two calcium chloride forms by their formula-mass ratio', () => {
    const ratio =
      SALT_DEFINITIONS['calcium-chloride-dihydrate'].molarMassGPerMol /
      SALT_DEFINITIONS['calcium-chloride-anhydrous'].molarMassGPerMol;
    for (const grams of [1, 2.5, 7]) {
      const dihydrate = applySalts({
        source: RO_WATER,
        additions: [{ salt: 'calcium-chloride-dihydrate', grams, target: 'mash' }],
        volumes: { mashVolumeL: 20, spargeVolumeL: 0 },
      }).mash;
      const anhydrous = applySalts({
        source: RO_WATER,
        additions: [{ salt: 'calcium-chloride-anhydrous', grams, target: 'mash' }],
        volumes: { mashVolumeL: 20, spargeVolumeL: 0 },
      }).mash;
      expect(anhydrous.calciumPpm / dihydrate.calciumPpm).toBeCloseTo(ratio, 12);
      expect(anhydrous.chloridePpm / dihydrate.chloridePpm).toBeCloseTo(ratio, 12);
      expect(anhydrous.calciumPpm).toBeGreaterThan(dihydrate.calciumPpm);
    }
    expect(ratio).toBeCloseTo(1.3246414, 6);
  });
});

describe('edge case: zero-alkalinity RO source', () => {
  it('sits exactly on the grist DI pH and needs no sparge acid', () => {
    const result = predictMashPh({ grist: PALE_GRIST, water: RO_WATER, mashVolumeL: 15 });
    // Buffering: 4.5 × 41 + 0.5 × 46 = 184.5 + 23 = 207.5 mEq/pH.
    // Weighted DI pH = (184.5 × 5.72 + 23 × 5.54) / 207.5 = 5.70005.
    expect(result.totalBufferingMEqPerPh).toBeCloseTo(207.5, 9);
    expect(result.ph).toBeCloseTo(5.70005, 4);
    expect(result.residualAlkalinityPpm).toBe(0);
    expect(result.effectiveAlkalinityMEq).toBe(0);
    expect(acidifyWater({ profile: RO_WATER, volumeL: 20 }).milliequivalents).toBe(0);
  });

  it('is completely insensitive to the assumed water pH', () => {
    for (const assumed of [6, 7, 7.5, 8.5]) {
      expect(
        predictMashPh({
          grist: PALE_GRIST,
          water: RO_WATER,
          mashVolumeL: 15,
          options: { assumedSourceWaterPh: assumed },
        }).ph,
      ).toBeCloseTo(5.70005, 4);
    }
  });
});

describe('edge case: 100 % roasted grist', () => {
  const roasted = [grain('Roasted Barley', 5, 500)];

  it('lands on the roasted class DI pH in RO water', () => {
    const result = predictMashPh({ grist: roasted, water: RO_WATER, mashVolumeL: 15 });
    expect(result.ph).toBeCloseTo(4.68, 4);
    expect(result.warnings.some((w) => w.includes('below 5.2'))).toBe(true);
  });

  it('barely moves even in Burton water, because it is so heavily buffered', () => {
    const burton = predictMashPh({
      grist: roasted,
      water: BURTON_ON_TRENT.profile,
      mashVolumeL: 15,
    }).ph;
    expect(burton).toBeGreaterThan(4.68);
    expect(burton).toBeLessThan(4.85);
  });

  it('wants an alkali, and the solver finds one', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 5.4,
      agent: { kind: 'alkali', salt: 'baking-soda' },
      grist: roasted,
      water: RO_WATER,
      mashVolumeL: 15,
    });
    expect(solution.amount).toBeGreaterThan(0);
    expect(solution.achievedPh).toBeCloseTo(5.4, 3);
  });
});

describe('edge case: acidulated malt only', () => {
  const acidOnly = [grain('Acidulated Malt', 5, 3)];

  it('drives the mash far below the base malt DI pH', () => {
    const result = predictMashPh({ grist: acidOnly, water: RO_WATER, mashVolumeL: 15 });
    // 5 kg × 3 % = 150 g of lactic = 1665.2 mmol against 205 mEq/pH of buffering,
    // which drives the balance to the bottom of the search bracket.
    expect(result.ph).toBeLessThan(4);
    expect(result.contributions.acidulatedMaltMEq).toBeGreaterThan(0);
  });

  it('is a normal grist once diluted to a sane proportion', () => {
    const result = predictMashPh({
      grist: [grain('Pilsner', 4.85, 1.6), grain('Acidulated Malt', 0.15, 3)],
      water: MUNICH.profile,
      mashVolumeL: 15,
    });
    expect(result.ph).toBeGreaterThan(5.2);
    expect(result.ph).toBeLessThan(5.7);
  });
});

describe('edge case: nothing to mash', () => {
  it('returns NaN rather than a plausible-looking lie for an all-extract recipe', () => {
    const result = predictMashPh({
      grist: [{ ...grain('Pale DME', 3, 4), class: 'dry-extract' }],
      water: MUNICH.profile,
      mashVolumeL: 15,
    });
    expect(Number.isNaN(result.ph)).toBe(true);
    expect(result.totalBufferingMEqPerPh).toBe(0);
    expect(result.warnings.some((w) => w.includes('undefined'))).toBe(true);
    expect(result.explain.notes?.[0]).toContain('Undefined');
  });

  it('returns NaN for an empty grist', () => {
    expect(Number.isNaN(predictMashPh({ grist: [], water: RO_WATER, mashVolumeL: 15 }).ph)).toBe(
      true,
    );
  });

  it('does not try to solve for a target it cannot define', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 5.4,
      agent: { kind: 'acid', acid: 'lactic' },
      grist: [],
      water: MUNICH.profile,
      mashVolumeL: 15,
    });
    expect(solution.amount).toBe(0);
    expect(solution.unreachable).toBe(true);
  });

  it('handles a zero-volume mash without dividing by zero', () => {
    const result = predictMashPh({ grist: PALE_GRIST, water: MUNICH.profile, mashVolumeL: 0 });
    expect(result.ph).toBeCloseTo(5.70005, 4);
    expect(Number.isFinite(result.thicknessLPerKg)).toBe(true);
  });

  it('handles a zero-mass grist entry mid-edit', () => {
    const result = predictMashPh({
      grist: [grain('Pilsner', 5, 1.6), grain('Crystal 60', 0, 60)],
      water: RO_WATER,
      mashVolumeL: 15,
    });
    expect(result.ph).toBeCloseTo(5.72, 4);
  });
});

describe('edge case: target already achieved', () => {
  it('returns a zero dose for an acid when the mash is already at or below target', () => {
    for (const targetPh of [5.72, 5.9, 6.5]) {
      const solution = solveAdditionsForTargetPh({
        targetPh,
        agent: { kind: 'acid', acid: 'lactic' },
        grist: [grain('Pilsner', 5, 1.6)],
        water: RO_WATER,
        mashVolumeL: 15,
      });
      expect(solution.amount).toBe(0);
      expect(solution.unreachable).toBe(false);
    }
  });

  it('returns no salts when the water already is the target', () => {
    for (const profile of [PILSEN.profile, MUNICH.profile, DUBLIN.profile]) {
      const result = solveWaterProfile({
        source: profile,
        target: profile,
        volumes: { mashVolumeL: 16, spargeVolumeL: 12 },
      });
      expect(result.additions).toEqual([]);
      expect(result.score).toBeCloseTo(0, 9);
    }
  });
});

describe('nothing ever returns a surprise NaN', () => {
  it('survives a seeded sweep of grists, waters and volumes', () => {
    const random = makeRandom(90210);
    const salts: readonly SaltId[] = SALT_IDS;
    for (let trial = 0; trial < 80; trial += 1) {
      const water = waterProfile({
        calciumPpm: random() * 300,
        magnesiumPpm: random() * 50,
        sodiumPpm: random() * 100,
        chloridePpm: random() * 200,
        sulfatePpm: random() * 700,
        alkalinityPpmAsCaCO3: random() * 300,
      });
      const grist = [
        grain('Base', random() * 8, 2),
        grain('Crystal 60', random() * 1, 60),
        grain('Carafa', random() * 0.5, 400),
      ];
      const mashVolumeL = random() * 40;
      const salt = salts[Math.floor(random() * salts.length)] ?? 'gypsum';
      const treated = applySalts({
        source: water,
        additions: [{ salt, grams: random() * 10, target: 'mash' }],
        volumes: { mashVolumeL, spargeVolumeL: random() * 20 },
      });
      const result = predictMashPh({
        grist,
        water: treated.mash,
        mashVolumeL,
        acidAdditions: [{ acid: 'lactic', millilitres: random() * 5 }],
      });
      if (result.totalBufferingMEqPerPh > 0) {
        expect(Number.isFinite(result.ph)).toBe(true);
        expect(result.ph).toBeGreaterThan(2.9);
        expect(result.ph).toBeLessThan(9.1);
      } else {
        expect(Number.isNaN(result.ph)).toBe(true);
      }
      for (const ion of WATER_IONS) {
        expect(Number.isFinite(ionPpm(treated.total, ion))).toBe(true);
      }
    }
  });
});
