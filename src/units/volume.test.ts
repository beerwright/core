import { describe, expect, it } from 'vitest';
import {
  fluidOuncesToLitres,
  gallonsToLitres,
  imperialGallonsToLitres,
  litresToFluidOunces,
  litresToGallons,
  litresToImperialGallons,
  litresToImperialQuarts,
  litresToMillilitres,
  litresToQuarts,
  millilitresToLitres,
  quartsToLitres,
} from './volume';

describe('US gallons', () => {
  it('uses the exact factor', () => {
    expect(gallonsToLitres(1)).toBe(3.785411784);
  });

  it.each([
    [19, 5.0193],
    [20, 5.2834],
    [23, 6.076],
  ])('converts %f L to ~%f gal', (litres, gallons) => {
    expect(litresToGallons(litres)).toBeCloseTo(gallons, 4);
  });

  it('converts a 5 gal batch to ~18.93 L', () => {
    expect(gallonsToLitres(5)).toBeCloseTo(18.9271, 4);
  });

  it.each([1, 19, 23.5])('round trips %f L', (litres) => {
    expect(gallonsToLitres(litresToGallons(litres))).toBeCloseTo(litres, 12);
  });
});

describe('US quarts', () => {
  it('is a quarter gallon', () => {
    expect(quartsToLitres(4)).toBeCloseTo(gallonsToLitres(1), 12);
  });

  it('converts 1 L to ~1.0567 qt', () => {
    expect(litresToQuarts(1)).toBeCloseTo(1.056688, 5);
  });

  it.each([1, 6.5, 19])('round trips %f L', (litres) => {
    expect(quartsToLitres(litresToQuarts(litres))).toBeCloseTo(litres, 12);
  });
});

describe('imperial measures', () => {
  it('uses the exact factor', () => {
    expect(imperialGallonsToLitres(1)).toBe(4.54609);
  });

  it('is larger than the US gallon', () => {
    expect(litresToImperialGallons(20)).toBeLessThan(litresToGallons(20));
  });

  it('is a quarter gallon', () => {
    expect(litresToImperialQuarts(4.54609)).toBeCloseTo(4, 12);
  });
});

describe('US fluid ounces', () => {
  it('is a 128th of a gallon', () => {
    expect(fluidOuncesToLitres(128)).toBeCloseTo(3.785411784, 12);
  });

  /** The two bottles US homebrewers prime for. */
  it.each([
    [12, 0.35488],
    [22, 0.65062],
  ])('%f fl oz is %f L', (ounces, litres) => {
    expect(fluidOuncesToLitres(ounces)).toBeCloseTo(litres, 5);
  });

  it.each([0.33, 0.5, 0.75])('round trips %f L', (litres) => {
    expect(fluidOuncesToLitres(litresToFluidOunces(litres))).toBeCloseTo(litres, 12);
  });
});

describe('millilitres', () => {
  it('converts both ways', () => {
    expect(litresToMillilitres(0.0065)).toBeCloseTo(6.5, 9);
    expect(millilitresToLitres(6.5)).toBeCloseTo(0.0065, 9);
  });
});
