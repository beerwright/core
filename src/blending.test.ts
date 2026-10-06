/**
 * Golden values from Crane's Blending Priming Calculator (Tonsmeire's residual
 * CO₂ and barrel factor, Crane's TA / pH / extract / acid-shock extensions).
 */

import { describe, expect, it } from 'vitest';
import { abvAdvanced } from './abv';
import {
  acidShockStarter,
  BARREL_AGED_RESIDUAL_FACTOR,
  type BlendComponentInput,
  blendComponentResidualCo2,
  blendExplanations,
  blendPh,
  bottlesOfSize,
  DEFAULT_TA_SAMPLE_ML,
  EXTRACT_CO2_VOLUMES_PER_GRAVITY_POINT,
  evaluateBlend,
  fruitSugarKilograms,
  SUCROSE_POINTS_PER_POUND_PER_GALLON,
  sucroseEquivalentFraction,
  sugarAdditionSucroseKilograms,
  titratableAcidityGramsPerLitre,
  WHOLE_FRUITS,
  wholeFruitSucroseKilograms,
} from './blending';
import { type PrimingSugar, primingSugar, residualCo2Volumes } from './carbonation';
import { kgToPounds } from './units/mass';
import { fahrenheitToCelsius } from './units/temperature';
import { gallonsToLitres, litresToGallons } from './units/volume';

describe('titratable acidity', () => {
  it("matches Crane's worked example: 12.2 mL NaOH, 50 mL at 1.010 → 2.17 g/L", () => {
    // TA = (12.2 × 0.9) / (50 × 1.010) × 10 = 2.174 g/L
    expect(titratableAcidityGramsPerLitre({ naohMl: 12.2, sampleMl: 50, sg: 1.01 })).toBeCloseTo(
      2.174,
      3,
    );
  });

  it('scales linearly with the sample volume', () => {
    const fifty = titratableAcidityGramsPerLitre({ naohMl: 12.2, sampleMl: 50, sg: 1.01 });
    const twentyFive = titratableAcidityGramsPerLitre({
      naohMl: 6.1,
      sampleMl: DEFAULT_TA_SAMPLE_ML,
      sg: 1.01,
    });
    expect(fifty).not.toBeNull();
    expect(twentyFive).toBeCloseTo(fifty ?? 0, 9);
  });

  it('returns null for a zero sample', () => {
    expect(titratableAcidityGramsPerLitre({ naohMl: 10, sampleMl: 0, sg: 1.01 })).toBeNull();
  });
});

describe('residual CO₂', () => {
  it('uses the standard curve, halved for barrel-aged beer', () => {
    const peakC = fahrenheitToCelsius(68);
    const residual = residualCo2Volumes(peakC);
    expect(blendComponentResidualCo2(peakC, false)).toBeCloseTo(residual, 12);
    expect(blendComponentResidualCo2(peakC, true)).toBeCloseTo(
      residual * BARREL_AGED_RESIDUAL_FACTOR,
      12,
    );
  });
});

describe('blend pH', () => {
  it('weights hydrogen ions, not pH units', () => {
    // Equal volumes of 3.5 and 3.8:
    // [H+] = 0.5 × 10^(−3.5) + 0.5 × 10^(−3.8) = 2.373e-4 → pH 3.625
    expect(
      blendPh([
        { volumeL: 10, ph: 3.5 },
        { volumeL: 10, ph: 3.8 },
      ]),
    ).toBeCloseTo(3.625, 3);
  });

  it('skips components without volume', () => {
    expect(
      blendPh([
        { volumeL: 0, ph: 3.2 },
        { volumeL: 10, ph: 3.6 },
      ]),
    ).toBeCloseTo(3.6, 9);
  });
});

describe('evaluateBlend', () => {
  const young: Parameters<typeof evaluateBlend>[0]['components'][number] = {
    name: 'Young lambic',
    volumeL: gallonsToLitres(5),
    og: 1.05,
    fg: 1.004,
    ph: 3.5,
    srm: 4,
    peakTempC: fahrenheitToCelsius(68),
    barrelAged: false,
    naohMl: 8,
  };
  const old: Parameters<typeof evaluateBlend>[0]['components'][number] = {
    name: 'Barrel 2019',
    volumeL: gallonsToLitres(5),
    og: 1.055,
    fg: 1.01,
    ph: 3.8,
    srm: 12,
    peakTempC: fahrenheitToCelsius(68),
    barrelAged: true,
    naohMl: 5,
  };

  it('volume-weights residual CO₂ and adds extract from the sweeter beer', () => {
    const result = evaluateBlend({
      components: [young, old],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
    });
    expect(result.totalVolumeL).toBeCloseTo(gallonsToLitres(10), 9);
    expect(result.lowestFg).toBeCloseTo(1.004, 9);
    // Young residual ≈ 0.86; barrel-aged half of that ≈ 0.43; mean ≈ 0.645.
    const youngR = blendComponentResidualCo2(young.peakTempC ?? 0, false);
    const oldR = blendComponentResidualCo2(old.peakTempC ?? 0, true);
    expect(result.residualVolumes).toBeCloseTo((youngR + oldR) / 2, 9);
    // 0.51 × 5 gal × 6 points / 10 gal = 1.53 volumes.
    expect(result.extractVolumes).toBeCloseTo(
      (EXTRACT_CO2_VOLUMES_PER_GRAVITY_POINT * 5 * 6) / 10,
      9,
    );
    expect(result.predictedVolumes).toBeCloseTo((result.residualVolumes ?? 0) + 1.53, 9);
    expect(result.excessCarbonation).toBe(false);
    expect(result.srm).toBeCloseTo(8, 9);
    expect(result.ph).toBeCloseTo(3.625, 3);
  });

  it('volume-weights the original gravities, and has none when no beer has one', () => {
    const result = evaluateBlend({
      components: [young, old],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
    });
    expect(result.og).toBeCloseTo(1.0525, 9);
    const unmeasured = evaluateBlend({
      components: [
        { ...young, og: null },
        { ...old, og: null },
      ],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
    });
    expect(unmeasured.og).toBeNull();
    expect(unmeasured.fg).not.toBeNull();
  });

  it('does not require the driest beer to be listed first', () => {
    const driestFirst = evaluateBlend({
      components: [young, old],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
    });
    const driestSecond = evaluateBlend({
      components: [old, young],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
    });
    expect(driestSecond.extractVolumes).toBeCloseTo(driestFirst.extractVolumes, 12);
    expect(driestSecond.predictedVolumes).toBeCloseTo(driestFirst.predictedVolumes ?? 0, 12);
  });

  it('primes from predicted carbonation, not from temperature a second time', () => {
    const result = evaluateBlend({
      components: [young, old],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
    });
    expect(result.priming).not.toBeNull();
    expect(result.priming?.residualVolumes).toBeCloseTo(result.predictedVolumes ?? 0, 12);
    expect(result.priming?.sugar).toBe('table-sugar');
    const expected = primingSugar({
      beerVolumeL: result.totalVolumeL,
      targetVolumes: 3,
      fermentationTempC: 20,
      residualVolumes: result.predictedVolumes ?? 0,
      sugar: 'table-sugar',
    });
    expect(result.priming?.sugarGrams).toBeCloseTo(expected.sugarGrams, 9);
  });

  it('flags excess carbonation when leftover extract already meets the target', () => {
    const result = evaluateBlend({
      components: [young, { ...old, fg: 1.02 }],
      targetVolumes: 2,
      additions: [],
      kegVolumeL: null,
    });
    expect(result.excessCarbonation).toBe(true);
    expect(result.priming?.sugarGrams).toBe(0);
  });

  it('sizes the acid-shock starter at 0.3 g dry yeast per gallon', () => {
    const starter = acidShockStarter(gallonsToLitres(5));
    expect(starter.yeastGrams).toBeCloseTo(1.5, 9);
    expect(starter.waterL).toBeCloseTo(1.5 / 17, 9);
    expect(starter.acidBeerL).toBeCloseTo(starter.waterL, 12);
  });

  it('splits the blend into keg and bottles, and counts no bottles itself', () => {
    const result = evaluateBlend({
      components: [young],
      targetVolumes: 2.5,
      additions: [],
      kegVolumeL: gallonsToLitres(1),
    });
    expect(result.kegVolumeL).toBeCloseTo(gallonsToLitres(1), 9);
    expect(result.bottleVolumeL).toBeCloseTo(gallonsToLitres(4), 9);
    // Bottle sizes are up to the caller, so the result has no bottle count.
    expect('bottles750' in result).toBe(false);
  });

  it('counts whole bottles at whatever size the bottling day uses', () => {
    expect(bottlesOfSize(20, 750)).toBe(26);
    expect(bottlesOfSize(20, 330)).toBe(60);
    expect(bottlesOfSize(0, 750)).toBe(0);
  });

  it("converts fruit juice gravity to sucrose mass the way Crane's fruit row does", () => {
    // 1 gal at 1.046 → 46 points / 46 PPG = 1 lb = 0.4536 kg
    expect(
      fruitSugarKilograms({
        kind: 'fruit',
        name: 'Cherry',
        volumeL: gallonsToLitres(1),
        sg: 1.046,
      }),
    ).toBeCloseTo(0.45359237, 5);
  });

  it('sums several fruit additions', () => {
    const cherry = {
      kind: 'fruit',
      name: 'Cherry',
      volumeL: gallonsToLitres(1),
      sg: 1.046,
    } as const;
    const result = evaluateBlend({
      components: [
        {
          name: 'Young',
          volumeL: gallonsToLitres(5),
          og: 1.05,
          fg: 1.004,
          ph: null,
          srm: null,
          peakTempC: 20,
          barrelAged: false,
          naohMl: null,
        },
      ],
      targetVolumes: 3,
      additions: [cherry, cherry],
      kegVolumeL: null,
    });
    expect(result.additionSugarKg).toBeCloseTo(0.45359237 * 2, 5);
  });
});

describe('additions of four kinds', () => {
  /** 20 L at almost exactly 6.0 % ABV, so the worked examples read as written. */
  const base: BlendComponentInput = {
    name: 'Young',
    volumeL: 20,
    og: 1.0466,
    fg: 1.001,
    ph: null,
    srm: null,
    peakTempC: 20,
    barrelAged: false,
    naohMl: null,
  };

  /** The same 20 L with FG 1.010, the floor a weighed sugar ferments down to. */
  const sweeter: BlendComponentInput = { ...base, og: 1.05466, fg: 1.01 };

  it("counts a spirit's own alcohol, because it does not wait for yeast", () => {
    const result = evaluateBlend({
      components: [base],
      targetVolumes: 3,
      additions: [{ kind: 'spirit', name: 'Cherry tincture', volumeL: 0.5, abvPercent: 40 }],
      kegVolumeL: null,
    });
    // (20 × 6.0 + 0.5 × 40) / 20.5 ≈ 6.83 %
    expect(result.abv).toBeCloseTo(6, 2);
    expect(result.abvWithAdditions).toBeCloseTo(6.83, 2);
    expect(result.additionSugarKg).toBeNull();
  });

  it('leaves both figures alone for a flavour, which changes no number', () => {
    const result = evaluateBlend({
      components: [base],
      targetVolumes: 3,
      additions: [{ kind: 'flavour', name: 'Toasted oak', amountG: 40 }],
      kegVolumeL: null,
    });
    expect(result.abvWithAdditions).toBeNull();
    expect(result.additionSugarKg).toBeNull();
  });

  it('sums the fruit and spirit terms when both are in the blend', () => {
    const result = evaluateBlend({
      components: [base],
      targetVolumes: 3,
      additions: [
        { kind: 'fruit', name: 'Cherries', volumeL: 1, sg: 1.06 },
        { kind: 'flavour', name: 'Toasted oak', amountG: 40 },
        { kind: 'spirit', name: 'Cherry tincture', volumeL: 0.5, abvPercent: 40 },
      ],
      kegVolumeL: null,
    });
    const abv = result.abv ?? 0;
    const fruitTerm = 1 * abvAdvanced(1.06, 1.001);
    expect(result.abvWithAdditions).toBeCloseTo((20 * abv + fruitTerm + 0.5 * 40) / 21.5, 9);
    expect(result.additionSugarKg).toBeCloseTo(
      fruitSugarKilograms({ kind: 'fruit', name: 'Cherries', volumeL: 1, sg: 1.06 }),
      9,
    );
  });

  /**
   * A weighed sugar.
   *
   * The fruit row needs a volume and a gravity, which nobody measures on a jar
   * of honey. A sugar row is a weight and one of the priming sugars, so the
   * fermentable fraction is already known.
   */
  it('ferments a weighed sugar down to the driest FG, in the volume already in the vessel', () => {
    const result = evaluateBlend({
      components: [sweeter],
      targetVolumes: 3,
      additions: [{ kind: 'sugar', name: 'Table sugar', massKg: 1, sugar: 'table-sugar' }],
      kegVolumeL: null,
    });
    const abv = result.abv ?? 0;
    // 1 kg of sucrose in 20 L at 46 points per pound per gallon gives a
    // gravity rise, which then ferments back down to 1.010. It adds no volume,
    // so the denominator is the original 20 L.
    const points = (kgToPounds(1) / litresToGallons(20)) * SUCROSE_POINTS_PER_POUND_PER_GALLON;
    const delta = points / 1000;
    expect(result.abv).toBeCloseTo(6, 2);
    expect(result.abvWithAdditions).toBeCloseTo(
      (20 * abv + 20 * abvAdvanced(1.01 + delta, 1.01)) / 20,
      9,
    );
    // Sucrose-equivalent of a kilo of sucrose is a kilo.
    expect(result.additionSugarKg).toBeCloseTo(1, 9);
  });

  it('gets less out of a kilo of honey than out of a kilo of table sugar', () => {
    const kiloOf = (sugar: PrimingSugar) =>
      evaluateBlend({
        components: [sweeter],
        targetVolumes: 3,
        additions: [{ kind: 'sugar', name: 'One kilo', massKg: 1, sugar }],
        kegVolumeL: null,
      });
    const honey = kiloOf('honey');
    const table = kiloOf('table-sugar');

    expect(honey.additionSugarKg).toBeCloseTo(sucroseEquivalentFraction('honey'), 9);
    expect(honey.additionSugarKg ?? 0).toBeLessThan(table.additionSugarKg ?? 0);
    expect(honey.abvWithAdditions ?? 0).toBeLessThan(table.abvWithAdditions ?? 0);
  });

  it('sums the sugar the fruit carries and the sugar the jar carries', () => {
    const cherries = { kind: 'fruit', name: 'Cherries', volumeL: 1, sg: 1.06 } as const;
    const honey = { kind: 'sugar', name: 'Honey', massKg: 1, sugar: 'honey' } as const;
    const result = evaluateBlend({
      components: [sweeter],
      targetVolumes: 3,
      additions: [cherries, honey],
      kegVolumeL: null,
    });

    expect(result.additionSugarKg).toBeCloseTo(
      fruitSugarKilograms(cherries) + sugarAdditionSucroseKilograms(honey),
      9,
    );
    // The figure covers sugar from every kind of addition, so there's no
    // field named for fruit alone.
    expect('fruitSugarKg' in result).toBe(false);
  });

  /**
   * Whole fruit instead of juice.
   *
   * The fruit row needs a volume and a gravity, which a carton of juice has.
   * Ten pounds of cherries have neither, and the brewer isn't going to press
   * them to find out, so the row takes a weight and gets the sugar from a
   * table.
   */
  it('turns 5 kg of cherries at 13 % into 0.65 kg of sugar', () => {
    expect(
      wholeFruitSucroseKilograms({
        kind: 'whole-fruit',
        name: 'Cherries',
        massKg: 5,
        sugarPercent: 13,
      }),
    ).toBeCloseTo(0.65, 9);
  });

  it('ferments whole fruit exactly as it ferments the same sucrose off a scale', () => {
    const inputs = { components: [sweeter], targetVolumes: 3, kegVolumeL: null } as const;
    const weighed = evaluateBlend({
      ...inputs,
      additions: [{ kind: 'sugar', name: 'Table sugar', massKg: 1, sugar: 'table-sugar' }],
    });
    const picked = evaluateBlend({
      ...inputs,
      // 10 kg of fruit at 10 % sugar is the same kilogram of sucrose, and
      // neither adds any volume.
      additions: [{ kind: 'whole-fruit', name: 'Cherries', massKg: 10, sugarPercent: 10 }],
    });

    expect(picked.additionSugarKg).toBeCloseTo(weighed.additionSugarKg ?? 0, 9);
    expect(picked.abvWithAdditions).toBeCloseTo(weighed.abvWithAdditions ?? 0, 9);
  });

  it('counts the fruit in the bucket alongside the fruit in the jug', () => {
    const juice = { kind: 'fruit', name: 'Cherry juice', volumeL: 1, sg: 1.06 } as const;
    const bucket = { kind: 'whole-fruit', name: 'Cherries', massKg: 5, sugarPercent: 13 } as const;
    const result = evaluateBlend({
      components: [sweeter],
      targetVolumes: 3,
      additions: [juice, bucket],
      kegVolumeL: null,
    });

    expect(result.additionSugarKg).toBeCloseTo(
      fruitSugarKilograms(juice) + wholeFruitSucroseKilograms(bucket),
      9,
    );
  });

  it('has no ABV with additions when nothing with a volume was added', () => {
    const result = evaluateBlend({
      components: [base],
      targetVolumes: 3,
      additions: [{ kind: 'fruit', name: 'Cherries', volumeL: 0, sg: 1.06 }],
      kegVolumeL: null,
    });
    expect(result.abvWithAdditions).toBeNull();
  });
});

/**
 * The table holds defaults; a brewer with their own figure overwrites the
 * percent on the row. These tests check the figures match USDA's and the list
 * covers the fruit blenders commonly use.
 */
describe('WHOLE_FRUITS', () => {
  it('names twelve fruits at their published sugar content', () => {
    expect(WHOLE_FRUITS.map((fruit) => [fruit.id, fruit.sugarPercent])).toEqual([
      ['cherry', 13],
      ['raspberry', 4],
      ['blackberry', 5],
      ['blueberry', 10],
      ['strawberry', 5],
      ['peach', 8],
      ['apricot', 9],
      ['plum', 10],
      ['grape', 16],
      ['mango', 14],
      ['passion-fruit', 11],
      ['apple', 10],
    ]);
  });

  it('gives every fruit a name a brewer would type', () => {
    expect(WHOLE_FRUITS.map((fruit) => fruit.name)).toEqual([
      'Cherry',
      'Raspberry',
      'Blackberry',
      'Blueberry',
      'Strawberry',
      'Peach',
      'Apricot',
      'Plum',
      'Grape',
      'Mango',
      'Passion fruit',
      'Apple',
    ]);
  });
});

describe('a measured FG and dated additions', () => {
  /** 10 L at the floor and 10 L still sweet: 20 L, driest 1.004, predicted FG 1.007. */
  const young: BlendComponentInput = {
    name: 'Young lambic',
    volumeL: 10,
    og: 1.05,
    fg: 1.004,
    ph: null,
    srm: null,
    peakTempC: 20,
    barrelAged: false,
    naohMl: null,
  };
  const old: BlendComponentInput = { ...young, name: 'Barrel 2019', og: 1.056, fg: 1.01 };

  const blend = (extra: Partial<Parameters<typeof evaluateBlend>[0]> = {}) =>
    evaluateBlend({
      components: [young, old],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
      ...extra,
    });

  it('reports the volume-weighted FG as the prediction, and stands on it when nothing was measured', () => {
    const result = blend();
    expect(result.predictedFg).toBeCloseTo(1.007, 9);
    expect(result.fg).toBeCloseTo(1.007, 9);
  });

  it('lets a measured FG win, and reads the ABV off it', () => {
    const result = blend({ measuredFg: 1.005 });
    expect(result.fg).toBeCloseTo(1.005, 9);
    expect(result.predictedFg).toBeCloseTo(1.007, 9);
    expect(result.abv).toBeCloseTo(abvAdvanced(1.053, 1.005), 9);
  });

  it('agrees with the summed-over-the-cards extract when the measurement matches the prediction', () => {
    // 0.51 × 10 L × 6 points / 20 L = 1.53 volumes, either way round.
    expect(blend({ measuredFg: 1.007 }).extractVolumes).toBeCloseTo(blend().extractVolumes, 9);
  });

  it('leaves no extract to come when the blend has already reached the floor', () => {
    expect(blend({ measuredFg: 1.004 }).extractVolumes).toBe(0);
    expect(blend({ measuredFg: 1.002 }).extractVolumes).toBe(0);
  });

  it('asks for more priming sugar once the extract it was counting on has gone', () => {
    const predicted = blend().priming;
    const dried = blend({ measuredFg: 1.004 }).priming;
    expect(dried?.sugarGrams).toBeGreaterThan(predicted?.sugarGrams ?? 0);
  });

  const cherries = { kind: 'fruit', name: 'Cherries', volumeL: 2, sg: 1.06 } as const;
  const packagedOn = new Date('2026-09-20');

  it('leaves an undated addition exactly where it was: out of the dose', () => {
    const fruited = blend({ additions: [cherries], packagedOn });
    expect(fruited.additionPrimingSugarKg).toBeNull();
    expect(fruited.additionPrimingVolumes).toBe(0);
    expect(fruited.priming?.sugarGrams).toBeCloseTo(blend().priming?.sugarGrams ?? 0, 9);
  });

  it('counts a late addition as sugar already in the bottle, and takes it off the dose', () => {
    const late = blend({
      additions: [{ ...cherries, addedOn: new Date('2026-09-18') }],
      packagedOn,
    });
    expect(late.additionPrimingSugarKg).toBeCloseTo(fruitSugarKilograms(cherries), 9);
    expect(late.additionPrimingVolumes).toBeGreaterThan(0);
    expect(late.priming?.sugarGrams).toBeLessThan(blend().priming?.sugarGrams ?? 0);
  });

  it('treats an addition with a month behind it as fermented, so it primes nothing', () => {
    const early = blend({
      additions: [{ ...cherries, addedOn: new Date('2026-08-01') }],
      packagedOn,
    });
    expect(early.additionPrimingSugarKg).toBeNull();
    expect(early.additionPrimingVolumes).toBe(0);
  });

  it('cannot judge contact time with no packaging day, so the addition stays out of the dose', () => {
    const undecided = blend({ additions: [{ ...cherries, addedOn: new Date('2026-09-18') }] });
    expect(undecided.additionPrimingSugarKg).toBeNull();
    expect(undecided.additionPrimingVolumes).toBe(0);
  });

  it('does not count an addition the measured FG already contains', () => {
    // Fruit added on 1 August, FG read on 1 September, so the reading includes it.
    const measured = blend({
      additions: [{ ...cherries, addedOn: new Date('2026-08-01') }],
      measuredFg: 1.006,
      measuredOn: new Date('2026-09-01'),
      packagedOn,
    });
    expect(measured.abvWithAdditions).toBeNull();
    // The OG used for ABV includes the fruit's sugar, so it's higher than the
    // components' 1.053.
    expect(measured.abv ?? 0).toBeGreaterThan(abvAdvanced(1.053, 1.006));
  });

  it('still counts an addition made after the reading was taken', () => {
    const after = blend({
      additions: [{ ...cherries, addedOn: new Date('2026-09-18') }],
      measuredFg: 1.006,
      measuredOn: new Date('2026-09-01'),
      packagedOn,
    });
    expect(after.abvWithAdditions).not.toBeNull();
    expect(after.abvWithAdditions ?? 0).toBeGreaterThan(after.abv ?? 0);
  });
});

describe('the carbonation explanation, once a measurement is in hand', () => {
  const young: BlendComponentInput = {
    name: 'Young lambic',
    volumeL: 10,
    og: 1.05,
    fg: 1.004,
    ph: null,
    srm: null,
    peakTempC: 20,
    barrelAged: false,
    naohMl: null,
  };
  const old: BlendComponentInput = { ...young, name: 'Barrel 2019', og: 1.056, fg: 1.01 };
  const carbonation = (extra: Partial<Parameters<typeof blendExplanations>[0]> = {}) => {
    const found = blendExplanations({
      components: [young, old],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
      ...extra,
    }).find((e) => e.formula === 'blend-residual-plus-extract');
    if (found === undefined) throw new Error('no carbonation explanation');
    return found;
  };

  it('says the extract was measured on the blend itself', () => {
    const measured = carbonation({ measuredFg: 1.006 });
    expect(measured.inputs.measuredFg).toBe(1.006);
    expect(measured.expression).toContain('0.51 × (measured − driest)');
    expect((measured.notes ?? []).join(' ')).toContain('measured');
  });

  it('says nothing about a measurement when there is none', () => {
    const predicted = carbonation();
    expect(predicted.inputs.measuredFg).toBeUndefined();
    expect(predicted.expression).toContain('0.51 × Σ(V × Δpoints)/ΣV');
    expect((predicted.notes ?? []).join(' ')).not.toContain('measured');
  });

  it("carries a late addition's sugar as carbonation the blend already holds", () => {
    const late = carbonation({
      additions: [
        { kind: 'fruit', name: 'Cherries', volumeL: 2, sg: 1.06, addedOn: new Date('2026-09-18') },
      ],
      packagedOn: new Date('2026-09-20'),
    });
    expect(late.inputs.additionPrimingVolumes).toBeGreaterThan(0);
    expect((late.notes ?? []).join(' ')).toContain('three weeks');
  });

  it('leaves the note off when every addition had time to ferment', () => {
    const early = carbonation({
      additions: [
        { kind: 'fruit', name: 'Cherries', volumeL: 2, sg: 1.06, addedOn: new Date('2026-08-01') },
      ],
      packagedOn: new Date('2026-09-20'),
    });
    expect(early.inputs.additionPrimingVolumes).toBeUndefined();
    expect((early.notes ?? []).join(' ')).not.toContain('three weeks');
  });
});

describe('a measured FG already counts the sugar added before it was read', () => {
  const beer: BlendComponentInput = {
    name: 'Young lambic',
    volumeL: 20,
    og: 1.05,
    fg: 1.004,
    ph: null,
    srm: null,
    peakTempC: 20,
    barrelAged: false,
    naohMl: null,
  };
  const cherries = { kind: 'fruit', name: 'Cherries', volumeL: 2, sg: 1.06 } as const;

  it('does not charge a late addition to the dose twice over', () => {
    // Fruit added on the 18th, FG read on the 19th, bottled on the 20th. The
    // reading includes the cherries, so the extract term already counts their
    // sugar. Counting it again as priming sugar would reduce the dose twice
    // for the same fruit.
    const measured = evaluateBlend({
      components: [beer],
      targetVolumes: 3,
      additions: [{ ...cherries, addedOn: new Date('2026-09-18') }],
      measuredFg: 1.02,
      measuredOn: new Date('2026-09-19'),
      packagedOn: new Date('2026-09-20'),
      kegVolumeL: null,
    });
    expect(measured.additionPrimingSugarKg).toBeNull();
    expect(measured.additionPrimingVolumes).toBe(0);
    // The measured extract covers it instead.
    expect(measured.extractVolumes).toBeCloseTo(
      EXTRACT_CO2_VOLUMES_PER_GRAVITY_POINT * (20 - 4),
      9,
    );
  });

  it('still charges one the reading was taken before', () => {
    const after = evaluateBlend({
      components: [beer],
      targetVolumes: 3,
      additions: [{ ...cherries, addedOn: new Date('2026-09-18') }],
      measuredFg: 1.004,
      measuredOn: new Date('2026-09-10'),
      packagedOn: new Date('2026-09-20'),
      kegVolumeL: null,
    });
    expect(after.additionPrimingSugarKg).toBeCloseTo(fruitSugarKilograms(cherries), 9);
    expect(after.additionPrimingVolumes).toBeGreaterThan(0);
  });
});

describe('a hop in the blend', () => {
  const base: BlendComponentInput = {
    name: 'Young',
    volumeL: 20,
    og: 1.0466,
    fg: 1.001,
    ph: null,
    srm: null,
    peakTempC: 20,
    barrelAged: false,
    naohMl: null,
  };

  it('moves no number at all, the way a herb does not', () => {
    const plain = evaluateBlend({
      components: [base],
      targetVolumes: 3,
      additions: [],
      kegVolumeL: null,
    });
    const hopped = evaluateBlend({
      components: [base],
      targetVolumes: 3,
      additions: [{ kind: 'hop', name: 'Citra', amountG: 120 }],
      kegVolumeL: null,
    });
    expect(hopped.abv).toEqual(plain.abv);
    expect(hopped.abvWithAdditions).toBeNull();
    expect(hopped.additionSugarKg).toBeNull();
    expect(hopped.totalVolumeL).toBeCloseTo(plain.totalVolumeL, 9);
    expect(hopped.priming?.sugarGrams).toBeCloseTo(plain.priming?.sugarGrams ?? 0, 9);
  });

  it('is not priming sugar however close to packaging it went in', () => {
    // The timing check is about sugar, and a hop has none.
    const late = evaluateBlend({
      components: [base],
      targetVolumes: 3,
      additions: [{ kind: 'hop', name: 'Citra', amountG: 120, addedOn: new Date('2026-09-19') }],
      packagedOn: new Date('2026-09-20'),
      kegVolumeL: null,
    });
    expect(late.additionPrimingSugarKg).toBeNull();
    expect(late.additionPrimingVolumes).toBe(0);
  });
});
