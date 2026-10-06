/**
 * Kettle pH: how much acid it takes to move the wort in the kettle, and how
 * much the brewer's own kettle has taken in past brews.
 *
 * ## Why this is separate from `mashPh`
 *
 * Mash pH is predictable. The grist is weighed, the water is analysed, and the
 * charge balance in `./mashPh` has every term it needs before dough-in. Kettle
 * pH isn't. The wort in the boil has left most of the grain behind, carries
 * whatever the lauter rinsed out, and has a pH that depends on how the
 * runnings went. A kettle dose predicted from the recipe alone would be a
 * guess.
 *
 * So this works from a measurement. The brewer reads a meter, and the dose is
 * solved from that reading against a buffering figure. The figure starts as a
 * model estimate ({@link estimateKettleBufferingMEqPerPh}) and is replaced by
 * the brewer's own kettle once two brews have measured it
 * ({@link observedKettleBuffering}, {@link kettleBufferingEstimate}).
 *
 * ## Acid chemistry comes from `mashPh`
 *
 * This module doesn't compute acid strength itself. {@link acidStrengthMEqPerUnit}
 * and {@link ACID_DEFINITIONS} do that, evaluated at the pH the dose ends at,
 * which is the same protonation convention `solveAdditionsForTargetPh` and
 * `acidifyWater` use. This module only handles buffering and volume.
 *
 * ## Sources
 *
 * - Troester, K., "Understanding Mash pH" (braukaiser.com), for the buffering
 *   capacity used in the grist term.
 * - Palmer & Kaminski, *Water* (2013), for kettle pH 5.0–5.2 as the useful band
 *   and the reasons for it: hot break, bitterness quality and colour.
 */

import {
  ACID_DEFINITIONS,
  acidStrengthMEqPerUnit,
  carbonateProtonsDonated,
  totalCarbonateMMolPerLitre,
} from './mashPh';
import type { AcidId, Litres, Percent, WaterProfile } from './types';
import { alkalinityMEqPerLitre } from './water';

/**
 * The kettle pH target when a recipe doesn't set one.
 *
 * 5.1 at room temperature is the middle of the 5.0–5.2 band Palmer & Kaminski
 * give for the boil. It's low enough for a firm hot break and clean
 * bitterness, and high enough that the beer doesn't finish sharp.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_KETTLE_TARGET_PH = 5.1;

// ---------------------------------------------------------------------------
// Buffering, estimated from the mash model
// ---------------------------------------------------------------------------

/**
 * Buffering from one litre of water at `ph`, in mEq per pH unit.
 *
 * This isn't a derivative. It's the alkalinity a litre gives up going down one
 * whole pH unit from `ph`, which is what "mEq per pH unit" means taken
 * literally. {@link totalCarbonateMMolPerLitre} back-calculates the carbonate
 * from the measured alkalinity at the water's own pH, so the same speciation
 * correction `acidifyWater` applies to a sparge dose applies here.
 *
 * The figure is small. A 90 ppm bicarbonate water gives about 0.066 mEq/pH per
 * litre near pH 5.4, compared with ~40 mEq/pH per kilogram for a pale grist.
 * We include it because it's cheap and correct, even though it barely changes
 * the answer.
 *
 * @param profile - The water, after dilution and salts.
 * @param ph - The pH the slope is taken at.
 * @param waterPh - The water's own pH, for the carbonate back-calculation.
 *   Defaults to the profile's, then to 7.5.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function waterBufferingMEqPerPhPerLitre(
  profile: WaterProfile,
  ph: number,
  waterPh?: number,
): number {
  const sourcePh = waterPh ?? profile.ph ?? 7.5;
  const totalCarbonate = totalCarbonateMMolPerLitre(alkalinityMEqPerLitre(profile), sourcePh);
  if (totalCarbonate <= 0) return 0;
  const titrated = totalCarbonate * (carbonateProtonsDonated(ph) - carbonateProtonsDonated(ph - 1));
  return Math.max(0, titrated);
}

/**
 * What {@link estimateKettleBufferingMEqPerPh} needs to know about a brew.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface KettleBufferingInput {
  /**
   * The grist's buffering in mEq per pH unit, from `MashPhResult.totalBufferingMEqPerPh`.
   */
  readonly gristBufferingMEqPerPh: number;
  /** Mash water, after dilution and salts. */
  readonly mashProfile: WaterProfile;
  /** Mash water volume, litres. */
  readonly mashVolumeL: Litres;
  /** Sparge water, after dilution and salts. */
  readonly spargeProfile: WaterProfile;
  /** Sparge water volume, litres. `0` for a no-sparge or BIAB mash. */
  readonly spargeVolumeL: Litres;
  /** The pH the water's own buffering slope is taken at. Defaults to the mash's band, 5.4. */
  readonly ph?: number;
}

/** The pH the water term is evaluated at when the caller doesn't give one. */
const DEFAULT_BUFFERING_PH = 5.4;

/**
 * Buffering of the whole liquor, in mEq per pH unit per litre of liquor.
 *
 * ## The assumption
 *
 * We add the grist's titration buffering to the water's alkalinity and treat
 * the total as spread evenly through all the liquor (mash water plus sparge
 * water), so whatever share of the liquor reaches the kettle carries the same
 * share of the buffering. It's a first estimate, and it's off in ways a recipe
 * can't predict. The grain isn't in the kettle, what the lauter rinsed out
 * doesn't follow the grist's titration curve, and a slow sparge and a fast one
 * don't extract the same buffering from the same grain bill.
 *
 * It's meant as a starting number. Once two brew days have a pH reading before
 * and after the kettle dose, the brewer's own figure replaces it
 * ({@link kettleBufferingEstimate}). Until then this is the best estimate
 * available, and {@link KettleBufferingEstimate.basis} records which of the two
 * is in use.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function kettleBufferingPerLitreMEqPerPh(input: KettleBufferingInput): number {
  const totalLiquorL = input.mashVolumeL + input.spargeVolumeL;
  if (!(totalLiquorL > 0)) return 0;
  const ph = input.ph ?? DEFAULT_BUFFERING_PH;
  const liquor =
    input.gristBufferingMEqPerPh +
    waterBufferingMEqPerPhPerLitre(input.mashProfile, ph) * input.mashVolumeL +
    waterBufferingMEqPerPhPerLitre(input.spargeProfile, ph) * input.spargeVolumeL;
  return liquor / totalLiquorL;
}

/**
 * The kettle's buffering at a measured pre-boil volume, in mEq per pH unit.
 *
 * `perLitre × preBoilVolumeL`, with the per-litre figure and its assumption in
 * {@link kettleBufferingPerLitreMEqPerPh}. It's linear in the volume so the
 * recipe calculation can publish one per-litre number, and on brew day it can
 * be scaled by whatever volume the sight glass shows.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function estimateKettleBufferingMEqPerPh(
  input: KettleBufferingInput & { readonly preBoilVolumeL: Litres },
): number {
  return kettleBufferingPerLitreMEqPerPh(input) * Math.max(0, input.preBoilVolumeL);
}

// ---------------------------------------------------------------------------
// The dose
// ---------------------------------------------------------------------------

/**
 * Result of {@link kettleAcidDose}.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface KettleAcidDoseResult {
  /** Acid needed, mEq. Zero when none is. */
  readonly milliequivalents: number;
  /** Amount to add, in {@link unit}. Zero when none is needed. */
  readonly amount: number;
  /** `'mL'` for a liquid acid, `'g'` for one sold as a solid. */
  readonly unit: 'mL' | 'g';
  /** True when the wort is already at or under the target and nothing should go in. */
  readonly noAcidNeeded: boolean;
}

/**
 * Acid to bring a measured kettle pH down to a target.
 *
 * ```
 * mEq    = buffering × (measured − target)
 * amount = mEq / strength(acid, at the target pH)
 * ```
 *
 * The acid's strength is evaluated at the target pH and not at the reading,
 * because the equivalents a polyprotic acid delivers depend on the pH it ends
 * at, which is the target. `acidifyWater` uses the same convention for the
 * sparge, and `solveAdditionsForTargetPh` gets there from the other direction
 * by re-predicting the mash pH at each trial dose until it hits the target.
 *
 * Wort at or under the target returns a zero dose with `noAcidNeeded` set. A
 * negative amount would mean taking acid out of the kettle.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function kettleAcidDose(input: {
  /** The kettle's buffering, mEq per pH unit. */
  readonly bufferingMEqPerPh: number;
  /** The meter reading, pH. */
  readonly measuredPh: number;
  /** The target, pH. */
  readonly targetPh: number;
  readonly acid: AcidId;
  /** Strength, % w/w. Defaults to the acid's own default. */
  readonly concentrationPercent?: Percent;
}): KettleAcidDoseResult {
  const unit: 'mL' | 'g' = ACID_DEFINITIONS[input.acid].usuallySolid ? 'g' : 'mL';
  const drop = input.measuredPh - input.targetPh;
  if (!(drop > 0) || !(input.bufferingMEqPerPh > 0)) {
    return { milliequivalents: 0, amount: 0, unit, noAcidNeeded: !(drop > 0) };
  }
  const milliequivalents = input.bufferingMEqPerPh * drop;
  const perUnit = acidStrengthMEqPerUnit(input.acid, input.targetPh, input.concentrationPercent);
  return {
    milliequivalents,
    amount: perUnit > 0 ? milliequivalents / perUnit : 0,
    unit,
    noAcidNeeded: false,
  };
}

// ---------------------------------------------------------------------------
// Calibration from the brewer's own kettle readings
// ---------------------------------------------------------------------------

/**
 * The buffering measured on one brew day, mEq per pH unit, or `null`.
 *
 * ```
 * buffering = amount × strength(acid, at the pH it landed on) / (before − after)
 * ```
 *
 * Returns `null` when the reading after the dose isn't below the reading
 * before it, or when nothing was added. In both cases there's no measurement.
 * It isn't a measurement of zero. A meter that reads the same number twice
 * means the dose was too small to see, not that the wort has no buffering, and
 * a zero in the median would pull every later dose toward nothing.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function observedKettleBuffering(input: {
  /** pH before the dose went in. */
  readonly phBefore: number;
  /** pH after it was stirred through. */
  readonly phAfter: number;
  readonly acid: AcidId;
  /** Strength, % w/w. Defaults to the acid's own default. */
  readonly concentrationPercent?: Percent;
  /** How much went in, mL for a liquid acid and g for a solid. */
  readonly amount: number;
}): number | null {
  const drop = input.phBefore - input.phAfter;
  if (!(drop > 0) || !(input.amount > 0)) return null;
  const milliequivalents =
    input.amount * acidStrengthMEqPerUnit(input.acid, input.phAfter, input.concentrationPercent);
  if (!(milliequivalents > 0)) return null;
  return milliequivalents / drop;
}

/**
 * Where a buffering figure came from.
 *
 * @category Water and mash pH
 * @group Results
 */
export type KettleBufferingBasis =
  /** The median of the brewer's own before/after readings. */
  | 'observed'
  /** {@link estimateKettleBufferingMEqPerPh}, used until there are two readings. */
  | 'model';

/**
 * A buffering figure to dose against, and where it came from.
 *
 * @see kettleBufferingEstimate
 *
 * @category Water and mash pH
 * @group Results
 */
export interface KettleBufferingEstimate {
  /** The figure to dose against, mEq per pH unit. */
  readonly bufferingMEqPerPh: number;
  /** Whether the figure came from the brewer's readings or from the model. */
  readonly basis: KettleBufferingBasis;
  /** How many usable past readings there are. Under `'model'` this is 0 or 1. */
  readonly observationCount: number;
}

/**
 * The buffering to dose against. This is the median of the brewer's own
 * readings once there are two, and the model estimate until then.
 *
 * We use the median because brew-day mistakes tend to be large and
 * one-sided: a meter left in the wort while it heated, a dose only half
 * stirred in, a reading taken before the acid had mixed. Any of those gives a
 * figure far from the true one, and a mean would carry it into the next
 * brew's dose. One reading on its own can't be told apart from a good one, so
 * we wait for a second before using either.
 *
 * @param observations - Past brews' {@link observedKettleBuffering} values,
 *   `null`s already dropped.
 * @param modelEstimate - {@link estimateKettleBufferingMEqPerPh} for this brew.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function kettleBufferingEstimate(
  observations: readonly number[],
  modelEstimate: number,
): KettleBufferingEstimate {
  const usable = observations.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length < 2) {
    return { bufferingMEqPerPh: modelEstimate, basis: 'model', observationCount: usable.length };
  }
  return {
    bufferingMEqPerPh: median(usable),
    basis: 'observed',
    observationCount: usable.length,
  };
}

/**
 * Median of a non-empty list. With an even count it's the mean of the middle
 * two.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const upper = sorted[middle] ?? 0;
  const lower = sorted[sorted.length % 2 === 1 ? middle : middle - 1] ?? 0;
  return (lower + upper) / 2;
}
