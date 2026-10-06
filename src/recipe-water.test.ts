/**
 * Integration of the water/mash-pH section into `calculateRecipe`.
 *
 * The main requirement is that a recipe without `water` gets no water section
 * at all, and that adding water data leaves every other figure unchanged. The
 * other tests check that the section, when present, agrees with the
 * standalone modules it wraps.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_EQUIPMENT, REFERENCE_RECIPE_A } from './fixtures/reference-recipes';
import { DUBLIN, MUNICH } from './fixtures/water-profiles';
import { acidifyWater, predictMashPh } from './mashPh';
import { calculateRecipe, DEFAULT_TARGET_MASH_PH } from './recipe';
import type { RecipeInput, RecipeWaterInput, WaterProfile } from './types';
import { alkalinityPpm, applySalts, RO_WATER, residualAlkalinityPpm, waterProfile } from './water';

const SOFT_WATER: WaterProfile = waterProfile({
  name: 'City tap',
  calciumPpm: 35,
  magnesiumPpm: 6,
  sodiumPpm: 12,
  chloridePpm: 20,
  sulfatePpm: 25,
  alkalinityPpmAsCaCO3: 80,
});

const baseRecipe = (): RecipeInput => REFERENCE_RECIPE_A;

const withWater = (water: RecipeWaterInput): RecipeInput => ({ ...baseRecipe(), water });

describe('recipes without water data are unchanged', () => {
  it('has no water section at all', () => {
    const result = calculateRecipe(baseRecipe(), REFERENCE_EQUIPMENT);
    expect(result.water).toBeUndefined();
    expect('water' in result).toBe(false);
  });

  it('produces no water explanations and no water warnings', () => {
    const result = calculateRecipe(baseRecipe(), REFERENCE_EQUIPMENT);
    for (const key of ['mashPh', 'residualAlkalinity', 'sulfateChloride', 'spargeAcid']) {
      expect(result.explain[key]).toBeUndefined();
    }
    expect(result.warnings.some((w) => w.toLowerCase().includes('ph'))).toBe(false);
  });

  it('leaves every vital identical when water data is added', () => {
    const without = calculateRecipe(baseRecipe(), REFERENCE_EQUIPMENT);
    const withIt = calculateRecipe(withWater({ sourceProfile: SOFT_WATER }), REFERENCE_EQUIPMENT);
    expect(withIt.vitals).toEqual(without.vitals);
    expect(withIt.volumes).toEqual(without.volumes);
    expect(withIt.fermentables).toEqual(without.fermentables);
    expect(withIt.hops).toEqual(without.hops);
  });
});

describe('the water section', () => {
  const result = () =>
    calculateRecipe(
      withWater({
        sourceProfile: SOFT_WATER,
        saltAdditions: [
          { salt: 'gypsum', grams: 4 },
          { salt: 'calcium-chloride-dihydrate', grams: 2 },
        ],
      }),
      REFERENCE_EQUIPMENT,
    );

  it('uses the volume waterfall’s strike and sparge water', () => {
    const calculated = calculateRecipe(baseRecipe(), REFERENCE_EQUIPMENT);
    const water = result().water;
    expect(water?.mashVolumeL).toBe(calculated.volumes.strikeWaterL);
    expect(water?.spargeVolumeL).toBe(calculated.volumes.spargeWaterL);
  });

  it('agrees exactly with applySalts run standalone', () => {
    const water = result().water;
    if (!water) throw new Error('expected a water section');
    const standalone = applySalts({
      source: SOFT_WATER,
      additions: [
        { salt: 'gypsum', grams: 4 },
        { salt: 'calcium-chloride-dihydrate', grams: 2 },
      ],
      volumes: { mashVolumeL: water.mashVolumeL, spargeVolumeL: water.spargeVolumeL },
    });
    expect(water.mashProfile).toEqual(standalone.mash);
    expect(water.spargeProfile).toEqual(standalone.sparge);
    expect(water.totalProfile).toEqual(standalone.total);
  });

  it('agrees exactly with predictMashPh run standalone', () => {
    const water = result().water;
    if (!water) throw new Error('expected a water section');
    const standalone = predictMashPh({
      grist: baseRecipe().fermentables,
      water: water.mashProfile,
      mashVolumeL: water.mashVolumeL,
    });
    expect(water.mashPh.ph).toBeCloseTo(standalone.ph, 12);
  });

  it('reports RA, alkalinity and the sulfate:chloride balance', () => {
    const water = result().water;
    if (!water) throw new Error('expected a water section');
    expect(water.residualAlkalinityPpm).toBeCloseTo(residualAlkalinityPpm(water.mashProfile), 12);
    expect(water.alkalinityPpmAsCaCO3).toBeCloseTo(alkalinityPpm(water.totalProfile), 12);
    expect(water.sulfateChlorideRatio).toBeCloseTo(
      water.totalProfile.sulfatePpm / water.totalProfile.chloridePpm,
      12,
    );
    expect(water.sulfateChlorideBalance).toBe('balanced');
  });

  it('attaches the explanations to the recipe’s explain block', () => {
    const explain = result().explain;
    expect(explain.mashPh?.formula).toBe('charge-balance-troester');
    expect(explain.residualAlkalinity?.formula).toBe('kolbach-1953');
    expect(explain.sulfateChloride?.formula).toBe('sulfate-chloride-ratio');
  });

  it('keeps the pre-existing explanations intact', () => {
    const explain = result().explain;
    for (const key of ['og', 'fg', 'abv', 'ibu', 'srm', 'buGu', 'volumes']) {
      expect(explain[key]).toBeDefined();
    }
  });
});

describe('dilution and split targets', () => {
  it('applies RO dilution before the salts', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: DUBLIN.profile, dilutionFraction: 0.5 }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.water?.dilutedSourceProfile.calciumPpm).toBeCloseTo(59, 6);
    expect(result.water?.dilutionFraction).toBe(0.5);
    expect(result.warnings.some((w) => w.includes('50 % RO'))).toBe(true);
  });

  it('states the dilution in litres of the strike + sparge water, not just a ratio', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: DUBLIN.profile, dilutionFraction: 0.4 }),
      REFERENCE_EQUIPMENT,
    );
    const water = result.water;
    if (!water) throw new Error('expected a water section');
    const liquorL = result.volumes.strikeWaterL + result.volumes.spargeWaterL;
    expect(water.dilutionWaterL).toBeCloseTo(liquorL * 0.4, 9);
    expect(water.sourceWaterL).toBeCloseTo(liquorL * 0.6, 9);

    // Also per vessel, since strike and sparge water are prepared separately.
    // The two shares must add up to the totals.
    expect(water.mashDilution.dilutionWaterL).toBeCloseTo(result.volumes.strikeWaterL * 0.4, 9);
    expect(water.spargeDilution.dilutionWaterL).toBeCloseTo(result.volumes.spargeWaterL * 0.4, 9);
    expect(water.mashDilution.dilutionWaterL + water.spargeDilution.dilutionWaterL).toBeCloseTo(
      water.dilutionWaterL,
      9,
    );
    expect(water.mashDilution.sourceWaterL + water.spargeDilution.sourceWaterL).toBeCloseTo(
      water.sourceWaterL,
      9,
    );

    const undiluted = calculateRecipe(
      withWater({ sourceProfile: DUBLIN.profile }),
      REFERENCE_EQUIPMENT,
    );
    expect(undiluted.water?.dilutionWaterL).toBe(0);
    expect(undiluted.water?.sourceWaterL).toBeCloseTo(liquorL, 9);
  });

  it('puts a mash-targeted salt only in the mash', () => {
    const result = calculateRecipe(
      withWater({
        sourceProfile: SOFT_WATER,
        saltAdditions: [{ salt: 'gypsum', grams: 6, target: 'mash' }],
      }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.water?.spargeProfile.sulfatePpm).toBeCloseTo(SOFT_WATER.sulfatePpm, 9);
    expect(result.water?.mashProfile.sulfatePpm).toBeGreaterThan(SOFT_WATER.sulfatePpm);
  });

  it('pro-rates a total-water acid dose so only the mash share affects mash pH', () => {
    const total = calculateRecipe(
      withWater({
        sourceProfile: MUNICH.profile,
        acidAdditions: [{ acid: 'lactic', millilitres: 6, target: 'total' }],
      }),
      REFERENCE_EQUIPMENT,
    );
    const mashOnly = calculateRecipe(
      withWater({
        sourceProfile: MUNICH.profile,
        acidAdditions: [{ acid: 'lactic', millilitres: 6, target: 'mash' }],
      }),
      REFERENCE_EQUIPMENT,
    );
    expect(total.water?.mashPh.ph).toBeGreaterThan(mashOnly.water?.mashPh.ph ?? 0);
  });

  it('ignores a sparge-targeted acid entirely for mash pH', () => {
    const spargeOnly = calculateRecipe(
      withWater({
        sourceProfile: MUNICH.profile,
        acidAdditions: [{ acid: 'lactic', millilitres: 6, target: 'sparge' }],
      }),
      REFERENCE_EQUIPMENT,
    );
    const none = calculateRecipe(withWater({ sourceProfile: MUNICH.profile }), REFERENCE_EQUIPMENT);
    expect(spargeOnly.water?.mashPh.ph).toBeCloseTo(none.water?.mashPh.ph ?? 0, 12);
  });
});

describe('correction advice', () => {
  it('offers a lactic dose when the mash sits above the target', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: DUBLIN.profile }),
      REFERENCE_EQUIPMENT,
    );
    const correction = result.water?.mashPhCorrection;
    expect(result.water?.targetMashPh).toBe(DEFAULT_TARGET_MASH_PH);
    expect(correction?.unit).toBe('mL');
    expect(correction?.amount).toBeGreaterThan(0);
    expect(correction?.achievedPh).toBeCloseTo(5.4, 3);
    expect(result.explain.mashPhCorrection).toBeDefined();
  });

  it('offers baking soda when the mash sits below the target', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: RO_WATER, targetMashPh: 5.9 }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.water?.mashPhCorrection?.unit).toBe('g');
    expect(result.water?.mashPhCorrection?.amount).toBeGreaterThan(0);
  });

  it('offers nothing when the mash is already on target', () => {
    const first = calculateRecipe(
      withWater({ sourceProfile: DUBLIN.profile }),
      REFERENCE_EQUIPMENT,
    );
    const dose = first.water?.mashPhCorrection?.amount ?? 0;
    const corrected = calculateRecipe(
      withWater({
        sourceProfile: DUBLIN.profile,
        acidAdditions: [{ acid: 'lactic', millilitres: dose }],
      }),
      REFERENCE_EQUIPMENT,
    );
    expect(corrected.water?.mashPh.ph).toBeCloseTo(5.4, 3);
    expect(corrected.water?.mashPhCorrection).toBeUndefined();
  });

  it('honours a custom target mash pH', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: DUBLIN.profile, targetMashPh: 5.25 }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.water?.targetMashPh).toBe(5.25);
    expect(result.water?.mashPhCorrection?.achievedPh).toBeCloseTo(5.25, 3);
  });
});

describe('sparge acidification', () => {
  it('is absent unless asked for', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: MUNICH.profile }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.water?.spargeAcid).toBeUndefined();
  });

  it('agrees with acidifyWater run standalone', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: MUNICH.profile, acidifySparge: true }),
      REFERENCE_EQUIPMENT,
    );
    const water = result.water;
    if (!water?.spargeAcid) throw new Error('expected sparge acid');
    const standalone = acidifyWater({
      profile: water.spargeProfile,
      volumeL: water.spargeVolumeL,
      targetPh: 5.5,
      acid: 'lactic',
      assumedSourceWaterPh: 7.5,
    });
    expect(water.spargeAcid.milliequivalents).toBeCloseTo(standalone.milliequivalents, 12);
    expect(water.spargeAcid.millilitres).toBeCloseTo(standalone.millilitres ?? 0, 12);
    expect(result.explain.spargeAcid).toBeDefined();
  });

  it('honours the acid choice, strength and target pH', () => {
    const result = calculateRecipe(
      withWater({
        sourceProfile: MUNICH.profile,
        acidifySparge: true,
        spargeAcid: 'phosphoric',
        spargeAcidConcentrationPercent: 10,
        spargeTargetPh: 5.8,
      }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.water?.spargeAcid?.targetPh).toBe(5.8);
    expect(result.water?.spargeAcid?.explain.inputs.concentrationPercent).toBe(10);
  });
});

describe('target comparison and warnings', () => {
  it('compares the achieved water with a target profile', () => {
    const target = waterProfile({ calciumPpm: 100, chloridePpm: 60, sulfatePpm: 150 });
    const result = calculateRecipe(
      withWater({
        sourceProfile: SOFT_WATER,
        targetProfile: target,
        saltAdditions: [{ salt: 'gypsum', grams: 5 }],
      }),
      REFERENCE_EQUIPMENT,
    );
    const comparison = result.water?.targetComparison;
    expect(comparison).toHaveLength(6);
    const calcium = comparison?.find((c) => c.ion === 'calcium');
    expect(calcium?.targetPpm).toBe(100);
    expect(calcium?.deltaPpm).toBeCloseTo((calcium?.achievedPpm ?? 0) - 100, 12);
  });

  it('surfaces a high-pH warning on the recipe’s own warnings list', () => {
    const result = calculateRecipe(
      withWater({ sourceProfile: DUBLIN.profile }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.warnings.some((w) => w.includes('above 5.6'))).toBe(true);
  });

  it('surfaces a chalk warning', () => {
    const result = calculateRecipe(
      withWater({
        sourceProfile: SOFT_WATER,
        saltAdditions: [{ salt: 'chalk', grams: 3 }],
      }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.warnings.some((w) => w.includes('sparingly soluble'))).toBe(true);
  });

  it('surfaces a high-sodium warning', () => {
    const result = calculateRecipe(
      withWater({
        sourceProfile: SOFT_WATER,
        saltAdditions: [
          { salt: 'table-salt', grams: 12 },
          { salt: 'gypsum', grams: 12 },
        ],
      }),
      REFERENCE_EQUIPMENT,
    );
    expect(result.warnings.some((w) => w.includes('Na⁺'))).toBe(true);
  });

  it('never repeats a warning', () => {
    const result = calculateRecipe(
      withWater({
        sourceProfile: DUBLIN.profile,
        saltAdditions: [
          { salt: 'chalk', grams: 2 },
          { salt: 'chalk', grams: 2, target: 'mash' },
        ],
      }),
      REFERENCE_EQUIPMENT,
    );
    const water = result.water;
    if (!water) throw new Error('expected a water section');
    expect(new Set(water.warnings).size).toBe(water.warnings.length);
  });
});

describe('options flow through', () => {
  it('honours the full-alkalinity model', () => {
    const titrated = calculateRecipe(
      withWater({ sourceProfile: MUNICH.profile }),
      REFERENCE_EQUIPMENT,
    );
    const full = calculateRecipe(
      withWater({ sourceProfile: MUNICH.profile }),
      REFERENCE_EQUIPMENT,
      {
        mashPh: { alkalinityModel: 'full-alkalinity' },
      },
    );
    expect(full.water?.mashPh.ph).toBeGreaterThan(titrated.water?.mashPh.ph ?? 0);
  });

  it('honours a stated source water pH', () => {
    const assumed = calculateRecipe(
      withWater({ sourceProfile: MUNICH.profile }),
      REFERENCE_EQUIPMENT,
    );
    const stated = calculateRecipe(
      withWater({ sourceProfile: { ...MUNICH.profile, ph: 8.3 } }),
      REFERENCE_EQUIPMENT,
    );
    expect(stated.water?.mashPh.ph).not.toBe(assumed.water?.mashPh.ph);
    expect(Math.abs((stated.water?.mashPh.ph ?? 0) - (assumed.water?.mashPh.ph ?? 0))).toBeLessThan(
      0.02,
    );
  });
});
