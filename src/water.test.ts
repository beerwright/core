import { describe, expect, it } from 'vitest';
import {
  BURTON_ON_TRENT,
  DUBLIN,
  MUNICH,
  PILSEN,
  SALT_YIELD_FIXTURES,
  WATER_FIXTURES,
} from './fixtures/water-profiles';
import type { SaltId, WaterIon } from './types';
import {
  ALKALINITY_PER_BICARBONATE,
  addProfiles,
  alkalinityFromBicarbonate,
  alkalinityMEqPerLitre,
  alkalinityPpm,
  applySalts,
  BICARBONATE_PER_ALKALINITY,
  bicarbonateFromAlkalinity,
  blendProfiles,
  CACO3_EQUIVALENT_WEIGHT,
  calciumHardnessPpm,
  chargeBalanceErrorPercent,
  DEFAULT_CALCIUM_FLOOR_PPM,
  diluteProfile,
  EQUIVALENT_WEIGHT_G_PER_EQ,
  ION_ADVISORY_RANGE_PPM,
  ionMEqPerLitre,
  ionPpm,
  ionsFromSalts,
  MOLAR_MASS_G_PER_MOL,
  magnesiumHardnessPpm,
  PPM_CACO3_PER_DH,
  profileDelta,
  RO_WATER,
  residualAlkalinityExplained,
  residualAlkalinityMEqPerLitre,
  residualAlkalinityPpm,
  SALT_DEFINITIONS,
  SALT_IDS,
  SULFATE_CHLORIDE_BAND_TARGETS,
  SULFATE_CHLORIDE_MEANINGFUL_PPM,
  saltAlkalinityMEqPerGram,
  saltAlkalinityPpmPerGramPerLitre,
  saltIonPpmPerGramPerLitre,
  scaleProfile,
  sulfateChlorideBalance,
  sulfateChlorideExplained,
  sulfateChlorideRatio,
  toIonAmounts,
  totalHardnessPpm,
  unmeasuredIons,
  WATER_IONS,
  waterProfile,
  waterProfileWarnings,
  withUnmeasured,
} from './water';

/** Litres per US gallon. Dividing our per-litre figures by this gives the published per-gallon ones. */
const L_PER_US_GAL = 3.785411784;

describe('alkalinity conversions', () => {
  /**
   * `1 mEq = 50.043 mg CaCO₃ = 61.016 mg HCO₃⁻`, so
   * `HCO₃ = Alk × 61.016 / 50.043 = Alk × 1.21925`.
   * Tolerance: 1e-4 on the ratio, exact on the round trip.
   */
  it('derives the ratio from the equivalent weights', () => {
    expect(CACO3_EQUIVALENT_WEIGHT).toBeCloseTo(50.043, 3);
    expect(BICARBONATE_PER_ALKALINITY).toBeCloseTo(1.21927, 5);
    expect(ALKALINITY_PER_BICARBONATE).toBeCloseTo(0.820162, 6);
  });

  it('converts both directions and round trips', () => {
    expect(alkalinityFromBicarbonate(100)).toBeCloseTo(82.0162, 4);
    expect(bicarbonateFromAlkalinity(100)).toBeCloseTo(121.927, 3);
    for (const value of [0, 15, 100, 319, 1000]) {
      expect(alkalinityFromBicarbonate(bicarbonateFromAlkalinity(value))).toBeCloseTo(value, 9);
    }
  });

  it('accepts all three entry forms and lands on the same water', () => {
    const fromBicarbonate = waterProfile({ bicarbonatePpm: 121.927 });
    const fromAlkalinity = waterProfile({ alkalinityPpmAsCaCO3: 100 });
    // 100 ppm CaCO₃ / 17.848 = 5.603 °dH.
    const fromDh = waterProfile({ carbonateHardnessDh: 100 / PPM_CACO3_PER_DH });
    expect(fromAlkalinity.bicarbonatePpm).toBeCloseTo(fromBicarbonate.bicarbonatePpm, 3);
    expect(fromDh.bicarbonatePpm).toBeCloseTo(fromBicarbonate.bicarbonatePpm, 3);
  });

  it('lets an explicit bicarbonate win over the alkalinity forms', () => {
    const profile = waterProfile({ bicarbonatePpm: 50, alkalinityPpmAsCaCO3: 500 });
    expect(profile.bicarbonatePpm).toBe(50);
  });

  it('defaults every missing ion to zero', () => {
    expect(waterProfile()).toEqual(RO_WATER_SHAPE);
  });
});

const RO_WATER_SHAPE = {
  calciumPpm: 0,
  magnesiumPpm: 0,
  sodiumPpm: 0,
  chloridePpm: 0,
  sulfatePpm: 0,
  bicarbonatePpm: 0,
};

describe('equivalent weights', () => {
  /** `M / |z|`, from the IUPAC molar masses. */
  it.each([
    ['calcium', 20.039],
    ['magnesium', 12.1525],
    ['sodium', 22.98977],
    ['chloride', 35.453],
    ['sulfate', 48.028],
    ['bicarbonate', 61.016],
  ] as const)('%s is %f g/eq', (ion, expected) => {
    expect(EQUIVALENT_WEIGHT_G_PER_EQ[ion]).toBeCloseTo(expected, 4);
  });

  it('turns ppm into mEq/L', () => {
    // 100 ppm Ca / 20.039 = 4.990 mEq/L.
    expect(ionMEqPerLitre(waterProfile({ calciumPpm: 100 }), 'calcium')).toBeCloseTo(4.9903, 4);
  });
});

describe('residual alkalinity (Kolbach 1953)', () => {
  /**
   * Checked against the published RA of the classic brewing waters, with the
   * arithmetic written out in the fixture.
   * Tolerance: 0.05 ppm. Fixture values are given to 3 dp.
   */
  it.each(WATER_FIXTURES.map((f) => [f.profile.name ?? '', f] as const))('%s', (_name, fixture) => {
    expect(alkalinityPpm(fixture.profile)).toBeCloseTo(fixture.alkalinityPpm, 1);
    expect(residualAlkalinityPpm(fixture.profile)).toBeCloseTo(fixture.residualAlkalinityPpm, 1);
  });

  it('reproduces Dublin’s famously high RA and Pilsen’s near-zero one', () => {
    expect(residualAlkalinityPpm(DUBLIN.profile)).toBeGreaterThan(170);
    expect(residualAlkalinityPpm(PILSEN.profile)).toBeLessThan(10);
  });

  it('cancels Burton’s huge alkalinity with its huge calcium', () => {
    expect(alkalinityPpm(BURTON_ON_TRENT.profile)).toBeGreaterThan(240);
    expect(residualAlkalinityPpm(BURTON_ON_TRENT.profile)).toBeLessThan(20);
  });

  /**
   * The two published renderings of Kolbach's formula must agree:
   * `Alk − Ca hardness/3.5 − Mg hardness/7` ≡ `Alk − Ca ppm/1.4021 − Mg ppm/1.7003`.
   * Tolerance: 1e-9 ppm.
   */
  it('agrees with the elemental-ppm form of the same formula', () => {
    for (const fixture of WATER_FIXTURES) {
      const p = fixture.profile;
      const elemental =
        alkalinityPpm(p) -
        p.calciumPpm /
          (3.5 / (MOLAR_MASS_G_PER_MOL.calciumCarbonate / MOLAR_MASS_G_PER_MOL.calcium)) -
        p.magnesiumPpm /
          (7 / (MOLAR_MASS_G_PER_MOL.calciumCarbonate / MOLAR_MASS_G_PER_MOL.magnesium));
      expect(residualAlkalinityPpm(p)).toBeCloseTo(elemental, 9);
    }
  });

  it('reports RA in mEq/L consistently', () => {
    for (const fixture of WATER_FIXTURES) {
      expect(residualAlkalinityMEqPerLitre(fixture.profile)).toBeCloseTo(
        residualAlkalinityPpm(fixture.profile) / CACO3_EQUIVALENT_WEIGHT,
        9,
      );
    }
  });

  it('explains itself with both forms of the formula', () => {
    const explanation = residualAlkalinityExplained(MUNICH.profile);
    expect(explanation.formula).toBe('kolbach-1953');
    expect(explanation.value).toBeCloseTo(99.2, 1);
    expect(explanation.notes?.some((n) => n.includes('Ca/1.4'))).toBe(true);
  });
});

describe('hardness', () => {
  it('converts calcium and magnesium to CaCO₃ equivalents', () => {
    // 100 ppm Ca × 100.086/40.078 = 249.73 ppm as CaCO₃.
    expect(calciumHardnessPpm(waterProfile({ calciumPpm: 100 }))).toBeCloseTo(249.73, 2);
    // 100 ppm Mg × 100.086/24.305 = 411.79.
    expect(magnesiumHardnessPpm(waterProfile({ magnesiumPpm: 100 }))).toBeCloseTo(411.79, 2);
    expect(totalHardnessPpm(waterProfile({ calciumPpm: 100, magnesiumPpm: 100 }))).toBeCloseTo(
      661.52,
      2,
    );
  });
});

describe('salt stoichiometry', () => {
  /**
   * Golden values from the molar masses, cross-checked against the per-US-gallon
   * figures published by Palmer (*How to Brew*) and Martin (Bru'n Water).
   * Tolerance: 0.05 ppm per g/L, 0.1 ppm per g/gal (published tables are
   * printed to 1 dp).
   */
  it.each(SALT_YIELD_FIXTURES.map((f) => [f.salt, f] as const))('%s', (_salt, fixture) => {
    const yields = saltIonPpmPerGramPerLitre(fixture.salt as SaltId);
    for (const [ion, expected] of Object.entries(fixture.ppmPerGramPerLitre)) {
      expect(yields[ion as WaterIon]).toBeCloseTo(expected, 1);
    }
    for (const [ion, expected] of Object.entries(fixture.ppmPerGramPerUsGallon)) {
      expect(yields[ion as WaterIon] / L_PER_US_GAL).toBeCloseTo(expected, 1);
    }
    // Ions not in the fixture should be zero.
    for (const ion of WATER_IONS) {
      if (!(ion in fixture.ppmPerGramPerLitre)) expect(yields[ion]).toBe(0);
    }
  });

  /**
   * Mass balance for the salts that only dissociate. The ppm of ions released
   * per gram, plus the waters of hydration that come off as water, must add up
   * to the whole gram.
   *
   * ```
   * Σ ion ppm  =  1000 × (M_salt − n_H₂O × 18.015) / M_salt
   * ```
   *
   * Gypsum, for instance: `1000 × (172.164 − 36.030) / 172.164 = 790.72` ppm of
   * ions and 209.28 ppm of water. Tolerance: 1e-6 ppm.
   */
  it.each([
    ['gypsum', 2],
    ['calcium-chloride-dihydrate', 2],
    ['calcium-chloride-anhydrous', 0],
    ['epsom-salt', 7],
    ['table-salt', 0],
    ['magnesium-chloride', 6],
    ['baking-soda', 0],
  ] as const)('%s releases its whole mass as ions plus %i waters', (salt, waters) => {
    const yields = saltIonPpmPerGramPerLitre(salt);
    const summed = WATER_IONS.reduce((sum, ion) => sum + yields[ion], 0);
    const molarMass = SALT_DEFINITIONS[salt].molarMassGPerMol;
    const expected = (1000 * (molarMass - waters * MOLAR_MASS_G_PER_MOL.water)) / molarMass;
    expect(summed).toBeCloseTo(expected, 6);
  });

  it('accounts for chalk’s extra CO₂ and lime’s hydroxide substitution', () => {
    // CaCO₃ + CO₂ + H₂O → Ca²⁺ + 2 HCO₃⁻. The products weigh one CO₂ and one H₂O
    // more than the chalk did, so the ion sum is over 1000.
    const chalk = saltIonPpmPerGramPerLitre('chalk');
    const chalkTotal = WATER_IONS.reduce((sum, ion) => sum + chalk[ion], 0);
    // Ca 400.44 + 2 HCO₃ 1219.26 = 1619.70. The surplus is CO₂ (44.009) + H₂O
    // (18.015) per mole of chalk = 1000 × 62.024 / 100.086 = 619.70 ppm.
    expect(chalkTotal).toBeCloseTo(1619.7, 1);
    expect(chalkTotal - 1000).toBeCloseTo(
      (1000 * (44.009 + MOLAR_MASS_G_PER_MOL.water)) / MOLAR_MASS_G_PER_MOL.calciumCarbonate,
      1,
    );
    // Ca(OH)₂ reports its two hydroxides as their bicarbonate equivalent, which
    // is heavier than the hydroxide, so the ion sum isn't a mass balance.
    const lime = saltIonPpmPerGramPerLitre('slaked-lime');
    expect(WATER_IONS.reduce((sum, ion) => sum + lime[ion], 0)).toBeGreaterThan(1000);
    expect(lime.calcium).toBeCloseTo(
      (1000 * MOLAR_MASS_G_PER_MOL.calcium) / SALT_DEFINITIONS['slaked-lime'].molarMassGPerMol,
      6,
    );
  });

  /**
   * The common mix-up between dihydrate and anhydrous calcium chloride.
   * `147.014 / 110.984 = 1.3247`, so the anhydrous form yields 32.5 % more of
   * both ions per gram.
   * Tolerance: 1e-6 on the ratio.
   */
  it('gives anhydrous calcium chloride 1.3247× the dihydrate’s yield', () => {
    const dihydrate = saltIonPpmPerGramPerLitre('calcium-chloride-dihydrate');
    const anhydrous = saltIonPpmPerGramPerLitre('calcium-chloride-anhydrous');
    const expectedRatio =
      SALT_DEFINITIONS['calcium-chloride-dihydrate'].molarMassGPerMol /
      SALT_DEFINITIONS['calcium-chloride-anhydrous'].molarMassGPerMol;
    expect(expectedRatio).toBeCloseTo(1.32465, 4);
    expect(anhydrous.calcium / dihydrate.calcium).toBeCloseTo(expectedRatio, 9);
    expect(anhydrous.chloride / dihydrate.chloride).toBeCloseTo(expectedRatio, 9);
    // Same Ca:Cl ratio, since it's the same salt with different water content.
    expect(anhydrous.calcium / anhydrous.chloride).toBeCloseTo(
      dihydrate.calcium / dihydrate.chloride,
      9,
    );
  });

  it('makes chalk’s alkalinity equal its own mass, by definition', () => {
    // Alkalinity is reported *as CaCO₃*, so 1 g/L of CaCO₃ is 1000 ppm of it.
    expect(saltAlkalinityPpmPerGramPerLitre('chalk')).toBeCloseTo(1000, 3);
    expect(saltAlkalinityMEqPerGram('chalk')).toBeCloseTo(19.983, 3);
  });

  it('gives baking soda 1 eq/mol and lime 2', () => {
    // 1000 / 84.006 = 11.904 mEq/g.
    expect(saltAlkalinityMEqPerGram('baking-soda')).toBeCloseTo(11.904, 3);
    // 2000 / 74.092 = 26.9935 mEq/g.
    expect(saltAlkalinityMEqPerGram('slaked-lime')).toBeCloseTo(26.9935, 3);
    expect(saltAlkalinityMEqPerGram('gypsum')).toBe(0);
  });

  it('keeps the alkalinity a salt reports consistent with its bicarbonate', () => {
    for (const salt of SALT_IDS) {
      const bicarbonate = saltIonPpmPerGramPerLitre(salt).bicarbonate;
      expect(alkalinityFromBicarbonate(bicarbonate)).toBeCloseTo(
        saltAlkalinityPpmPerGramPerLitre(salt),
        6,
      );
    }
  });
});

describe('dosing salts into water', () => {
  /**
   * Worked by hand: 5 g of gypsum in 20 L is 0.25 g/L,
   * `0.25 × 232.79 = 58.20 ppm Ca` and `0.25 × 557.94 = 139.49 ppm SO₄`.
   * Tolerance: 0.05 ppm.
   */
  it('scales by grams per litre', () => {
    const ions = ionsFromSalts([{ salt: 'gypsum', grams: 5 }], 20);
    expect(ions.calcium).toBeCloseTo(58.2, 1);
    expect(ions.sulfate).toBeCloseTo(139.49, 1);
    expect(ions.magnesium).toBe(0);
  });

  it('honours a partial dissolution fraction', () => {
    const full = ionsFromSalts([{ salt: 'chalk', grams: 4 }], 20);
    const half = ionsFromSalts([{ salt: 'chalk', grams: 4, dissolvedFraction: 0.5 }], 20);
    expect(half.calcium).toBeCloseTo(full.calcium / 2, 9);
    expect(half.bicarbonate).toBeCloseTo(full.bicarbonate / 2, 9);
  });

  it('adds up over several salts', () => {
    const ions = ionsFromSalts(
      [
        { salt: 'gypsum', grams: 4 },
        { salt: 'calcium-chloride-dihydrate', grams: 3 },
      ],
      20,
    );
    // Ca: 0.2 × 232.79 + 0.15 × 272.61 = 46.56 + 40.89 = 87.45.
    expect(ions.calcium).toBeCloseTo(87.45, 1);
    expect(ions.sulfate).toBeCloseTo(111.59, 1);
    expect(ions.chloride).toBeCloseTo(72.35, 1);
  });

  it('returns nothing for zero volume rather than dividing by it', () => {
    const ions = ionsFromSalts([{ salt: 'gypsum', grams: 5 }], 0);
    for (const ion of WATER_IONS) expect(ions[ion]).toBe(0);
  });
});

describe('mash / sparge splits', () => {
  const source = waterProfile({ calciumPpm: 20, alkalinityPpmAsCaCO3: 40 });

  it('splits a total-water dose by volume so both waters match', () => {
    const treated = applySalts({
      source,
      additions: [{ salt: 'gypsum', grams: 10, target: 'total' }],
      volumes: { mashVolumeL: 16, spargeVolumeL: 12 },
    });
    expect(treated.split[0]?.mashGrams).toBeCloseTo((10 * 16) / 28, 9);
    expect(treated.split[0]?.spargeGrams).toBeCloseTo((10 * 12) / 28, 9);
    expect(treated.mash.calciumPpm).toBeCloseTo(treated.sparge.calciumPpm, 9);
    expect(treated.total.calciumPpm).toBeCloseTo(treated.mash.calciumPpm, 9);
  });

  it('puts a mash-targeted dose entirely in the mash', () => {
    const treated = applySalts({
      source,
      additions: [{ salt: 'gypsum', grams: 10, target: 'mash' }],
      volumes: { mashVolumeL: 16, spargeVolumeL: 12 },
    });
    expect(treated.sparge.calciumPpm).toBeCloseTo(source.calciumPpm, 9);
    // 10 g in 16 L = 0.625 g/L × 232.79 = 145.49 ppm on top of the 20 ppm source.
    expect(treated.mash.calciumPpm).toBeCloseTo(20 + 145.49, 1);
    // Total is the volume-weighted blend: (16 × 165.49 + 12 × 20) / 28.
    expect(treated.total.calciumPpm).toBeCloseTo((16 * 165.49 + 12 * 20) / 28, 1);
  });

  it('conserves ion mass across the split', () => {
    const treated = applySalts({
      source,
      additions: [{ salt: 'gypsum', grams: 7, target: 'mash' }],
      volumes: { mashVolumeL: 16, spargeVolumeL: 12 },
    });
    const massInVessels = treated.mash.sulfatePpm * 16 + treated.sparge.sulfatePpm * 12;
    expect(treated.total.sulfatePpm * 28).toBeCloseTo(massInVessels, 6);
    // 7 g gypsum carries 7 × 0.55794 = 3.906 g of sulfate = 3905.6 mg.
    expect(massInVessels).toBeCloseTo(7 * 557.94, 0);
  });

  it('warns about chalk', () => {
    const treated = applySalts({
      source,
      additions: [{ salt: 'chalk', grams: 3 }],
      volumes: { mashVolumeL: 16, spargeVolumeL: 12 },
    });
    expect(treated.warnings.some((w) => w.includes('sparingly soluble'))).toBe(true);
  });

  it('puts everything in the mash when there is no sparge', () => {
    const treated = applySalts({
      source,
      additions: [{ salt: 'gypsum', grams: 6, target: 'total' }],
      volumes: { mashVolumeL: 30, spargeVolumeL: 0 },
    });
    expect(treated.split[0]?.mashGrams).toBeCloseTo(6, 9);
    expect(treated.split[0]?.spargeGrams).toBeCloseTo(0, 9);
  });
});

describe('dilution and blending', () => {
  it('halves every ion at 50 % RO', () => {
    const diluted = diluteProfile(DUBLIN.profile, 0.5);
    for (const ion of WATER_IONS) {
      expect(ionPpm(diluted, ion)).toBeCloseTo(ionPpm(DUBLIN.profile, ion) / 2, 9);
    }
  });

  it('leaves nothing at 100 % RO and everything at 0 %', () => {
    expect(toIonAmounts(diluteProfile(DUBLIN.profile, 1))).toEqual(toIonAmounts(RO_WATER));
    expect(toIonAmounts(diluteProfile(DUBLIN.profile, 0))).toEqual(toIonAmounts(DUBLIN.profile));
  });

  it('clamps a nonsensical dilution fraction', () => {
    expect(diluteProfile(DUBLIN.profile, -1).calciumPpm).toBe(DUBLIN.profile.calciumPpm);
    expect(diluteProfile(DUBLIN.profile, 2).calciumPpm).toBe(0);
  });

  it('dilutes with an arbitrary second water, not just RO', () => {
    const blend = diluteProfile(DUBLIN.profile, 0.25, PILSEN.profile);
    expect(blend.calciumPpm).toBeCloseTo(118 * 0.75 + 7 * 0.25, 9);
  });

  it('blends by volume', () => {
    const blend = blendProfiles([
      { profile: DUBLIN.profile, volumeL: 10 },
      { profile: PILSEN.profile, volumeL: 30 },
    ]);
    expect(blend.calciumPpm).toBeCloseTo((118 * 10 + 7 * 30) / 40, 9);
  });

  it('drops pH on blending rather than averaging a logarithm', () => {
    const blend = blendProfiles([
      { profile: { ...DUBLIN.profile, ph: 8 }, volumeL: 10 },
      { profile: { ...PILSEN.profile, ph: 6 }, volumeL: 10 },
    ]);
    expect(blend.ph).toBeUndefined();
  });

  it('returns RO for a zero-volume blend rather than dividing by zero', () => {
    expect(toIonAmounts(blendProfiles([]))).toEqual(toIonAmounts(RO_WATER));
  });

  it('adds, scales and subtracts profiles', () => {
    expect(addProfiles(PILSEN.profile, PILSEN.profile).calciumPpm).toBe(14);
    expect(scaleProfile(PILSEN.profile, 3).calciumPpm).toBe(21);
    expect(profileDelta(DUBLIN.profile, PILSEN.profile).calcium).toBe(111);
  });
});

describe('sulfate : chloride', () => {
  it.each([
    [50, 150, 0.333, 'too-malty'],
    [75, 100, 0.75, 'malty'],
    [100, 75, 1.333, 'balanced'],
    [300, 100, 3, 'hoppy'],
    [350, 50, 7, 'very-hoppy'],
  ] as const)('SO₄ %f : Cl %f = %f → %s', (sulfate, chloride, ratio, band) => {
    const profile = waterProfile({ sulfatePpm: sulfate, chloridePpm: chloride });
    expect(sulfateChlorideRatio(profile)).toBeCloseTo(ratio, 3);
    expect(sulfateChlorideBalance(profile)).toBe(band);
  });

  /**
   * Zero chloride gives an infinite ratio. That comes from dividing by zero,
   * so it shouldn't be banded as the hoppiest water on the scale.
   */
  it('refuses to band a zero chloride as "very hoppy"', () => {
    const noChloride = waterProfile({ sulfatePpm: 100 });
    expect(sulfateChlorideRatio(noChloride)).toBe(Number.POSITIVE_INFINITY);
    expect(sulfateChlorideBalance(noChloride)).toBe('indeterminate');
  });

  it('reports an unmeasured ion as unmeasured, not as zero', () => {
    const partial = withUnmeasured(waterProfile({ sulfatePpm: 45, calciumPpm: 60 }), ['chloride']);
    expect(Number.isNaN(sulfateChlorideRatio(partial))).toBe(true);
    expect(sulfateChlorideBalance(partial)).toBe('unmeasured');
    expect(sulfateChlorideExplained(partial).notes?.join(' ')).toContain('does not print');
  });

  it('withholds a band when there is too little of either ion to taste', () => {
    // Pilsen is 5 ppm against 5 ppm. The ratio is 1.00, but there's almost nothing there.
    expect(sulfateChlorideRatio(PILSEN.profile)).toBeCloseTo(1, 3);
    expect(sulfateChlorideBalance(PILSEN.profile)).toBe('indeterminate');
  });

  it('explains itself and never returns a non-finite value', () => {
    const explanation = sulfateChlorideExplained(waterProfile({ sulfatePpm: 200 }));
    expect(Number.isFinite(explanation.value)).toBe(true);
    expect(explanation.notes?.some((n) => n.includes('too little'))).toBe(true);
  });

  /**
   * Burton has 725 ppm sulfate against 25 ppm chloride. Requiring 50 ppm of
   * each ion would suppress the band on the most sulfate-dominated water in
   * brewing, so the threshold is on the combined total.
   */
  it('puts Burton firmly in the hoppy band and Dublin near balanced', () => {
    expect(BURTON_ON_TRENT.profile.chloridePpm).toBeLessThan(SULFATE_CHLORIDE_MEANINGFUL_PPM);
    expect(sulfateChlorideBalance(BURTON_ON_TRENT.profile)).toBe('very-hoppy');
    expect(sulfateChlorideBalance(DUBLIN.profile)).toBe('hoppy');
  });

  /**
   * Each band word maps to its midpoint ratio, and that ratio has to fall back
   * in the same band. Otherwise picking "hoppy" could come back as "balanced".
   */
  it('offers each band word a ratio that falls inside that band', () => {
    for (const [band, ratio] of Object.entries(SULFATE_CHLORIDE_BAND_TARGETS)) {
      const profile = waterProfile({ sulfatePpm: 100 * ratio, chloridePpm: 100 });
      expect(sulfateChlorideBalance(profile)).toBe(band);
    }
    // Palmer & Kaminski's working range is 50–150 ppm. A new rule starts at the
    // low end, which is above the 40 ppm the advisory range treats as too low.
    expect(DEFAULT_CALCIUM_FLOOR_PPM).toBe(50);
    expect(DEFAULT_CALCIUM_FLOOR_PPM).toBeGreaterThan(ION_ADVISORY_RANGE_PPM.calcium.min);
  });
});

describe('unmeasured ions', () => {
  const partial = withUnmeasured(
    waterProfile({ calciumPpm: 60, magnesiumPpm: 12, sodiumPpm: 20, alkalinityPpmAsCaCO3: 123 }),
    ['chloride', 'sulfate'],
  );

  it('leaves the arithmetic alone — an unmeasured ion still reads zero', () => {
    expect(partial.sulfatePpm).toBe(0);
    expect(alkalinityPpm(partial)).toBeCloseTo(123, 6);
    expect(residualAlkalinityPpm(partial)).toBeCloseTo(
      residualAlkalinityPpm(withUnmeasured(partial, [])),
      12,
    );
  });

  it('omits the key entirely when nothing is unmeasured', () => {
    expect(withUnmeasured(partial, [])).not.toHaveProperty('unmeasured');
    expect(unmeasuredIons(waterProfile({}))).toEqual([]);
  });

  it('spreads through blending, dilution and salt additions', () => {
    // Half RO doesn't tell us what was in the other half.
    expect(unmeasuredIons(diluteProfile(partial, 0.5))).toEqual(['chloride', 'sulfate']);
    // Full RO does, because none of the source is left.
    expect(unmeasuredIons(diluteProfile(partial, 1))).toEqual([]);
    expect(unmeasuredIons(addProfiles(partial, waterProfile({ chloridePpm: 30 })))).toEqual([
      'chloride',
      'sulfate',
    ]);
  });

  it('names the gap instead of blaming a typo for the charge imbalance', () => {
    const warnings = waterProfileWarnings(partial);
    expect(warnings.join(' ')).toContain('does not print');
    expect(warnings.some((w) => w.includes('expected with'))).toBe(true);
    expect(warnings.some((w) => w.includes('check the report for a typo'))).toBe(false);
  });

  it('does not advise on an ion it was never given', () => {
    const noCalcium = withUnmeasured(waterProfile({ chloridePpm: 50, sulfatePpm: 50 }), [
      'calcium',
    ]);
    expect(waterProfileWarnings(noCalcium).some((w) => w.includes('helps mash pH'))).toBe(false);
  });
});

describe('charge balance and warnings', () => {
  /**
   * A real analysis balances. Burton's published figures are a few percent
   * short on cations because the analysis leaves out potassium and nitrate,
   * which is well inside the 5 % threshold for a warning.
   */
  it('balances a synthetic profile exactly', () => {
    // 1 mEq/L of Ca (20.039 ppm) against 1 mEq/L of Cl (35.453 ppm).
    const profile = waterProfile({ calciumPpm: 20.039, chloridePpm: 35.453 });
    expect(chargeBalanceErrorPercent(profile)).toBeCloseTo(0, 6);
  });

  it('reports zero for water with nothing in it', () => {
    expect(chargeBalanceErrorPercent(RO_WATER)).toBe(0);
  });

  it('flags a badly unbalanced analysis', () => {
    const profile = waterProfile({ calciumPpm: 300, chloridePpm: 5 });
    expect(Math.abs(chargeBalanceErrorPercent(profile))).toBeGreaterThan(5);
    expect(waterProfileWarnings(profile).some((w) => w.includes('Cations and anions'))).toBe(true);
  });

  it('warns about high sodium alongside high sulfate', () => {
    const profile = waterProfile({ calciumPpm: 80, sodiumPpm: 130, sulfatePpm: 250 });
    expect(waterProfileWarnings(profile).some((w) => w.includes('harsh, salty'))).toBe(true);
  });

  it('warns about too little calcium', () => {
    expect(waterProfileWarnings(RO_WATER).some((w) => w.includes('Ca²⁺ is 0 ppm'))).toBe(true);
  });

  it('warns about Burton’s sulfate', () => {
    expect(
      waterProfileWarnings(BURTON_ON_TRENT.profile).some((w) => w.includes('SO₄²⁻ is 725 ppm')),
    ).toBe(true);
  });

  it('says nothing about a comfortable profile', () => {
    const profile = waterProfile({
      calciumPpm: 20.039 * 4,
      magnesiumPpm: 12.1525,
      chloridePpm: 35.453 * 1.5,
      sulfatePpm: 48.028 * 3.5,
    });
    expect(waterProfileWarnings(profile)).toEqual([]);
  });
});

describe('alkalinity of a treated water', () => {
  it('carries baking soda straight through to alkalinity', () => {
    // 2 g of NaHCO₃ in 20 L = 0.1 g/L → 72.63 ppm HCO₃ → 59.57 ppm as CaCO₃.
    const treated = applySalts({
      source: RO_WATER,
      additions: [{ salt: 'baking-soda', grams: 2, target: 'mash' }],
      volumes: { mashVolumeL: 20, spargeVolumeL: 0 },
    });
    expect(treated.mash.bicarbonatePpm).toBeCloseTo(72.63, 1);
    expect(alkalinityPpm(treated.mash)).toBeCloseTo(59.57, 1);
    // 0.1 g/L × 11.904 mEq/g = 1.1904 mEq/L.
    expect(alkalinityMEqPerLitre(treated.mash)).toBeCloseTo(1.1904, 3);
  });
});
