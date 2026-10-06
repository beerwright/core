/**
 * Measurement corrections and brew-day adjustments.
 *
 * Refractometer wort correction and fermenting-sample correction, hydrometer
 * temperature correction, and the two usual fixes when the gravity comes out
 * wrong: dilute, or boil down.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import { platoToSgExact } from './gravity';
import {
  ASBC_METHODS,
  HYDROMETER_CORRECTION_POLYNOMIAL,
  KELL_1975,
  TERRILL_REFRACTOMETER_2011,
} from './sources';
import type { Celsius, Litres, SpecificGravity } from './types';
import { gravityPointsToSg, sgToGravityPoints, sgToPlato } from './units/gravity';
import { celsiusToFahrenheit } from './units/temperature';

// ---------------------------------------------------------------------------
// Refractometer
// ---------------------------------------------------------------------------

/**
 * Default wort correction factor.
 *
 * A refractometer is calibrated against sucrose, but wort's mix of maltose,
 * dextrins and protein refracts more per unit of extract, so a raw reading runs
 * high by ~4 %. 1.04 is the conventional default. Brewers who calibrate their
 * own instrument against a hydrometer typically get between 1.02 and 1.06.
 *
 * @category Gravity and ABV
 * @group Constants and defaults
 */
export const DEFAULT_WORT_CORRECTION_FACTOR = 1.04;

/**
 * Corrected Brix for unfermented wort: `Brix_corrected = Brix_measured / WCF`.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function correctRefractometerBrix(
  measuredBrix: number,
  wortCorrectionFactor = DEFAULT_WORT_CORRECTION_FACTOR,
): number {
  return measuredBrix / wortCorrectionFactor;
}

/**
 * Specific gravity of unfermented wort from a raw refractometer reading.
 *
 * Divides out the wort correction factor and converts the resulting Brix to SG
 * on the Plato scale. Only valid before fermentation starts. Once alcohol is
 * present, use {@link refractometerFinalGravity}.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function refractometerToGravity(
  measuredBrix: number,
  wortCorrectionFactor = DEFAULT_WORT_CORRECTION_FACTOR,
): SpecificGravity {
  return platoToSgExact(correctRefractometerBrix(measuredBrix, wortCorrectionFactor));
}

/**
 * Which fermenting-sample model to run.
 *
 * Only Terrill's linear regression is implemented. The union lets a second
 * model be added without a breaking signature change, but a new model has to
 * pass the validation described on {@link refractometerFinalGravity} first.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export type FermentingSampleModel = 'terrill-linear';

/**
 * True gravity of a fermenting or finished sample from two refractometer
 * readings.
 *
 * Alcohol refracts far more strongly than sugar, so a refractometer reading
 * taken after fermentation has started is meaningless unless the correction
 * also knows the original reading. Sean Terrill's linear regression
 * (seanterrill.com, "Refractometer FG Results") against measured hydrometer
 * data:
 *
 * ```
 * FG = 1.001843 − 0.002318474·OB − 0.000007775·OB² − 0.000000034·OB³
 *               + 0.00574·FB    + 0.00003344·FB²  + 0.000000086·FB³
 * ```
 *
 * `OB` and `FB` are wort-correction-factor-adjusted Brix, which is how
 * Brewer's Friend and Brewfather apply the model. Use
 * {@link refractometerFinalGravityRaw} to pass uncorrected instrument readings.
 *
 * ## Validation
 *
 * A model has to give physically sensible results across the brewing range,
 * and this one does. Given `OB = FB` (a sample that hasn't fermented at all)
 * it returns within 0.002 SG of the true gravity of that Brix from 8 to
 * 20 °Bx, and over realistic fermentations it implies apparent attenuations
 * of 69–75 %. We tried a second, widely circulated "Terrill cubic" and
 * rejected it. As transcribed it returns SG below 1.000 and implied
 * attenuations above 100 % for strong beers, so its coefficients can't be
 * right.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function refractometerFinalGravity(
  originalCorrectedBrix: number,
  finalCorrectedBrix: number,
  _model: FermentingSampleModel = 'terrill-linear',
): SpecificGravity {
  const ob = originalCorrectedBrix;
  const fb = finalCorrectedBrix;
  return (
    1.001843 -
    0.002318474 * ob -
    0.000007775 * ob ** 2 -
    0.000000034 * ob ** 3 +
    0.00574 * fb +
    0.00003344 * fb ** 2 +
    0.000000086 * fb ** 3
  );
}

/**
 * {@link refractometerFinalGravity} taking raw instrument readings, applying the
 * wort correction factor to both.
 *
 * @category Gravity and ABV
 * @group Start here
 */
export function refractometerFinalGravityRaw(
  originalMeasuredBrix: number,
  finalMeasuredBrix: number,
  wortCorrectionFactor = DEFAULT_WORT_CORRECTION_FACTOR,
  model: FermentingSampleModel = 'terrill-linear',
): SpecificGravity {
  return refractometerFinalGravity(
    correctRefractometerBrix(originalMeasuredBrix, wortCorrectionFactor),
    correctRefractometerBrix(finalMeasuredBrix, wortCorrectionFactor),
    model,
  );
}

/**
 * Calibrate a wort correction factor from a paired reading.
 *
 * `WCF = Brix_measured / °P(hydrometer SG)`. Take both readings on the same
 * unfermented sample. The result is the factor for that instrument.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function calibrateWortCorrectionFactor(
  measuredBrix: number,
  hydrometerGravity: SpecificGravity,
): number {
  const plato = sgToPlato(hydrometerGravity);
  return plato > 0 ? measuredBrix / plato : DEFAULT_WORT_CORRECTION_FACTOR;
}

// ---------------------------------------------------------------------------
// Hydrometer temperature correction
// ---------------------------------------------------------------------------

/**
 * Standard hydrometer calibration temperature, °C (60 °F).
 *
 * @category Gravity and ABV
 * @group Constants and defaults
 */
export const DEFAULT_HYDROMETER_CALIBRATION_TEMP_C = 15.5556;

/**
 * The brewing calculators' cubic fit of water density against °F.
 *
 * This isn't {@link waterDensityKgPerM3}. It's the polynomial every homebrew
 * hydrometer-correction calculator uses, and we use it so a brewer who checks
 * a reading against Brewer's Friend gets the same answer. It's fitted over the
 * range a hydrometer sample is realistically at, roughly 0–40 °C, and is badly
 * wrong outside it (at 212 °F it returns 1.042). That's why the volume
 * correction below doesn't use it.
 */
function waterDensityPolynomial(tempF: number): number {
  return (
    1.00130346 - 1.34722124e-4 * tempF + 2.04052596e-6 * tempF ** 2 - 2.32820948e-9 * tempF ** 3
  );
}

/**
 * Correct a hydrometer reading taken at the wrong temperature.
 *
 * ```
 * SG_true = SG_read × ρ(T_sample) / ρ(T_calibration)
 * ```
 *
 * where ρ is the standard cubic fit of water density in °F. Hot samples read
 * low (the wort is less dense than the instrument assumes) and the correction
 * pushes them back up. A 30 °C sample on a 60 °F hydrometer reads about
 * 0.0016 SG low.
 *
 * @category Gravity and ABV
 * @group Start here
 */
export function correctHydrometerReading(
  measuredGravity: SpecificGravity,
  sampleTempC: Celsius,
  calibrationTempC: Celsius = DEFAULT_HYDROMETER_CALIBRATION_TEMP_C,
): SpecificGravity {
  const sample = waterDensityPolynomial(celsiusToFahrenheit(sampleTempC));
  const calibration = waterDensityPolynomial(celsiusToFahrenheit(calibrationTempC));
  return (measuredGravity * sample) / calibration;
}

// ---------------------------------------------------------------------------
// Volume temperature correction
// ---------------------------------------------------------------------------

/**
 * The temperature all stored volumes are expressed at, °C.
 *
 * The volume calculations in `./volumes` work at 20 °C (see `postBoilVolumeL`),
 * so a brew-day reading has to be corrected to 20 °C before it's stored.
 *
 * @category Gravity and ABV
 * @group Constants and defaults
 */
export const REFERENCE_VOLUME_TEMP_C = 20;

/**
 * Density of air-free water at one atmosphere, kg/m³.
 *
 * Kell's equation (G. S. Kell, "Density, thermal expansivity, and
 * compressibility of liquid water from 0° to 150 °C", *J. Chem. Eng. Data*
 * **20**(1), 1975, 97–105):
 *
 * ```
 *        999.83952 + 16.945176·t − 7.9870401e-3·t² − 46.170461e-6·t³
 *                  + 105.56302e-9·t⁴ − 280.54253e-12·t⁵
 * ρ(t) = ───────────────────────────────────────────────────────────
 *                        1 + 16.879850e-3·t
 * ```
 *
 * Fitted over 0–150 °C, it reproduces tabulated densities to a few parts per
 * million. It returns 998.204 kg/m³ at 20 °C and 958.364 kg/m³ at 100 °C. We
 * only use ratios of it, so even that small error mostly cancels.
 *
 * It also reproduces water's density maximum at 3.98 °C (not 0 °C), which is
 * an easy check that the coefficients were transcribed correctly.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function waterDensityKgPerM3(tempC: Celsius): number {
  const t = tempC;
  const numerator =
    999.83952 +
    16.945176 * t -
    7.9870401e-3 * t ** 2 -
    46.170461e-6 * t ** 3 +
    105.56302e-9 * t ** 4 -
    280.54253e-12 * t ** 5;
  return numerator / (1 + 16.87985e-3 * t);
}

/**
 * A volume measured hot, expressed at the reference temperature.
 *
 * ```
 * V_ref = V_t × ρ(t) / ρ(ref)
 * ```
 *
 * Mass is conserved while the wort cools, so the volumes are in inverse ratio
 * to the densities. A sight-glass reading taken off a boiling kettle overstates
 * the 20 °C volume by ~4 %. Below 20 °C the correction goes the other way and
 * the volume goes up, because cold water is denser.
 *
 * ## Relationship to the planned boil shrinkage
 *
 * When planning a brew, `applyBoilShrinkage` in `./volumes` applies a flat 4 %
 * between "post-boil (hot)" and "post-boil (20 °C)". That constant and this
 * function describe the same contraction, and they agree: at 100 °C this
 * returns a factor of 0.960088, which is 3.991 %, against the planning
 * constant's 4.000 %. Planning uses a brewer-editable percentage on the
 * equipment profile instead of calling this, because it also has to cover
 * whatever else a particular rig loses between flame-out and the measuring
 * jug. This function corrects a measurement, so it uses the physics.
 * `corrections.test.ts` checks the two stay within 0.01 percentage points of
 * each other.
 *
 * ## Treating wort as water
 *
 * Wort isn't water, but we treat it as if it were. At brewing strengths wort
 * is ~88–95 % water by mass and the dissolved extract only raises the cubic
 * expansion coefficient slightly, so real wort contracts a little more than
 * this predicts. The error bound comes from observation: the 4 % hot-wort
 * figure that BeerSmith, Brewer's Friend and Grainfather all use is reproduced
 * here to 0.009 percentage points, so the wort-versus-water difference is
 * smaller than the one significant figure that figure is quoted to. Taking
 * that precision as the bound, the approximation costs at most ~0.5
 * percentage points of volume: ~0.1 L in a 25 L kettle, against a sight glass
 * a brewer can read to perhaps 0.25 L.
 *
 * @param volumeL - The volume as read, litres.
 * @param measuredAtC - The temperature it was read at, °C. Valid 0–100 °C
 *   (liquid water at one atmosphere). Outside that the equation still
 *   evaluates (Kell is fitted to 150 °C) but the answer has nothing to do with
 *   brewing. We don't clamp it, so a nonsense temperature gives an obviously
 *   wrong volume instead of a plausible wrong one.
 * @param referenceC - The temperature to express the result at. Defaults to
 *   {@link REFERENCE_VOLUME_TEMP_C}.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function correctVolumeToReference(
  volumeL: Litres,
  measuredAtC: Celsius,
  referenceC: Celsius = REFERENCE_VOLUME_TEMP_C,
): Litres {
  return (volumeL * waterDensityKgPerM3(measuredAtC)) / waterDensityKgPerM3(referenceC);
}

/**
 * Density of water at the gravity reference temperature, kg/L.
 *
 * Specific gravity is a ratio, so turning it into a density needs the density
 * of the reference water: water at 20 °C, the 20/20 °C basis we assume for
 * gravity readings here, and also {@link REFERENCE_VOLUME_TEMP_C}. 0.99823 kg/L
 * is the conventional brewing figure. {@link waterDensityKgPerM3} returns
 * 998.204 kg/m³ at the same temperature, a difference of 26 ppm, which is
 * three orders of magnitude below the resolution of any scale a keg will sit
 * on.
 *
 * @category Gravity and ABV
 * @group Constants and defaults
 */
export const WATER_DENSITY_AT_REFERENCE_KG_PER_L = 0.99823;

/**
 * Input to {@link beerVolumeFromWeight}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface BeerWeightInput {
  /** The full vessel on the scale, kilograms. */
  readonly grossKg: number;
  /** The same vessel empty, kilograms, including lid, dip tubes and disconnects. */
  readonly tareKg: number;
  /** Gravity of the beer inside, SG. Finished beer is ~1.010. */
  readonly sg: SpecificGravity;
}

/**
 * Litres of beer in a vessel, from what it weighs full and what it weighs empty.
 *
 * ```
 * net_kg  = gross − tare
 * ρ_kg/L  = sg × 0.99823
 * litres  = net_kg / ρ
 * ```
 *
 * This is mainly for kegs. You can't see the liquid level in a Cornelius keg,
 * so most batches get recorded as "about nineteen litres". Weighing it full
 * and empty gives a real number.
 *
 * ## Assumptions
 *
 * **20 °C, the same reference SG uses.** Specific gravity is a ratio against
 * water, so a density in kg/L needs that water's density,
 * {@link WATER_DENSITY_AT_REFERENCE_KG_PER_L}. A keg straight out of a cold
 * conditioning fridge holds slightly denser beer, but the effect is the same
 * 0.4 % the volume correction gives between 4 and 20 °C, which is less than
 * the weight of a wet disconnect.
 *
 * **Dissolved CO₂ is ignored.** 19 L at 2.4 volumes holds 89 g of it, plus a
 * few grams in a sealed keg's headspace. But 89 g against ~19 kg of beer is
 * 0.47 % of the mass, about 90 mL of apparent volume. That's below the
 * precision of the two weighings, so including it would be false precision.
 *
 * **Bad input returns zero.** A net weight of zero or less means the tare was
 * wrong, the vessel is empty, or the two numbers were swapped. None of those
 * is a volume. A negative result could end up in a packaged-volume field and
 * corrupt every yield figure computed from it. Callers can recognise zero and
 * refuse to store it.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function beerVolumeFromWeight(input: BeerWeightInput): Litres {
  const netKg = input.grossKg - input.tareKg;
  if (!(netKg > 0)) return 0;
  const densityKgPerL = input.sg * WATER_DENSITY_AT_REFERENCE_KG_PER_L;
  if (!(densityKgPerL > 0)) return 0;
  return netKg / densityKgPerL;
}

// ---------------------------------------------------------------------------
// Dilution, boil-down and blending
// ---------------------------------------------------------------------------

/**
 * Result of a dilution or boil-down calculation.
 *
 * @category Gravity and ABV
 * @group Results
 */
export interface VolumeAdjustment {
  /** Volume after the adjustment, litres. */
  readonly resultingVolumeL: Litres;
  /** Water to add (dilution) or wort to evaporate (boil-down), litres. */
  readonly volumeChangeL: Litres;
  /** Gravity after the adjustment, SG. */
  readonly resultingGravity: SpecificGravity;
}

/**
 * Water to add to bring a wort down to a target gravity.
 *
 * Extract is conserved, so `points₁ × V₁ = points₂ × V₂` and
 * `V₂ = V₁ × points₁ / points₂`. Returns a zero change when the target is at or
 * above the current gravity, since you can't dilute upwards.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function dilutionToTargetGravity(
  currentVolumeL: Litres,
  currentGravity: SpecificGravity,
  targetGravity: SpecificGravity,
): VolumeAdjustment {
  const p1 = sgToGravityPoints(currentGravity);
  const p2 = sgToGravityPoints(targetGravity);
  if (p2 <= 0 || p2 >= p1) {
    return { resultingVolumeL: currentVolumeL, volumeChangeL: 0, resultingGravity: currentGravity };
  }
  const resultingVolumeL = (currentVolumeL * p1) / p2;
  return {
    resultingVolumeL,
    volumeChangeL: resultingVolumeL - currentVolumeL,
    resultingGravity: targetGravity,
  };
}

/**
 * Wort to boil away to bring a wort up to a target gravity.
 *
 * The same conservation of extract as {@link dilutionToTargetGravity}, in the
 * other direction. `volumeChangeL` is negative (volume leaves the kettle). Returns a
 * zero change when the target is at or below the current gravity.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function boilDownToTargetGravity(
  currentVolumeL: Litres,
  currentGravity: SpecificGravity,
  targetGravity: SpecificGravity,
): VolumeAdjustment {
  const p1 = sgToGravityPoints(currentGravity);
  const p2 = sgToGravityPoints(targetGravity);
  if (p1 <= 0 || p2 <= p1) {
    return { resultingVolumeL: currentVolumeL, volumeChangeL: 0, resultingGravity: currentGravity };
  }
  const resultingVolumeL = (currentVolumeL * p1) / p2;
  return {
    resultingVolumeL,
    volumeChangeL: resultingVolumeL - currentVolumeL,
    resultingGravity: targetGravity,
  };
}

/**
 * Gravity after diluting with a known volume of water.
 * `SG₂ = 1 + points₁ × V₁ / (V₁ + V_water) / 1000`.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function gravityAfterDilution(
  currentVolumeL: Litres,
  currentGravity: SpecificGravity,
  waterAddedL: Litres,
): SpecificGravity {
  const total = currentVolumeL + waterAddedL;
  if (total <= 0) return currentGravity;
  return gravityPointsToSg((sgToGravityPoints(currentGravity) * currentVolumeL) / total);
}

/**
 * Mass of a sugar or extract needed to raise a wort to a target gravity, kg.
 *
 * `kg = (points_target − points_current) × V / pointsPerKgPerL`. For "my
 * pre-boil gravity is low, how much DME do I add?". Ignores the small volume
 * the sugar itself adds.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function sugarToTargetGravity(
  currentVolumeL: Litres,
  currentGravity: SpecificGravity,
  targetGravity: SpecificGravity,
  pointsPerKgPerL: number,
): number {
  if (pointsPerKgPerL <= 0) return 0;
  const deficit = sgToGravityPoints(targetGravity) - sgToGravityPoints(currentGravity);
  if (deficit <= 0) return 0;
  return (deficit * currentVolumeL) / pointsPerKgPerL;
}

/**
 * One component of a blend.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface BlendComponent {
  /** Volume of this component, liters. */
  readonly volumeL: Litres;
  /** Gravity of this component, SG. */
  readonly gravity: SpecificGravity;
  /** Optional bitterness, IBU, blended by volume. */
  readonly ibu?: number;
  /** Optional colour, SRM, blended by volume. */
  readonly srm?: number;
  /** Optional alcohol, % ABV, blended by volume. */
  readonly abv?: number;
}

/**
 * Result of {@link blend}.
 *
 * @category Gravity and ABV
 * @group Results
 */
export interface BlendResult {
  /** Total volume of the blend, liters. */
  readonly volumeL: Litres;
  /** Gravity of the blend, SG. */
  readonly gravity: SpecificGravity;
  /** Bitterness of the blend, IBU. */
  readonly ibu: number;
  /** Color of the blend, SRM. */
  readonly srm: number;
  /** Alcohol of the blend, % ABV. */
  readonly abv: number;
}

/**
 * Blend two or more worts or beers.
 *
 * Gravity blends by conserved extract (`Σ points × V / Σ V`). Bitterness,
 * colour and alcohol blend linearly by volume, which is exact for ABV and a
 * good approximation for IBU and SRM. A component that leaves out a field
 * counts as zero for it.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function blend(components: readonly BlendComponent[]): BlendResult {
  let volumeL = 0;
  let pointLitres = 0;
  let ibuLitres = 0;
  let srmLitres = 0;
  let abvLitres = 0;
  for (const c of components) {
    volumeL += c.volumeL;
    pointLitres += sgToGravityPoints(c.gravity) * c.volumeL;
    ibuLitres += (c.ibu ?? 0) * c.volumeL;
    srmLitres += (c.srm ?? 0) * c.volumeL;
    abvLitres += (c.abv ?? 0) * c.volumeL;
  }
  if (volumeL <= 0) return { volumeL: 0, gravity: 1, ibu: 0, srm: 0, abv: 0 };
  return {
    volumeL,
    gravity: gravityPointsToSg(pointLitres / volumeL),
    ibu: ibuLitres / volumeL,
    srm: srmLitres / volumeL,
    abv: abvLitres / volumeL,
  };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const roundTo = (n: number, dp: number) => Number(n.toFixed(dp));

/**
 * A pre-fermentation refractometer reading turned into a gravity, with its
 * breakdown.
 *
 * @category Gravity and ABV
 * @group Explanations
 */
export function refractometerGravityExplained(
  measuredBrix: number,
  wortCorrectionFactor = DEFAULT_WORT_CORRECTION_FACTOR,
): Explanation {
  const corrected = correctRefractometerBrix(measuredBrix, wortCorrectionFactor);
  const sg = refractometerToGravity(measuredBrix, wortCorrectionFactor);
  return explain(sg, {
    label: 'Gravity from a refractometer (unfermented wort)',
    formula: 'wort-correction-factor',
    expression: 'SG = SG(°P) where °P = Brix_measured / WCF',
    inputs: {
      measuredBrix: roundTo(measuredBrix, 2),
      wortCorrectionFactor,
      correctedBrix: roundTo(corrected, 2),
    },
    unit: 'SG',
    notes: [
      'A refractometer is calibrated against sucrose; wort refracts more per unit of extract, so a raw reading runs about 4 % high.',
      'Valid only before fermentation starts. Once there is alcohol in the sample, use the fermenting-sample model.',
    ],
    family: 'corrections',
    sources: [ASBC_METHODS],
  });
}

/**
 * A refractometer reading taken during or after fermentation turned into a
 * true gravity, with its breakdown.
 *
 * @category Gravity and ABV
 * @group Explanations
 */
export function refractometerFinalGravityExplained(
  originalMeasuredBrix: number,
  finalMeasuredBrix: number,
  wortCorrectionFactor = DEFAULT_WORT_CORRECTION_FACTOR,
): Explanation {
  const ob = correctRefractometerBrix(originalMeasuredBrix, wortCorrectionFactor);
  const fb = correctRefractometerBrix(finalMeasuredBrix, wortCorrectionFactor);
  const fg = refractometerFinalGravity(ob, fb);
  return explain(fg, {
    label: 'Final gravity from a refractometer',
    formula: 'terrill-linear',
    expression:
      'FG = 1.001843 − 0.002318474·OB − 0.000007775·OB² − 0.000000034·OB³ + 0.00574·FB + 0.00003344·FB² + 0.000000086·FB³',
    inputs: {
      originalMeasuredBrix: roundTo(originalMeasuredBrix, 2),
      finalMeasuredBrix: roundTo(finalMeasuredBrix, 2),
      wortCorrectionFactor,
      correctedOriginalBrix: roundTo(ob, 3),
      correctedFinalBrix: roundTo(fb, 3),
    },
    unit: 'SG',
    notes: [
      'Alcohol refracts far more strongly than sugar, so a reading taken after fermentation started is meaningless without the starting point.',
      "OB and FB are wort-correction-factor-adjusted Brix, which is how Brewer's Friend and Brewfather apply the same model.",
      'A widely circulated "Terrill cubic" variant returns gravities below 1.000 for strong beers and is not used here.',
    ],
    family: 'corrections',
    sources: [TERRILL_REFRACTOMETER_2011],
  });
}

/**
 * A hydrometer reading taken at the wrong temperature, corrected, with its breakdown.
 *
 * @category Gravity and ABV
 * @group Explanations
 */
export function hydrometerCorrectionExplained(
  measuredGravity: SpecificGravity,
  sampleTempC: Celsius,
  calibrationTempC: Celsius = DEFAULT_HYDROMETER_CALIBRATION_TEMP_C,
): Explanation {
  const corrected = correctHydrometerReading(measuredGravity, sampleTempC, calibrationTempC);
  return explain(corrected, {
    label: 'Hydrometer reading corrected for temperature',
    formula: 'hydrometer-temperature-correction',
    expression: 'SG_true = SG_read × ρ(T_sample) / ρ(T_calibration)',
    inputs: {
      measuredGravity: roundTo(measuredGravity, 4),
      sampleTempC: roundTo(sampleTempC, 1),
      calibrationTempC: roundTo(calibrationTempC, 2),
      correctionPoints: roundTo((corrected - measuredGravity) * 1000, 2),
    },
    unit: 'SG',
    notes: [
      'ρ is the cubic water-density fit in °F that every homebrewing calculator uses, so this agrees with the answer a brewer gets elsewhere.',
      'A hot sample reads low and the correction pushes it back up; a cold one reads high.',
    ],
    family: 'corrections',
    sources: [HYDROMETER_CORRECTION_POLYNOMIAL],
  });
}

/**
 * A volume measured hot, expressed at 20 °C, with its breakdown.
 *
 * @category Gravity and ABV
 * @group Explanations
 */
export function volumeCorrectionExplained(
  volumeL: Litres,
  measuredAtC: Celsius,
  referenceC: Celsius = REFERENCE_VOLUME_TEMP_C,
): Explanation {
  const corrected = correctVolumeToReference(volumeL, measuredAtC, referenceC);
  return explain(corrected, {
    label: 'Volume corrected to 20 °C',
    formula: 'kell-1975-density-ratio',
    expression: 'V_ref = V_t × ρ(t) / ρ(ref)',
    inputs: {
      volumeL: roundTo(volumeL, 2),
      measuredAtC: roundTo(measuredAtC, 1),
      referenceC,
      densityAtMeasuredKgPerM3: roundTo(waterDensityKgPerM3(measuredAtC), 3),
      densityAtReferenceKgPerM3: roundTo(waterDensityKgPerM3(referenceC), 3),
      shrinkagePercent: roundTo((1 - corrected / volumeL) * 100, 3),
    },
    unit: 'L',
    notes: [
      'Mass is conserved as the wort cools, so the volumes are in inverse ratio to the densities.',
      'Wort is treated as water. The error is smaller than the one significant figure the observed 4 % hot-wort shrinkage is quoted to.',
    ],
    family: 'corrections',
    sources: [KELL_1975],
  });
}
