import { describe, expect, it } from 'vitest';
import {
  beerVolumeFromWeight,
  blend,
  boilDownToTargetGravity,
  calibrateWortCorrectionFactor,
  correctHydrometerReading,
  correctRefractometerBrix,
  correctVolumeToReference,
  DEFAULT_HYDROMETER_CALIBRATION_TEMP_C,
  DEFAULT_WORT_CORRECTION_FACTOR,
  dilutionToTargetGravity,
  gravityAfterDilution,
  REFERENCE_VOLUME_TEMP_C,
  refractometerFinalGravity,
  refractometerFinalGravityRaw,
  refractometerToGravity,
  sugarToTargetGravity,
  WATER_DENSITY_AT_REFERENCE_KG_PER_L,
  waterDensityKgPerM3,
} from './corrections';
import { apparentAttenuationPercent } from './gravity';
import { sgToPlato } from './units/gravity';
import { applyBoilShrinkage } from './volumes';

describe('refractometer wort correction', () => {
  it('divides by the WCF', () => {
    expect(DEFAULT_WORT_CORRECTION_FACTOR).toBe(1.04);
    // 12 / 1.04 = 11.5385 °Bx
    expect(correctRefractometerBrix(12)).toBeCloseTo(11.5385, 4);
  });

  it('converts a raw reading to SG', () => {
    // 11.5385 °P → 1.04643 SG
    expect(refractometerToGravity(12)).toBeCloseTo(1.04643, 5);
  });

  it('honours a custom factor', () => {
    expect(correctRefractometerBrix(12, 1.02)).toBeCloseTo(12 / 1.02, 9);
  });

  it('calibrates a factor from a paired hydrometer reading', () => {
    const wcf = calibrateWortCorrectionFactor(12, 1.0464);
    expect(wcf).toBeCloseTo(12 / sgToPlato(1.0464), 9);
    // Round trip: the calibrated factor recovers the hydrometer gravity.
    expect(refractometerToGravity(12, wcf)).toBeCloseTo(1.0464, 4);
  });
});

describe('refractometer fermenting-sample correction (Terrill linear)', () => {
  /**
   * Golden values, computed longhand from
   * `FG = 1.001843 − 0.002318474·OB − 0.000007775·OB² − 0.000000034·OB³
   *              + 0.00574·FB + 0.00003344·FB² + 0.000000086·FB³`
   *
   * OB = 12, FB = 6.5:
   * ```
   * 1.001843 − 0.0278217 − 0.0011196 − 0.0000588
   *          + 0.0373100 + 0.0014129 + 0.0000236 = 1.01159
   * ```
   * **Tolerance: 0.00005 SG.**
   */
  it.each([
    [12, 6.5, 1.01159],
    [12, 7, 1.01466],
    [16, 9, 1.017],
  ])('OB %f, FB %f → FG %f', (ob, fb, fg) => {
    expect(refractometerFinalGravity(ob, fb)).toBeCloseTo(fg, 4);
  });

  it('stays physical across the brewing range when no fermentation happened', () => {
    // Fed OB = FB, the model should land near the true gravity of that Brix.
    for (const brix of [8, 12, 16, 20]) {
      const modelled = refractometerFinalGravity(brix, brix);
      const trueGravity = refractometerToGravity(brix, 1);
      expect(Math.abs(modelled - trueGravity)).toBeLessThan(0.0025);
    }
  });

  it('implies sane attenuations across the range', () => {
    for (const [ob, fb] of [
      [12, 7],
      [14, 8],
      [16, 9],
      [20, 11],
    ] as const) {
      const og = refractometerToGravity(ob, 1);
      const fg = refractometerFinalGravity(ob, fb);
      const adf = apparentAttenuationPercent(og, fg);
      expect(adf).toBeGreaterThan(50);
      expect(adf).toBeLessThan(95);
    }
  });

  it('reports a lower FG for a lower final reading', () => {
    expect(refractometerFinalGravity(12, 6)).toBeLessThan(refractometerFinalGravity(12, 8));
  });

  it('applies the WCF to both readings in the raw variant', () => {
    expect(refractometerFinalGravityRaw(12.48, 6.76, 1.04)).toBeCloseTo(
      refractometerFinalGravity(12, 6.5),
      9,
    );
  });
});

describe('hydrometer temperature correction', () => {
  it('is a no-op at the calibration temperature', () => {
    expect(correctHydrometerReading(1.05, DEFAULT_HYDROMETER_CALIBRATION_TEMP_C)).toBeCloseTo(
      1.05,
      9,
    );
  });

  it('corrects a hot sample upward', () => {
    // 1.050 read at 30 °C on a 60 °F hydrometer is really 1.0534.
    expect(correctHydrometerReading(1.05, 30)).toBeCloseTo(1.053428, 5);
  });

  it('corrects a cold sample downward', () => {
    expect(correctHydrometerReading(1.05, 5)).toBeLessThan(1.05);
  });

  it('grows with the temperature gap', () => {
    const small = Math.abs(correctHydrometerReading(1.05, 20) - 1.05);
    const large = Math.abs(correctHydrometerReading(1.05, 40) - 1.05);
    expect(large).toBeGreaterThan(small);
  });

  it('honours a different calibration temperature', () => {
    expect(correctHydrometerReading(1.05, 20, 20)).toBeCloseTo(1.05, 9);
  });
});

describe('water density (Kell 1975)', () => {
  /**
   * Golden values from the equation's source range, kg/m³. Tolerance:
   * 0.001 kg/m³. This is an analytic fit, not a regression, so these only check
   * that the six coefficients were transcribed correctly.
   */
  it.each([
    [0, 999.8395],
    [20, 998.2041],
    [40, 992.2158],
    [60, 983.1989],
    [80, 971.7978],
    [100, 958.3637],
  ])('ρ(%f °C) = %f kg/m³', (tempC, expected) => {
    expect(waterDensityKgPerM3(tempC)).toBeCloseTo(expected, 3);
  });

  it('puts the density maximum at 3.98 °C, not at 0 °C', () => {
    // Water's density maximum. A sign error or a dropped term in the numerator
    // shows up here first.
    expect(waterDensityKgPerM3(3.98)).toBeGreaterThan(waterDensityKgPerM3(0));
    expect(waterDensityKgPerM3(3.98)).toBeGreaterThan(waterDensityKgPerM3(8));
    expect(waterDensityKgPerM3(3.98)).toBeCloseTo(999.972, 3);
  });

  it('falls monotonically once past the anomaly', () => {
    for (let t = 10; t < 100; t += 5) {
      expect(waterDensityKgPerM3(t + 5)).toBeLessThan(waterDensityKgPerM3(t));
    }
  });
});

describe('volume temperature correction', () => {
  it('is a no-op at the reference temperature', () => {
    expect(REFERENCE_VOLUME_TEMP_C).toBe(20);
    expect(correctVolumeToReference(26, 20)).toBe(26);
    expect(correctVolumeToReference(26, 65, 65)).toBeCloseTo(26, 12);
  });

  /**
   * Golden factors, `ρ(t) / ρ(20)`, worked from the densities pinned above:
   * ```
   * 100 °C   958.3637 / 998.2041 = 0.960088  →  3.991 % shrinkage
   *  98 °C   959.7923 / 998.2041 = 0.961519  →  3.848 %
   *  65 °C   980.5548 / 998.2041 = 0.982319  →  1.768 %
   *  40 °C   992.2158 / 998.2041 = 0.994001  →  0.600 %
   * ```
   * **Tolerance: 1e-6 of a litre per litre.**
   */
  it.each([
    [100, 0.960088],
    [98, 0.961519],
    [65, 0.982319],
    [40, 0.994001],
  ])('shrinks a liter read at %f °C to %f L', (measuredAtC, expected) => {
    expect(correctVolumeToReference(1, measuredAtC)).toBeCloseTo(expected, 6);
  });

  it('reconciles with the waterfall’s 4 % planning shrinkage', () => {
    // `applyBoilShrinkage` and `correctVolumeToReference` both document that
    // the flat 4 % planning shrinkage is water's contraction from boiling to
    // 20 °C. If this fails, one of those doc comments is wrong.
    const physical = 100 * (1 - correctVolumeToReference(1, 100));
    expect(physical).toBeCloseTo(3.9912, 4);
    expect(Math.abs(physical - 4)).toBeLessThan(0.01);
    expect(correctVolumeToReference(25, 100)).toBeCloseTo(applyBoilShrinkage(25), 2);
  });

  it('corrects a mash-temperature reading by ~1.8 %', () => {
    // A refractometer sample or a stuck-sparge check pulled at 65 °C.
    expect(correctVolumeToReference(30, 65)).toBeCloseTo(29.4696, 4);
  });

  it('is the brew-day example: 26 L off a 98 °C kettle is 25 L', () => {
    // 26 × 0.961519 = 24.9995, which rounds to 25 L at one decimal place.
    expect(correctVolumeToReference(26, 98)).toBeCloseTo(24.9995, 4);
    expect(correctVolumeToReference(26, 98).toFixed(1)).toBe('25.0');
  });

  it('runs the other way below the reference — cold water is the dense one', () => {
    expect(correctVolumeToReference(20, 4)).toBeGreaterThan(20);
    expect(correctVolumeToReference(20, 4)).toBeCloseTo(20.0354, 4);
  });

  it('scales linearly in the volume', () => {
    expect(correctVolumeToReference(50, 90)).toBeCloseTo(2 * correctVolumeToReference(25, 90), 12);
  });

  it('round trips through an explicit reference', () => {
    // Correcting 20 → 100 and back is the identity, so this works as the
    // inverse of `removeBoilShrinkage` as well as of `applyBoilShrinkage`.
    const hot = correctVolumeToReference(24, 20, 100);
    expect(correctVolumeToReference(hot, 100, 20)).toBeCloseTo(24, 12);
  });

  it('deepens monotonically with the temperature gap', () => {
    for (let t = 25; t < 100; t += 5) {
      expect(correctVolumeToReference(1, t + 5)).toBeLessThan(correctVolumeToReference(1, t));
    }
  });
});

describe('volume from a weighed vessel', () => {
  /**
   * The function depends on this reference: SG is a ratio against water at
   * 20 °C, so a density in kg/L is `sg × ρ_water`. Checking it against Kell's
   * equation at the same temperature confirms the conventional brewing figure
   * wasn't mistyped.
   */
  it('uses water at the gravity reference temperature', () => {
    expect(WATER_DENSITY_AT_REFERENCE_KG_PER_L).toBe(0.99823);
    const kell = waterDensityKgPerM3(REFERENCE_VOLUME_TEMP_C) / 1000;
    expect(WATER_DENSITY_AT_REFERENCE_KG_PER_L).toBeCloseTo(kell, 4);
    // 26 ppm apart, which is what the doc comment claims.
    expect(Math.abs(WATER_DENSITY_AT_REFERENCE_KG_PER_L / kell - 1)).toBeLessThan(3e-5);
  });

  /**
   * **The golden weigh-in.** A 19 L Cornelius keg of finished 1.010 beer:
   * ```
   * ρ   = 1.010 × 0.99823        = 1.008212 kg/L
   * net = 19 × 1.008212          = 19.156 kg
   * ```
   * So a 4.2 kg empty keg weighs 23.356 kg full. **Tolerance: 1 mL**, far
   * below what any scale a keg sits on can resolve.
   */
  it('reads 19 L of 1.010 beer out of a 19.16 kg net weight', () => {
    expect(beerVolumeFromWeight({ grossKg: 23.356, tareKg: 4.2, sg: 1.01 })).toBeCloseTo(19, 3);
  });

  it('round trips: litres → net kilograms → litres', () => {
    for (const [litres, sg] of [
      [19, 1.01],
      [23, 1.012],
      [9.5, 1.02],
      [50, 1.005],
    ] as const) {
      const netKg = litres * sg * WATER_DENSITY_AT_REFERENCE_KG_PER_L;
      expect(beerVolumeFromWeight({ grossKg: netKg + 4.2, tareKg: 4.2, sg })).toBeCloseTo(
        litres,
        9,
      );
    }
  });

  /** A denser beer weighs more per litre, so the same net mass is fewer litres. */
  it('reads fewer litres out of the same weight of a stronger beer', () => {
    const weak = beerVolumeFromWeight({ grossKg: 23.4, tareKg: 4.2, sg: 1.005 });
    const strong = beerVolumeFromWeight({ grossKg: 23.4, tareKg: 4.2, sg: 1.025 });
    expect(strong).toBeLessThan(weak);
    // The ratio equals the gravity ratio. Nothing else affects it.
    expect(weak / strong).toBeCloseTo(1.025 / 1.005, 9);
  });

  /**
   * A gross weight at or below the tare is a data-entry mistake (the two values
   * swapped, the wrong empty weight) or an empty keg, and none of those is a
   * volume. Callers can recognise zero. A negative value could end up in
   * `packagedVolumeL` and corrupt every yield figure downstream.
   */
  it.each([
    [4.2, 4.2],
    [4.0, 4.2],
    [0, 4.2],
  ])('returns zero for a gross of %f against a tare of %f', (grossKg, tareKg) => {
    expect(beerVolumeFromWeight({ grossKg, tareKg, sg: 1.01 })).toBe(0);
  });

  it('returns zero rather than infinity for a nonsense gravity', () => {
    expect(beerVolumeFromWeight({ grossKg: 23.4, tareKg: 4.2, sg: 0 })).toBe(0);
  });

  /**
   * The function ignores dissolved CO₂. This checks how much that matters:
   * 19 L at 2.4 volumes is 89 g of dissolved CO₂ against ~19.16 kg of beer,
   * under half a percent of the mass, ~90 mL of apparent volume.
   */
  it('is unaffected by dissolved CO₂ at the level worth ignoring', () => {
    const beer = beerVolumeFromWeight({ grossKg: 23.356, tareKg: 4.2, sg: 1.01 });
    const withCo2 = beerVolumeFromWeight({ grossKg: 23.356 + 0.089, tareKg: 4.2, sg: 1.01 });
    expect(withCo2 - beer).toBeCloseTo(0.088, 3);
    expect((withCo2 - beer) / beer).toBeLessThan(0.005);
  });
});

describe('dilution and boil-down', () => {
  it('dilutes by conserving extract', () => {
    // 25 L at 1.060 → 1.050 needs 25 × 60/50 = 30 L, i.e. 5 L of water.
    const result = dilutionToTargetGravity(25, 1.06, 1.05);
    expect(result.resultingVolumeL).toBeCloseTo(30, 9);
    expect(result.volumeChangeL).toBeCloseTo(5, 9);
    expect(result.resultingGravity).toBe(1.05);
  });

  it('refuses to dilute upward', () => {
    const result = dilutionToTargetGravity(25, 1.05, 1.06);
    expect(result.volumeChangeL).toBe(0);
    expect(result.resultingGravity).toBe(1.05);
  });

  it('boils down by conserving extract', () => {
    // 25 L at 1.048 → 1.060 leaves 25 × 48/60 = 20 L, i.e. 5 L boiled off.
    const result = boilDownToTargetGravity(25, 1.048, 1.06);
    expect(result.resultingVolumeL).toBeCloseTo(20, 9);
    expect(result.volumeChangeL).toBeCloseTo(-5, 9);
  });

  it('refuses to boil down to a lower gravity', () => {
    expect(boilDownToTargetGravity(25, 1.06, 1.05).volumeChangeL).toBe(0);
  });

  it('is the exact inverse of gravityAfterDilution', () => {
    const plan = dilutionToTargetGravity(23, 1.058, 1.048);
    expect(gravityAfterDilution(23, 1.058, plan.volumeChangeL)).toBeCloseTo(1.048, 9);
  });

  it('round trips dilute-then-boil-down', () => {
    const diluted = dilutionToTargetGravity(20, 1.06, 1.05);
    const restored = boilDownToTargetGravity(diluted.resultingVolumeL, 1.05, 1.06);
    expect(restored.resultingVolumeL).toBeCloseTo(20, 9);
  });
});

describe('sugarToTargetGravity', () => {
  it('computes the DME needed to rescue a low pre-boil gravity', () => {
    // 25 L short by 4 points, DME at 44 PPG = 367.198 points·L/kg
    // → 4 × 25 / 367.198 = 0.2723 kg
    expect(sugarToTargetGravity(25, 1.046, 1.05, 367.198)).toBeCloseTo(0.2723, 4);
  });

  it('is zero when already at or above target', () => {
    expect(sugarToTargetGravity(25, 1.052, 1.05, 367.198)).toBe(0);
    expect(sugarToTargetGravity(25, 1.05, 1.05, 367.198)).toBe(0);
  });

  it('guards against a zero-yield sugar', () => {
    expect(sugarToTargetGravity(25, 1.04, 1.05, 0)).toBe(0);
  });
});

describe('blend', () => {
  it('conserves extract and volume', () => {
    // 10 L at 1.060 + 10 L at 1.040 → 20 L at 1.050
    const result = blend([
      { volumeL: 10, gravity: 1.06 },
      { volumeL: 10, gravity: 1.04 },
    ]);
    expect(result.volumeL).toBeCloseTo(20, 9);
    expect(result.gravity).toBeCloseTo(1.05, 9);
  });

  it('weights by volume, not by count', () => {
    const result = blend([
      { volumeL: 15, gravity: 1.06 },
      { volumeL: 5, gravity: 1.02 },
    ]);
    // (15 × 60 + 5 × 20) / 20 = 50 points
    expect(result.gravity).toBeCloseTo(1.05, 9);
  });

  it('blends bitterness, colour and alcohol linearly', () => {
    const result = blend([
      { volumeL: 10, gravity: 1.05, ibu: 60, srm: 4, abv: 6 },
      { volumeL: 10, gravity: 1.05, ibu: 20, srm: 20, abv: 4 },
    ]);
    expect(result.ibu).toBeCloseTo(40, 9);
    expect(result.srm).toBeCloseTo(12, 9);
    expect(result.abv).toBeCloseTo(5, 9);
  });

  it('treats missing fields as zero', () => {
    const result = blend([
      { volumeL: 10, gravity: 1.05, ibu: 40 },
      { volumeL: 10, gravity: 1.05 },
    ]);
    expect(result.ibu).toBeCloseTo(20, 9);
  });

  it('handles a single component as identity', () => {
    const result = blend([{ volumeL: 19, gravity: 1.047, ibu: 33 }]);
    expect(result.volumeL).toBe(19);
    expect(result.gravity).toBeCloseTo(1.047, 9);
    expect(result.ibu).toBeCloseTo(33, 9);
  });

  it('returns water for an empty blend', () => {
    expect(blend([])).toEqual({ volumeL: 0, gravity: 1, ibu: 0, srm: 0, abv: 0 });
  });
});
