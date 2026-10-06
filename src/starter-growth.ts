/**
 * Starter wort and Braukaiser's growth model: how much yeast a flask makes.
 *
 * ## Why this is its own module
 *
 * `starter.ts` is the starter calculator. It works out how many cells the
 * batch needs, how many are in the fridge, and what to build. For the pitch
 * side it calls `yeast.ts`, so there's one viability curve and one cell-count
 * target.
 *
 * `yeast.ts` also needs the growth model: a recipe's yeast row can carry a
 * saved starter, and `pitchPlan` has to grow it to count the cells that reach
 * the wort. Importing `starter.ts` from `yeast.ts` would create an import
 * cycle, which is why `DRY_SACHET_GRAMS_DEFAULT` is duplicated in `yeast.ts`.
 * Duplicating the growth model isn't an option, because two copies of the
 * same fit could drift apart.
 *
 * So the shared part sits below both. This module only depends on `types.ts`,
 * both `starter.ts` and `yeast.ts` import it, and Kai's four constants are
 * only implemented once.
 *
 * Everything here is per litre of starter, not per litre of beer: cells in
 * billions, extract in grams of DME, volumes in litres. A "growth rate" is
 * always new billion cells per gram of dry extract and an "inoculation rate"
 * is always billion cells pitched per gram of dry extract. Those are
 * Braukaiser's two axes, kept in his units so the transcribed numbers can be
 * checked against his chart. His own error bar on all of it is "+/- 15 % or
 * more", so nothing downstream should be shown with more precision than that.
 */

import type { Litres, SpecificGravity, StarterMethod } from './types';

// ---------------------------------------------------------------------------
// Starter wort
// ---------------------------------------------------------------------------

/**
 * Grams of dry malt extract per litre of starter wort: 100.
 *
 * The standard homebrew starter recipe is 10 : 1 water to DME by weight.
 * 100 g of DME into a kilo of water is 100/1100 = 9.1 °P, which is
 * {@link STARTER_GRAVITY}. Starter calculators default to this gravity, and
 * it's close to the ~10 °P (1.040) Kai ran his growth experiments at.
 *
 * Building a starter at a different gravity doesn't just rescale the model.
 * Kai tested it and found 5, 7 and 10 °P all plateau together, while 20 °P
 * grows visibly less yeast and lowers viability. So we plan at the gravity the
 * model was measured at and report the DME, and don't offer a gravity setting.
 *
 * ## Grams of DME versus grams of extract
 *
 * Braukaiser's axes are per gram of extract. Ours are per gram of DME, and we
 * treat the two as the same number. The published calculators don't agree on
 * the conversion either: Brewer's Friend works out 98.5 g of extract in a
 * litre at 1.037, Homebrew Dad 100.9 g. That's a 2.4 % spread, and our flat
 * 100 sits between them. Kai puts the error bar on his model at "+/- 15 % or
 * more", so the difference between 98.5, 100 and 100.9 is an order of
 * magnitude below the noise. What matters is using one convention
 * consistently, and 100 g/L is easy to weigh out.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const STARTER_DME_GRAMS_PER_LITRE = 100;

/**
 * The gravity {@link STARTER_DME_GRAMS_PER_LITRE} produces, as SG (9.1 °P).
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const STARTER_GRAVITY: SpecificGravity = 1.037;

/**
 * DME for a starter volume, grams.
 *
 * @category Yeast
 * @group Calculations
 */
export function starterDmeGrams(volumeL: Litres): number {
  return volumeL * STARTER_DME_GRAMS_PER_LITRE;
}

/**
 * The starter volume a quantity of DME makes at {@link STARTER_GRAVITY}, litres.
 *
 * @category Yeast
 * @group Calculations
 */
export function starterVolumeL(dmeGrams: number): Litres {
  return dmeGrams / STARTER_DME_GRAMS_PER_LITRE;
}

// ---------------------------------------------------------------------------
// Growth — Braukaiser's model
// ---------------------------------------------------------------------------

/**
 * Braukaiser's ceiling on growth from a stirred starter: 1.4 billion new cells
 * per gram of extract.
 *
 * The model is published as pseudo-code in Kai Troester, *Estimating yeast
 * growth*, Braukaiser, 3 November 2012,
 * <http://braukaiser.com/blog/blog/2012/11/03/estimating-yeast-growth/>, and
 * it consists of these four constants. He plots growth rate (new cells per
 * gram of dry extract) against inoculation rate (cells pitched per gram of
 * that extract). Below {@link GROWTH_PLATEAU_INOCULATION_RATE} the measured
 * growth rate is flat at 1.4 B/g, so a lightly pitched stirred starter makes
 * as much yeast as the extract can support, and pitching it thinner doesn't
 * get you more.
 *
 * This is why the model is useful: counting cells out of a stir-plate
 * starter, Kai got substantially more yeast than Mr Malty's older model
 * predicts, and got the same answer when he repeated the experiment.
 *
 * It only applies to stirred starters under foil. His NHC 2013 talk says so
 * ("For foil capped stirred starters only"),
 * <https://braukaiser.com/documents/Troester_NHC_2013_Step_Up_Your_Starter.pdf>.
 * See {@link UNSTIRRED_GROWTH_PER_GRAM} for the rest.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const MAX_GROWTH_PER_GRAM = 1.4;

/**
 * Where the stirred plateau ends: an inoculation rate of 1.4 B cells per gram.
 *
 * Below it, growth is {@link MAX_GROWTH_PER_GRAM}. At and above it the fit
 * takes over. Kai's pseudo-code puts the boundary at exactly 1.4
 * (`if (initial cells < 1.4) … if (initial cells between 1.4 and 3.5) …`),
 * and the two branches don't meet. The plateau's 1.400 drops to the fit's
 * 2.33 − 0.67 × 1.4 = 1.392 as soon as the rate reaches 1.4.
 *
 * That 0.008 B/g step is in the published model and in every implementation
 * of it, so we keep it instead of smoothing the corner. Matching Brewer's
 * Friend's numbers matters more than a 0.6 % discontinuity nobody can
 * measure.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const GROWTH_PLATEAU_INOCULATION_RATE = 1.4;

/**
 * The stirred model's declining limb, transcribed from Braukaiser's fit:
 *
 * ```
 * growth rate = 2.33 − 0.67 × inoculation rate       (1.4 ≤ rate ≤ 3.5)
 * ```
 *
 * These are Kai's own coefficients, and every implementation of "the
 * Braukaiser model" uses this form. Brewer's Friend's
 * `growthRateCurveBraukaiserStir` and Homebrew Dad's calculator
 * (<http://www.brewunited.com/yeast_calculator.php>) are both this line with a
 * clamp at zero.
 *
 * We copy the model as published. We don't smooth the corner at 1.4,
 * extrapolate past {@link GROWTH_CEASES_INOCULATION_RATE}, or interpolate
 * between the agitation modes, because Kai didn't publish any of those.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const GROWTH_DECLINE_INTERCEPT = 2.33;

/**
 * @see GROWTH_DECLINE_INTERCEPT
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const GROWTH_DECLINE_SLOPE = 0.67;

/**
 * Inoculation rate at which growth stops, for every method: 3.5 B cells per
 * gram of extract.
 *
 * Kai gives this round number for all three of his bands, and notes it's past
 * what anyone builds anyway: "I don't think that starters with more than
 * 3.5 Billion cells/g are practical."
 *
 * The stirred line's root is 2.33 / 0.67 = 3.4776, so between 3.4776 and 3.5
 * the fit is very slightly negative (−0.015 B/g at 3.5). We clamp it to zero
 * so it doesn't report cells dying. Past the cut-off the starter still
 * ferments, it just doesn't make yeast.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const GROWTH_CEASES_INOCULATION_RATE = 3.5;

/**
 * Growth rate for the two unstirred methods, in new billion cells per gram of
 * extract. These are flat across the whole 0–3.5 B/g range, and aren't a
 * fraction of the stirred curve.
 *
 * - **still**: 0.4 B/g. Kai's own figure, with his own caveat: "The 0.4 Billion
 *   new cells per gram proposed here is a rough guess based on the data points
 *   I have so far."
 * - **shaken**: 0.62 B/g. This is the weakest number in this module. It isn't
 *   in any Braukaiser text. It's Homebrew Dad's read-off of the unlabelled bar
 *   chart on slide 17 of the NHC 2013 deck (still / shaken / stirred, all under
 *   foil). We use it because it's the only published figure for the method,
 *   and brewers without a stir plate do shake. Treat it as an order of
 *   magnitude, not a measurement.
 *
 * This gap is the case for a stir plate. At any ordinary inoculation rate a
 * stirred starter sits on the 1.4 plateau and makes three and a half times
 * the yeast a still one does from the same DME.
 *
 * ## Why these are flat, and why the bands cross
 *
 * Held to 3.5, a flat 0.62 crosses the stirred fit at
 * (2.33 − 0.62) / 0.67 = 2.55 B/g, and 0.4 crosses it at 2.88. Above those
 * rates the model says an unstirred starter grows more yeast than a stirred
 * one.
 *
 * That isn't a transcription error, and we don't "fix" it. Kai
 * both states the flat range explicitly ("a growth rate of 0.4 Billion per gram
 * should be assumed over the full initial cell density range (0 – 3.5 B/g)")
 * and gives the mechanism for the shape: "This effect of dropping yeast yield
 * is not as pronounced for a non agitated culture … because in such a culture
 * not all yeast cells have the same access to wort nutrients due to
 * sedimentation." A stirred starter has every cell competing for the same
 * wort, so crowding has a bigger effect. He explicitly says the modes can't be
 * related by a scaling factor ("stirred and still starters are expected to
 * show different growth behavior that cannot be simply approximated by adding
 * a constant scaling factor"), which is why this is a `Record` of
 * measurements and not a multiplier on {@link MAX_GROWTH_PER_GRAM}.
 *
 * The crossing is above 2.5 B/g, which is a starter pitched roughly twice as
 * thick as anything {@link planStarter} will build. It's a quirk at the edge
 * of the model, not a reason to switch the stir plate off.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const UNSTIRRED_GROWTH_PER_GRAM: Readonly<Record<'shaken' | 'still', number>> = {
  shaken: 0.62,
  still: 0.4,
};

/**
 * Braukaiser's growth rate, in new billion cells per gram of extract, for an
 * inoculation rate in billion cells per gram of extract.
 *
 * ```
 * any method, rate > 3.5    → 0
 * stir-plate, rate < 1.4    → 1.4                        (the plateau)
 * stir-plate, 1.4 ≤ rate    → max(0, 2.33 − 0.67 × rate) (the fitted decline)
 * shaken                    → 0.62                       (flat)
 * still                     → 0.4                        (flat)
 * ```
 *
 * @see MAX_GROWTH_PER_GRAM for the stirred curve's source,
 * {@link UNSTIRRED_GROWTH_PER_GRAM} for the flat bands.
 *
 * @category Yeast
 * @group Calculations
 */
export function starterGrowthRate(
  inoculationRate: number,
  method: StarterMethod = 'stir-plate',
): number {
  if (!Number.isFinite(inoculationRate) || inoculationRate < 0) return 0;
  if (inoculationRate > GROWTH_CEASES_INOCULATION_RATE) return 0;
  if (method !== 'stir-plate') return UNSTIRRED_GROWTH_PER_GRAM[method];
  if (inoculationRate < GROWTH_PLATEAU_INOCULATION_RATE) return MAX_GROWTH_PER_GRAM;
  return Math.max(0, GROWTH_DECLINE_INTERCEPT - GROWTH_DECLINE_SLOPE * inoculationRate);
}

/**
 * What one starter step does.
 *
 * @category Yeast
 * @group Results
 */
export interface StarterYield {
  /** Cells pitched into this step, billion. */
  readonly pitchedCellsBillion: number;
  /** Dry malt extract, grams. */
  readonly dmeGrams: number;
  /** Starter volume at {@link STARTER_GRAVITY}, litres. */
  readonly volumeL: Litres;
  /** Cells pitched per gram of extract (Braukaiser's x-axis). */
  readonly inoculationRate: number;
  /** New cells per gram of extract (Braukaiser's y-axis) for this agitation method. */
  readonly growthRate: number;
  /** Cells the step makes, billion. */
  readonly newCellsBillion: number;
  /** Cells at the end of the step, billion: pitched plus new. */
  readonly finalCellsBillion: number;
  /** The agitation this step was grown with. */
  readonly method: StarterMethod;
}

/**
 * Grow a pitch in a starter.
 *
 * ```
 * inoculation = cells / DME
 * new cells   = growthRate(inoculation, method) × DME
 * final       = cells + new
 * ```
 *
 * Cells are never lost here. The model's floor is zero growth, so a starter
 * pitched too thick returns what went in. The cells are still alive, they
 * just had nothing to eat.
 *
 * @category Yeast
 * @group Calculations
 */
export function starterGrowth(
  initialCellsBillion: number,
  dmeGrams: number,
  method: StarterMethod = 'stir-plate',
): StarterYield {
  const cells = Math.max(0, initialCellsBillion);
  const dme = Math.max(0, dmeGrams);
  const inoculationRate = dme > 0 ? cells / dme : Number.POSITIVE_INFINITY;
  const growthRate = dme > 0 ? starterGrowthRate(inoculationRate, method) : 0;
  const newCellsBillion = growthRate * dme;
  return {
    pitchedCellsBillion: cells,
    dmeGrams: dme,
    volumeL: starterVolumeL(dme),
    inoculationRate,
    growthRate,
    newCellsBillion,
    finalCellsBillion: cells + newCellsBillion,
    method,
  };
}
