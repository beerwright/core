/**
 * Carbonation.
 *
 * Forced carbonation (temperature ⇄ pressure ⇄ volumes of CO₂) and priming
 * sugar by sugar type, including the CO₂ the beer already holds from
 * fermentation. Priming has a single rate, the stoichiometric one in
 * {@link primingSugar}, and a keg gets the same dose as a bottle. The folk
 * reduction for kegs is discussed on that function and isn't implemented.
 *
 * A fermentation schedule feeds the priming dose through
 * {@link scheduleResidualCo2}, which decides whether a beer's residual CO₂
 * comes from its temperature or from the pressure it was held at. This isn't
 * a keg discount: a spunded ferment gets the same dose rate, it just arrives
 * at packaging already holding more CO₂, which can be measured.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import {
  BRAUKAISER_CARBONATION,
  BYO_MR_WIZARD_KEG_PRIMING,
  CO2_SOLUBILITY_TABLES,
} from './sources';
import type { Celsius, FermentationStep, Litres } from './types';
import { celsiusToFahrenheit, fahrenheitToCelsius } from './units/temperature';

/**
 * Mass of one "volume" of CO₂ per litre of beer, grams.
 *
 * One volume is one litre of CO₂ at 0 °C and 1 atm dissolved in one litre of
 * beer. CO₂'s density under those conditions is 1.96 g/L.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const GRAMS_CO2_PER_VOLUME_PER_LITRE = 1.96;

/**
 * Volumes of CO₂ dissolved at a given temperature and gauge pressure.
 *
 * ```
 * V = (P + 14.695) × (0.01821 + 0.09011 × e^(−(T − 32) / 43.11)) − 0.003342
 * ```
 *
 * with `P` in PSI gauge and `T` in °F. This is the empirical fit of the
 * standard carbonation tables that keg calculators use. Inputs are °C and PSI
 * and converted internally. We keep PSI because regulators are labelled in
 * it.
 *
 * @category Packaging
 * @group Calculations
 */
export function co2VolumesFromPressure(tempC: Celsius, pressurePsi: number): number {
  const tempF = celsiusToFahrenheit(tempC);
  return (pressurePsi + 14.695) * (0.01821 + 0.09011 * Math.exp(-(tempF - 32) / 43.11)) - 0.003342;
}

/**
 * Gauge pressure needed to hold a target carbonation at a temperature, PSI.
 * The exact inverse of {@link co2VolumesFromPressure}.
 *
 * @category Packaging
 * @group Start here
 */
export function pressureFromCo2Volumes(tempC: Celsius, volumes: number): number {
  const tempF = celsiusToFahrenheit(tempC);
  const henry = 0.01821 + 0.09011 * Math.exp(-(tempF - 32) / 43.11);
  return (volumes + 0.003342) / henry - 14.695;
}

/**
 * Gauge pressure in PSI to bar. Regulators outside the US are marked in bar.
 *
 * @category Packaging
 * @group Calculations
 */
export function psiToBar(psi: number): number {
  return psi * 0.0689475729;
}

/**
 * Gauge pressure in bar to PSI.
 *
 * @category Packaging
 * @group Calculations
 */
export function barToPsi(bar: number): number {
  return bar / 0.0689475729;
}

/**
 * Gauge pressure in PSI to kilopascals.
 *
 * 1 psi = 6.894 757 293 168 361 kPa exactly, from the definition of the pound-
 * force and the inch. Some European regulators are marked in kPa instead of
 * bar. 100 kPa = 1 bar, so this is the bar conversion times 100.
 *
 * @category Packaging
 * @group Calculations
 */
export function psiToKilopascals(psi: number): number {
  return psi * 6.89475729;
}

/**
 * Gauge pressure in kilopascals to PSI.
 *
 * @category Packaging
 * @group Calculations
 */
export function kilopascalsToPsi(kilopascals: number): number {
  return kilopascals / 6.89475729;
}

/**
 * {@link co2VolumesFromPressure} with the pressure in kilopascals.
 *
 * This only converts units; the fit is the same one. Spunding valves sold
 * outside the US are marked in bar and kPa, and this saves callers from
 * converting to PSI themselves.
 *
 * @category Packaging
 * @group Calculations
 */
export function co2VolumesFromKilopascals(tempC: Celsius, kilopascals: number): number {
  return co2VolumesFromPressure(tempC, kilopascalsToPsi(kilopascals));
}

/**
 * CO₂ the beer still holds from fermentation, in volumes.
 *
 * ```
 * V_residual = 3.0378 − 0.050062 × T + 0.00026555 × T²
 * ```
 *
 * with `T` in °F. This is the standard residual-CO₂ curve priming calculators
 * use. `T` is the **highest** temperature the beer reached at or after the
 * end of fermentation, not the current one, because CO₂ driven off by a warm
 * diacetyl rest doesn't come back when the beer is chilled.
 *
 * @category Packaging
 * @group Calculations
 */
export function residualCo2Volumes(fermentationTempC: Celsius): number {
  const t = celsiusToFahrenheit(fermentationTempC);
  return 3.0378 - 0.050062 * t + 0.00026555 * t * t;
}

/**
 * The temperature at which a beer naturally holds a given residual CO₂, °C.
 *
 * @category Packaging
 * @group Calculations
 */
export function fermentationTempForResidualCo2(volumes: number): Celsius {
  // Invert the quadratic 0.00026555 T² − 0.050062 T + (3.0378 − V) = 0 on the
  // physically meaningful (descending) branch.
  const a = 0.00026555;
  const b = -0.050062;
  const c = 3.0378 - volumes;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return Number.NaN;
  const tempF = (-b - Math.sqrt(discriminant)) / (2 * a);
  return fahrenheitToCelsius(tempF);
}

// ---------------------------------------------------------------------------
// What a fermentation schedule leaves in the beer
// ---------------------------------------------------------------------------

/**
 * The CO₂ a finished ferment leaves behind, and the conditions it was
 * computed at.
 *
 * The two cases use *different published fits*, so a caller showing "0.86
 * volumes" needs the temperature and pressure to say which one produced it.
 * See {@link scheduleResidualCo2}.
 *
 * @category Packaging
 * @group Results
 */
export interface ResidualCo2 {
  /** Volumes of CO₂ still in solution when the beer is packaged. */
  readonly volumes: number;
  /** The temperature the figure was read at, **°C**. */
  readonly tempC: Celsius;
  /**
   * Gauge pressure the beer sat under at {@link tempC}, **psi**, or `null` when
   * the schedule finished open to atmosphere.
   */
  readonly pressurePsi: number | null;
}

/**
 * The warmest temperature a fermentation schedule reaches, **°C**.
 *
 * We check both ends of every step, because a ramp can end hotter than it
 * starts. `null` for a schedule with no steps.
 *
 * @category Packaging
 * @group Calculations
 */
export function peakFermentationTempC(steps: readonly FermentationStep[]): Celsius | null {
  if (steps.length === 0) return null;
  return Math.max(
    ...steps.map((step) =>
      step.endTempC === undefined ? step.tempC : Math.max(step.tempC, step.endTempC),
    ),
  );
}

/**
 * How much CO₂ the beer still holds when the schedule ends.
 *
 * ## Two fits, chosen by the schedule
 *
 * **Open to atmosphere** (the usual case) uses {@link residualCo2Volumes} at
 * the schedule's *peak* temperature. CO₂ that a warm diacetyl rest drove off
 * doesn't come back when the beer is crashed, because there's only air and a
 * blow-off tube above the beer.
 *
 * **Under pressure** is the exception. A sealed vessel with a spunding valve
 * has a CO₂ headspace at a known gauge pressure, so the beer is at Henry's-law
 * equilibrium, not at whatever was left after its warmest point, and it does
 * take gas back up as it chills. So if the **last** step has a pressure, we
 * use {@link co2VolumesFromPressure} at that step's finishing temperature and
 * ignore the peak.
 *
 * We look at the last step, not any step, because a beer that was spunded and
 * then vented and transferred is back to the open-vessel case. A brewer
 * records that by leaving the pressure off the last step.
 *
 * ## Assumptions and limits
 *
 * This assumes the stated pressure is actually *held* at the stated
 * temperature, by a spunding valve, a gas line, or topping up the vessel.
 * Pressure that's only *trapped* before a crash falls as the beer absorbs it,
 * and the beer ends up somewhere between the two figures. This model doesn't
 * cover that case; for a trapped-and-crashed step, the right figure is the
 * pressure the gauge settles at, which has to be measured.
 *
 * The two fits also disagree slightly where they meet. At 20 °C and zero gauge
 * pressure the residual curve gives 0.86 volumes and the Henry's-law fit gives
 * 0.84, since they're independent regressions of the same tables. A step with
 * `pressurePsi: 0` would read a little lower than the same step without one,
 * so we treat zero as no pressure.
 *
 * @returns `null` for a schedule with no steps. The caller's own default (a
 * room-temperature ale) is a better answer there.
 *
 * @category Packaging
 * @group Calculations
 */
export function scheduleResidualCo2(steps: readonly FermentationStep[]): ResidualCo2 | null {
  const peakTempC = peakFermentationTempC(steps);
  if (peakTempC === null) return null;

  const last = steps[steps.length - 1];
  const pressurePsi = last?.pressurePsi ?? 0;
  if (last !== undefined && pressurePsi > 0) {
    // Use the temperature the beer *finishes* at, not the warmer end of a
    // ramp. Under a held pressure the beer re-equilibrates as the temperature
    // changes, so the end temperature is what it's at when the valve comes off.
    const tempC = last.endTempC ?? last.tempC;
    return { volumes: co2VolumesFromPressure(tempC, pressurePsi), tempC, pressurePsi };
  }

  return { volumes: residualCo2Volumes(peakTempC), tempC: peakTempC, pressurePsi: null };
}

/**
 * Supported priming sugars.
 *
 * @category Packaging
 * @group Inputs
 */
export type PrimingSugar =
  /** Dextrose monohydrate, which is what "corn sugar"/"priming sugar" is sold as. */
  | 'corn-sugar'
  /** Anhydrous dextrose/glucose. */
  | 'dextrose'
  /** Sucrose: table sugar, caster sugar. */
  | 'table-sugar'
  /** Dry malt extract. */
  | 'dme'
  /** Honey. */
  | 'honey'
  /** Turbinado / demerara. */
  | 'turbinado'
  /** Maple syrup. */
  | 'maple-syrup';

/**
 * Grams of CO₂ produced per gram of each priming sugar.
 *
 * From the stoichiometry of alcoholic fermentation, `C₆H₁₂O₆ → 2 C₂H₅OH + 2 CO₂`:
 *
 * - **Sucrose** (342.30 g/mol) hydrolyses and yields 4 CO₂ (176.04 g):
 *   176.04 / 342.30 = **0.5142**.
 * - **Anhydrous dextrose** (180.16) yields 2 CO₂ (88.02): **0.4886**.
 * - **Corn sugar** is dextrose *monohydrate* (198.17), so the same 88.02 g of
 *   CO₂ comes from a heavier gram: **0.4442**. This is why corn sugar doses run
 *   ~15 % higher than table sugar by mass.
 * - **DME** is ~95 % extract of which a priming yeast ferments ~80 %, mostly
 *   maltose (which yields sucrose's 0.5142 per gram of sugar):
 *   0.95 × 0.80 × 0.5142 = **0.3908**. Both figures are approximations, since
 *   DME fermentability varies by product.
 * - **Honey** is ~82 % fermentable monosaccharides: 0.82 × 0.4886 = **0.4007**.
 * - **Turbinado** is ~98 % sucrose: **0.5039**.
 * - **Maple syrup** is ~66 % sucrose: **0.3394**.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const PRIMING_SUGAR_CO2_YIELD: Readonly<Record<PrimingSugar, number>> = {
  'corn-sugar': 0.4442,
  dextrose: 0.4886,
  'table-sugar': 0.5142,
  dme: 0.3908,
  honey: 0.4007,
  turbinado: 0.5039,
  'maple-syrup': 0.3394,
};

/**
 * Human-readable names for the priming sugars.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const PRIMING_SUGAR_LABELS: Readonly<Record<PrimingSugar, string>> = {
  'corn-sugar': 'Corn sugar (dextrose monohydrate)',
  dextrose: 'Dextrose (anhydrous)',
  'table-sugar': 'Table sugar (sucrose)',
  dme: 'Dry malt extract',
  honey: 'Honey',
  turbinado: 'Turbinado / demerara',
  'maple-syrup': 'Maple syrup',
};

/**
 * Input to {@link primingSugar}.
 *
 * @category Packaging
 * @group Inputs
 */
export interface PrimingInput {
  /** Volume of beer being packaged, litres. */
  readonly beerVolumeL: Litres;
  /** Target carbonation, volumes of CO₂. */
  readonly targetVolumes: number;
  /** Highest temperature the beer reached at the end of fermentation, °C. */
  readonly fermentationTempC: Celsius;
  /**
   * Residual CO₂ already in the beer, volumes. When omitted, derived from
   * {@link fermentationTempC} via {@link residualCo2Volumes}. A blend passes
   * its predicted carbonation (temperature residual plus leftover extract)
   * here so the dose is not computed from temperature a second time.
   */
  readonly residualVolumes?: number;
  /** Which sugar. Defaults to corn sugar. */
  readonly sugar?: PrimingSugar;
}

/**
 * Result of {@link primingSugar}.
 *
 * @category Packaging
 * @group Results
 */
export interface PrimingResult {
  /** Sugar to add, grams. */
  readonly sugarGrams: number;
  /** Sugar to add, grams per litre. */
  readonly sugarGramsPerLitre: number;
  /** CO₂ that must be generated, grams. */
  readonly co2Grams: number;
  /** CO₂ already in solution, volumes. */
  readonly residualVolumes: number;
  /** Carbonation that still has to be created, volumes. */
  readonly volumesToAdd: number;
  /** The sugar the dose is for. */
  readonly sugar: PrimingSugar;
}

/**
 * Priming sugar for a target carbonation.
 *
 * ```
 * volumesToAdd = target − residual(fermentation temperature)
 * CO₂_g        = volumesToAdd × beerVolume_L × 1.96
 * sugar_g      = CO₂_g / yield(sugar)
 * ```
 *
 * A negative `volumesToAdd` (the beer already holds more CO₂ than the target)
 * clamps the dose to zero and is reported as such.
 *
 * ## There is no keg rate
 *
 * Homebrewing folklore says to prime a keg *below* the bottle rate. We don't:
 * 19 L in a Cornelius keg gets the same dose as the same 19 L in bottles.
 * This section explains why.
 *
 * **Published guidance.** *Brew Your Own*'s Mr. Wizard says to "use about
 * **75 %** of the priming sugar suggested in a recipe for bottle-conditioned
 * beer". Forum advice and kegging write-ups say **one half to two thirds**.
 * So the range is 0.50–0.75, which is a factor of 1.5 wide, and none of it is
 * derived.
 *
 * **The only attributable source doubts it.** The same Mr. Wizard answer that
 * gives the 75 % says: "I have never been able to find the original source of
 * this advice. Most of the explanations for this are vague."
 * <https://byo.com/mr-wizard/priming-when-keg/>
 *
 * **Headspace doesn't account for it.** The usual explanation is that some
 * of the CO₂ the sugar makes fills the keg's ullage and never dissolves. Nineteen litres at 2.4 volumes needs 2.4 × 19 × 1.96 = **89 g**
 * dissolved. A 19 L Cornelius keg filled with 19 L of beer leaves ~1 L of
 * headspace, which at the equilibrium ~1.8 bar absolute and 4 °C holds
 * `PV/RT` = 1.8e5 × 1e−3 / (8.314 × 277) ≈ 0.08 mol ≈ **3.5 g**. That's under
 * 4 % of the dose, while the rule of thumb withholds 25–50 %. The same beer in
 * fifty-three bottles has ~795 mL of headspace in total, which at 20 °C holds
 * ~2.6 g, so the two are within a gram of each other. Mr. Wizard does the
 * same calculation and reaches the same conclusion.
 *
 * **The stoichiometry is the same in either vessel.** `sugar → CO₂` is a mass
 * balance. Putting 89 g of CO₂ into 19 L of beer takes the sugar that makes
 * 89 g of CO₂, whether the beer is in one keg or fifty-three bottles.
 *
 * **Real losses, but not a coefficient.** A keg is pressurised to seat the lid
 * and then vented, often more than once to purge oxygen, and every vent loses
 * CO₂ the sugar made. Poppets and lid gaskets also leak a little over the
 * weeks of conditioning. Those losses are real, but they depend on the
 * brewer's routine and gaskets, not on kegs in general, and nobody has
 * measured them. That's why the published range is 50 % wide with no
 * derivation. A brewer who vents a lot can take a few grams off themselves;
 * we won't guess at a number the literature can't support.
 *
 * **The alternative.** Skip the sugar and spund at
 * {@link pressureFromCo2Volumes} for the target and the fermentation
 * temperature, so the pressure sets the carbonation directly. That's the
 * reliable way to avoid over-carbonating a keg.
 *
 * @category Packaging
 * @group Start here
 */
export function primingSugar(input: PrimingInput): PrimingResult {
  const sugar = input.sugar ?? 'corn-sugar';
  const residualVolumes = input.residualVolumes ?? residualCo2Volumes(input.fermentationTempC);
  const volumesToAdd = Math.max(0, input.targetVolumes - residualVolumes);
  const co2Grams = volumesToAdd * input.beerVolumeL * GRAMS_CO2_PER_VOLUME_PER_LITRE;
  const sugarGrams = co2Grams / PRIMING_SUGAR_CO2_YIELD[sugar];
  return {
    sugarGrams,
    sugarGramsPerLitre: input.beerVolumeL > 0 ? sugarGrams / input.beerVolumeL : 0,
    co2Grams,
    residualVolumes,
    volumesToAdd,
    sugar,
  };
}

/**
 * Carbonation a given dose of priming sugar produces. This is the inverse of
 * {@link primingSugar}, for "I have 100 g of corn sugar left, what will I get?".
 *
 * @category Packaging
 * @group Calculations
 */
export function carbonationFromPrimingSugar(input: {
  readonly beerVolumeL: Litres;
  readonly sugarGrams: number;
  readonly fermentationTempC: Celsius;
  readonly sugar?: PrimingSugar;
}): number {
  const sugar = input.sugar ?? 'corn-sugar';
  if (input.beerVolumeL <= 0) return 0;
  const co2Grams = input.sugarGrams * PRIMING_SUGAR_CO2_YIELD[sugar];
  const added = co2Grams / (input.beerVolumeL * GRAMS_CO2_PER_VOLUME_PER_LITRE);
  return residualCo2Volumes(input.fermentationTempC) + added;
}

/**
 * Volumes of CO₂ to grams per litre of beer.
 *
 * @category Packaging
 * @group Calculations
 */
export function co2VolumesToGramsPerLitre(volumes: number): number {
  return volumes * GRAMS_CO2_PER_VOLUME_PER_LITRE;
}

/**
 * Grams of CO₂ per litre of beer to volumes.
 *
 * @category Packaging
 * @group Calculations
 */
export function gramsPerLitreToCo2Volumes(gramsPerLitre: number): number {
  return gramsPerLitre / GRAMS_CO2_PER_VOLUME_PER_LITRE;
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/**
 * The priming dose with its breakdown.
 *
 * This wraps {@link primingSugar} so the dose comes with the arithmetic that
 * produced it and the sources behind it, instead of a bare number of grams.
 *
 * @category Packaging
 * @group Explanations
 */
export function primingSugarExplained(input: PrimingInput): Explanation {
  const result = primingSugar(input);
  const yieldPerGram = PRIMING_SUGAR_CO2_YIELD[result.sugar];
  return explain(result.sugarGrams, {
    label: 'Priming sugar',
    formula: 'priming-stoichiometric',
    expression: 'sugar_g = (target − residual) × beerVolume_L × 1.96 / CO₂ yield per gram of sugar',
    inputs: {
      beerVolumeL: round(input.beerVolumeL),
      targetVolumes: round(input.targetVolumes),
      fermentationTempC: round(input.fermentationTempC, 1),
      residualVolumes: round(result.residualVolumes),
      volumesToAdd: round(result.volumesToAdd),
      co2Grams: round(result.co2Grams, 1),
      sugar: result.sugar,
      co2GramsPerGramOfSugar: yieldPerGram,
      sugarGramsPerLitre: round(result.sugarGramsPerLitre),
    },
    unit: 'g',
    notes: [
      `Dosed as ${PRIMING_SUGAR_LABELS[result.sugar].toLowerCase()}, at ${yieldPerGram} g of CO₂ per gram.`,
      `Residual CO₂ is read at the warmest temperature the beer reached at or after the end of fermentation, not the current one.`,
      'A keg gets the same dose as a bottle. The folk reduction for kegs is not implemented, and the source that states it also disowns it.',
      ...(result.volumesToAdd === 0
        ? ['The beer already holds the target carbonation, so the dose is zero.']
        : []),
    ],
    family: 'carbonation',
    sources: [BRAUKAISER_CARBONATION, CO2_SOLUBILITY_TABLES, BYO_MR_WIZARD_KEG_PRIMING],
  });
}

/**
 * The regulator setting for a target carbonation at a serving temperature,
 * with its breakdown.
 *
 * @category Packaging
 * @group Explanations
 */
export function forcedCarbonationExplained(tempC: Celsius, targetVolumes: number): Explanation {
  const psi = pressureFromCo2Volumes(tempC, targetVolumes);
  return explain(psi, {
    label: 'Forced carbonation pressure',
    formula: 'henry-law-carbonation-tables',
    expression: 'V = (P + 14.695) × (0.01821 + 0.09011 e^(−(T−32)/43.11)) − 0.003342, solved for P',
    inputs: {
      tempC: round(tempC, 1),
      targetVolumes: round(targetVolumes),
      pressureBar: round(psiToBar(psi), 2),
      pressureKilopascals: round(psiToKilopascals(psi), 0),
      co2GramsPerLitre: round(co2VolumesToGramsPerLitre(targetVolumes), 1),
    },
    unit: 'psi',
    notes: [
      'PSI because that is how regulators are labeled; the same figure is given in bar and kPa above.',
      'Spunding to this pressure at the fermentation temperature reaches the target with no priming sugar at all.',
    ],
    family: 'carbonation',
    sources: [CO2_SOLUBILITY_TABLES, BRAUKAISER_CARBONATION],
  });
}
