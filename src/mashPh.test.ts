import { describe, expect, it } from 'vitest';
import { ACID_STRENGTH_FIXTURES, DUBLIN, MUNICH, PILSEN } from './fixtures/water-profiles';
import {
  ACID_DEFINITIONS,
  acidConcentrationPercent,
  acidifyWater,
  acidMilliequivalentsAtPh,
  acidMillimoles,
  acidMillimolesPerGram,
  acidMillimolesPerMillilitre,
  acidSolutionDensity,
  acidStrengthMEqPerUnit,
  alkaliBaseMEqPerGramAtPh,
  alkalinityAtPh,
  CARBONIC_PKA,
  CRYSTAL_BUFFERING_MAX,
  carbonateProtonsDonated,
  crystalMaltPhDefaults,
  DEFAULT_ACIDULATED_MALT_PERCENT_LACTIC,
  DEFAULT_MASH_PH_OPTIONS,
  DEFAULT_SPARGE_TARGET_PH,
  equivalentsPerMillimole,
  inferMaltPhClass,
  MALT_PH_DEFAULTS,
  predictMashPh,
  protonsDonatedPerMolecule,
  resolveMaltTitrations,
  resolveMashPhOptions,
  solveAdditionsForTargetPh,
  totalCarbonateMMolPerLitre,
} from './mashPh';
import type { AcidId, FermentableAddition, WaterProfile } from './types';
import { RO_WATER, waterProfile } from './water';

// ---------------------------------------------------------------------------
// Grists used throughout
// ---------------------------------------------------------------------------

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

/** 5 kg of pilsner malt, the grist the worked example uses. */
const PILSNER_GRIST: readonly FermentableAddition[] = [grain('Weyermann Pilsner', 5, 1.6)];

/**
 * The mash water in the worked example: 50 ppm Ca, 5 ppm Mg, 100 ppm alkalinity
 * as CaCO₃ (= 121.927 ppm HCO₃), pH not stated so 7.5 is assumed.
 */
const MODERATE_WATER: WaterProfile = waterProfile({
  calciumPpm: 50,
  magnesiumPpm: 5,
  sodiumPpm: 10,
  chloridePpm: 20,
  sulfatePpm: 30,
  alkalinityPpmAsCaCO3: 100,
});

// ---------------------------------------------------------------------------

describe('polyprotic speciation', () => {
  /**
   * `f(pH) = Σ j·10^(j·pH − Σ pKa) / Σ 10^(j·pH − Σ pKa)`, the mean number of
   * protons a molecule has donated. Worked longhand in the fixture header.
   * Tolerance: 5e-4 protons.
   */
  it.each([
    ['lactic', 0.972],
    ['phosphoric', 1.0151],
    ['citric', 1.9015],
    ['acetic', 0.815],
    ['hydrochloric', 1],
    ['sulfuric', 1.9996],
  ] as const)('%s donates %f protons at pH 5.40', (acid, expected) => {
    expect(protonsDonatedPerMolecule(ACID_DEFINITIONS[acid].pKa, 5.4)).toBeCloseTo(expected, 3);
  });

  it('is exactly half-dissociated at its own pKa', () => {
    expect(protonsDonatedPerMolecule([4.5], 4.5)).toBeCloseTo(0.5, 12);
  });

  it('rises monotonically with pH for every acid', () => {
    for (const acid of Object.keys(ACID_DEFINITIONS) as AcidId[]) {
      const pKa = ACID_DEFINITIONS[acid].pKa;
      for (let ph = 3; ph < 9; ph += 0.25) {
        expect(protonsDonatedPerMolecule(pKa, ph + 0.25)).toBeGreaterThanOrEqual(
          protonsDonatedPerMolecule(pKa, ph),
        );
      }
    }
  });

  it('approaches 0 at low pH and n at high pH without overflowing', () => {
    expect(protonsDonatedPerMolecule([3.128, 4.761, 6.396], -5)).toBeCloseTo(0, 7);
    expect(protonsDonatedPerMolecule([3.128, 4.761, 6.396], 20)).toBeCloseTo(3, 9);
    expect(Number.isFinite(protonsDonatedPerMolecule([-6], 14))).toBe(true);
  });

  it('treats a strong acid as fully dissociated across the whole brewing range', () => {
    for (const ph of [3, 4, 5.4, 6, 8]) {
      expect(protonsDonatedPerMolecule([-6], ph)).toBeCloseTo(1, 6);
    }
  });

  /**
   * Phosphoric's second proton makes tabulated equivalence numbers wrong. It
   * delivers 1.015 eq/mol at pH 5.40 but 1.059 at pH 6.0 and 1.14 at 6.4.
   * Citric goes the other way, with nearly 2 eq/mol at mash pH instead of 3.
   */
  it('tracks phosphoric’s second proton and citric’s third', () => {
    const phosphoric = ACID_DEFINITIONS.phosphoric.pKa;
    expect(protonsDonatedPerMolecule(phosphoric, 5.4)).toBeCloseTo(1.0151, 4);
    expect(protonsDonatedPerMolecule(phosphoric, 6.4)).toBeGreaterThan(1.13);
    const citric = ACID_DEFINITIONS.citric.pKa;
    expect(protonsDonatedPerMolecule(citric, 5.4)).toBeLessThan(2);
    expect(protonsDonatedPerMolecule(citric, 8)).toBeGreaterThan(2.9);
  });

  it('turns a conjugate base into negative equivalents', () => {
    // Bicarbonate at mash pH takes back ~0.9 protons per millimole.
    expect(equivalentsPerMillimole(CARBONIC_PKA, 5.4, 1)).toBeCloseTo(0.1008 - 1, 3);
    // Carbonate takes back ~1.9.
    expect(equivalentsPerMillimole(CARBONIC_PKA, 5.4, 2)).toBeCloseTo(0.1008 - 2, 3);
  });
});

describe('carbonate system', () => {
  /**
   * `f_carbonic` at the pH values that matter, from pKa 6.35 / 10.33.
   * At pH 5.40: `α₁ = 1/(1 + 10^(6.35−5.40)) = 0.1009`.
   * Tolerance: 5e-4.
   */
  it.each([
    [5.4, 0.1009],
    [5.5, 0.1239],
    [7.0, 0.8176],
    [7.5, 0.9354],
    [8.3, 0.9982],
  ])('f_carbonic(%f) = %f', (ph, expected) => {
    expect(carbonateProtonsDonated(ph)).toBeCloseTo(expected, 3);
  });

  /**
   * `C_T = Alk / f(pH)`. 100 ppm as CaCO₃ = 1.99828 mEq/L; at
   * pH 7.5 that implies `1.99828 / 0.93536 = 2.13638 mmol/L` of total carbonate.
   * Tolerance: 1e-3 mmol/L.
   */
  it('back-calculates total carbonate from alkalinity and pH', () => {
    expect(totalCarbonateMMolPerLitre(1.99828, 7.5)).toBeCloseTo(2.1361, 3);
  });

  it('round trips alkalinity through the speciation', () => {
    for (const ph of [7, 7.5, 8, 8.3]) {
      const ct = totalCarbonateMMolPerLitre(2, ph);
      expect(alkalinityAtPh(ct, ph)).toBeCloseTo(2, 9);
    }
  });

  it('leaves about a tenth of the alkalinity untitrated at mash pH', () => {
    const ct = totalCarbonateMMolPerLitre(2, 7.5);
    // 1 − f(5.4)/f(7.5) = 1 − 0.100889 / 0.935356 = 0.89214.
    const fraction = (2 - alkalinityAtPh(ct, 5.4)) / 2;
    expect(fraction).toBeCloseTo(0.89214, 4);
  });

  it('is barely sensitive to the assumed source water pH', () => {
    const at70 = 2 - alkalinityAtPh(totalCarbonateMMolPerLitre(2, 7.0), 5.4);
    const at83 = 2 - alkalinityAtPh(totalCarbonateMMolPerLitre(2, 8.3), 5.4);
    expect(Math.abs(at83 - at70)).toBeLessThan(0.05);
  });

  it('finds exactly no carbonate in water with no alkalinity', () => {
    expect(totalCarbonateMMolPerLitre(0, 7.5)).toBe(0);
    expect(alkalinityAtPh(0, 5.4)).toBe(0);
  });
});

describe('acid strengths', () => {
  /**
   * `mmol/mL = density × (w/w ÷ 100) × 1000 / M`, with the arithmetic written
   * out in the fixture. The figure brewers usually quote, 88 % lactic at
   * ~11.8 mEq/mL, comes out of it.
   * Tolerance: 0.005 mmol/mL, 0.02 mEq/mL.
   */
  it.each(ACID_STRENGTH_FIXTURES.map((f) => [`${f.acid} ${f.concentrationPercent} %`, f] as const))(
    '%s',
    (_name, fixture) => {
      const acid = fixture.acid as AcidId;
      expect(acidMillimolesPerMillilitre(acid, fixture.concentrationPercent)).toBeCloseTo(
        fixture.mmolPerMl,
        2,
      );
      expect(protonsDonatedPerMolecule(ACID_DEFINITIONS[acid].pKa, 5.4)).toBeCloseTo(
        fixture.protonsAtPh54,
        3,
      );
      expect(acidStrengthMEqPerUnit(acid, 5.4, fixture.concentrationPercent)).toBeCloseTo(
        fixture.mEqPerMlAtPh54,
        1,
      );
    },
  );

  it('gives 88 % lactic acid the published ~11.8 mEq/mL', () => {
    expect(acidStrengthMEqPerUnit('lactic', 5.4)).toBeCloseTo(11.48, 2);
    expect(acidMillimolesPerMillilitre('lactic', 88)).toBeCloseTo(11.811, 3);
  });

  it('weighs citric acid as the monohydrate', () => {
    // 1000 / 210.139 = 4.7588 mmol/g, not 1000/192.124 = 5.205.
    expect(acidMillimolesPerGram('citric', 100)).toBeCloseTo(4.7588, 3);
    expect(ACID_DEFINITIONS.citric.solidMolarMassGPerMol).toBeCloseTo(210.139, 3);
  });

  it('interpolates the density table and clamps outside it', () => {
    expect(acidSolutionDensity('lactic', 88)).toBeCloseTo(1.209, 6);
    expect(acidSolutionDensity('lactic', 84)).toBeCloseTo((1.186 + 1.209) / 2, 3);
    expect(acidSolutionDensity('lactic', -10)).toBeCloseTo(0.9982, 6);
    expect(acidSolutionDensity('phosphoric', 200)).toBeCloseTo(1.685, 6);
  });

  it('handles acetic acid’s non-monotone density', () => {
    expect(acidSolutionDensity('acetic', 80)).toBeGreaterThan(acidSolutionDensity('acetic', 100));
  });

  it('reads the amount from millilitres or grams and defaults the strength', () => {
    expect(acidConcentrationPercent({ acid: 'lactic' })).toBe(88);
    expect(acidConcentrationPercent({ acid: 'lactic', concentrationPercent: 80 })).toBe(80);
    expect(acidMillimoles({ acid: 'lactic', millilitres: 2 })).toBeCloseTo(23.622, 2);
    expect(acidMillimoles({ acid: 'citric', grams: 10 })).toBeCloseTo(47.588, 2);
    expect(acidMilliequivalentsAtPh({ acid: 'lactic', millilitres: 1 }, 5.4)).toBeCloseTo(11.48, 2);
  });

  it('scales linearly with volume', () => {
    expect(acidMillimoles({ acid: 'lactic', millilitres: 4 })).toBeCloseTo(
      4 * acidMillimoles({ acid: 'lactic', millilitres: 1 }),
      9,
    );
  });
});

describe('alkaline additions', () => {
  /**
   * Baking soda at mash pH: `1000/84.006 = 11.904 mmol/g`, each absorbing
   * `1 − 0.1009 = 0.8991` protons → 10.70 mEq of base per gram.
   * Tolerance: 0.02 mEq/g.
   */
  it('costs baking soda at ~10.7 mEq of base per gram at pH 5.4', () => {
    expect(alkaliBaseMEqPerGramAtPh('baking-soda', 5.4)).toBeCloseTo(10.7, 1);
  });

  it('gives chalk ~19 mEq/g and slaked lime ~27 mEq/g', () => {
    // Chalk: 9.991 mmol/g × (2 − 0.1009) = 18.97.
    expect(alkaliBaseMEqPerGramAtPh('chalk', 5.4)).toBeCloseTo(18.97, 1);
    // Lime: 13.497 mmol/g × 2 = 26.99.
    expect(alkaliBaseMEqPerGramAtPh('slaked-lime', 5.4)).toBeCloseTo(26.99, 1);
  });

  it('gives the pH-neutral salts no base at all', () => {
    for (const salt of [
      'gypsum',
      'calcium-chloride-dihydrate',
      'epsom-salt',
      'table-salt',
    ] as const) {
      expect(alkaliBaseMEqPerGramAtPh(salt, 5.4)).toBe(0);
    }
  });
});

describe('malt classification', () => {
  it.each([
    ['Weyermann Pilsner', 1.6, 'grain', 'base'],
    ['Maris Otter Pale Ale', 3, 'grain', 'base'],
    ['Munich Malt I', 8, 'grain', 'munich-vienna'],
    ['Vienna Malt', 4, 'grain', 'munich-vienna'],
    ['Wheat Malt, Pale', 2, 'grain', 'wheat-other'],
    ['Flaked Oats', 1, 'grain', 'wheat-other'],
    ['Caramunich III', 57, 'steeping-grain', 'crystal'],
    ['Crystal 60', 60, 'steeping-grain', 'crystal'],
    ['Special B', 180, 'steeping-grain', 'crystal'],
    ['Carafa Special II', 425, 'steeping-grain', 'roasted'],
    ['Roasted Barley', 500, 'steeping-grain', 'roasted'],
    ['Chocolate Malt', 350, 'steeping-grain', 'roasted'],
    ['Acidulated Malt', 3, 'grain', 'acidulated'],
    ['Sauermalz', 3, 'grain', 'acidulated'],
  ] as const)('classifies %s', (name, color, cls, expected) => {
    expect(inferMaltPhClass({ ...grain(name, 1, color), class: cls })).toBe(expected);
  });

  it('gives sugars and extracts no titration curve', () => {
    expect(inferMaltPhClass({ ...grain('Corn Sugar', 1, 0), class: 'sugar' })).toBe('none');
    expect(inferMaltPhClass({ ...grain('Pale DME', 1, 4), class: 'dry-extract' })).toBe('none');
  });

  it('lets an explicit catalog class win over every heuristic', () => {
    expect(inferMaltPhClass({ ...grain('Something Odd', 1, 400), ph: { maltClass: 'base' } })).toBe(
      'base',
    );
  });

  it('falls back to colour for an unrecognised name', () => {
    expect(inferMaltPhClass(grain('Mystery Grain', 1, 2))).toBe('base');
    expect(inferMaltPhClass(grain('Mystery Grain', 1, 40))).toBe('crystal');
    expect(inferMaltPhClass(grain('Mystery Grain', 1, 400))).toBe('roasted');
  });
});

describe('malt titration defaults', () => {
  it('uses the documented class defaults', () => {
    expect(MALT_PH_DEFAULTS.base).toEqual({
      distilledWaterPh: 5.72,
      bufferingCapacityMEqPerKgPerPh: 41,
    });
    expect(MALT_PH_DEFAULTS['munich-vienna'].distilledWaterPh).toBeLessThan(
      MALT_PH_DEFAULTS.base.distilledWaterPh,
    );
    expect(MALT_PH_DEFAULTS['wheat-other'].distilledWaterPh).toBeGreaterThan(
      MALT_PH_DEFAULTS.base.distilledWaterPh,
    );
    expect(MALT_PH_DEFAULTS.roasted.bufferingCapacityMEqPerKgPerPh).toBeGreaterThan(
      MALT_PH_DEFAULTS.base.bufferingCapacityMEqPerKgPerPh,
    );
  });

  /** `pH_DI = 5.42 − 0.00727 × °L`, `B = 45 + 0.35 × °L`, both clamped. */
  it('fits crystal malt to its colour', () => {
    expect(crystalMaltPhDefaults(10).distilledWaterPh).toBeCloseTo(5.3473, 3);
    expect(crystalMaltPhDefaults(60).distilledWaterPh).toBeCloseTo(4.9838, 3);
    expect(crystalMaltPhDefaults(60).bufferingCapacityMEqPerKgPerPh).toBeCloseTo(66, 3);
    // Clamped at the dark end.
    expect(crystalMaltPhDefaults(400).distilledWaterPh).toBeCloseTo(4.4, 6);
    expect(crystalMaltPhDefaults(400).bufferingCapacityMEqPerKgPerPh).toBe(CRYSTAL_BUFFERING_MAX);
  });

  it('darker crystal is always more acidic and better buffered', () => {
    for (let color = 5; color < 150; color += 5) {
      expect(crystalMaltPhDefaults(color + 5).distilledWaterPh).toBeLessThanOrEqual(
        crystalMaltPhDefaults(color).distilledWaterPh,
      );
      expect(
        crystalMaltPhDefaults(color + 5).bufferingCapacityMEqPerKgPerPh,
      ).toBeGreaterThanOrEqual(crystalMaltPhDefaults(color).bufferingCapacityMEqPerKgPerPh);
    }
  });

  it('lets a maltster’s published DI pH override the class without losing the class buffering', () => {
    const [titration] = resolveMaltTitrations([
      grain('Custom Pilsner', 5, 1.6, { ph: { distilledWaterPh: 5.81 } }),
    ]);
    expect(titration?.distilledWaterPh).toBe(5.81);
    expect(titration?.bufferingCapacityMEqPerKgPerPh).toBe(41);
    expect(titration?.fromPublishedData).toBe(false);
  });

  it('marks a fully-specified malt as coming from published data', () => {
    const [titration] = resolveMaltTitrations([
      grain('Measured Malt', 5, 1.6, {
        ph: { distilledWaterPh: 5.81, bufferingCapacityMEqPerKgPerPh: 44 },
      }),
    ]);
    expect(titration?.fromPublishedData).toBe(true);
    expect(titration?.bufferingMEqPerPh).toBeCloseTo(220, 9);
  });

  /**
   * Acidulated malt at the default 3 % w/w: 1 kg carries 30 g of lactic acid,
   * `30 / 90.078 × 1000 = 333.0 mmol`.
   * Tolerance: 0.1 mmol.
   */
  it('reads lactic acid off acidulated malt', () => {
    const [titration] = resolveMaltTitrations([grain('Acidulated Malt', 1, 3)]);
    expect(DEFAULT_ACIDULATED_MALT_PERCENT_LACTIC).toBe(3);
    expect(titration?.lacticAcidMMol).toBeCloseTo(333.05, 1);
    // Otherwise it's a base malt.
    expect(titration?.distilledWaterPh).toBe(5.72);
  });

  it('honours a per-product acid content', () => {
    const [titration] = resolveMaltTitrations([
      grain('Acid Malt', 1, 3, { ph: { acidContentPercentLactic: 2 } }),
    ]);
    expect(titration?.lacticAcidMMol).toBeCloseTo(222.03, 1);
  });
});

describe('predicted mash pH', () => {
  /**
   * Golden worked example, computed longhand.
   *
   * 5 kg pilsner malt (DI pH 5.72, 41 mEq/(kg·pH) → 205 mEq/pH of buffering) in
   * 15 L of water with 50 ppm Ca, 5 ppm Mg and 100 ppm alkalinity as CaCO₃,
   * water pH assumed 7.5.
   *
   * ```
   * alkalinity      100 / 50.043            = 1.99828 mEq/L
   * f_carbonic(7.5)                          = 0.93536
   * C_T             1.99828 / 0.93536        = 2.13638 mmol/L
   * Ca              50 / 20.039 = 2.4951 mEq/L → /3.5 × 15 L = 10.693 mEq acid
   * Mg              5 / 12.1525 = 0.4114     → /7   × 15 L =  0.882 mEq acid
   * solve  205 × (5.72 − pH) = 10.693 + 0.882 − 15 × [1.99828 − C_T·f(pH)]
   *   → pH = 5.7768
   * at that pH  f_carbonic(5.7768) = 0.21094, so the water still holds
   *   2.13638 × 0.21094 = 0.45064 mEq/L and has given up
   *   (1.99828 − 0.45064) × 15 = 23.22 mEq of base, 77.5 % of what was measured.
   * ```
   *
   * Tolerance: 0.002 pH (the fixture value is quoted to 4 dp and the model
   * converges to 1e-6).
   */
  it('matches the longhand worked example', () => {
    const result = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    });
    expect(result.ph).toBeCloseTo(5.7768, 3);
    expect(result.distilledWaterPh).toBeCloseTo(5.72, 9);
    expect(result.totalBufferingMEqPerPh).toBeCloseTo(205, 9);
    expect(result.thicknessLPerKg).toBeCloseTo(3, 9);
    expect(result.contributions.calciumMEq).toBeCloseTo(10.693, 2);
    expect(result.contributions.magnesiumMEq).toBeCloseTo(0.882, 2);
    expect(result.effectiveAlkalinityMEq).toBeCloseTo(23.22, 1);
    expect(result.contributions.waterAlkalinityMEq).toBeCloseTo(-23.22, 1);
  });

  it('reports which formula ran and how it converged', () => {
    const result = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    });
    expect(result.explain.formula).toBe('charge-balance-troester');
    expect(result.explain.unit).toBe('pH');
    expect(result.iterations).toBeLessThanOrEqual(DEFAULT_MASH_PH_OPTIONS.maxIterations);
    expect(result.explain.inputs.alkalinityModel).toBe('titrated-to-mash-ph');
  });

  /**
   * With `full-alkalinity` the whole measured alkalinity counts, which pushes
   * the prediction up: 5.8098 instead of 5.7768. That 0.03 pH is the systematic
   * bias in calculators that don't model the carbonate speciation.
   * Tolerance: 0.002 pH.
   */
  it('predicts higher under the full-alkalinity model', () => {
    const full = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
      options: { alkalinityModel: 'full-alkalinity' },
    });
    expect(full.ph).toBeCloseTo(5.8098, 3);
    expect(full.ph).toBeGreaterThan(
      predictMashPh({ grist: PILSNER_GRIST, water: MODERATE_WATER, mashVolumeL: 15 }).ph,
    );
  });

  it('lands exactly on the grist’s DI pH in distilled water', () => {
    const result = predictMashPh({ grist: PILSNER_GRIST, water: RO_WATER, mashVolumeL: 15 });
    expect(result.ph).toBeCloseTo(5.72, 5);
    expect(result.residualAlkalinityPpm).toBe(0);
  });

  it('weights the DI pH of a mixed grist by buffering, not by mass', () => {
    const grist = [grain('Pilsner', 4, 1.6), grain('Roasted Barley', 1, 500)];
    const result = predictMashPh({ grist, water: RO_WATER, mashVolumeL: 15 });
    // Buffering: 4 × 41 = 164 and 1 × 100 = 100, total 264 mEq/pH.
    // Weighted DI pH = (164 × 5.72 + 100 × 4.68) / 264 = 5.3261.
    expect(result.totalBufferingMEqPerPh).toBeCloseTo(264, 9);
    expect(result.distilledWaterPh).toBeCloseTo(5.3261, 3);
    expect(result.ph).toBeCloseTo(5.3261, 3);
  });

  /**
   * The most important calibration check: 1 % acidulated malt in the grist
   * lowers mash pH by about 0.08, at the low end of the commonly quoted
   * 0.07–0.10 rule of thumb.
   *
   * ```
   * 50 g acid malt × 3 % = 1.5 g lactic = 16.65 mmol
   * at pH 5.64 it delivers 16.65 × 0.9827 = 16.36 mEq
   * over 205 mEq/pH → 0.0798 pH
   * ```
   * Tolerance: 0.005 pH.
   */
  it('drops pH by ~0.08 per 1 % acidulated malt', () => {
    const base = predictMashPh({ grist: PILSNER_GRIST, water: RO_WATER, mashVolumeL: 15 }).ph;
    const withAcidMalt = predictMashPh({
      grist: [grain('Pilsner', 4.95, 1.6), grain('Acidulated Malt', 0.05, 3)],
      water: RO_WATER,
      mashVolumeL: 15,
    }).ph;
    expect(base - withAcidMalt).toBeCloseTo(0.08, 2);
  });

  it('scales acidulated malt roughly linearly', () => {
    const drop = (kg: number): number =>
      predictMashPh({ grist: PILSNER_GRIST, water: RO_WATER, mashVolumeL: 15 }).ph -
      predictMashPh({
        grist: [grain('Pilsner', 5 - kg, 1.6), grain('Acidulated Malt', kg, 3)],
        water: RO_WATER,
        mashVolumeL: 15,
      }).ph;
    expect(drop(0.1) / drop(0.05)).toBeCloseTo(2, 1);
  });

  /**
   * Thickness matters because the water's contribution scales with litres and
   * the grist's with kilograms. With the same grist and water, a mash twice as
   * thick has a measurably lower pH.
   */
  it('predicts a lower pH for a thicker mash in alkaline water', () => {
    const thin = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 20,
    }).ph;
    const thick = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 10,
    }).ph;
    expect(thick).toBeLessThan(thin);
  });

  it('does not care about thickness in distilled water', () => {
    const thin = predictMashPh({ grist: PILSNER_GRIST, water: RO_WATER, mashVolumeL: 25 }).ph;
    const thick = predictMashPh({ grist: PILSNER_GRIST, water: RO_WATER, mashVolumeL: 8 }).ph;
    expect(thick).toBeCloseTo(thin, 5);
  });

  it('pushes pH up with Dublin water and pulls it down with Pilsen', () => {
    const dublin = predictMashPh({
      grist: PILSNER_GRIST,
      water: DUBLIN.profile,
      mashVolumeL: 15,
    }).ph;
    const pilsen = predictMashPh({
      grist: PILSNER_GRIST,
      water: PILSEN.profile,
      mashVolumeL: 15,
    }).ph;
    const munich = predictMashPh({
      grist: PILSNER_GRIST,
      water: MUNICH.profile,
      mashVolumeL: 15,
    }).ph;
    expect(pilsen).toBeLessThan(munich);
    expect(munich).toBeLessThan(dublin);
    expect(pilsen).toBeCloseTo(5.72, 1);
  });

  it('warns outside the 5.2–5.6 window', () => {
    const high = predictMashPh({ grist: PILSNER_GRIST, water: DUBLIN.profile, mashVolumeL: 15 });
    expect(high.warnings.some((w) => w.includes('above 5.6'))).toBe(true);
    const low = predictMashPh({
      grist: PILSNER_GRIST,
      water: RO_WATER,
      mashVolumeL: 15,
      acidAdditions: [{ acid: 'lactic', millilitres: 15 }],
    });
    expect(low.warnings.some((w) => w.includes('below 5.2'))).toBe(true);
  });

  it('says it assumed a source water pH when the report did not give one', () => {
    const result = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    });
    expect(result.warnings.some((w) => w.includes('pH was not given'))).toBe(true);
    const stated = predictMashPh({
      grist: PILSNER_GRIST,
      water: { ...MODERATE_WATER, ph: 7.8 },
      mashVolumeL: 15,
    });
    expect(stated.warnings.some((w) => w.includes('pH was not given'))).toBe(false);
  });

  it('ignores acids targeted at the sparge', () => {
    const withSparge = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
      acidAdditions: [{ acid: 'lactic', millilitres: 5, target: 'sparge' }],
    });
    const without = predictMashPh({
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    });
    expect(withSparge.ph).toBeCloseTo(without.ph, 9);
  });
});

describe('solving for a target mash pH', () => {
  /**
   * From 5.7769 to 5.40 the grist has to absorb `205 × 0.3769 = 77.3 mEq`, and
   * the water gives up a little more base on the way down, so the answer is a
   * little above `77.3 / 11.48 = 6.73 mL` of 88 % lactic.
   * Tolerance: 0.05 mL, and the achieved pH to 1e-4.
   */
  it('doses lactic acid to hit the target and lands on it', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 5.4,
      agent: { kind: 'acid', acid: 'lactic' },
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    });
    expect(solution.unit).toBe('mL');
    expect(solution.amount).toBeCloseTo(7.04, 1);
    expect(solution.achievedPh).toBeCloseTo(5.4, 4);
    expect(solution.baselinePh).toBeCloseTo(5.7768, 3);
    expect(solution.unreachable).toBe(false);
  });

  /** Feeding the solver's answer back through the predictor should reproduce the target. */
  it.each(['lactic', 'phosphoric', 'hydrochloric', 'sulfuric', 'acetic', 'citric'] as const)(
    'round trips through predictMashPh for %s',
    (acid) => {
      const solution = solveAdditionsForTargetPh({
        targetPh: 5.4,
        agent: { kind: 'acid', acid },
        grist: PILSNER_GRIST,
        water: MODERATE_WATER,
        mashVolumeL: 15,
      });
      const solid = ACID_DEFINITIONS[acid].usuallySolid;
      const back = predictMashPh({
        grist: PILSNER_GRIST,
        water: MODERATE_WATER,
        mashVolumeL: 15,
        acidAdditions: [
          solid ? { acid, grams: solution.amount } : { acid, millilitres: solution.amount },
        ],
      });
      expect(back.ph).toBeCloseTo(5.4, 4);
    },
  );

  it('needs less of a stronger acid, in the ratio of their equivalents', () => {
    const dose = (acid: AcidId): number =>
      solveAdditionsForTargetPh({
        targetPh: 5.4,
        agent: { kind: 'acid', acid },
        grist: PILSNER_GRIST,
        water: MODERATE_WATER,
        mashVolumeL: 15,
      }).amount;
    // 85 % phosphoric delivers 14.84 mEq/mL against lactic's 11.48.
    expect(dose('lactic') / dose('phosphoric')).toBeCloseTo(14.84 / 11.48, 1);
    // 5 % vinegar delivers 0.68 mEq/mL, so you'd need a whole bottle.
    expect(dose('acetic')).toBeGreaterThan(50);
  });

  it('needs proportionally more of a weaker lactic solution', () => {
    const at88 = solveAdditionsForTargetPh({
      targetPh: 5.4,
      agent: { kind: 'acid', acid: 'lactic' },
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    }).amount;
    const at80 = solveAdditionsForTargetPh({
      targetPh: 5.4,
      agent: { kind: 'acid', acid: 'lactic', concentrationPercent: 80 },
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    }).amount;
    expect(at80 / at88).toBeCloseTo(11.811 / 10.534, 2);
  });

  it('raises pH with baking soda and round trips through the water profile', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 5.9,
      agent: { kind: 'alkali', salt: 'baking-soda' },
      grist: PILSNER_GRIST,
      water: RO_WATER,
      mashVolumeL: 15,
    });
    expect(solution.unit).toBe('g');
    expect(solution.amount).toBeGreaterThan(0);
    expect(solution.achievedPh).toBeCloseTo(5.9, 3);
    expect(solution.baselinePh).toBeCloseTo(5.72, 4);
  });

  it('warns that chalk will not dissolve', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 5.9,
      agent: { kind: 'alkali', salt: 'chalk' },
      grist: PILSNER_GRIST,
      water: RO_WATER,
      mashVolumeL: 15,
    });
    expect(solution.warnings.some((w) => w.includes('not fully dissolve'))).toBe(true);
  });

  it('returns zero when the target is already met', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 5.9,
      agent: { kind: 'acid', acid: 'lactic' },
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    });
    expect(solution.amount).toBe(0);
    expect(solution.achievedPh).toBeCloseTo(solution.baselinePh, 9);
    expect(solution.warnings.some((w) => w.includes('already'))).toBe(true);
  });

  it('returns zero when an alkali is asked for but the mash is already high enough', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 5.5,
      agent: { kind: 'alkali', salt: 'baking-soda' },
      grist: PILSNER_GRIST,
      water: RO_WATER,
      mashVolumeL: 15,
    });
    expect(solution.amount).toBe(0);
  });

  it('reports an unreachable target instead of clamping it', () => {
    const solution = solveAdditionsForTargetPh({
      targetPh: 2.5,
      agent: { kind: 'acid', acid: 'acetic' },
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    });
    expect(solution.unreachable).toBe(true);
    expect(solution.warnings.some((w) => w.includes('out of reach'))).toBe(true);
  });

  it('solves on top of acid that is already in the mash', () => {
    const full = solveAdditionsForTargetPh({
      targetPh: 5.4,
      agent: { kind: 'acid', acid: 'lactic' },
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
    }).amount;
    const topUp = solveAdditionsForTargetPh({
      targetPh: 5.4,
      agent: { kind: 'acid', acid: 'lactic' },
      grist: PILSNER_GRIST,
      water: MODERATE_WATER,
      mashVolumeL: 15,
      existingAcidAdditions: [{ acid: 'lactic', millilitres: 3 }],
    }).amount;
    expect(topUp).toBeCloseTo(full - 3, 2);
  });

  it('is deterministic', () => {
    const run = (): number =>
      solveAdditionsForTargetPh({
        targetPh: 5.35,
        agent: { kind: 'acid', acid: 'phosphoric', concentrationPercent: 75 },
        grist: PILSNER_GRIST,
        water: DUBLIN.profile,
        mashVolumeL: 16,
      }).amount;
    expect(run()).toBe(run());
  });
});

describe('sparge water acidification', () => {
  /**
   * 15 L of water at 100 ppm alkalinity (1.99828 mEq/L), pH 7.5, down to pH 5.5:
   *
   * ```
   * C_T           = 1.99828 / 0.93536 = 2.13638 mmol/L
   * Alk(5.5)      = 2.13638 × 0.123862 = 0.26462 mEq/L
   * acid          = (1.99828 − 0.26462) × 15 = 26.008 mEq
   * 88 % lactic at pH 5.5 = 11.811 × 0.97765 = 11.547 mEq/mL
   * volume        = 26.01 / 11.547 = 2.25 mL
   * ```
   * Tolerance: 0.05 mEq, 0.02 mL.
   */
  it('matches the longhand titration', () => {
    const result = acidifyWater({ profile: MODERATE_WATER, volumeL: 15 });
    expect(result.targetPh).toBe(DEFAULT_SPARGE_TARGET_PH);
    expect(result.milliequivalents).toBeCloseTo(26.008, 2);
    expect(result.millilitres).toBeCloseTo(2.252, 2);
    expect(result.alkalinityPpmAsCaCO3).toBeCloseTo(100, 3);
  });

  it('needs nothing for RO water', () => {
    const result = acidifyWater({ profile: RO_WATER, volumeL: 15 });
    expect(result.milliequivalents).toBe(0);
    expect(result.millilitres).toBe(0);
  });

  it('needs more acid for a lower target and for more alkalinity', () => {
    const to55 = acidifyWater({ profile: MODERATE_WATER, volumeL: 15 }).milliequivalents;
    const to52 = acidifyWater({
      profile: MODERATE_WATER,
      volumeL: 15,
      targetPh: 5.2,
    }).milliequivalents;
    const dublin = acidifyWater({ profile: DUBLIN.profile, volumeL: 15 }).milliequivalents;
    expect(to52).toBeGreaterThan(to55);
    expect(dublin).toBeGreaterThan(to55);
  });

  it('scales linearly with volume', () => {
    const at15 = acidifyWater({ profile: MODERATE_WATER, volumeL: 15 }).milliequivalents;
    const at30 = acidifyWater({ profile: MODERATE_WATER, volumeL: 30 }).milliequivalents;
    expect(at30).toBeCloseTo(at15 * 2, 9);
  });

  it('costs each acid at its own equivalents, evaluated at the target pH', () => {
    const lactic = acidifyWater({ profile: MODERATE_WATER, volumeL: 15, acid: 'lactic' });
    const phosphoric = acidifyWater({ profile: MODERATE_WATER, volumeL: 15, acid: 'phosphoric' });
    expect(lactic.milliequivalents).toBeCloseTo(phosphoric.milliequivalents, 9);
    expect((lactic.millilitres ?? 0) / (phosphoric.millilitres ?? 1)).toBeCloseTo(
      acidStrengthMEqPerUnit('phosphoric', 5.5) / acidStrengthMEqPerUnit('lactic', 5.5),
      6,
    );
  });

  it('reports a solid acid in grams', () => {
    const citric = acidifyWater({ profile: MODERATE_WATER, volumeL: 15, acid: 'citric' });
    expect(citric.grams).toBeGreaterThan(0);
    expect(citric.millilitres).toBeUndefined();
    expect(citric.explain.unit).toBe('g');
  });

  it('warns about over-acidifying', () => {
    const result = acidifyWater({ profile: MODERATE_WATER, volumeL: 15, targetPh: 4.8 });
    expect(result.warnings.some((w) => w.includes('lower than it needs to be'))).toBe(true);
  });
});

describe('options', () => {
  it('fills every default', () => {
    expect(resolveMashPhOptions()).toEqual(DEFAULT_MASH_PH_OPTIONS);
    expect(DEFAULT_MASH_PH_OPTIONS.assumedSourceWaterPh).toBe(7.5);
    expect(DEFAULT_MASH_PH_OPTIONS.convergenceTolerancePh).toBe(1e-6);
  });

  it('lets each option through independently', () => {
    expect(resolveMashPhOptions({ assumedSourceWaterPh: 8.1 }).assumedSourceWaterPh).toBe(8.1);
    expect(
      resolveMashPhOptions({ acidulatedMaltPercentLactic: 2 }).acidulatedMaltPercentLactic,
    ).toBe(2);
  });

  it('honours a custom acidulated malt strength', () => {
    const at3 = predictMashPh({
      grist: [grain('Pilsner', 4.9, 1.6), grain('Acid Malt', 0.1, 3)],
      water: RO_WATER,
      mashVolumeL: 15,
    }).ph;
    const at2 = predictMashPh({
      grist: [grain('Pilsner', 4.9, 1.6), grain('Acid Malt', 0.1, 3)],
      water: RO_WATER,
      mashVolumeL: 15,
      options: { acidulatedMaltPercentLactic: 2 },
    }).ph;
    expect(at2).toBeGreaterThan(at3);
  });
});
