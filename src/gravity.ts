/**
 * Gravity, extract and efficiency.
 *
 * Internally the engine measures extract in point·litres: the mass of
 * dissolved extract expressed as "gravity points × litres of wort". It adds up
 * across additions and divides straight into a volume to give a gravity, so
 * the whole waterfall is bookkeeping:
 *
 * ```
 * pointLitres = kg × pointsPerKgPerL × efficiency
 * SG          = 1 + (Σ pointLitres) / volumeL / 1000
 * ```
 */

import {
  DEFAULT_MOISTURE_PERCENT_BY_CLASS,
  MASH_SACCHARIFICATION_MAX_C,
  MASH_SACCHARIFICATION_MIN_C,
  MASH_TEMP_ATTENUATION_MAX_SHIFT,
  MASH_TEMP_ATTENUATION_POINTS_PER_C,
  MASH_TEMP_ATTENUATION_REFERENCE_C,
  MAX_SUCROSE_PPG,
  POINTS_PER_KG_PER_L_PER_PPG,
  resolveCalculationOptions,
} from './defaults';
import type {
  CalculationOptions,
  Celsius,
  FermentableAddition,
  FermentableClass,
  FermentableUse,
  Kilograms,
  Litres,
  MashStep,
  Percent,
  Plato,
  SpecificGravity,
  YeastSelection,
} from './types';
import { gravityPointsToSg, sgToGravityPoints, sgToPlato } from './units/gravity';

// ---------------------------------------------------------------------------
// Plato ⇄ SG, exactly invertible
// ---------------------------------------------------------------------------

/**
 * Exact numerical inverse of {@link sgToPlato} (the ASBC cubic).
 *
 * `platoToSg` in `units/gravity` is a different published approximation, so
 * the two aren't exact inverses and a round trip through them loses ~0.05 °P.
 * Attenuation is defined on extract (°P), and predicting FG then reading the
 * attenuation back off it has to round-trip exactly. So this is a
 * Newton–Raphson inversion of the same cubic. It converges to ~1e-12 SG in
 * three iterations.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function platoToSgExact(plato: Plato): SpecificGravity {
  let sg = 1 + plato / 258.6; // starting guess, close enough for two-digit Plato
  for (let i = 0; i < 12; i += 1) {
    const f = sgToPlato(sg) - plato;
    const df = 1111.14 - 2 * 630.272 * sg + 3 * 135.997 * sg ** 2;
    const step = f / df;
    sg -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return sg;
}

// ---------------------------------------------------------------------------
// Per-fermentable yield
// ---------------------------------------------------------------------------

/**
 * Yield of a fermentable in points per pound per US gallon, as-is.
 *
 * Uses `ppg` when the addition has one (a user override, or a catalog that
 * publishes PPG directly). Otherwise it converts the maltster's fine-grind
 * dry-basis extract figure:
 *
 * ```
 * PPG = ((FGDB% − fine/coarse difference%) / 100) × (1 − moisture% / 100) × 46.214
 * ```
 *
 * The moisture term converts a dry-basis figure to the as-is grain the brewer
 * weighs out. 46.214 is the yield of pure sucrose (Palmer, *How to Brew*).
 *
 * @throws if the addition has neither `ppg` nor an extract percentage.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function fermentablePpg(
  fermentable: FermentableAddition,
  options: CalculationOptions = {},
): number {
  if (fermentable.ppg !== undefined) return fermentable.ppg;
  const fgdb = fermentable.extractFineGrindDryBasisPercent;
  if (fgdb === undefined) {
    throw new TypeError(
      `Fermentable "${fermentable.name}" has neither ppg nor extractFineGrindDryBasisPercent; ` +
        'one of the two is required to compute yield.',
    );
  }
  const maxPpg = options.maxSucrosePpg ?? MAX_SUCROSE_PPG;
  const moisture =
    fermentable.moisturePercent ?? DEFAULT_MOISTURE_PERCENT_BY_CLASS[fermentable.class];
  const coarse = fgdb - (fermentable.fineCoarseDifferencePercent ?? 0);
  return (coarse / 100) * (1 - moisture / 100) * maxPpg;
}

/**
 * Yield of a fermentable in the engine's canonical unit, gravity points per
 * kilogram per litre: `PPG × 8.345404` (see `POINTS_PER_KG_PER_L_PER_PPG`).
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function fermentablePointsPerKgPerL(
  fermentable: FermentableAddition,
  options: CalculationOptions = {},
): number {
  return fermentablePpg(fermentable, options) * POINTS_PER_KG_PER_L_PER_PPG;
}

/**
 * One row of a grist expressed as shares: what it is, and how much of the bill.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface GristShare {
  /** This row's share of the total bill, in percent. The shares don't have to sum to 100. */
  readonly percentOfGrist: Percent;
  /** The fermentable for this row. Its `amountKg` is ignored, because the share replaces it. */
  readonly fermentable: FermentableAddition;
}

/**
 * The total grist mass that puts a bill of shares on a target OG, or `null`.
 *
 * This is the inverse of the waterfall at the top of this file. Each addition
 * contributes `kg × pointsPerKgPerL × efficiency`, and with fixed shares every
 * `kg` is the same multiple of the total, so the gravity is proportional to the
 * total mass and the answer is a single division:
 *
 * ```
 * blended = Σ (share_i / 100) × pointsPerKgPerL_i × efficiency_i
 * gristKg = (targetOg − 1) × 1000 × postBoilVolumeL / blended
 * ```
 *
 * The result is exact because nothing in the forward calculation adds a term
 * that doesn't scale with mass. Efficiency is a per-class constant
 * ({@link fermentableEfficiencyFraction} reads `class` and `use`, never a
 * mass). When designing forward, the post-boil volume comes from the target
 * batch size and the equipment's losses. Grain absorption changes the water
 * required, not the volume in the kettle (`volumes.ts`). `gravity.test.ts`
 * checks this by sizing a grist and reading the target back out of
 * {@link predictGravities}.
 *
 * ## Why this isn't `sugarToTargetGravity`
 *
 * `sugarToTargetGravity` answers the brew-day question ("my gravity is low,
 * how much DME?") and returns 0 when the deficit isn't positive, because you
 * can't take sugar back out of a kettle. When you're designing a recipe, the
 * most common reason to set a target is that the bill overshoots, so this
 * function has to size down as well as up.
 *
 * `null` covers every grist that no mass can satisfy: nothing in it has
 * extract, every share is zero, the volume isn't positive, or the target is at
 * or below water. These are states a half-entered bill passes through, so we
 * return `null` and let the caller decide what to show, instead of throwing.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function gristKgForTargetOg(
  grist: readonly GristShare[],
  postBoilVolumeL: Litres,
  mashEfficiencyPercent: Percent,
  targetOg: SpecificGravity,
  options: CalculationOptions = {},
): number | null {
  if (!Number.isFinite(postBoilVolumeL) || postBoilVolumeL <= 0) return null;
  const targetPoints = sgToGravityPoints(targetOg);
  if (!Number.isFinite(targetPoints) || targetPoints <= 0) return null;

  let blended = 0;
  for (const row of grist) {
    if (!Number.isFinite(row.percentOfGrist) || row.percentOfGrist <= 0) continue;
    blended +=
      (row.percentOfGrist / 100) *
      fermentablePointsPerKgPerL(row.fermentable, options) *
      fermentableEfficiencyFraction(row.fermentable, mashEfficiencyPercent, options);
  }
  if (blended <= 0) return null;

  return (targetPoints * postBoilVolumeL) / blended;
}

/**
 * The efficiency that applies to one addition, as a fraction (0–1).
 *
 * - Extract, sugar and non-fermentables dissolve completely: 1.0, whatever
 *   their `use` says, because there is nothing to convert or lauter.
 * - Grain in the mash: the profile's mash efficiency.
 * - Anything steeped (or grain tossed into the kettle): the partial steep
 *   efficiency, 50 % by default.
 * - Grain added to the whirlpool or fermenter cannot contribute extract: 0.
 *
 * The parameter is just `{ class, use }`, like {@link isMashGrain} below,
 * because those two fields decide which efficiency applies. Callers holding
 * something other than a full {@link FermentableAddition} (a recipe document
 * row, say) can call this instead of copying the switch.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function fermentableEfficiencyFraction(
  fermentable: {
    readonly class: FermentableClass;
    readonly use: FermentableUse;
  },
  mashEfficiencyPercent: Percent,
  options: CalculationOptions = {},
): number {
  const steep = (options.steepEfficiencyPercent ?? 50) / 100;
  switch (fermentable.class) {
    case 'dry-extract':
    case 'liquid-extract':
    case 'sugar':
    case 'non-fermentable':
      return 1;
    case 'grain':
      if (fermentable.use === 'mash') return mashEfficiencyPercent / 100;
      if (fermentable.use === 'steep' || fermentable.use === 'boil') return steep;
      return 0;
    case 'steeping-grain':
      if (fermentable.use === 'mash') return mashEfficiencyPercent / 100;
      if (fermentable.use === 'steep' || fermentable.use === 'boil') return steep;
      return 0;
    default:
      return 0;
  }
}

/**
 * Theoretical maximum extract of an addition, in point·litres
 * (at 100 % efficiency).
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function fermentableMaxPointLitres(
  fermentable: FermentableAddition,
  options: CalculationOptions = {},
): number {
  return fermentable.amountKg * fermentablePointsPerKgPerL(fermentable, options);
}

/**
 * Extract an addition delivers after efficiency, in point·litres.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function fermentablePointLitres(
  fermentable: FermentableAddition,
  mashEfficiencyPercent: Percent,
  options: CalculationOptions = {},
): number {
  return (
    fermentableMaxPointLitres(fermentable, options) *
    fermentableEfficiencyFraction(fermentable, mashEfficiencyPercent, options)
  );
}

/**
 * Total mass of all fermentables in kg. This is the denominator for "% of grist".
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function totalGristMass(fermentables: readonly FermentableAddition[]): Kilograms {
  return fermentables.reduce((sum, f) => sum + f.amountKg, 0);
}

/**
 * Grain (or steeping grain) that sits in the mash tun: milled, doughed in and
 * heated. Extract and sugars are excluded even if they're stirred into the
 * mash, because they don't absorb water or buffer pH.
 *
 * Acidulated malt counts as grain. It isn't a water acid, and it goes in the
 * mill bill with the rest of the grist.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function isMashGrain(fermentable: {
  readonly class: FermentableClass;
  readonly use: FermentableUse;
}): boolean {
  return (
    (fermentable.class === 'grain' || fermentable.class === 'steeping-grain') &&
    (fermentable.use === 'mash' || fermentable.use === 'steep')
  );
}

/**
 * Mass of grain in the mash tun, in kg. This is what absorbs water and what the
 * strike-temperature calculation heats.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function mashGrainMass(fermentables: readonly FermentableAddition[]): Kilograms {
  return fermentables.filter(isMashGrain).reduce((sum, f) => sum + f.amountKg, 0);
}

/**
 * Which stage of the waterfall an addition's extract first appears in.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function fermentableStage(
  fermentable: FermentableAddition,
): 'pre-boil' | 'boil' | 'fermenter' {
  switch (fermentable.use) {
    case 'mash':
    case 'steep':
      return 'pre-boil';
    case 'boil':
    case 'whirlpool':
      return 'boil';
    case 'fermenter':
      return 'fermenter';
    default:
      return 'boil';
  }
}

// ---------------------------------------------------------------------------
// Gravity prediction
// ---------------------------------------------------------------------------

/**
 * The volumes the gravity waterfall needs. All litres.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface GravityVolumes {
  /** Wort volume at the start of the boil, hot. */
  readonly preBoilVolumeL: Litres;
  /** Wort volume at the end of the boil, corrected to 20 °C. */
  readonly postBoilVolumeL: Litres;
  /** Chilled wort transferred into the fermenter. */
  readonly volumeIntoFermenterL: Litres;
}

/**
 * Input to {@link predictGravities}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface GravityPredictionInput {
  /** The grist and any sugars or extracts. */
  readonly fermentables: readonly FermentableAddition[];
  /** Wort volumes at each point the gravity is predicted. */
  readonly volumes: GravityVolumes;
  /** Mash efficiency, %. */
  readonly mashEfficiencyPercent: Percent;
  /** Calculation options. Defaults apply to anything left out. */
  readonly options?: CalculationOptions;
}

/**
 * Everything the gravity waterfall produces.
 *
 * @category Gravity and ABV
 * @group Results
 */
export interface GravityPrediction {
  /** Gravity of the wort as the boil starts. */
  readonly preBoilGravity: SpecificGravity;
  /** Gravity at the end of the boil, corrected to 20 °C. Equal to {@link og}. */
  readonly postBoilGravity: SpecificGravity;
  /** Original gravity, what a hydrometer reads on the wort going into the fermenter. */
  readonly og: SpecificGravity;
  /**
   * OG-equivalent: the gravity the wort would have had if every later sugar
   * addition (fermenter honey, dextrose at high krausen) had gone in the kettle.
   * ABV has to be computed from this figure.
   */
  readonly ogEquivalent: SpecificGravity;
  /** Theoretical maximum extract of the whole grist, point·litres. */
  readonly maxPointLitres: number;
  /** Extract in the kettle at the start of the boil, point·litres. */
  readonly preBoilPointLitres: number;
  /** Extract in the kettle at the end of the boil, point·litres. */
  readonly postBoilPointLitres: number;
  /** Extract including fermenter additions, point·litres. */
  readonly totalPointLitres: number;
  /** Mash efficiency that was applied, %. */
  readonly mashEfficiencyPercent: Percent;
  /**
   * Brewhouse efficiency, %: extract that reaches the fermenter as a fraction
   * of the grist's theoretical maximum. It's always ≤ mash efficiency. The gap
   * is kettle deadspace, hop absorption and chiller loss.
   */
  readonly brewhouseEfficiencyPercent: Percent;
}

/**
 * Predict the gravity waterfall from a grist, an efficiency and the volumes.
 *
 * Extract is tracked in point·litres and divided by the wort volume at each
 * point. Sugars added in the fermenter go into
 * {@link GravityPrediction.ogEquivalent} and not the measured OG, because a
 * hydrometer at pitching can't see them.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function predictGravities(input: GravityPredictionInput): GravityPrediction {
  const { fermentables, volumes, mashEfficiencyPercent } = input;
  const options = input.options ?? {};

  let maxPointLitres = 0;
  let preBoilPointLitres = 0;
  let boilPointLitres = 0;
  let fermenterPointLitres = 0;

  for (const f of fermentables) {
    maxPointLitres += fermentableMaxPointLitres(f, options);
    const delivered = fermentablePointLitres(f, mashEfficiencyPercent, options);
    switch (fermentableStage(f)) {
      case 'pre-boil':
        preBoilPointLitres += delivered;
        break;
      case 'boil':
        boilPointLitres += delivered;
        break;
      case 'fermenter':
        fermenterPointLitres += delivered;
        break;
      default:
        break;
    }
  }

  const postBoilPointLitres = preBoilPointLitres + boilPointLitres;
  const totalPointLitres = postBoilPointLitres + fermenterPointLitres;

  const preBoilGravity = gravityPointsToSg(safeDivide(preBoilPointLitres, volumes.preBoilVolumeL));
  const postBoilGravity = gravityPointsToSg(
    safeDivide(postBoilPointLitres, volumes.postBoilVolumeL),
  );
  // Losses between the kettle and the fermenter remove wort, not concentration,
  // so the gravity into the fermenter equals the post-boil gravity.
  const og = postBoilGravity;
  const ogEquivalent = gravityPointsToSg(
    sgToGravityPoints(og) + safeDivide(fermenterPointLitres, volumes.volumeIntoFermenterL),
  );

  const extractIntoFermenter =
    sgToGravityPoints(og) * volumes.volumeIntoFermenterL + fermenterPointLitres;
  const brewhouseEfficiencyPercent =
    maxPointLitres > 0 ? (extractIntoFermenter / maxPointLitres) * 100 : 0;

  return {
    preBoilGravity,
    postBoilGravity,
    og,
    ogEquivalent,
    maxPointLitres,
    preBoilPointLitres,
    postBoilPointLitres,
    totalPointLitres,
    mashEfficiencyPercent,
    brewhouseEfficiencyPercent,
  };
}

function safeDivide(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

// ---------------------------------------------------------------------------
// Efficiency, back-computed from actuals
// ---------------------------------------------------------------------------

/**
 * Input to {@link mashEfficiencyFromMeasurement}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface MeasuredEfficiencyInput {
  /** The grist and any sugars or extracts the measured wort contains. */
  readonly fermentables: readonly FermentableAddition[];
  /** Measured gravity, SG. */
  readonly measuredGravity: SpecificGravity;
  /** Volume the measurement corresponds to, litres. */
  readonly measuredVolumeL: Litres;
  /**
   * Which point the sample was taken at. `pre-boil` and `post-boil` samples see
   * different subsets of the grist, so the stage matters.
   */
  readonly stage?: 'pre-boil' | 'post-boil' | 'fermenter';
  /** Calculation options. Defaults apply to anything left out. */
  readonly options?: CalculationOptions;
}

/**
 * Back-compute mash efficiency from a measured gravity and volume. This is the
 * exact inverse of {@link predictGravities}.
 *
 * Additions that mash efficiency doesn't apply to (extract, sugar, lactose)
 * are subtracted first at their own fixed efficiency. What's left is divided
 * by the theoretical maximum of the mashed grain.
 *
 * ```
 * mashEff% = 100 × (measuredPoints × volume − Σ fixed-efficiency point·litres)
 *                  / Σ mashable theoretical point·litres
 * ```
 *
 * Returns `NaN` when the grist has nothing that mash efficiency applies to. An
 * all-extract recipe has no mash efficiency, and reporting 0 % would claim a
 * value that doesn't exist. Callers should show it as "—".
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function mashEfficiencyFromMeasurement(input: MeasuredEfficiencyInput): Percent {
  const options = input.options ?? {};
  const stage = input.stage ?? 'post-boil';
  const measuredPointLitres = sgToGravityPoints(input.measuredGravity) * input.measuredVolumeL;

  let fixedPointLitres = 0;
  let mashablePointLitres = 0;
  for (const f of input.fermentables) {
    if (!stageIsVisibleAt(fermentableStage(f), stage)) continue;
    // To tell whether an addition depends on mash efficiency, run the helper at
    // two efficiencies and see whether the answer changes.
    const atFull = fermentableEfficiencyFraction(f, 100, options);
    const atHalf = fermentableEfficiencyFraction(f, 50, options);
    const max = fermentableMaxPointLitres(f, options);
    if (atFull === atHalf) {
      fixedPointLitres += max * atFull;
    } else {
      mashablePointLitres += max;
    }
  }

  if (mashablePointLitres <= 0) return Number.NaN;
  return ((measuredPointLitres - fixedPointLitres) / mashablePointLitres) * 100;
}

function stageIsVisibleAt(
  additionStage: 'pre-boil' | 'boil' | 'fermenter',
  sampleStage: 'pre-boil' | 'post-boil' | 'fermenter',
): boolean {
  if (sampleStage === 'pre-boil') return additionStage === 'pre-boil';
  if (sampleStage === 'post-boil') return additionStage !== 'fermenter';
  return true;
}

/**
 * Brewhouse efficiency from batch actuals: the extract that made it into the
 * fermenter over the grist's theoretical maximum.
 *
 * ```
 * brewhouseEff% = 100 × (OG points × fermenter volume) / Σ theoretical point·litres
 * ```
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function brewhouseEfficiencyFromMeasurement(input: {
  readonly fermentables: readonly FermentableAddition[];
  readonly measuredOg: SpecificGravity;
  readonly volumeIntoFermenterL: Litres;
  readonly options?: CalculationOptions;
}): Percent {
  const options = input.options ?? {};
  const max = input.fermentables.reduce((sum, f) => sum + fermentableMaxPointLitres(f, options), 0);
  if (max <= 0) return 0;
  return ((sgToGravityPoints(input.measuredOg) * input.volumeIntoFermenterL) / max) * 100;
}

// ---------------------------------------------------------------------------
// Attenuation & final gravity
// ---------------------------------------------------------------------------

/**
 * Apparent attenuation of one fermentable, as a fraction of its own extract.
 *
 * - An explicit `fermentabilityPercent` always wins.
 * - `sugar` ferments out completely: 1.0.
 * - `non-fermentable` (lactose, maltodextrin) does not ferment at all: 0.0.
 * - Everything else attenuates at whatever the yeast manages.
 *
 * This is why a recipe with 10 % dextrose finishes drier than the yeast's
 * published attenuation alone would suggest, and a milk stout finishes sweeter.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function fermentableAttenuationFraction(
  fermentable: FermentableAddition,
  yeastAttenuationFraction: number,
): number {
  if (fermentable.fermentabilityPercent !== undefined) {
    return fermentable.fermentabilityPercent / 100;
  }
  if (fermentable.class === 'sugar') return 1;
  if (fermentable.class === 'non-fermentable') return 0;
  return yeastAttenuationFraction;
}

/**
 * The apparent attenuation to use for a yeast selection, in %.
 *
 * The midpoint of the published range, unless the strain has an explicit
 * figure. With several strains pitched together the most attenuative one
 * dominates the finished beer, so we take the maximum.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function yeastApparentAttenuationPercent(
  yeasts: readonly YeastSelection[] | undefined,
): Percent | undefined {
  if (!yeasts || yeasts.length === 0) return undefined;
  let best: number | undefined;
  for (const y of yeasts) {
    const value = y.attenuationPercent ?? (y.attenuationMinPercent + y.attenuationMaxPercent) / 2;
    if (best === undefined || value > best) best = value;
  }
  return best;
}

/**
 * A single mash temperature that stands in for a whole schedule, in °C, or
 * `undefined` when the recipe has no rest that converts starch.
 *
 * A step mash has no single temperature, but fermentability mostly depends on
 * how much conversion happened where beta-amylase is fast and makes maltose,
 * versus where alpha-amylase dominates and leaves dextrins. So we collapse the
 * schedule to the duration-weighted mean of its saccharification rests and
 * drop everything else:
 *
 * - Sparge steps are a rinse and convert nothing.
 * - Rests outside [{@link MASH_SACCHARIFICATION_MIN_C},
 *   {@link MASH_SACCHARIFICATION_MAX_C}] °C are excluded, not clamped. An acid
 *   or protein rest below 55 °C converts no starch, and a mash-out above 75 °C
 *   denatures the amylases within minutes. Including either would move the
 *   answer in the wrong direction.
 * - `decoction` and `temperature` steps count the same as `infusion` ones. How
 *   the tun got to the rest doesn't matter; the enzymes only see the rest
 *   temperature.
 *
 * Each rest is weighted by `max(timeMinutes, 1)`, so a step with a zero or
 * missing duration still moves the mean a little instead of disappearing.
 *
 * This is our own heuristic, not a published model. With it, a Hochkurz mash
 * of 62 °C × 40 min then 72 °C × 20 min reads as
 * `(62×40 + 72×20) / 60 = 65.33 °C`, a beer that finishes near the middle. Using
 * the 62 °C of the first rest would predict a beer far drier than it ever
 * ferments to.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function effectiveMashTempC(steps: readonly MashStep[] | undefined): Celsius | undefined {
  if (!steps || steps.length === 0) return undefined;
  let weightedSum = 0;
  let weight = 0;
  for (const step of steps) {
    if (step.type === 'sparge') continue;
    if (step.targetTempC < MASH_SACCHARIFICATION_MIN_C) continue;
    if (step.targetTempC > MASH_SACCHARIFICATION_MAX_C) continue;
    const minutes = Math.max(step.timeMinutes, 1);
    weightedSum += step.targetTempC * minutes;
    weight += minutes;
  }
  return weight > 0 ? weightedSum / weight : undefined;
}

/**
 * The adjustment to apparent attenuation for mash temperature, in percentage
 * points.
 *
 * This is a heuristic, not a published formula: ±1.2 points per °C away from
 * 66.7 °C (152 °F), clamped to ±8 points. Cooler mashes make more fermentable
 * wort. {@link resolveAttenuationPercent} always applies it when the recipe has
 * a mash schedule that {@link effectiveMashTempC} can get a saccharification
 * temperature from. An extract recipe with no mash keeps the yeast's published
 * attenuation.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function mashTemperatureAttenuationShift(mashTempC: Celsius): Percent {
  const raw = (MASH_TEMP_ATTENUATION_REFERENCE_C - mashTempC) * MASH_TEMP_ATTENUATION_POINTS_PER_C;
  return Math.max(-MASH_TEMP_ATTENUATION_MAX_SHIFT, Math.min(MASH_TEMP_ATTENUATION_MAX_SHIFT, raw));
}

/**
 * Input to {@link predictFinalGravity}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface FinalGravityInput {
  /** The grist and any sugars or extracts. Each ferments at its own rate. */
  readonly fermentables: readonly FermentableAddition[];
  /** The OG-equivalent, which counts every sugar the yeast will see. */
  readonly ogEquivalent: SpecificGravity;
  /** Yeast apparent attenuation, %. */
  readonly attenuationPercent: Percent;
  /** Mash efficiency, %, needed to weight each addition's extract. */
  readonly mashEfficiencyPercent: Percent;
  /**
   * Fraction of the kettle's wort that reaches the fermenter (0–1), default 1.
   *
   * This only matters when the recipe has fermenter additions. Some of the
   * kettle sugars are left behind on the trub and the fermenter sugars aren't,
   * so the yeast sees a mix slightly richer in the late additions.
   */
  readonly kettleRetentionFraction?: number;
  /** Calculation options. Defaults apply to anything left out. */
  readonly options?: CalculationOptions;
}

/**
 * Result of {@link predictFinalGravity}.
 *
 * @category Gravity and ABV
 * @group Results
 */
export interface FinalGravityPrediction {
  /** Predicted final gravity, SG. */
  readonly fg: SpecificGravity;
  /**
   * Net apparent attenuation of the whole wort, %. It differs from the yeast's
   * figure whenever there are sugars or non-fermentables.
   */
  readonly netApparentAttenuationPercent: Percent;
  /** Yeast attenuation that was applied (after any mash-temperature shift), %. */
  readonly effectiveYeastAttenuationPercent: Percent;
  /** Original extract, °P. */
  readonly originalExtractPlato: Plato;
  /** Apparent extract at terminal gravity, °P. */
  readonly apparentExtractPlato: Plato;
}

/**
 * Predict final gravity from the grist and the yeast's attenuation.
 *
 * Attenuation is defined on extract, so the arithmetic happens in °P:
 *
 * ```
 * netADF = Σ (extract_i × attenuation_i) / Σ extract_i
 * AE     = OE × (1 − netADF)
 * FG     = SG(AE)
 * ```
 *
 * where `attenuation_i` is per-fermentable (see
 * {@link fermentableAttenuationFraction}). The Plato⇄SG pair used here is
 * {@link sgToPlato}/{@link platoToSgExact} so the round trip is exact.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function predictFinalGravity(input: FinalGravityInput): FinalGravityPrediction {
  const options = input.options ?? {};
  const yeastFraction = input.attenuationPercent / 100;

  // Water has nothing to ferment. We return early because the Plato round
  // trip's cubic reads −0.003 °P at SG 1.000 and would give a final gravity
  // slightly above the original.
  if (input.ogEquivalent <= 1) {
    return {
      fg: input.ogEquivalent,
      netApparentAttenuationPercent: 0,
      effectiveYeastAttenuationPercent: input.attenuationPercent,
      originalExtractPlato: 0,
      apparentExtractPlato: 0,
    };
  }

  const retention = input.kettleRetentionFraction ?? 1;
  let weighted = 0;
  let total = 0;
  for (const f of input.fermentables) {
    const raw = fermentablePointLitres(f, input.mashEfficiencyPercent, options);
    if (raw <= 0) continue;
    const points = fermentableStage(f) === 'fermenter' ? raw : raw * retention;
    total += points;
    weighted += points * fermentableAttenuationFraction(f, yeastFraction);
  }

  const netFraction = total > 0 ? weighted / total : yeastFraction;
  const originalExtractPlato = sgToPlato(input.ogEquivalent);
  const apparentExtractPlato = originalExtractPlato * (1 - netFraction);

  return {
    fg: platoToSgExact(apparentExtractPlato),
    netApparentAttenuationPercent: netFraction * 100,
    effectiveYeastAttenuationPercent: input.attenuationPercent,
    originalExtractPlato,
    apparentExtractPlato,
  };
}

/**
 * Apparent degree of fermentation, in %.
 *
 * `ADF = 100 × (OE − AE) / OE`, with both extracts in °P. Yeast labs quote
 * attenuation against this definition.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function apparentAttenuationPercent(og: SpecificGravity, fg: SpecificGravity): Percent {
  const oe = sgToPlato(og);
  if (oe <= 0) return 0;
  return ((oe - sgToPlato(fg)) / oe) * 100;
}

/**
 * Real extract in °P: the extract left once you remove the alcohol's effect on
 * the hydrometer.
 *
 * Balling's relation: `RE = 0.1808 × OE + 0.8192 × AE`.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function realExtractPlato(og: SpecificGravity, fg: SpecificGravity): Plato {
  return 0.1808 * sgToPlato(og) + 0.8192 * sgToPlato(fg);
}

/**
 * Real degree of fermentation, in %.
 *
 * Defined as `100 × (OE − RE) / OE`. With Balling's real-extract relation this
 * reduces to `0.8192 × ADF`, which is where the "RDF is about 80 % of apparent
 * attenuation" rule of thumb comes from.
 *
 * ASBC's laboratory RDF has an extra correction for the mass of CO₂ that left
 * the beer. The difference is a few tenths of a percent and we don't model it.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function realAttenuationPercent(og: SpecificGravity, fg: SpecificGravity): Percent {
  const oe = sgToPlato(og);
  if (oe <= 0) return 0;
  return ((oe - realExtractPlato(og, fg)) / oe) * 100;
}

/**
 * Alcohol by weight, in % w/w.
 *
 * `ABW = (OE − RE) / (2.0665 − 0.010665 × OE)`, the standard relation used with
 * Balling's real extract.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function alcoholByWeightPercent(og: SpecificGravity, fg: SpecificGravity): Percent {
  const oe = sgToPlato(og);
  const re = realExtractPlato(og, fg);
  return (oe - re) / (2.0665 - 0.010665 * oe);
}

/** Millilitres in one US fluid ounce. Only the calorie conversion uses it. */
const ML_PER_US_FLUID_OUNCE = 29.5735295625;

/**
 * Litres in a 12 US fl oz serving, the unit beer calories are published in.
 *
 * @category Gravity and ABV
 * @group Constants and defaults
 */
export const LITRES_PER_12_US_FL_OZ = (12 * ML_PER_US_FLUID_OUNCE) / 1000;

/**
 * Calories in a 12 US fl oz serving, in kcal.
 *
 * The standard brewing-industry formula:
 * `kcal/12oz = [6.9 × ABW + 4.0 × (RE − 0.1)] × FG × 3.55`
 * where ABW is % w/w and RE is real extract in °P. That's 6.9 kcal/g for
 * ethanol and 4.0 kcal/g for carbohydrate, scaled by the mass of a 12 oz
 * serving.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function caloriesPer12UsFlOz(og: SpecificGravity, fg: SpecificGravity): number {
  const abw = alcoholByWeightPercent(og, fg);
  const re = realExtractPlato(og, fg);
  return (6.9 * abw + 4.0 * (re - 0.1)) * fg * 3.55;
}

/**
 * Calories per litre, in kcal. See {@link caloriesPer12UsFlOz}.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function caloriesPerLitre(og: SpecificGravity, fg: SpecificGravity): number {
  return caloriesPer12UsFlOz(og, fg) / LITRES_PER_12_US_FL_OZ;
}

/**
 * Calories in a 330 mL serving, in kcal.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function caloriesPer330ml(og: SpecificGravity, fg: SpecificGravity): number {
  return caloriesPerLitre(og, fg) * 0.33;
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Resolve the attenuation to apply, including overrides and the mash heuristic.
 *
 * The mash-temperature shift always applies, because moving the mash from
 * 63 °C to 69 °C changes the beer and the FG should reflect that. There are two
 * exceptions. An explicit `attenuationOverridePercent` replaces everything, and
 * a missing `mashTempC` (extract recipes, or a schedule with no
 * saccharification rest) leaves the yeast's own figure as it is.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function resolveAttenuationPercent(args: {
  readonly yeasts?: readonly YeastSelection[] | undefined;
  readonly mashTempC?: Celsius | undefined;
  readonly options?: CalculationOptions;
}): Percent {
  const options = resolveCalculationOptions(args.options);
  if (options.attenuationOverridePercent !== undefined) return options.attenuationOverridePercent;
  // A recipe with no yeast selected falls back to 75 %, the middle of the
  // range for a typical American ale strain.
  const base = yeastApparentAttenuationPercent(args.yeasts) ?? 75;
  if (args.mashTempC === undefined) return base;
  return Math.max(0, Math.min(100, base + mashTemperatureAttenuationShift(args.mashTempC)));
}
