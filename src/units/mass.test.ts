import { describe, expect, it } from 'vitest';
import {
  gramsToKg,
  kgToGrams,
  kgToOunces,
  kgToPounds,
  kgToPoundsOunces,
  ouncesToKg,
  poundsToKg,
} from './mass';

describe('pounds', () => {
  it('uses the exact avoirdupois factor', () => {
    expect(poundsToKg(1)).toBe(0.45359237);
  });

  it.each([
    [1, 2.204623],
    [5, 11.023113],
    [0.5, 1.102311],
  ])('converts %f kg to ~%f lb', (kg, lb) => {
    expect(kgToPounds(kg)).toBeCloseTo(lb, 5);
  });

  it.each([0.001, 1, 4.536, 25])('round trips %f kg', (kg) => {
    expect(poundsToKg(kgToPounds(kg))).toBeCloseTo(kg, 12);
  });
});

describe('ounces', () => {
  it('is a sixteenth of a pound', () => {
    expect(ouncesToKg(16)).toBeCloseTo(poundsToKg(1), 12);
  });

  it('converts 28.349523125 g to 1 oz', () => {
    expect(kgToOunces(0.028349523125)).toBeCloseTo(1, 12);
  });

  it('converts a typical hop addition', () => {
    expect(kgToOunces(0.028)).toBeCloseTo(0.9877, 4);
  });

  it.each([0.028, 0.1, 1])('round trips %f kg', (kg) => {
    expect(ouncesToKg(kgToOunces(kg))).toBeCloseTo(kg, 12);
  });
});

describe('grams', () => {
  it('converts both ways', () => {
    expect(kgToGrams(1.25)).toBeCloseTo(1250, 9);
    expect(gramsToKg(1250)).toBeCloseTo(1.25, 9);
  });
});

describe('kgToPoundsOunces', () => {
  it('splits a grain bill mass into lb + oz', () => {
    const { pounds, ounces } = kgToPoundsOunces(4.2);
    expect(pounds).toBe(9);
    expect(ounces).toBeCloseTo(4.1506, 3);
  });

  it('never reports 16 or more ounces', () => {
    for (let kg = 0.05; kg < 12; kg += 0.05) {
      const { ounces } = kgToPoundsOunces(kg);
      expect(ounces).toBeGreaterThanOrEqual(0);
      expect(ounces).toBeLessThan(16);
    }
  });

  it('recomposes to the original mass', () => {
    const { pounds, ounces } = kgToPoundsOunces(7.77);
    expect(poundsToKg(pounds) + ouncesToKg(ounces)).toBeCloseTo(7.77, 12);
  });
});
