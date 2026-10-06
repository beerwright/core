import { describe, expect, it } from 'vitest';
import {
  barToPsi,
  carbonationFromPrimingSugar,
  co2VolumesFromKilopascals,
  co2VolumesFromPressure,
  co2VolumesToGramsPerLitre,
  fermentationTempForResidualCo2,
  GRAMS_CO2_PER_VOLUME_PER_LITRE,
  gramsPerLitreToCo2Volumes,
  kilopascalsToPsi,
  PRIMING_SUGAR_CO2_YIELD,
  pressureFromCo2Volumes,
  primingSugar,
  psiToBar,
  psiToKilopascals,
  residualCo2Volumes,
  scheduleResidualCo2,
} from './carbonation';
import type { FermentationStep } from './types';
import { fahrenheitToCelsius } from './units/temperature';

describe('forced carbonation', () => {
  /**
   * Golden values from the standard carbonation table, computed longhand:
   * ```
   * 38 °F, 12 psi:
   *   henry = 0.01821 + 0.09011 × e^(−6/43.11) = 0.01821 + 0.078404 = 0.096614
   *   V     = (12 + 14.695) × 0.096614 − 0.003342 = 2.5796 − 0.0033 = 2.576
   * ```
   * **Tolerance: 0.01 volumes** (the printed tables are given to 0.1).
   */
  it.each([
    [fahrenheitToCelsius(38), 12, 2.576],
    [4, 10, 2.329],
    [0, 8, 2.455],
  ])('%f °C at %f psi → %f volumes', (tempC, psi, volumes) => {
    expect(co2VolumesFromPressure(tempC, psi)).toBeCloseTo(volumes, 2);
  });

  it('inverts exactly', () => {
    for (const tempC of [0, 2, 4, 10, 20]) {
      for (const volumes of [1.5, 2.0, 2.4, 3.0, 3.5]) {
        const psi = pressureFromCo2Volumes(tempC, volumes);
        expect(co2VolumesFromPressure(tempC, psi)).toBeCloseTo(volumes, 9);
      }
    }
  });

  it('needs more pressure at a warmer temperature', () => {
    expect(pressureFromCo2Volumes(12, 2.4)).toBeGreaterThan(pressureFromCo2Volumes(2, 2.4));
  });

  it('needs more pressure for more carbonation', () => {
    expect(pressureFromCo2Volumes(4, 3.0)).toBeGreaterThan(pressureFromCo2Volumes(4, 2.0));
  });

  it('lands near the familiar 2.4 volumes at 4 °C and ~11 psi', () => {
    expect(pressureFromCo2Volumes(4, 2.4)).toBeCloseTo(10.5, 0);
  });

  /**
   * The common keg-calculator reference value: a fridge at 3 °C holding an ale
   * at 2.5 volumes needs **10–12 psi**, and the published tables all fall in
   * that range. Longhand:
   * ```
   * 3 °C = 37.4 °F
   * henry = 0.01821 + 0.09011 × e^(−5.4 / 43.11) = 0.097719
   * P     = (2.5 + 0.003342) / 0.097719 − 14.695 = 10.92 psi
   * ```
   * **Tolerance: the published 10–12 psi band.** We check a range instead of
   * a point because that's the resolution the reference tables are printed at.
   */
  it('puts a 3 °C keg at 2.5 volumes inside the published 10–12 psi band', () => {
    const psi = pressureFromCo2Volumes(3, 2.5);
    expect(psi).toBeGreaterThan(10);
    expect(psi).toBeLessThan(12);
    expect(psi).toBeCloseTo(10.92, 2);
    // 0.75 bar on a European regulator, which is marked in tenths.
    expect(psiToBar(psi)).toBeCloseTo(0.753, 3);
  });

  it('converts pressure units', () => {
    expect(psiToBar(14.5037738)).toBeCloseTo(1, 6);
    expect(barToPsi(psiToBar(12.5))).toBeCloseTo(12.5, 9);
    // 1 bar = 100 kPa, so the two conversions must differ by that factor.
    expect(psiToKilopascals(12.5)).toBeCloseTo(psiToBar(12.5) * 100, 4);
    expect(kilopascalsToPsi(psiToKilopascals(12.5))).toBeCloseTo(12.5, 9);
    expect(psiToKilopascals(1)).toBeCloseTo(6.894757, 5);
  });
});

describe('residual CO₂', () => {
  /**
   * `V = 3.0378 − 0.050062 T + 0.00026555 T²` with T in °F.
   * At 20 °C = 68 °F: 3.0378 − 3.404216 + 1.227903 = 0.8615 volumes.
   */
  it.each([
    [20, 0.8615],
    [18, 0.9151],
    [10, 1.1986],
  ])('%f °C leaves %f volumes in solution', (tempC, volumes) => {
    expect(residualCo2Volumes(tempC)).toBeCloseTo(volumes, 3);
  });

  it('holds less CO₂ the warmer the beer got', () => {
    expect(residualCo2Volumes(24)).toBeLessThan(residualCo2Volumes(16));
  });

  it('inverts back to the temperature', () => {
    for (const tempC of [10, 15, 18, 20, 24]) {
      expect(fermentationTempForResidualCo2(residualCo2Volumes(tempC))).toBeCloseTo(tempC, 6);
    }
  });
});

describe('dissolved CO₂ in kilopascals', () => {
  /**
   * The same published table the psi fit is tested against, in kPa, the unit
   * European spunding valves are marked in. 100 kPa is 14.504 psi, and a bar
   * is exactly 100 kPa, so these are the psi golden values converted.
   *
   * **Tolerance: 0.01 volumes**, as above.
   */
  it.each([
    // 15 °C at 1 bar, a typical spunded lager primary.
    [15, 100, 1.9349],
    // 2 °C at ~0.69 bar, the same beer's crash after the valve is turned down.
    [2, 68.948, 2.4934],
    // 4 °C at 10 psi, the serving-fridge figure from the `forced carbonation` tests.
    [4, 68.948, 2.329],
  ])('%f °C at %f kPa → %f volumes', (tempC, kilopascals, volumes) => {
    expect(co2VolumesFromKilopascals(tempC, kilopascals)).toBeCloseTo(volumes, 2);
  });

  it('is the psi fit in another unit, not a second model', () => {
    for (const tempC of [0, 4, 15, 20]) {
      for (const psi of [0, 8, 15, 30]) {
        expect(co2VolumesFromKilopascals(tempC, psiToKilopascals(psi))).toBeCloseTo(
          co2VolumesFromPressure(tempC, psi),
          9,
        );
      }
    }
  });
});

describe('what a schedule leaves in the beer', () => {
  const hold = (
    tempC: number,
    days: number,
    pressurePsi?: number,
  ): FermentationStep & { readonly pressurePsi?: number } => ({
    name: 'Step',
    type: 'primary',
    tempC,
    days,
    ...(pressurePsi === undefined ? {} : { pressurePsi }),
  });

  it('says nothing about a schedule with no steps', () => {
    expect(scheduleResidualCo2([])).toBeNull();
  });

  it('reads an open ferment off its peak, not its last step', () => {
    // A diacetyl rest at 18 °C then a crash to 2 °C. The CO₂ the warm rest drove
    // off doesn't come back, so the crash temperature mustn't be used.
    const residual = scheduleResidualCo2([hold(10, 10), hold(18, 3), hold(2, 28)]);
    expect(residual?.pressurePsi).toBeNull();
    expect(residual?.tempC).toBe(18);
    expect(residual?.volumes).toBeCloseTo(residualCo2Volumes(18), 9);
  });

  it('counts the warm end of a ramp', () => {
    const residual = scheduleResidualCo2([{ ...hold(18, 14), endTempC: 22 }]);
    expect(residual?.tempC).toBe(22);
  });

  it('reads a spunded last step off Henry’s law instead', () => {
    const residual = scheduleResidualCo2([hold(15, 7, 15), hold(2, 3, 10)]);
    expect(residual?.pressurePsi).toBe(10);
    expect(residual?.tempC).toBe(2);
    expect(residual?.volumes).toBeCloseTo(co2VolumesFromPressure(2, 10), 9);
    // Much higher than the peak-temperature figure would be.
    expect(residual?.volumes ?? 0).toBeGreaterThan(residualCo2Volumes(15) * 2);
  });

  it('goes back to the peak when the pressure came off before packaging', () => {
    // Spunded, then vented and transferred. The brewer records that by leaving
    // the pressure off the last step, which is the step the rule checks.
    const residual = scheduleResidualCo2([hold(15, 7, 15), hold(15, 3)]);
    expect(residual?.pressurePsi).toBeNull();
    expect(residual?.volumes).toBeCloseTo(residualCo2Volumes(15), 9);
  });

  it('treats a stated zero as no pressure at all', () => {
    // The two published fits disagree by ~0.02 volumes at zero gauge, so if
    // `pressurePsi: 0` used Henry's law it would change the priming dose for a
    // beer that was never spunded.
    const zero = scheduleResidualCo2([hold(20, 14, 0)]);
    const absent = scheduleResidualCo2([hold(20, 14)]);
    expect(zero).toStrictEqual(absent);
  });

  it('feeds the priming dose without the dose recomputing it', () => {
    const steps = [hold(15, 7, 15), hold(2, 3, 10)];
    const residual = scheduleResidualCo2(steps);
    const dose = primingSugar({
      beerVolumeL: 19,
      targetVolumes: 2.4,
      fermentationTempC: 15,
      ...(residual === null ? {} : { residualVolumes: residual.volumes }),
    });
    // Already past the target, so no sugar is needed.
    expect(dose.residualVolumes).toBeCloseTo(residual?.volumes ?? 0, 9);
    expect(dose.volumesToAdd).toBe(0);
    expect(dose.sugarGrams).toBe(0);
  });

  it('does not change the dose for a beer that was never spunded', () => {
    // The most important regression check: a schedule without pressure must
    // give the same dose as passing no schedule at all.
    const steps = [hold(20, 14)];
    const residual = scheduleResidualCo2(steps);
    const withHandoff = primingSugar({
      beerVolumeL: 19,
      targetVolumes: 2.4,
      fermentationTempC: 20,
      ...(residual === null ? {} : { residualVolumes: residual.volumes }),
    });
    const withoutIt = primingSugar({ beerVolumeL: 19, targetVolumes: 2.4, fermentationTempC: 20 });
    expect(withHandoff.sugarGrams).toBeCloseTo(withoutIt.sugarGrams, 9);
  });
});

describe('priming sugar', () => {
  /**
   * 20 L to 2.4 volumes from a 20 °C fermentation, longhand:
   * ```
   * residual   = 0.8615 volumes
   * to add     = 2.4 − 0.8615 = 1.5385 volumes
   * CO₂ needed = 1.5385 × 20 L × 1.96 g/L = 60.31 g
   * corn sugar = 60.31 / 0.4442 = 135.8 g
   * table sugar= 60.31 / 0.5142 = 117.3 g
   * DME        = 60.31 / 0.3908 = 154.3 g
   * ```
   * **Tolerance: 0.5 g.**
   */
  const input = { beerVolumeL: 20, targetVolumes: 2.4, fermentationTempC: 20 };

  it('computes corn sugar longhand', () => {
    const result = primingSugar(input);
    expect(result.residualVolumes).toBeCloseTo(0.8615, 3);
    expect(result.volumesToAdd).toBeCloseTo(1.5385, 3);
    expect(result.co2Grams).toBeCloseTo(60.31, 1);
    expect(result.sugarGrams).toBeCloseTo(135.8, 1);
    expect(result.sugarGramsPerLitre).toBeCloseTo(6.79, 2);
  });

  it.each([
    ['table-sugar', 117.3],
    ['dme', 154.3],
    ['honey', 150.5],
    ['dextrose', 123.4],
  ] as const)('computes %s', (sugar, grams) => {
    expect(primingSugar({ ...input, sugar }).sugarGrams).toBeCloseTo(grams, 0);
  });

  it('needs ~15 %% more corn sugar than table sugar, per the monohydrate weight', () => {
    const corn = primingSugar({ ...input, sugar: 'corn-sugar' }).sugarGrams;
    const table = primingSugar({ ...input, sugar: 'table-sugar' }).sugarGrams;
    expect(corn / table).toBeCloseTo(0.5142 / 0.4442, 6);
  });

  it('needs more sugar for a warmer fermentation', () => {
    expect(primingSugar({ ...input, fermentationTempC: 24 }).sugarGrams).toBeGreaterThan(
      primingSugar({ ...input, fermentationTempC: 16 }).sugarGrams,
    );
  });

  it('clamps to zero when the beer is already over-carbonated', () => {
    const result = primingSugar({ ...input, targetVolumes: 0.5, fermentationTempC: 4 });
    expect(result.volumesToAdd).toBe(0);
    expect(result.sugarGrams).toBe(0);
  });

  it('scales linearly with batch size', () => {
    const small = primingSugar({ ...input, beerVolumeL: 10 }).sugarGrams;
    const large = primingSugar({ ...input, beerVolumeL: 20 }).sugarGrams;
    expect(large).toBeCloseTo(small * 2, 9);
  });

  it('round trips through carbonationFromPrimingSugar', () => {
    for (const sugar of Object.keys(
      PRIMING_SUGAR_CO2_YIELD,
    ) as (keyof typeof PRIMING_SUGAR_CO2_YIELD)[]) {
      const dose = primingSugar({ ...input, sugar });
      expect(
        carbonationFromPrimingSugar({
          beerVolumeL: input.beerVolumeL,
          sugarGrams: dose.sugarGrams,
          fermentationTempC: input.fermentationTempC,
          sugar,
        }),
      ).toBeCloseTo(input.targetVolumes, 9);
    }
  });

  /**
   * Cross-check against BeerSmith/Brewfather-style calculators, and the one
   * place they reasonably disagree with each other.
   *
   * For **20 L at 2.4 volumes from a 20 °C peak** the published tools give
   * **105–140 g** of "priming sugar", and the spread comes down to what each
   * tool assumes corn sugar *is*.
   *
   * - Tools that treat corn sugar as **anhydrous** dextrose (or quote sucrose)
   *   sit at the bottom: 117–124 g. That is our `table-sugar` and `dextrose`.
   * - Tools that treat it as **dextrose monohydrate** (which is what the bag
   *   from the homebrew shop contains; ~9 % of its weight is water of
   *   crystallisation) sit at the top: ~136 g. That's our `corn-sugar`, and
   *   it's the correct figure for the product a brewer actually weighs.
   *
   * We therefore pin each sugar to its own stoichiometric value (asserted
   * longhand above) and check the group against the published band here.
   * **Tolerance: the 105–140 g band**, which is how far the reference tools
   * disagree with each other, not our own uncertainty.
   */
  it('lands the pure sugars inside the published 105–140 g band', () => {
    // Honey and DME are left out because they aren't pure sugar, so their doses
    // are higher and the published band doesn't cover them.
    for (const sugar of ['corn-sugar', 'dextrose', 'table-sugar', 'turbinado'] as const) {
      const grams = primingSugar({ ...input, sugar }).sugarGrams;
      expect(grams).toBeGreaterThan(105);
      expect(grams).toBeLessThan(140);
    }
  });

  /**
   * The common rule of thumb "table sugar is about 10 % less than corn sugar"
   * holds, and it follows from the monohydrate weight without any tuning.
   * 117.3 / 135.8 = 0.864, so the actual figure is 14 %, and the rule of thumb
   * rounds it down.
   */
  it('puts table sugar 10–15 % below corn sugar for the same CO₂', () => {
    const corn = primingSugar({ ...input, sugar: 'corn-sugar' }).sugarGrams;
    const table = primingSugar({ ...input, sugar: 'table-sugar' }).sugarGrams;
    const saving = 1 - table / corn;
    expect(saving).toBeGreaterThan(0.1);
    expect(saving).toBeLessThan(0.15);
  });

  it('derives sucrose yield from the stoichiometry: 176.04 / 342.30', () => {
    expect(PRIMING_SUGAR_CO2_YIELD['table-sugar']).toBeCloseTo(176.04 / 342.3, 3);
  });

  it('derives anhydrous dextrose yield: 88.02 / 180.16', () => {
    expect(PRIMING_SUGAR_CO2_YIELD.dextrose).toBeCloseTo(88.02 / 180.16, 3);
  });

  it('derives corn sugar yield from the monohydrate: 88.02 / 198.17', () => {
    expect(PRIMING_SUGAR_CO2_YIELD['corn-sugar']).toBeCloseTo(88.02 / 198.17, 3);
  });
});

describe('keg conditioning', () => {
  /** The same beer as the bottle golden above: 20 L, 2.4 volumes, 20 °C peak. */
  const input = { beerVolumeL: 20, targetVolumes: 2.4, fermentationTempC: 20 };

  /**
   * There is no keg rate: a keg gets the same dose as bottles. The usual
   * homebrewing reduction (half to two thirds of the bottle dose, *Brew Your
   * Own* at 75 %) has no findable source, and the headspace explanation for it
   * accounts for under 4 % of the dose. See `primingSugar`'s doc comment for
   * the full reasoning.
   *
   * We assert the two calls are identical, not a particular mass, because the
   * point is that both vessels get the same dose. If someone adds a keg factor
   * back, this test fails.
   */
  it('doses a keg at the bottle rate, exactly', () => {
    const bottle = primingSugar(input);
    const keg = primingSugar({ ...input, beerVolumeL: 19 });
    expect(keg.sugarGramsPerLitre).toBeCloseTo(bottle.sugarGramsPerLitre, 12);
    // 19 L Cornelius keg, corn sugar: 6.79 g/L × 19 = 129.0 g, the full
    // stoichiometric dose. Two thirds of it would be 86 g.
    expect(keg.sugarGrams).toBeCloseTo(129.0, 1);
    expect(keg.sugarGrams).toBeGreaterThan(100);
  });

  /**
   * Nothing is held back anywhere in the calculation: the CO₂ the dose
   * generates is exactly the CO₂ the target needs. A keg reduction applied as
   * a scale on `co2Grams` would fail here.
   */
  it('generates the full stoichiometric CO₂, with nothing withheld', () => {
    const result = primingSugar({ ...input, beerVolumeL: 19 });
    expect(result.residualVolumes).toBeCloseTo(0.8615, 3);
    expect(result.volumesToAdd).toBeCloseTo(1.5385, 3);
    expect(result.co2Grams).toBeCloseTo(
      result.volumesToAdd * 19 * GRAMS_CO2_PER_VOLUME_PER_LITRE,
      12,
    );
    // The headspace argument's 89 g, at this keg's 1.54 volumes to add.
    expect(result.co2Grams).toBeCloseTo(57.3, 1);
  });

  /**
   * The dose reaches the target. This is the same round trip tested for
   * bottles, at a keg volume. A reduced dose would come back short of 2.4
   * volumes, which is the problem with it.
   */
  it('reaches the target in a keg, not two thirds of the way to it', () => {
    const dose = primingSugar({ ...input, beerVolumeL: 19 });
    expect(
      carbonationFromPrimingSugar({
        beerVolumeL: 19,
        sugarGrams: dose.sugarGrams,
        fermentationTempC: input.fermentationTempC,
      }),
    ).toBeCloseTo(input.targetVolumes, 9);
  });

  /**
   * The alternative to priming sugar: spund at the pressure that gives the
   * target at the fermentation temperature. It's the same fit as the regulator
   * setting, so there's no new maths. What we check is that a warm ferment
   * needs a real, settable pressure, much higher than a cold keg needs.
   * 20 °C at 2.4 volumes:
   * ```
   * 68 °F: henry = 0.01821 + 0.09011 × e^(−36 / 43.11) = 0.057358
   * P     = (2.4 + 0.003342) / 0.057358 − 14.695 = 27.20 psi
   * ```
   */
  it('spunds a 20 °C ferment to 2.4 volumes at ~27 psi', () => {
    expect(pressureFromCo2Volumes(20, 2.4)).toBeCloseTo(27.2, 1);
    // Far above what the same beer needs cold in a serving fridge.
    expect(pressureFromCo2Volumes(20, 2.4)).toBeGreaterThan(pressureFromCo2Volumes(4, 2.4));
  });
});

describe('CO₂ mass conversions', () => {
  it('uses 1.96 g per litre per volume', () => {
    expect(GRAMS_CO2_PER_VOLUME_PER_LITRE).toBe(1.96);
    expect(co2VolumesToGramsPerLitre(2.4)).toBeCloseTo(4.704, 9);
  });

  it('round trips', () => {
    expect(gramsPerLitreToCo2Volumes(co2VolumesToGramsPerLitre(2.4))).toBeCloseTo(2.4, 9);
  });
});
