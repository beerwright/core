import { describe, expect, it } from 'vitest';
import { waterDensityKgPerM3 } from './corrections';
import {
  abvToMassFraction,
  dissolvedSugarVolumeLPerKg,
  ethanolWaterDensityKgPerL,
  massFractionToAbv,
  mixSpirits,
  mixSpiritsExplained,
  mixSpiritsRefusal,
  proofAndSweeten,
  proofAndSweetenExplained,
  proofAndSweetenRefusal,
  sugarConcentrationToBrix,
} from './spirits';

describe('dissolvedSugarVolumeLPerKg', () => {
  // The five figures quoted in the beverage literature, each computed from the
  // Plato fit: the volume of 100 g of solution, minus the volume its water
  // alone would occupy, divided by the grams of sugar in it.
  it.each([
    [10, 0.6162],
    [20, 0.618],
    [30, 0.6197],
    [40, 0.6215],
    [60, 0.6249],
  ])('is %d °Bx worth of sucrose at %f L/kg', (brix, expected) => {
    expect(dissolvedSugarVolumeLPerKg(brix)).toBeCloseTo(expected, 4);
  });

  it('climbs with concentration, because a crowded solution packs less tightly', () => {
    expect(dissolvedSugarVolumeLPerKg(10)).toBeLessThan(dissolvedSugarVolumeLPerKg(60));
  });

  it('answers the infinitely dilute figure rather than dividing by no sugar at all', () => {
    expect(dissolvedSugarVolumeLPerKg(0)).toBeCloseTo(0.6144, 4);
  });
});

describe('sugarConcentrationToBrix', () => {
  it('turns grams per litre into the °Bx of a solution carrying them', () => {
    // 150 g/L of sucrose is 14.2 °Bx. At that strength a litre weighs
    // 1.0557 kg and 14.2 % of it is sugar.
    expect(sugarConcentrationToBrix(150)).toBeCloseTo(14.2065, 3);
  });

  it('round-trips against the Plato relation it inverts', () => {
    for (const gramsPerLitre of [50, 150, 300, 600]) {
      const brix = sugarConcentrationToBrix(gramsPerLitre);
      const sg = 1 + brix / (258.6 - (brix / 258.2) * 227.1);
      expect(10 * brix * sg * 0.99823).toBeCloseTo(gramsPerLitre, 6);
    }
  });

  it('has nothing to invert at no sugar at all', () => {
    expect(sugarConcentrationToBrix(0)).toBe(0);
  });
});

describe('proofAndSweeten', () => {
  // Worked example: a litre of 60 % macerate, targeting 30 % and 150 g/L.
  // Alcohol is conserved, so the final volume is two litres. 300 g of sugar
  // goes in and takes up some of that volume, and the rest is water.
  const AMARO = {
    volumeL: 1,
    abvPercent: 60,
    targetAbvPercent: 30,
    targetSugarGL: 150,
    sweetener: { kind: 'sugar' },
  } as const;

  it('doubles the litre, because halving the strength doubles the volume', () => {
    expect(proofAndSweeten(AMARO)?.finalVolumeL).toBeCloseTo(2.0, 4);
  });

  it('weighs out 300 g of sugar for the volume it will end up in', () => {
    expect(proofAndSweeten(AMARO)?.sugarKg).toBeCloseTo(0.3, 4);
  });

  it('leaves the sugar room and pours the rest as water', () => {
    const result = proofAndSweeten(AMARO);
    const sugarRoomL = (result?.finalVolumeL ?? 0) - AMARO.volumeL - (result?.waterL ?? 0);
    expect(sugarRoomL).toBeCloseTo(0.1851, 4);
    expect(result?.waterL).toBeCloseTo(0.8149, 4);
  });

  it('comes out at the strength and the sweetness that were asked for', () => {
    const result = proofAndSweeten(AMARO);
    expect(result?.finalAbvPercent).toBeCloseTo(30, 6);
    expect(result?.finalSugarGL).toBeCloseTo(150, 6);
  });

  it('adds no syrup when the sweetener is dry sugar', () => {
    expect(proofAndSweeten(AMARO)?.syrupL).toBe(0);
  });

  it('reaches the same target with less water when the sugar arrives as syrup', () => {
    const syrup = proofAndSweeten({ ...AMARO, sweetener: { kind: 'syrup', brix: 60 } });
    expect(syrup?.sugarKg).toBeCloseTo(0.3, 4);
    expect(syrup?.syrupL).toBeCloseTo(0.3878, 4);
    expect(syrup?.waterL).toBeCloseTo(0.6146, 4);
    expect(syrup?.waterL ?? 0).toBeLessThan(proofAndSweeten(AMARO)?.waterL ?? 0);
    expect(syrup?.finalVolumeL).toBeCloseTo(2.0, 4);
    expect(syrup?.finalAbvPercent).toBeCloseTo(30, 6);
    expect(syrup?.finalSugarGL).toBeCloseTo(150, 6);
  });

  it('refuses a target at or above what is already in the jar', () => {
    expect(proofAndSweeten({ ...AMARO, targetAbvPercent: 60 })).toBeNull();
    expect(proofAndSweeten({ ...AMARO, targetAbvPercent: 70 })).toBeNull();
  });

  it('refuses a sugar target that will not fit in the volume that strength allows', () => {
    // A litre of 60 % taken to 55 % is 1.09 L, which leaves 91 mL for sugar.
    // 327 g of sugar needs more than twice that.
    expect(proofAndSweeten({ ...AMARO, targetAbvPercent: 55, targetSugarGL: 300 })).toBeNull();
  });

  it('refuses a jar with nothing in it, rather than dividing by no volume', () => {
    expect(proofAndSweeten({ ...AMARO, volumeL: 0 })).toBeNull();
    expect(proofAndSweeten({ ...AMARO, abvPercent: 0 })).toBeNull();
    expect(proofAndSweeten({ ...AMARO, targetAbvPercent: 0 })).toBeNull();
  });

  it('proofs down without sweetening at all', () => {
    const plain = proofAndSweeten({ ...AMARO, targetSugarGL: 0 });
    expect(plain?.sugarKg).toBe(0);
    expect(plain?.waterL).toBeCloseTo(1, 9);
  });
});

describe('proofAndSweetenExplained', () => {
  const explanation = proofAndSweetenExplained({
    volumeL: 1,
    abvPercent: 60,
    targetAbvPercent: 30,
    targetSugarGL: 150,
    sweetener: { kind: 'sugar' },
  });

  it('files itself under spirits, citing the Plato fit it derives the sugar’s room from', () => {
    expect(explanation?.family).toBe('spirits');
    expect(explanation?.sources?.[0]?.author).toContain('American Society of Brewing Chemists');
  });

  it('explains the water, which is the number a maker pours', () => {
    expect(explanation?.value).toBeCloseTo(0.8149, 4);
    expect(explanation?.unit).toBe('L');
  });

  it('says what the model does not know', () => {
    expect(explanation?.notes?.join(' ')).toContain('Spirit and water contract');
  });

  it('declines with the arithmetic, rather than explaining a number that is not one', () => {
    expect(
      proofAndSweetenExplained({
        volumeL: 1,
        abvPercent: 40,
        targetAbvPercent: 40,
        targetSugarGL: 0,
        sweetener: { kind: 'sugar' },
      }),
    ).toBeNull();
  });
});

describe('ethanolWaterDensityKgPerL', () => {
  // Figures from the International Alcoholometric Tables at 20 °C.
  it('gives water and ethanol their tabled densities', () => {
    expect(ethanolWaterDensityKgPerL(0, 20)).toBeCloseTo(0.9982, 5);
    expect(ethanolWaterDensityKgPerL(1, 20)).toBeCloseTo(0.78924, 5);
  });

  it('puts water at its densest near 4 °C and lighter at 40', () => {
    expect(ethanolWaterDensityKgPerL(0, 4)).toBeGreaterThan(ethanolWaterDensityKgPerL(0, 0));
    expect(ethanolWaterDensityKgPerL(0, 4)).toBeGreaterThan(ethanolWaterDensityKgPerL(0, 10));
    expect(ethanolWaterDensityKgPerL(0, 40)).toBeCloseTo(0.99222, 3);
  });

  it('gives a 40 % spirit its tabled density', () => {
    expect(ethanolWaterDensityKgPerL(abvToMassFraction(40), 20)).toBeCloseTo(0.94805, 4);
  });
});

describe('abvToMassFraction', () => {
  it.each([
    [40, 0.333],
    [50, 0.4243],
    [96, 0.9384],
  ])('reads %d %% vol as the tabled mass fraction', (abv, fraction) => {
    expect(abvToMassFraction(abv)).toBeCloseTo(fraction, 3);
  });

  it('round-trips through massFractionToAbv', () => {
    for (const abv of [0.5, 12, 30, 60, 96.5]) {
      expect(massFractionToAbv(abvToMassFraction(abv))).toBeCloseTo(abv, 9);
    }
  });

  it('pins the ends', () => {
    expect(abvToMassFraction(0)).toBe(0);
    expect(abvToMassFraction(100)).toBe(1);
  });
});

describe('mixSpirits', () => {
  const at20 = (amount: number, abvPercent: number) =>
    ({ amount, unit: 'L', tempC: 20, abvPercent }) as const;

  it('counts the contraction: a litre of 96 % and a litre of water make 1.94 L at 49.5 %', () => {
    const mix = mixSpirits([at20(1, 96), at20(1, 0)]);
    expect(mix?.abvPercent).toBeCloseTo(49.5, 1);
    expect(mix?.volumeL).toBeCloseTo(1.939, 3);
    expect(mix?.additiveVolumeL).toBeCloseTo(2, 9);
    expect(mix?.pureAlcoholL).toBeCloseTo(0.96, 9);
  });

  it('shrinks equal volumes of ethanol and water by about 3.5 %', () => {
    const mix = mixSpirits([at20(0.5, 100), at20(0.5, 0)]);
    expect(mix?.volumeL).toBeCloseTo(0.9646, 4);
  });

  it('gives back a single liquid unchanged', () => {
    const mix = mixSpirits([at20(0.7, 40)]);
    expect(mix?.abvPercent).toBeCloseTo(40, 9);
    expect(mix?.volumeL).toBeCloseTo(0.7, 9);
  });

  it('takes a liquid in kilograms the same as the litres it weighs', () => {
    const litres = mixSpirits([at20(1, 60), at20(1, 0)]);
    const kgOf60 = ethanolWaterDensityKgPerL(abvToMassFraction(60), 20);
    const kilograms = mixSpirits([
      { amount: kgOf60, unit: 'kg', tempC: 35, abvPercent: 60 },
      at20(1, 0),
    ]);
    expect(kilograms?.abvPercent).toBeCloseTo(litres?.abvPercent ?? 0, 9);
    expect(kilograms?.volumeL).toBeCloseTo(litres?.volumeL ?? 0, 9);
  });

  it('corrects litres measured cold to their volume at 20 °C', () => {
    const cold = mixSpirits([{ amount: 1, unit: 'L', tempC: 10, abvPercent: 40 }]);
    // Denser when cold, so a litre measured at 10 °C is more than a litre at 20.
    expect(cold?.volumeL).toBeGreaterThan(1.006);
    expect(cold?.abvPercent).toBeCloseTo(40, 9);
  });

  it('takes a negative amount out of the mix', () => {
    // Ten litres of 10 % wash with a litre of 70 % run off leaves it weaker.
    const left = mixSpirits([at20(10, 10), at20(-1, 70)]);
    expect(left?.abvPercent).toBeGreaterThan(3);
    expect(left?.abvPercent).toBeLessThan(4);
  });

  it('refuses a mix with nothing in it, or less than nothing', () => {
    expect(mixSpirits([])).toBeNull();
    expect(mixSpirits([at20(1, 40), at20(-1, 40)])).toBeNull();
    expect(mixSpirits([at20(1, 40), at20(-2, 0)])).toBeNull();
  });

  it('refuses taking out more alcohol than is there', () => {
    expect(mixSpirits([at20(2, 10), at20(-0.5, 96)])).toBeNull();
  });

  it('refuses a temperature outside the formula, but not for kilograms', () => {
    expect(mixSpirits([{ amount: 1, unit: 'L', tempC: 60, abvPercent: 40 }])).toBeNull();
    expect(mixSpirits([{ amount: 1, unit: 'kg', tempC: 60, abvPercent: 40 }])).not.toBeNull();
  });

  it('explains itself with one row per liquid', () => {
    const explanation = mixSpiritsExplained([at20(1, 96), at20(1, 0)]);
    expect(explanation?.value).toBeCloseTo(49.5, 1);
    expect(explanation?.inputs.liquid1).toBe('1 L at 20 °C, 96 %');
    expect(explanation?.inputs.liquid2).toBe('1 L at 20 °C, 0 %');
    expect(explanation?.family).toBe('spirits');
    expect(mixSpiritsExplained([])).toBeNull();
  });
});

describe('the OIML water term away from 20 °C', () => {
  it('agrees with Kell for plain water across the fitted range', () => {
    // At zero strength only the B coefficients are in play, so this pins each
    // of them against an independent density equation. B4 was once a factor
    // of ten out, which put water 0.05 g/L heavy at 40 °C.
    for (const tempC of [0, 4, 10, 30, 40]) {
      const gap = ethanolWaterDensityKgPerL(0, tempC) - waterDensityKgPerM3(tempC) / 1000;
      expect(Math.abs(gap)).toBeLessThan(2e-5);
    }
  });
});

describe('proofAndSweetenRefusal', () => {
  const jar = {
    volumeL: 1,
    abvPercent: 60,
    targetAbvPercent: 30,
    targetSugarGL: 150,
    sweetener: { kind: 'sugar' },
  } as const;

  it('says nothing when there is an answer', () => {
    expect(proofAndSweetenRefusal(jar)).toBeNull();
  });

  it('says nothing about a jar nobody has described yet', () => {
    expect(proofAndSweetenRefusal({ ...jar, volumeL: 0 })).toBeNull();
    expect(proofAndSweetenRefusal({ ...jar, sweetener: { kind: 'syrup', brix: 0 } })).toBeNull();
  });

  it('names a target above the strength in the jar', () => {
    expect(proofAndSweetenRefusal({ ...jar, targetAbvPercent: 70 })).toMatch(
      /cannot reach a strength higher/,
    );
  });

  it('names sugar that does not fit', () => {
    expect(proofAndSweetenRefusal({ ...jar, targetAbvPercent: 55, targetSugarGL: 300 })).toMatch(
      /sugar does not fit/,
    );
  });

  /**
   * 300 g of sugar from a 10 °Bx syrup: a litre holds
   * `0.10 × 1.040 × 0.9982 = 0.1038 kg`, so it takes 2.89 L of syrup, and the
   * finished drink is only 2 L. Dry sugar fits with room to spare.
   */
  it('names a syrup too thin for a sugar target that dry sugar would meet', () => {
    const thin = { ...jar, sweetener: { kind: 'syrup', brix: 10 } } as const;
    expect(proofAndSweeten(thin)).toBeNull();
    expect(proofAndSweetenRefusal(thin)).toMatch(/syrup brings more water/);
  });

  it.each([100, 120])('refuses a syrup at %d °Bx', (brix) => {
    const input = { ...jar, sweetener: { kind: 'syrup', brix } } as const;
    expect(proofAndSweeten(input)).toBeNull();
    expect(proofAndSweetenRefusal(input)).toMatch(/under 100 °Bx/);
  });
});

describe('mixSpiritsRefusal', () => {
  const litres = (amount: number, abvPercent: number, tempC = 20) =>
    ({ amount, unit: 'L', tempC, abvPercent }) as const;

  it('says nothing when there is an answer, or nothing to mix', () => {
    expect(mixSpiritsRefusal([litres(1, 96), litres(1, 0)])).toBeNull();
    expect(mixSpiritsRefusal([])).toBeNull();
    expect(mixSpiritsRefusal([litres(0, 40), litres(0, 0)])).toBeNull();
  });

  it('names negative amounts that take out more than went in', () => {
    expect(mixSpirits([litres(1, 40), litres(-2, 0)])).toBeNull();
    expect(mixSpiritsRefusal([litres(1, 40), litres(-2, 0)])).toMatch(/take out more/);
  });

  it('names a strength outside 0 to 100 % ahead of the negative amount', () => {
    expect(mixSpiritsRefusal([litres(20, 40), litres(-2, 140)])).toMatch(/between 0 and 100 %/);
  });

  it('names a temperature the density formula does not cover', () => {
    expect(mixSpiritsRefusal([litres(1, 96), litres(1, 0, 60)])).toMatch(/between −20 and 40 °C/);
  });

  it('ignores the temperature of a liquid that was weighed', () => {
    expect(
      mixSpiritsRefusal([litres(1, 96), { amount: 1, unit: 'kg', tempC: 60, abvPercent: 0 }]),
    ).toBeNull();
  });
});
