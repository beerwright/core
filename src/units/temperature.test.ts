import { describe, expect, it } from 'vitest';
import {
  celsiusDeltaToFahrenheit,
  celsiusToFahrenheit,
  fahrenheitDeltaToCelsius,
  fahrenheitToCelsius,
} from './temperature';

describe('celsiusToFahrenheit', () => {
  it.each([
    [0, 32],
    [100, 212],
    [-40, -40],
    [20, 68],
    [66, 150.8],
    [67, 152.6],
  ])('converts %f °C to %f °F', (c, f) => {
    expect(celsiusToFahrenheit(c)).toBeCloseTo(f, 6);
  });
});

describe('fahrenheitToCelsius', () => {
  it.each([
    [32, 0],
    [212, 100],
    [-40, -40],
    [152, 66.6667],
  ])('converts %f °F to %f °C', (f, c) => {
    expect(fahrenheitToCelsius(f)).toBeCloseTo(c, 4);
  });
});

describe('round trip', () => {
  it.each([-20, 0, 18, 65.5, 100])('round trips %f °C', (c) => {
    expect(fahrenheitToCelsius(celsiusToFahrenheit(c))).toBeCloseTo(c, 9);
  });
});

describe('deltas', () => {
  it('scales without the offset', () => {
    expect(celsiusDeltaToFahrenheit(1)).toBeCloseTo(1.8, 9);
    expect(fahrenheitDeltaToCelsius(9)).toBeCloseTo(5, 9);
  });

  it('round trips', () => {
    expect(fahrenheitDeltaToCelsius(celsiusDeltaToFahrenheit(12.5))).toBeCloseTo(12.5, 9);
  });
});
