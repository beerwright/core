import { describe, expect, it } from 'vitest';
import { POINTS_PER_KG_PER_L_PER_PPG } from './defaults';
import {
  MUST_SUGAR_POINTS_L_PER_KG,
  MUST_SUGAR_PPG,
  nutrientSchedule,
  nutrientScheduleExplained,
  sugarToGravity,
  sugarToGravityExplained,
  TOSNA_ADDITIONS,
  TOSNA_NITROGEN_FACTORS,
} from './must';
import { sgToBrix } from './units/gravity';
import { litresToGallons } from './units/volume';

describe('sugarToGravity', () => {
  // 19 L of water taken from 1.020 to 1.110 is 90 points over 19 L, and honey
  // yields 35 × 8.345404 = 292.09 points·L/kg. 90 × 19 / 292.09 = 5.854 kg.
  it('weighs the honey for the worked mead', () => {
    const { massKg } = sugarToGravity({
      currentSg: 1.02,
      targetSg: 1.11,
      volumeL: 19,
      sugar: 'honey',
    });
    expect(massKg).toBeCloseTo((90 * 19) / (35 * POINTS_PER_KG_PER_L_PER_PPG), 6);
    expect(massKg).toBeCloseTo(5.854, 3);
  });

  it('needs less of a richer sugar for the same move', () => {
    const args = { currentSg: 1.02, targetSg: 1.11, volumeL: 19 } as const;
    const honey = sugarToGravity({ ...args, sugar: 'honey' }).massKg;
    const dextrose = sugarToGravity({ ...args, sugar: 'dextrose' }).massKg;
    const sucrose = sugarToGravity({ ...args, sugar: 'sucrose' }).massKg;
    expect(sucrose).toBeLessThan(dextrose);
    expect(dextrose).toBeLessThan(honey);
  });

  it('derives its yields from the engine’s own PPG conversion', () => {
    for (const [sugar, ppg] of Object.entries(MUST_SUGAR_PPG)) {
      expect(MUST_SUGAR_POINTS_L_PER_KG[sugar as keyof typeof MUST_SUGAR_PPG]).toBeCloseTo(
        ppg * POINTS_PER_KG_PER_L_PER_PPG,
        9,
      );
    }
  });

  it('adds nothing when the target is already reached, or passed', () => {
    const at = { currentSg: 1.11, targetSg: 1.11, volumeL: 19, sugar: 'honey' } as const;
    expect(sugarToGravity(at).massKg).toBe(0);
    expect(sugarToGravity({ ...at, targetSg: 1.05 }).massKg).toBe(0);
  });

  it('adds nothing to a volume of nothing', () => {
    expect(
      sugarToGravity({ currentSg: 1, targetSg: 1.11, volumeL: 0, sugar: 'honey' }).massKg,
    ).toBe(0);
  });
});

describe('sugarToGravityExplained', () => {
  const explanation = sugarToGravityExplained({
    currentSg: 1.02,
    targetSg: 1.11,
    volumeL: 19,
    sugar: 'honey',
  });

  it('files itself under the cellar, with a source', () => {
    expect(explanation.family).toBe('cellar');
    expect(explanation.sources?.[0]?.author).toContain('Schramm');
  });

  it('cites Palmer instead when the sugar is one of his', () => {
    const sucrose = sugarToGravityExplained({
      currentSg: 1.02,
      targetSg: 1.11,
      volumeL: 19,
      sugar: 'sucrose',
    });
    expect(sucrose.sources?.[0]?.author).toContain('Palmer');
  });

  it('warns that the sugar’s own volume is not in the answer', () => {
    expect(explanation.notes?.join(' ')).toContain('0.7 L');
  });

  it('agrees with the function it wraps', () => {
    expect(explanation.value).toBeCloseTo(
      sugarToGravity({ currentSg: 1.02, targetSg: 1.11, volumeL: 19, sugar: 'honey' }).massKg,
      12,
    );
  });
});

describe('nutrientSchedule', () => {
  // TOSNA 3.0 as published: (((Brix × 10) × factor) / 50) × gallons. 1.110 is
  // 25.94 °Bx, medium is 0.90, and 19 L is 5.019 US gal, so the total is
  // (25.94 × 10 × 0.9 / 50) × 5.019 = 23.43 g.
  const MEAD = { volumeL: 19, originalSg: 1.11, demand: 'medium' } as const;

  it('follows the published formula, coefficient for coefficient', () => {
    const brix = sgToBrix(1.11);
    const expected = ((brix * 10 * 0.9) / 50) * litresToGallons(19);
    expect(nutrientSchedule(MEAD).fermaidOGrams).toBeCloseTo(expected, 9);
    expect(nutrientSchedule(MEAD).fermaidOGrams).toBeCloseTo(23.43, 2);
  });

  it('splits the total into four equal additions that add back up', () => {
    const { fermaidOGrams, additions } = nutrientSchedule(MEAD);
    expect(additions).toHaveLength(TOSNA_ADDITIONS);
    for (const addition of additions) expect(addition.grams).toBeCloseTo(fermaidOGrams / 4, 9);
    expect(additions.reduce((sum, a) => sum + a.grams, 0)).toBeCloseTo(fermaidOGrams, 9);
  });

  it('names the four points the published page names, and none of them is the pitch', () => {
    const labels = nutrientSchedule(MEAD).additions.map((a) => a.label);
    expect(labels[0]).toContain('24 hours');
    expect(labels[1]).toContain('48 hours');
    expect(labels[2]).toContain('72 hours');
    expect(labels[3]).toContain('sugar break');
    expect(labels.join(' ')).not.toContain('pitching the');
  });

  it('feeds a hungry strain more than a lazy one, in the published ratio', () => {
    const low = nutrientSchedule({ ...MEAD, demand: 'low' }).fermaidOGrams;
    const high = nutrientSchedule({ ...MEAD, demand: 'high' }).fermaidOGrams;
    expect(high / low).toBeCloseTo(TOSNA_NITROGEN_FACTORS.high / TOSNA_NITROGEN_FACTORS.low, 9);
  });

  it('feeds nothing to no must, and nothing to plain water', () => {
    expect(nutrientSchedule({ ...MEAD, volumeL: 0 }).fermaidOGrams).toBe(0);
    expect(nutrientSchedule({ ...MEAD, originalSg: 1 }).fermaidOGrams).toBe(0);
    for (const addition of nutrientSchedule({ ...MEAD, volumeL: 0 }).additions) {
      expect(addition.grams).toBe(0);
    }
  });
});

describe('nutrientScheduleExplained', () => {
  const explanation = nutrientScheduleExplained({
    volumeL: 19,
    originalSg: 1.11,
    demand: 'medium',
  });

  it('files itself under the cellar, citing the calculator it came from', () => {
    expect(explanation.family).toBe('cellar');
    expect(explanation.sources?.[0]?.url).toBe('https://www.meadmaderight.com/nutrient-additions');
  });

  it('reports the Brix it converted to, so the published tool can be checked against it', () => {
    expect(explanation.inputs.originalBrix).toBeCloseTo(sgToBrix(1.11), 1);
  });

  it('says that TOSNA states no YAN per gram, rather than implying one', () => {
    expect(explanation.notes?.join(' ')).toContain('does not state');
  });
});
