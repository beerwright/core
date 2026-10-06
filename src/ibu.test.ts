import { describe, expect, it } from 'vitest';
import {
  alphaAcidUnits,
  bitternessGravity,
  buGuRatio,
  calculateIbu,
  fixedTemperatureStandEffectiveBoilMinutes,
  garetzUtilization,
  isomerisationRateConstant,
  ragerGravityAdjustment,
  ragerUtilization,
  relativeIsomerisationRate,
  standEffectiveBoilMinutes,
  tinsethBignessFactor,
  tinsethBoilTimeFactor,
  tinsethUtilization,
} from './ibu';
import type { HopAddition } from './types';

/**
 * Tinseth's published hop-utilisation table.
 *
 * The table on realbeer.com is generated from the formula, so a correct
 * implementation should reproduce it to the three decimal places it's printed
 * to. Rows are boil gravity, columns are boil minutes.
 *
 * Tolerance is 0.0005 absolute, so the computed value rounds to the printed one.
 */
const TINSETH_TABLE: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  '1.030': { 5: 0.055, 10: 0.1, 15: 0.137, 30: 0.212, 45: 0.253, 60: 0.276, 90: 0.295 },
  '1.040': { 5: 0.05, 10: 0.091, 15: 0.125, 30: 0.194, 45: 0.232, 60: 0.252, 90: 0.27 },
  '1.050': { 5: 0.046, 10: 0.084, 15: 0.114, 30: 0.177, 45: 0.212, 60: 0.231, 90: 0.247 },
  '1.060': { 5: 0.042, 10: 0.076, 15: 0.105, 30: 0.162, 45: 0.194, 60: 0.211, 90: 0.226 },
  '1.070': { 5: 0.038, 10: 0.07, 15: 0.096, 30: 0.148, 45: 0.177, 60: 0.193, 90: 0.206 },
  '1.080': { 5: 0.035, 10: 0.064, 15: 0.087, 30: 0.135, 45: 0.162, 60: 0.176, 90: 0.188 },
  '1.090': { 5: 0.032, 10: 0.058, 15: 0.08, 30: 0.124, 45: 0.148, 60: 0.161, 90: 0.172 },
  '1.100': { 5: 0.029, 10: 0.053, 15: 0.073, 30: 0.113, 45: 0.135, 60: 0.147, 90: 0.157 },
  '1.110': { 5: 0.027, 10: 0.049, 15: 0.067, 30: 0.103, 45: 0.123, 60: 0.135, 90: 0.144 },
};

describe('Tinseth', () => {
  it('reproduces the published utilisation table', () => {
    for (const [gravityKey, row] of Object.entries(TINSETH_TABLE)) {
      const gravity = Number(gravityKey);
      for (const [minutesKey, expected] of Object.entries(row)) {
        const actual = tinsethUtilization(gravity, Number(minutesKey));
        expect(
          Math.abs(actual - expected),
          `SG ${gravityKey} @ ${minutesKey} min: got ${actual.toFixed(4)}, table says ${expected}`,
        ).toBeLessThan(0.0005);
      }
    }
  });

  it('computes the bigness factor as 1.65 × 0.000125^(Gb−1)', () => {
    expect(tinsethBignessFactor(1.0)).toBeCloseTo(1.65, 9);
    // 1.65 × 0.000125^0.05 = 1.65 × 0.638036 = 1.052760
    expect(tinsethBignessFactor(1.05)).toBeCloseTo(1.05276, 5);
  });

  it('computes the boil-time factor as (1 − e^(−0.04t)) / 4.15', () => {
    expect(tinsethBoilTimeFactor(0)).toBe(0);
    expect(tinsethBoilTimeFactor(60)).toBeCloseTo(0.219104, 6);
  });

  it('asymptotes at 1/4.15 in time', () => {
    expect(tinsethBoilTimeFactor(100000)).toBeCloseTo(1 / 4.15, 9);
    // A very long boil gets close to it.
    expect(tinsethBoilTimeFactor(240)).toBeGreaterThan(0.99 * (1 / 4.15));
  });

  it('penalises higher boil gravity', () => {
    expect(tinsethUtilization(1.08, 60)).toBeLessThan(tinsethUtilization(1.04, 60));
  });
});

describe('Rager', () => {
  it('follows the published tanh curve', () => {
    // 60 min: (18.11 + 13.86 × tanh(28.68/18.27)) / 100 = (18.11 + 12.710) / 100
    expect(ragerUtilization(60)).toBeCloseTo(0.308195, 5);
    // 30 min: (18.11 + 13.86 × tanh(−1.32/18.27)) / 100 = (18.11 − 1.000) / 100
    expect(ragerUtilization(30)).toBeCloseTo(0.171104, 5);
  });

  it('applies no gravity adjustment at or below 1.050', () => {
    expect(ragerGravityAdjustment(1.05)).toBe(0);
    expect(ragerGravityAdjustment(1.04)).toBe(0);
  });

  it('applies (Gb − 1.050)/0.2 above 1.050', () => {
    expect(ragerGravityAdjustment(1.07)).toBeCloseTo(0.1, 9);
  });

  it('runs hotter than Tinseth, as Rager himself noted', () => {
    expect(ragerUtilization(60)).toBeGreaterThan(tinsethUtilization(1.05, 60));
  });
});

describe('Garetz', () => {
  it('follows the published tanh curve', () => {
    // (7.2994 + 15.0746 × tanh(38.14/24.71)) / 100 = (7.2994 + 13.759) / 100
    expect(garetzUtilization(60)).toBeCloseTo(0.210581, 5);
  });

  it('rises monotonically with time', () => {
    // Non-decreasing, not strictly rising. The published fit is negative
    // below about 8.8 minutes and the floor holds those at zero, so the first
    // two samples are both zero.
    let previous = Number.NEGATIVE_INFINITY;
    for (let t = 0; t <= 90; t += 5) {
      const value = garetzUtilization(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('never takes bitterness away', () => {
    // The tanh fit crosses zero at 8.80 minutes and keeps falling. At a
    // whirlpool addition's couple of effective minutes it gives −2.9 %, which
    // would be a hop that makes the beer less bitter. None of the utilisations
    // in Garetz's published table are negative. The curve is a fit to that
    // table, and here it's being read outside the range it was fitted over.
    expect(garetzUtilization(8.9)).toBeGreaterThan(0);
    for (const minutes of [0, 1.6, 5, 8, 8.8]) {
      expect(garetzUtilization(minutes), `${minutes} min`).toBe(0);
    }
  });
});

describe('temperature-corrected isomerisation', () => {
  it('matches Malowicki at boiling: k₁(100 °C) = 0.01245 min⁻¹', () => {
    // Malowicki reports 0.01245 min⁻¹. The published Arrhenius parameters
    // evaluate to 0.012490, which agrees to the precision the paper quotes.
    expect(isomerisationRateConstant(100)).toBeCloseTo(0.01245, 4);
  });

  it('is 1.0 relative at boiling and falls off steeply below it', () => {
    expect(relativeIsomerisationRate(100)).toBe(1);
    expect(relativeIsomerisationRate(80)).toBeCloseTo(0.1653, 4);
    expect(relativeIsomerisationRate(60)).toBeCloseTo(0.022, 3);
  });

  it('makes a fixed 80 °C stand worth 16.5 %% of its wall-clock time', () => {
    expect(fixedTemperatureStandEffectiveBoilMinutes(30, 80)).toBeCloseTo(30 * 0.165349, 4);
  });

  it('returns zero for a zero-length stand', () => {
    expect(fixedTemperatureStandEffectiveBoilMinutes(0, 90)).toBe(0);
    expect(
      standEffectiveBoilMinutes({
        standMinutes: 0,
        startTempC: 90,
        ambientTempC: 20,
        coolingRateConstantPerMin: 0.015,
        integrationStepMinutes: 0.05,
      }),
    ).toBe(0);
  });

  it('makes the cooling model strictly less effective than a held stand', () => {
    const held = fixedTemperatureStandEffectiveBoilMinutes(20, 80);
    const cooling = standEffectiveBoilMinutes({
      standMinutes: 20,
      startTempC: 80,
      ambientTempC: 20,
      coolingRateConstantPerMin: 0.015,
      integrationStepMinutes: 0.05,
    });
    expect(cooling).toBeLessThan(held);
    // Hand-computed by trapezium integration: 1.6396 effective boil-minutes.
    expect(cooling).toBeCloseTo(1.6396, 3);
  });

  it('converges to the held stand as the cooling rate goes to zero', () => {
    const cooling = standEffectiveBoilMinutes({
      standMinutes: 20,
      startTempC: 80,
      ambientTempC: 20,
      coolingRateConstantPerMin: 1e-9,
      integrationStepMinutes: 0.05,
    });
    expect(cooling).toBeCloseTo(fixedTemperatureStandEffectiveBoilMinutes(20, 80), 4);
  });

  it('is insensitive to the integration step', () => {
    const coarse = standEffectiveBoilMinutes({
      standMinutes: 30,
      startTempC: 95,
      ambientTempC: 20,
      coolingRateConstantPerMin: 0.02,
      integrationStepMinutes: 0.5,
    });
    const fine = standEffectiveBoilMinutes({
      standMinutes: 30,
      startTempC: 95,
      ambientTempC: 20,
      coolingRateConstantPerMin: 0.02,
      integrationStepMinutes: 0.01,
    });
    expect(coarse).toBeCloseTo(fine, 2);
  });
});

describe('a stand that names the temperature it ended at', () => {
  const stand = (startTempC: number, endTempC: number | undefined, standMinutes = 20) =>
    standEffectiveBoilMinutes({
      standMinutes,
      startTempC,
      ambientTempC: 20,
      coolingRateConstantPerMin: 0.015,
      integrationStepMinutes: 0.05,
      ...(endTempC === undefined ? {} : { endTempC }),
    });

  it('is exactly the held model when the stand ends where it started', () => {
    expect(stand(75, 75)).toBeCloseTo(fixedTemperatureStandEffectiveBoilMinutes(20, 75), 9);
  });

  it('is worth less than the default curve and more than a stand held at the end', () => {
    // 80 °C to 50 °C in 20 minutes cools faster than the default k, and the
    // wort stays above 50 °C the whole time.
    expect(stand(80, 50)).toBeLessThan(stand(80, undefined));
    expect(stand(80, 50)).toBeGreaterThan(fixedTemperatureStandEffectiveBoilMinutes(20, 50));
  });

  it('solves the cooling constant from the two temperatures', () => {
    // k = ln((80 − 20) / (50 − 20)) / 20 = 0.034657/min.
    expect(stand(80, 50)).toBeCloseTo(
      standEffectiveBoilMinutes({
        standMinutes: 20,
        startTempC: 80,
        ambientTempC: 20,
        coolingRateConstantPerMin: Math.log(60 / 30) / 20,
        integrationStepMinutes: 0.05,
      }),
      9,
    );
  });

  it('holds at the start when the stand ends hotter than it began', () => {
    expect(stand(85, 95)).toBeCloseTo(fixedTemperatureStandEffectiveBoilMinutes(20, 85), 9);
  });

  it('holds at the start when the stand ends at or below ambient', () => {
    expect(stand(85, 20)).toBeCloseTo(fixedTemperatureStandEffectiveBoilMinutes(20, 85), 9);
    expect(stand(85, 5)).toBeCloseTo(fixedTemperatureStandEffectiveBoilMinutes(20, 85), 9);
  });

  it('leaves the default curve untouched when no end is given', () => {
    expect(stand(80, undefined)).toBe(
      standEffectiveBoilMinutes({
        standMinutes: 20,
        startTempC: 80,
        ambientTempC: 20,
        coolingRateConstantPerMin: 0.015,
        integrationStepMinutes: 0.05,
      }),
    );
  });
});

// ---------------------------------------------------------------------------

const boilHop = (overrides: Partial<HopAddition> = {}): HopAddition => ({
  name: 'Test',
  amountKg: 0.028,
  alphaAcidPercent: 10,
  form: 'whole',
  use: 'boil',
  timeMinutes: 60,
  ...overrides,
});

const baseInput = {
  volumeL: 20,
  boilGravity: 1.05,
  boilTimeMinutes: 60,
};

describe('calculateIbu', () => {
  it('computes a single whole-hop boil addition longhand', () => {
    // mg/L = 0.10 × 0.028 kg × 1e6 / 20 L = 140
    // U    = 0.230655 (Tinseth 1.050/60)
    // IBU  = 140 × 0.230655 = 32.29
    const result = calculateIbu({ ...baseInput, hops: [boilHop()] });
    expect(result.contributions[0]?.alphaAcidMgPerL).toBeCloseTo(140, 6);
    expect(result.ibu).toBeCloseTo(32.29, 2);
  });

  it('applies the pellet multiplier', () => {
    const whole = calculateIbu({ ...baseInput, hops: [boilHop()] }).ibu;
    const pellet = calculateIbu({ ...baseInput, hops: [boilHop({ form: 'pellet' })] }).ibu;
    expect(pellet / whole).toBeCloseTo(1.1, 9);
  });

  it('lets the form multipliers be overridden', () => {
    const result = calculateIbu({
      ...baseInput,
      hops: [boilHop({ form: 'cryo' })],
      options: { hopFormMultipliers: { cryo: 1.25 } },
    });
    expect(result.contributions[0]?.formMultiplier).toBe(1.25);
  });

  describe('pre-isomerised extract', () => {
    /**
     * 28 g of a 30 % iso-alpha product in 20 L is
     * 0.30 × 0.028 × 1e6 / 20 = 420 mg/L of iso-alpha. IBU is defined as mg/L
     * of iso-alpha, so at 0.95 recovery the answer is 399.
     *
     * If it went through Tinseth as an ordinary hop it would come out near 97,
     * about a quarter of the correct figure, with no warning.
     */
    const isoHop = (over: Partial<HopAddition> = {}): HopAddition => ({
      name: 'IsoHop',
      amountKg: 0.028,
      alphaAcidPercent: 30,
      isoAlphaPercent: 30,
      form: 'iso-extract',
      use: 'boil',
      timeMinutes: 60,
      ...over,
    });

    it('is dosed on iso-alpha at the recovery rate, not on a utilisation curve', () => {
      const result = calculateIbu({ ...baseInput, hops: [isoHop()] });
      expect(result.ibu).toBeCloseTo(399, 6);
      expect(result.contributions[0]?.utilizationFraction).toBeCloseTo(0.95, 9);
    });

    it('ignores boil time entirely', () => {
      const long = calculateIbu({ ...baseInput, hops: [isoHop({ timeMinutes: 90 })] }).ibu;
      const short = calculateIbu({ ...baseInput, hops: [isoHop({ timeMinutes: 1 })] }).ibu;
      expect(long).toBeCloseTo(short, 9);
    });

    /**
     * This checks the branch order. A post-fermentation dose is recorded as a
     * dry hop, and the dry-hop rule always returns 0, so extract has to be
     * handled before it gets there.
     */
    it('still bitters when it is added after fermentation', () => {
      const result = calculateIbu({
        ...baseInput,
        hops: [isoHop({ use: 'dry-hop', timeMinutes: 0, dryHopDays: 0 })],
      });
      expect(result.ibu).toBeCloseTo(399, 6);
    });

    it('honours a caller who doses post-fermentation at full recovery', () => {
      const result = calculateIbu({
        ...baseInput,
        hops: [isoHop()],
        options: { isoExtractRecovery: 1 },
      });
      expect(result.ibu).toBeCloseTo(420, 6);
    });

    it('falls back to the alpha figure and says that it did', () => {
      // We omit the field instead of setting it to `undefined`.
      // `exactOptionalPropertyTypes` treats those differently, and a caller
      // that doesn't know about iso-alpha would omit it.
      const { isoAlphaPercent: _omitted, ...withoutIso } = isoHop();
      const result = calculateIbu({ ...baseInput, hops: [withoutIso] });
      expect(result.ibu).toBeCloseTo(399, 6);
      expect(result.contributions[0]?.notes.join(' ')).toMatch(/No iso-alpha figure given/);
    });
  });

  describe('CO2 extract', () => {
    it('isomerises on the ordinary curve, without the pellet surface-area bonus', () => {
      const whole = calculateIbu({ ...baseInput, hops: [boilHop()] }).ibu;
      const extract = calculateIbu({
        ...baseInput,
        hops: [boilHop({ form: 'co2-extract' })],
      }).ibu;
      expect(extract).toBeCloseTo(whole, 9);
    });
  });

  it('gives dry hops exactly zero', () => {
    const result = calculateIbu({
      ...baseInput,
      hops: [boilHop({ use: 'dry-hop', timeMinutes: 0, dryHopDays: 5 })],
    });
    expect(result.ibu).toBe(0);
    expect(result.contributions[0]?.utilizationFraction).toBe(0);
    expect(result.contributions[0]?.notes.join(' ')).toMatch(/0 IBU by definition/);
  });

  it('gives keg hops exactly zero, whatever minutes the row still carries', () => {
    const result = calculateIbu({ ...baseInput, hops: [boilHop({ use: 'keg' })] });
    expect(result.ibu).toBe(0);
    expect(result.contributions[0]?.ibu).toBe(0);
    expect(result.contributions[0]?.utilizationFraction).toBe(0);
    expect(result.contributions[0]?.notes.join(' ')).toMatch(/0 IBU by definition/);
  });

  it('keeps keg hops out of the kettle alpha total', () => {
    expect(alphaAcidUnits([boilHop({ use: 'keg' })], 20)).toBe(0);
  });

  it('gives a zero-minute boil addition zero bitterness', () => {
    const result = calculateIbu({ ...baseInput, hops: [boilHop({ timeMinutes: 0 })] });
    expect(result.ibu).toBe(0);
  });

  it('treats first-wort hops as a full boil plus a 10 %% bonus', () => {
    const fwh = calculateIbu({
      ...baseInput,
      hops: [boilHop({ use: 'first-wort', timeMinutes: 0 })],
    });
    const full = calculateIbu({ ...baseInput, hops: [boilHop({ timeMinutes: 60 })] });
    expect(fwh.ibu / full.ibu).toBeCloseTo(1.1, 9);
    expect(fwh.contributions[0]?.effectiveBoilMinutes).toBe(60);
  });

  it('honours a first-wort multiplier override', () => {
    const result = calculateIbu({
      ...baseInput,
      hops: [boilHop({ use: 'first-wort' })],
      options: { firstWortMultiplier: 1 },
    });
    const full = calculateIbu({ ...baseInput, hops: [boilHop()] });
    expect(result.ibu).toBeCloseTo(full.ibu, 9);
  });

  it('handles an empty hop schedule', () => {
    const result = calculateIbu({ ...baseInput, hops: [] });
    expect(result.ibu).toBe(0);
    expect(result.contributions).toHaveLength(0);
  });

  it('reports per-addition contributions that sum to the total', () => {
    const result = calculateIbu({
      ...baseInput,
      hops: [boilHop(), boilHop({ timeMinutes: 15 }), boilHop({ use: 'dry-hop' })],
    });
    const sum = result.contributions.reduce((total, c) => total + c.ibu, 0);
    expect(sum).toBeCloseTo(result.ibu, 9);
    expect(result.contributions).toHaveLength(3);
  });

  it('is linear in hop mass', () => {
    const single = calculateIbu({ ...baseInput, hops: [boilHop({ amountKg: 0.028 })] }).ibu;
    const double = calculateIbu({ ...baseInput, hops: [boilHop({ amountKg: 0.056 })] }).ibu;
    expect(double).toBeCloseTo(single * 2, 9);
  });

  it('is inversely proportional to volume', () => {
    const small = calculateIbu({ ...baseInput, volumeL: 20, hops: [boilHop()] }).ibu;
    const big = calculateIbu({ ...baseInput, volumeL: 40, hops: [boilHop()] }).ibu;
    expect(big).toBeCloseTo(small / 2, 9);
  });
});

describe('whirlpool models', () => {
  const whirlpool = boilHop({ use: 'whirlpool', timeMinutes: 20, whirlpoolTempC: 80 });

  it('mIBU gives less than a held stand, which gives less than an equal boil', () => {
    const none = calculateIbu({
      ...baseInput,
      hops: [whirlpool],
      options: { whirlpool: { model: 'none' } },
    }).ibu;
    const mibu = calculateIbu({
      ...baseInput,
      hops: [whirlpool],
      options: { whirlpool: { model: 'mibu' } },
    }).ibu;
    const fixed = calculateIbu({
      ...baseInput,
      hops: [whirlpool],
      options: { whirlpool: { model: 'fixed-temperature' } },
    }).ibu;
    const boiled = calculateIbu({ ...baseInput, hops: [boilHop({ timeMinutes: 20 })] }).ibu;

    expect(none).toBe(0);
    expect(mibu).toBeGreaterThan(0);
    expect(mibu).toBeLessThan(fixed);
    expect(fixed).toBeLessThan(boiled);
  });

  it('gets more bitterness from a hotter stand', () => {
    const hot = calculateIbu({
      ...baseInput,
      hops: [boilHop({ use: 'whirlpool', timeMinutes: 20, whirlpoolTempC: 95 })],
    }).ibu;
    const cool = calculateIbu({
      ...baseInput,
      hops: [boilHop({ use: 'whirlpool', timeMinutes: 20, whirlpoolTempC: 70 })],
    }).ibu;
    expect(hot).toBeGreaterThan(cool);
  });

  it('gets more bitterness from a longer stand', () => {
    const long = calculateIbu({
      ...baseInput,
      hops: [boilHop({ use: 'whirlpool', timeMinutes: 45, whirlpoolTempC: 80 })],
    }).ibu;
    const short = calculateIbu({ ...baseInput, hops: [whirlpool] }).ibu;
    expect(long).toBeGreaterThan(short);
  });

  it('defaults an unspecified stand temperature to 80 °C', () => {
    const implicit = calculateIbu({
      ...baseInput,
      hops: [boilHop({ use: 'whirlpool', timeMinutes: 20 })],
    }).ibu;
    const explicit = calculateIbu({ ...baseInput, hops: [whirlpool] }).ibu;
    expect(implicit).toBeCloseTo(explicit, 9);
  });

  it('optionally credits boil hops with post-flameout isomerization', () => {
    const hops = [boilHop({ timeMinutes: 60 }), whirlpool];
    const without = calculateIbu({ ...baseInput, hops });
    const with_ = calculateIbu({
      ...baseInput,
      hops,
      options: { whirlpool: { includePostBoilIsomerisationForBoilHops: true } },
    });
    expect(with_.contributions[0]?.ibu).toBeGreaterThan(without.contributions[0]?.ibu ?? 0);
    // The whirlpool addition itself is unaffected.
    expect(with_.contributions[1]?.ibu).toBeCloseTo(without.contributions[1]?.ibu ?? 0, 9);
  });
});

describe('the stand a whirlpool row describes', () => {
  const standHop = (overrides: Partial<HopAddition>): HopAddition =>
    boilHop({ name: 'Citra', use: 'whirlpool', timeMinutes: 20, ...overrides });
  const describeOne = (hop: HopAddition) =>
    calculateIbu({ ...baseInput, hops: [hop] }).contributions[0]?.standDescription;

  it('says what the default curve did', () => {
    expect(describeOne(standHop({ whirlpoolTempC: 80 }))).toBe(
      'Citra, 20 min from 80 °C cooling: worth 1.6 boil minutes, 2.3 IBU.',
    );
  });

  it('says a stand that ends where it started was held', () => {
    expect(describeOne(standHop({ whirlpoolTempC: 75, whirlpoolEndTempC: 75 }))).toBe(
      'Citra, 20 min held at 75 °C: worth 2.0 boil minutes, 2.8 IBU.',
    );
  });

  it('names both temperatures when the stand cooled', () => {
    expect(describeOne(standHop({ whirlpoolTempC: 85, whirlpoolEndTempC: 70 }))).toBe(
      'Citra, 20 min from 85 °C to 70 °C: worth 2.7 boil minutes, 3.7 IBU.',
    );
  });

  it('reports an impossible end as a stand held at the start', () => {
    expect(describeOne(standHop({ whirlpoolTempC: 85, whirlpoolEndTempC: 95 }))).toBe(
      'Citra, 20 min held at 85 °C: worth 5.3 boil minutes, 6.8 IBU.',
    );
  });

  it('repeats the description as the contribution note', () => {
    const contribution = calculateIbu({
      ...baseInput,
      hops: [standHop({ whirlpoolTempC: 80 })],
    }).contributions[0];
    expect(contribution?.notes).toEqual([contribution?.standDescription]);
  });

  it('describes nothing for a row that is not a stand', () => {
    expect(describeOne(boilHop())).toBeNull();
    expect(describeOne(boilHop({ use: 'dry-hop' }))).toBeNull();
    expect(describeOne(boilHop({ use: 'first-wort' }))).toBeNull();
  });
});

describe('the numbers an existing recipe already has', () => {
  // The end temperature is optional, and a recipe without one must keep its numbers.
  it('leaves a whirlpool with no end temperature exactly where it was', () => {
    expect(
      calculateIbu({
        ...baseInput,
        hops: [boilHop({ use: 'whirlpool', timeMinutes: 20, whirlpoolTempC: 80 })],
      }).ibu,
    ).toBeCloseTo(2.2544696518, 9);
    expect(
      calculateIbu({
        ...baseInput,
        hops: [boilHop({ use: 'whirlpool', timeMinutes: 30, whirlpoolTempC: 95 })],
      }).ibu,
    ).toBeCloseTo(8.2601018582, 9);
  });

  it('leaves a plain boil addition exactly where it was', () => {
    expect(calculateIbu({ ...baseInput, hops: [boilHop()] }).ibu).toBeCloseTo(32.2929708152, 9);
  });
});

describe('formula selection', () => {
  const hops = [boilHop({ form: 'pellet' })];

  it('produces a different number for each model', () => {
    const tinseth = calculateIbu({ ...baseInput, hops, options: { ibuFormula: 'tinseth' } }).ibu;
    const rager = calculateIbu({ ...baseInput, hops, options: { ibuFormula: 'rager' } }).ibu;
    const garetz = calculateIbu({ ...baseInput, hops, options: { ibuFormula: 'garetz' } }).ibu;
    expect(rager).toBeGreaterThan(tinseth);
    expect(garetz).toBeLessThan(rager);
    expect(new Set([tinseth, rager, garetz]).size).toBe(3);
  });

  it('reports which model ran', () => {
    expect(calculateIbu({ ...baseInput, hops, options: { ibuFormula: 'garetz' } }).formula).toBe(
      'garetz',
    );
  });

  it('converges the self-referential Garetz model', () => {
    const result = calculateIbu({
      ...baseInput,
      hops: [boilHop({ amountKg: 0.1 }), boilHop({ amountKg: 0.1, timeMinutes: 30 })],
      options: { ibuFormula: 'garetz' },
    });
    const sum = result.contributions.reduce((total, c) => total + c.ibu, 0);
    expect(sum).toBeCloseTo(result.ibu, 6);
    expect(Number.isFinite(result.ibu)).toBe(true);
    expect(result.ibu).toBeGreaterThan(0);
  });

  it('lets elevation reduce Garetz utilisation', () => {
    const seaLevel = calculateIbu({ ...baseInput, hops, options: { ibuFormula: 'garetz' } }).ibu;
    const denver = calculateIbu({
      ...baseInput,
      hops,
      options: { ibuFormula: 'garetz', elevationM: 1600 },
    }).ibu;
    expect(denver).toBeLessThan(seaLevel);
  });
});

describe('bitternessGravity', () => {
  it('selects the requested basis', () => {
    expect(bitternessGravity('pre-boil', 1.04, 1.05)).toBe(1.04);
    expect(bitternessGravity('post-boil', 1.04, 1.05)).toBe(1.05);
    expect(bitternessGravity('average-boil', 1.04, 1.05)).toBeCloseTo(1.045, 9);
  });
});

describe('buGuRatio', () => {
  it('divides IBU by gravity units', () => {
    expect(buGuRatio(40, 1.05)).toBeCloseTo(0.8, 9);
  });

  it('is zero for water', () => {
    expect(buGuRatio(40, 1.0)).toBe(0);
  });
});
