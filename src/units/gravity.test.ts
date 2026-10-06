import { describe, expect, it } from 'vitest';
import {
  brixToSg,
  gravityPointsToSg,
  platoToSg,
  sgToBrix,
  sgToGravityPoints,
  sgToPlato,
} from './gravity';

describe('sgToPlato', () => {
  it.each([
    [1.0, 0],
    [1.04, 9.99],
    [1.048, 11.91],
    [1.056, 13.8],
    [1.076, 18.47],
  ])('converts %f SG to ~%f °P', (sg, plato) => {
    expect(sgToPlato(sg)).toBeCloseTo(plato, 1);
  });

  it('is monotonically increasing', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let sg = 1.0; sg <= 1.13; sg += 0.002) {
      const plato = sgToPlato(sg);
      expect(plato).toBeGreaterThan(previous);
      previous = plato;
    }
  });
});

describe('platoToSg', () => {
  it('converts 0 °P to water', () => {
    expect(platoToSg(0)).toBe(1);
  });

  it.each([
    [10, 1.04],
    [12, 1.0484],
    [20, 1.0832],
  ])('converts %f °P to ~%f SG', (plato, sg) => {
    expect(platoToSg(plato)).toBeCloseTo(sg, 3);
  });
});

describe('sg <-> plato round trip', () => {
  it.each([1.01, 1.03, 1.048, 1.062, 1.09, 1.12])('round trips %f within 0.0005 SG', (sg) => {
    expect(platoToSg(sgToPlato(sg))).toBeCloseTo(sg, 3);
  });
});

describe('gravity points', () => {
  it('converts SG to points', () => {
    expect(sgToGravityPoints(1.048)).toBeCloseTo(48, 6);
  });

  it('round trips', () => {
    expect(gravityPointsToSg(sgToGravityPoints(1.062))).toBeCloseTo(1.062, 9);
  });
});

describe('brix', () => {
  it('tracks plato', () => {
    expect(sgToBrix(1.048)).toBeCloseTo(sgToPlato(1.048), 9);
    expect(brixToSg(12)).toBeCloseTo(platoToSg(12), 9);
  });
});
