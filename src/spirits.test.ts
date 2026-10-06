import { describe, expect, it } from 'vitest';
import {
  dissolvedSugarVolumeLPerKg,
  proofAndSweeten,
  proofAndSweetenExplained,
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
