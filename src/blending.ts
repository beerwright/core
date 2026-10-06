/**
 * Barrel-aged and mixed-fermentation blending.
 *
 * This follows Tonsmeire's priming spreadsheet as extended by Crane (Council
 * Brewing, NHC), which is what sour-beer blenders already use: residual CO₂
 * that accounts for barrel ageing, extra CO₂ from leftover extract in the
 * sweeter components, volume-weighted TA / SRM / ABV / FG, [H⁺]-weighted pH,
 * additions, and the acid-shock starter for pitching into a sour blend.
 *
 * Each addition has a kind, and the kind decides what its numbers mean:
 *
 * - A `fruit` has a volume and a juice gravity. Its sugar is reported as
 *   sucrose and as the ABV the blend reaches if it all ferments out.
 * - A `flavour` (a herb, oak, coffee) has a weight and isn't used in any
 *   formula, because it changes how the beer tastes and not what it measures.
 * - A `hop` is the same thing with a variety's name.
 * - A `spirit` has a volume and an ABV, and its alcohol counts as soon as it
 *   goes in. The spirit term is `volume × ABV` and has no citation because
 *   that's the definition of alcohol by volume.
 *
 * No addition counts toward the total volume or the bottle count. Only an
 * addition that's still unfermented at packaging counts toward the priming
 * dose (see {@link ADDITION_FERMENTED_DAYS}).
 *
 * A `sugar` has a weight and the name of a sugar. It's the fruit case with
 * the measurement the other way round: juice is bought and read as a volume
 * at a gravity, but a jar of honey is a weight, and how much of it ferments
 * depends on which sugar it is. Its sucrose-equivalent is `mass × fraction`,
 * where the fraction is the sugar's CO₂ yield in carbonation.ts divided by
 * sucrose's. For alcohol, that sucrose raises the gravity of the volume
 * already in the vessel at Crane's 46 points per pound per gallon (the same
 * PPG as the fruit row), then ferments back down to the driest FG. A sugar
 * adds no liquid, so unlike a fruit or a spirit it isn't in the denominator.
 *
 * A `whole-fruit` is for a brewer who tipped in a bucket of cherries instead
 * of a carton of juice. You can't read a gravity on a bucket of fruit, so the
 * row is a weight and a percent: how much of that weight is sugar, from
 * {@link WHOLE_FRUITS} unless the brewer has a better figure. After that it
 * uses the same arithmetic as a weighed sugar: sucrose dissolved into the
 * volume already in the vessel, fermenting down to the driest FG. It adds no
 * volume because the skins, stones and pulp stay in the fermenter, and the
 * juice they gave up was already in the beer the blender measured.
 *
 * Citations are next to the numbers they support.
 */

import { abvAdvanced } from './abv';
import {
  GRAMS_CO2_PER_VOLUME_PER_LITRE,
  PRIMING_SUGAR_CO2_YIELD,
  type PrimingResult,
  type PrimingSugar,
  primingSugar,
  residualCo2Volumes,
} from './carbonation';
import type { Explanation } from './explain';
import { explain } from './explain';
import {
  BRAUKAISER_CARBONATION,
  CRANE_BLENDING_SHEET,
  MILK_THE_FUNK_PACKAGING,
  TECHNIQUES_HOME_WINEMAKING_PH,
  TONSMEIRE_BLENDING_2014,
} from './sources';
import type { Celsius, Litres, SpecificGravity } from './types';
import { sgToGravityPoints } from './units/gravity';
import { kgToPounds, poundsToKg } from './units/mass';
import { litresToGallons } from './units/volume';
import { daysBetween } from './yeast';

/**
 * Long-term barrel ageing knocks about half the assumed residual CO₂ out of
 * the beer. This is Tonsmeire's anecdotal factor, which blenders using his
 * spreadsheet have applied since 2014.
 *
 * @see https://www.themadfermentationist.com/2014/07/priming-barrel-aged-and-blended-sour.html
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const BARREL_AGED_RESIDUAL_FACTOR = 0.5;

/**
 * Extra volumes of CO₂ produced per gravity-point of extract that will still
 * ferment, once the blend's driest component sets the floor.
 *
 * From Crane's hidden Calculations tab: `0.51 × Σ(V × Δpoints) / ΣV`. The
 * 0.51 is the volumes of CO₂ one gravity point of sucrose yields in a gallon
 * of beer, from the same Braukaiser arithmetic the priming dose uses.
 *
 * @see http://braukaiser.com/wiki/index.php/Accurately_Calculating_Sugar_Additions_for_Carbonation
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const EXTRACT_CO2_VOLUMES_PER_GRAVITY_POINT = 0.51;

/**
 * Days an addition's sugar has to have been in the blend before we count it
 * as fermented out. Until then it counts as priming sugar.
 *
 * Fruit added to a mixed-fermentation blend a month before packaging has
 * been eaten. Fruit added the week before bottling is still sugar, and it
 * will carbonate in the bottle on top of whatever priming dose the blender
 * adds, which can over-carbonate the bottles dangerously. That's the only
 * reason this module looks at dates.
 *
 * Three weeks is a judgement call, not a measurement, and it's on the
 * conservative side. A Brettanomyces culture working through cherry sugar at
 * cellar temperature can take longer, so a blender who knows their culture
 * is slow should date the row and pay attention to the warning. The value is
 * exported so callers can show the threshold next to the number it affects.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const ADDITION_FERMENTED_DAYS = 21;

/**
 * Dry yeast for an acid-shock starter, grams per US gallon of blend.
 *
 * Crane's sheet uses `total_gal × 0.3`. Milk the Funk's rule of thumb is ~2 g
 * per 5 gal (0.4 g/gal). We use Crane's figure, which is the more
 * conservative of the two.
 *
 * @see https://www.milkthefunk.com/wiki/Packaging
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const ACID_SHOCK_YEAST_GRAMS_PER_GALLON = 0.3;

/**
 * Starter volume of water (and of acid beer) per gram of dry yeast, litres.
 *
 * Crane uses `(yeast_g / 17) × 33.81 fl oz` each of water and acid beer.
 * 17 g/L is a thick slurry, split 50/50 with the blend so the yeast can
 * acclimate for 24–48 h before packaging.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const ACID_SHOCK_STARTER_LITRES_PER_GRAM = 1 / 17;

/**
 * Sucrose points-per-pound-per-gallon. Fruit juice sugar is `points / 46`
 * pounds per gallon of juice, as in Crane's fruit row. It's the standard PPG
 * for sucrose used in extract-based sugar additions.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const SUCROSE_POINTS_PER_POUND_PER_GALLON = 46;

/**
 * Default titration sample in millilitres. Crane's Carbonation sheet uses 25 mL.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const DEFAULT_TA_SAMPLE_ML = 25;

/**
 * Residual CO₂ of one blend component, in volumes.
 *
 * This reads the standard residual curve at the peak temperature after
 * attenuation, not the current cellar temperature, and halves it when the
 * beer sat in a barrel long enough to off-gas.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function blendComponentResidualCo2(peakTempC: Celsius, barrelAged: boolean): number {
  const residual = residualCo2Volumes(peakTempC);
  return barrelAged ? residual * BARREL_AGED_RESIDUAL_FACTOR : residual;
}

/**
 * Titratable acidity as lactic acid, g/L.
 *
 * From Crane's TA sheet: titrate with 0.1 N NaOH to pH 8.2. The sample's
 * specific gravity is in the denominator, so the result is per kilogram of
 * beer, not per litre:
 *
 * ```
 * % TA     = (mL NaOH × 0.9) / (mL sample × SG)
 * TA g/L   = % TA × 10
 * ```
 *
 * The 0.9 is `0.1 N × 90 g/eq lactic / 10` (percent). Worked example from the
 * sheet: 12.2 mL NaOH, 50 mL beer at 1.010 → 2.17 g/L.
 *
 * Returns `null` when any input is unusable (zero sample, non-positive SG).
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function titratableAcidityGramsPerLitre(input: {
  readonly naohMl: number;
  readonly sampleMl: number;
  readonly sg: SpecificGravity;
}): number | null {
  if (input.sampleMl <= 0 || input.sg <= 0 || input.naohMl < 0) return null;
  const percent = (input.naohMl * 0.9) / (input.sampleMl * input.sg);
  return percent * 10;
}

/**
 * Blend pH from volume-weighted hydrogen-ion concentration.
 *
 * ```
 * pH = −log₁₀( Σ(Vᵢ × 10^(−pHᵢ)) / Σ Vᵢ )
 * ```
 *
 * This is exact for strong acids and an approximation for a buffered beer.
 * Crane cites the same approximation from *Techniques in Home Winemaking*.
 * Components without a pH are skipped, not treated as water.
 *
 * @see http://www.techniquesinhomewinemaking.com/blog/how-does-blending-impact-ph/
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function blendPh(
  parts: readonly { readonly volumeL: Litres; readonly ph: number }[],
): number | null {
  let volumeL = 0;
  let hydrogenLitres = 0;
  for (const part of parts) {
    if (part.volumeL <= 0 || !Number.isFinite(part.ph)) continue;
    volumeL += part.volumeL;
    hydrogenLitres += part.volumeL * 10 ** -part.ph;
  }
  if (volumeL <= 0 || hydrogenLitres <= 0) return null;
  return -Math.log10(hydrogenLitres / volumeL);
}

/**
 * Volume-weighted mean of a numeric field, skipping nulls.
 *
 * @category Blending, mead and spirits
 * @internal
 */
export function volumeWeightedMean(
  parts: readonly { readonly volumeL: Litres; readonly value: number | null }[],
): number | null {
  let volumeL = 0;
  let weighted = 0;
  for (const part of parts) {
    if (part.volumeL <= 0 || part.value === null || !Number.isFinite(part.value)) continue;
    volumeL += part.volumeL;
    weighted += part.volumeL * part.value;
  }
  if (volumeL <= 0) return null;
  return weighted / volumeL;
}

/**
 * One beer (or wine, or cider) going into the blend.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendComponentInput {
  /** Optional caller id, copied to {@link BlendComponentResult} so callers can match results to inputs. */
  readonly id?: string;
  /** The component's name. */
  readonly name: string;
  /** Volume going into the blend, litres. Zero or negative is skipped. */
  readonly volumeL: Litres;
  /** Original gravity, as specific gravity, or `null` if unknown. */
  readonly og: SpecificGravity | null;
  /** Final gravity, as specific gravity, or `null` if unknown. */
  readonly fg: SpecificGravity | null;
  /** Measured pH, or `null` if it hasn't been measured. */
  readonly ph: number | null;
  /** Color, in SRM, or `null` if unknown. */
  readonly srm: number | null;
  /** Peak temperature after attenuation, °C. */
  readonly peakTempC: Celsius | null;
  /**
   * True when the beer sat in a barrel long enough after attenuation to
   * off-gas (Tonsmeire's "significant amount of time").
   */
  readonly barrelAged: boolean;
  /** mL of 0.1 N NaOH to pH 8.2, for TA. */
  readonly naohMl: number | null;
  /** Titration sample volume, millilitres. Defaults to {@link DEFAULT_TA_SAMPLE_ML}. */
  readonly taSampleMl?: number;
}

/**
 * The day an addition went in. Every addition kind has it.
 *
 * It's optional. An undated addition is never judged fermented or
 * unfermented, so it stays out of the priming dose, and the dose only changes
 * once the blender gives a date. See {@link ADDITION_FERMENTED_DAYS} for how
 * the date is used.
 *
 * It's a `Date` and not a `YYYY-MM-DD` string because this package has no
 * clock and no locale (`hop-freshness` follows the same rule). The caller
 * parses the day it stored and passes an instant.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendAdditionTiming {
  /** The day it went into the blend, or `null` if the blender didn't say. */
  readonly addedOn?: Date | null;
}

/**
 * Fruit or sugar syrup folded into the blend. Its sugar is still to ferment.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendFruitInput extends BlendAdditionTiming {
  /** Tells the additions apart. */
  readonly kind: 'fruit';
  /** The fruit or syrup's name. */
  readonly name: string;
  /** Volume of juice or syrup, in liters. Zero or negative is skipped. */
  readonly volumeL: Litres;
  /** Juice / syrup specific gravity. */
  readonly sg: SpecificGravity;
}

/**
 * Sugar, honey or a syrup, added by weight.
 *
 * The sugar is picked from the priming sugar list because which sugar it is
 * decides how much of each kilogram ferments.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendSugarInput extends BlendAdditionTiming {
  /** Tells the additions apart. */
  readonly kind: 'sugar';
  /** The addition's name, as the blender wrote it. */
  readonly name: string;
  /** Amount by weight, **kilograms**. */
  readonly massKg: number;
  /** Which sugar it is. */
  readonly sugar: PrimingSugar;
}

/**
 * Whole fruit, added by weight with no gravity reading.
 *
 * The sugar percent is stored on the row instead of looked up by name,
 * because the name is free text. "Montmorency from the neighbour's tree"
 * isn't a table key, and a lookup that failed would silently contribute
 * nothing.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendWholeFruitInput extends BlendAdditionTiming {
  /** Tells the additions apart. */
  readonly kind: 'whole-fruit';
  /** The fruit's name. Free text, never looked up. */
  readonly name: string;
  /** Amount by weight in **kilograms**, including skins and stones. */
  readonly massKg: number;
  /** Sugar as a share of that weight, in **percent**. @see WHOLE_FRUITS */
  readonly sugarPercent: number;
}

/**
 * Typical sugar content of raw fruit, percent by mass.
 *
 * Total sugars per 100 g of raw fruit from USDA FoodData Central, rounded to
 * the nearest percent, for the twelve fruits blenders use most. We round
 * because ripeness, variety and storage time move the real figure by more
 * than the rounding does.
 *
 * These are **defaults, not measurements**. A brewer who has a better figure
 * (a Brix reading on the run-off juice, or a variety that isn't listed here)
 * overwrites the percent on the row, and the maths uses that. The table is
 * here so the common case is one pick from a list.
 *
 * @see https://fdc.nal.usda.gov/
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const WHOLE_FRUITS: readonly {
  /** Stable key for the fruit. */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Sugar as a share of the raw fruit's weight, in percent. */
  readonly sugarPercent: number;
}[] = [
  { id: 'cherry', name: 'Cherry', sugarPercent: 13 },
  { id: 'raspberry', name: 'Raspberry', sugarPercent: 4 },
  { id: 'blackberry', name: 'Blackberry', sugarPercent: 5 },
  { id: 'blueberry', name: 'Blueberry', sugarPercent: 10 },
  { id: 'strawberry', name: 'Strawberry', sugarPercent: 5 },
  { id: 'peach', name: 'Peach', sugarPercent: 8 },
  { id: 'apricot', name: 'Apricot', sugarPercent: 9 },
  { id: 'plum', name: 'Plum', sugarPercent: 10 },
  { id: 'grape', name: 'Grape', sugarPercent: 16 },
  { id: 'mango', name: 'Mango', sugarPercent: 14 },
  { id: 'passion-fruit', name: 'Passion fruit', sugarPercent: 11 },
  { id: 'apple', name: 'Apple', sugarPercent: 10 },
];

/**
 * A herb, spice, oak or coffee. It has a weight but isn't used in any calculation.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendFlavourInput extends BlendAdditionTiming {
  /** Tells the additions apart. */
  readonly kind: 'flavour';
  /** What it is, as the blender wrote it. */
  readonly name: string;
  /** Amount by weight, **grams**. `null` is "not decided yet". */
  readonly amountG: number | null;
}

/**
 * Hops added to finished beer. It has a variety and a weight but isn't used
 * in any calculation.
 *
 * It has the same shape as the flavour row, but it's a separate kind because
 * it's a different ingredient. The name is usually a hop variety but is free
 * text, since hops off a neighbour's fence have no variety.
 *
 * There's no bitterness, and that's correct, not an approximation. Every
 * model in `ibu.ts` returns zero for a hop that never went in the kettle, and
 * a blend is finished beer, so there's no isomerisation to model. That's why
 * the row has no alpha acid: nothing would read it, and the addition union
 * exists so rows don't carry fields the maths ignores.
 *
 * It doesn't take away any beer either. Hops do absorb liquid (the equipment
 * profile's `dryHopAbsorptionMlPerG` is 6 mL/g, so 100 g in a 20 L blend is
 * most of a bottle), but no addition changes the blend's volume or bottle
 * count, and we don't make hops an exception. The weight is recorded so the
 * blender knows what they used; the beer lost to the hops is left for them
 * to account for.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendHopInput extends BlendAdditionTiming {
  /** Tells the additions apart. */
  readonly kind: 'hop';
  /** The hop, usually a variety name. */
  readonly name: string;
  /** Amount by weight, **grams**. `null` is "not decided yet". */
  readonly amountG: number | null;
}

/**
 * A tincture or a spirit. Its alcohol counts as soon as it goes in.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendSpiritInput extends BlendAdditionTiming {
  /** Tells the additions apart. */
  readonly kind: 'spirit';
  /** The spirit or tincture's name. */
  readonly name: string;
  /** Volume added, in liters. Zero or negative is skipped. */
  readonly volumeL: Litres;
  /** Strength of the spirit, percent ABV. */
  readonly abvPercent: number;
}

/**
 * Anything folded into the blend that is not a beer. @see BlendFruitInput
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export type BlendAdditionInput =
  | BlendFruitInput
  | BlendWholeFruitInput
  | BlendSugarInput
  | BlendFlavourInput
  | BlendHopInput
  | BlendSpiritInput;

/**
 * Inputs to {@link evaluateBlend}.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface BlendInput {
  /** The beers going into the blend. */
  readonly components: readonly BlendComponentInput[];
  /** Target carbonation, volumes of CO₂. */
  readonly targetVolumes: number;
  /** Fruit, sugar, flavourings and spirits folded in. Empty means none. */
  readonly additions: readonly BlendAdditionInput[];
  /**
   * Volume going to keg, litres. The rest of the blend is bottles. `null`
   * means the whole blend is bottled.
   */
  readonly kegVolumeL: Litres | null;
  /** The sugar to prime with. Defaults to table sugar. */
  readonly sugar?: PrimingSugar;
  /**
   * Final gravity measured on the blend itself (not on a component), or
   * `null` if it hasn't been measured yet.
   *
   * The volume-weighted FG describes the blend on the day it was mixed, while
   * {@link BlendEvaluation.extractVolumes} and
   * {@link BlendEvaluation.abvWithAdditions} both describe it months later,
   * once everything sweeter than the driest component has fermented down to
   * that floor. A measurement tells us where the blend actually is now, so
   * when it's present it replaces the predicted extract term and ABV.
   */
  readonly measuredFg?: SpecificGravity | null;
  /**
   * The day {@link measuredFg} was read, or `null`.
   *
   * We need it because a hydrometer reading already includes every addition
   * made before it; the fruit's sugar is in that number. Without the day we
   * can't tell whether an addition came before or after the reading, and the
   * fruit would be counted once in the gravity and again in
   * `abvWithAdditions`.
   */
  readonly measuredOn?: Date | null;
  /**
   * The day the blend is packaged. Any addition sugar that hasn't fermented by
   * then ends up in the bottle.
   *
   * `null` when the blend hasn't been packaged and the caller has no date. In
   * that case no addition can be judged, and none of them count toward the
   * priming dose. For a blend that's still conditioning, pass today's date to
   * answer "if I bottled this now, what would still be sugar?".
   */
  readonly packagedOn?: Date | null;
}

/**
 * Per-component derived figures.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface BlendComponentResult {
  /** The caller's id from the input, or `null` if it had none. */
  readonly id: string | null;
  /** The component's name, from the input. */
  readonly name: string;
  /** Volume going into the blend, in liters. */
  readonly volumeL: Litres;
  /** This component's share of the blend's volume, as a fraction from 0 to 1. */
  readonly fraction: number;
  /** Original gravity, as specific gravity, from the input. */
  readonly og: SpecificGravity | null;
  /** Final gravity, as specific gravity, from the input. */
  readonly fg: SpecificGravity | null;
  /** pH, from the input. */
  readonly ph: number | null;
  /** Color in SRM, from the input. */
  readonly srm: number | null;
  /** Peak temperature after attenuation, in °C, from the input. */
  readonly peakTempC: Celsius | null;
  /** Whether the component was barrel-aged, from the input. */
  readonly barrelAged: boolean;
  /** Alcohol by volume, in percent, or `null` without both gravities and some attenuation. */
  readonly abv: number | null;
  /** Titratable acidity as lactic acid, in g/L, or `null` without a titration and an FG. */
  readonly taGramsPerLitre: number | null;
  /** Residual CO₂, in volumes, or `null` without a peak temperature. */
  readonly residualVolumes: number | null;
  /** Mass of this component, kg (`V × FG`). */
  readonly massKg: number | null;
}

/**
 * Acid-shock starter to pitch 24–48 h before packaging.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface AcidShockStarter {
  /** Dry yeast, in grams. */
  readonly yeastGrams: number;
  /** Water for the starter, in liters. */
  readonly waterL: Litres;
  /** Blend mixed into the starter so the yeast can acclimate, in liters. */
  readonly acidBeerL: Litres;
}

/**
 * Result of {@link evaluateBlend}.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface BlendEvaluation {
  /** Figures for each component with a positive volume, in input order. */
  readonly components: readonly BlendComponentResult[];
  /** Total volume of the components, in liters. Additions aren't counted. */
  readonly totalVolumeL: Litres;
  /** Volume-weighted residual CO₂ from temperature (and barrel ageing). */
  readonly residualVolumes: number | null;
  /**
   * Extra volumes from leftover extract in every component sweeter than the
   * driest. The bugs will keep fermenting down to that floor in the bottle.
   */
  readonly extractVolumes: number;
  /** Residual plus extract: carbonation the blend reaches with no priming sugar. */
  readonly predictedVolumes: number | null;
  /** True when predicted carbonation already meets or exceeds the target. */
  readonly excessCarbonation: boolean;
  /** The driest component's FG, as specific gravity. Sweeter extract ferments down to this. */
  readonly lowestFg: SpecificGravity | null;
  /** Volume-weighted titratable acidity as lactic acid, in g/L. */
  readonly taGramsPerLitre: number | null;
  /** Volume-weighted color, in SRM. */
  readonly srm: number | null;
  /** Alcohol by volume before additions, in percent. Uses the measured FG when there is one. */
  readonly abv: number | null;
  /** Blend pH from the components' hydrogen-ion concentration (see {@link blendPh}). */
  readonly ph: number | null;
  /**
   * Volume-weighted original gravity, `null` when no component has one. This
   * is the OG to use when this blend is a component of another blend.
   */
  readonly og: SpecificGravity | null;
  /**
   * The blend's final gravity: the measured value if there is one, otherwise
   * the volume-weighted prediction.
   *
   * This is the figure to display, and the one to use when this blend is a
   * component of another blend.
   */
  readonly fg: SpecificGravity | null;
  /**
   * Volume-weighted FG of the components, whether or not there's a
   * measurement. It describes the blend as mixed, before anything else
   * ferments.
   *
   * It's reported alongside {@link fg} so a caller can show both and the
   * blender can see the gap. Equal to {@link fg} when there's no measurement.
   */
  readonly predictedFg: SpecificGravity | null;
  /** Priming dose to reach the target carbonation, or `null` without a volume and a residual figure. */
  readonly priming: PrimingResult | null;
  /** Acid-shock starter for a blend this size, or `null` for an empty blend. */
  readonly acidShock: AcidShockStarter | null;
  /** Sucrose-equivalent in the fruit, whole-fruit and sugar additions, kg. */
  readonly additionSugarKg: number | null;
  /**
   * Sucrose-equivalent in the additions that will still be sugar when the
   * blend is packaged, kg, or `null` when none will be.
   *
   * A subset of {@link additionSugarKg}: the dated rows that went in too close
   * to packaging to have fermented. The blender may not think of this as
   * priming sugar, but it is, and unlike every other addition figure it
   * **is** counted in the dose. {@link additionPrimingVolumes} is the
   * carbonation it produces, and {@link priming} is reduced by that much.
   *
   * Undated rows are never included because they can't be judged, so a blend
   * with no dates gets the same dose as if additions had no dates at all.
   */
  readonly additionPrimingSugarKg: number | null;
  /** Carbonation {@link additionPrimingSugarKg} will produce in the bottle, volumes. */
  readonly additionPrimingVolumes: number;
  /**
   * Blend ABV once the fruit and the sugar have fermented out to the driest
   * FG, with any spirit's own alcohol already counted. `null` when the blend
   * has no ABV, or when nothing that moves it was added.
   */
  readonly abvWithAdditions: number | null;
  /** Volume going to keg, in liters, clamped to the blend's total. */
  readonly kegVolumeL: Litres;
  /** Volume left for bottles, in liters. */
  readonly bottleVolumeL: Litres;
}

/**
 * How many whole bottles a volume of beer fills, at the bottle size the caller
 * gives.
 *
 * The size is an argument because bottle sizes vary by region: in Brussels
 * it's 330s, 375s and the 750 cork-and-cage, in San Diego it's 12 oz, 16 oz
 * and bombers. We count *whole* bottles only. The remainder left in the
 * bottling bucket is dropped, not rounded up into a bottle that would be
 * partly empty. No volume or a zero bottle size gives zero bottles.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function bottlesOfSize(bottleVolumeL: number, bottleMl: number): number {
  if (!(bottleVolumeL > 0) || !(bottleMl > 0)) return 0;
  return Math.floor(bottleVolumeL / (bottleMl / 1000));
}

/**
 * Evaluates a blend, computing every derived figure Crane's spreadsheet shows
 * from the components.
 *
 * We find the driest FG ourselves. The spreadsheet requires the driest beer
 * in column #1, which is easy to get wrong. Components with no volume are
 * ignored.
 *
 * @category Blending, mead and spirits
 * @group Start here
 */
export function evaluateBlend(input: BlendInput): BlendEvaluation {
  const present = input.components.filter((c) => c.volumeL > 0);
  const totalVolumeL = present.reduce((sum, c) => sum + c.volumeL, 0);

  const lowestFg = minFinite(present.map((c) => c.fg));

  const components: BlendComponentResult[] = present.map((c) => {
    const fraction = totalVolumeL > 0 ? c.volumeL / totalVolumeL : 0;
    const abv = c.og !== null && c.fg !== null && c.og > c.fg ? abvAdvanced(c.og, c.fg) : null;
    const taGramsPerLitre =
      c.naohMl !== null && c.fg !== null
        ? titratableAcidityGramsPerLitre({
            naohMl: c.naohMl,
            sampleMl: c.taSampleMl ?? DEFAULT_TA_SAMPLE_ML,
            sg: c.fg,
          })
        : null;
    const residualVolumes =
      c.peakTempC !== null ? blendComponentResidualCo2(c.peakTempC, c.barrelAged) : null;
    const massKg = c.fg !== null ? c.volumeL * c.fg : null;
    return {
      id: c.id ?? null,
      name: c.name,
      volumeL: c.volumeL,
      fraction,
      og: c.og,
      fg: c.fg,
      ph: c.ph,
      srm: c.srm,
      peakTempC: c.peakTempC,
      barrelAged: c.barrelAged,
      abv,
      taGramsPerLitre,
      residualVolumes,
      massKg,
    };
  });

  const residualVolumes = volumeWeightedMean(
    components.map((c) => ({ volumeL: c.volumeL, value: c.residualVolumes })),
  );

  const measuredFg = input.measuredFg ?? null;

  // Extract still to ferment. A measured FG on the blend answers this
  // directly, so when there is one it replaces the sum over the components
  // instead of adding to it. The components describe what was poured in; the
  // reading describes what's in the vessel now. The important case is a blend
  // measured at or below the floor: it has nothing left to ferment, so the
  // dose has to supply the whole target, while the component sum would still
  // count CO₂ that fermented out months ago.
  let extractVolumes = 0;
  if (measuredFg !== null && lowestFg !== null) {
    extractVolumes =
      EXTRACT_CO2_VOLUMES_PER_GRAVITY_POINT *
      Math.max(0, sgToGravityPoints(measuredFg) - sgToGravityPoints(lowestFg));
  } else if (lowestFg !== null && totalVolumeL > 0) {
    const driestPoints = sgToGravityPoints(lowestFg);
    let pointLitres = 0;
    for (const c of components) {
      if (c.fg === null) continue;
      const extra = Math.max(0, sgToGravityPoints(c.fg) - driestPoints);
      pointLitres += extra * c.volumeL;
    }
    extractVolumes = (EXTRACT_CO2_VOLUMES_PER_GRAVITY_POINT * pointLitres) / totalVolumeL;
  }

  const presentFruit = input.additions.filter(
    (item): item is BlendFruitInput => item.kind === 'fruit' && item.volumeL > 0,
  );
  const presentSugar = input.additions.filter(
    (item): item is BlendSugarInput => item.kind === 'sugar' && item.massKg > 0,
  );
  const presentWholeFruit = input.additions.filter(
    (item): item is BlendWholeFruitInput => item.kind === 'whole-fruit' && item.massKg > 0,
  );
  const presentSpirit = input.additions.filter(
    (item): item is BlendSpiritInput => item.kind === 'spirit' && item.volumeL > 0,
  );
  const sucroseKg =
    presentFruit.reduce((sum, item) => sum + fruitSugarKilograms(item), 0) +
    presentSugar.reduce((sum, item) => sum + sugarAdditionSucroseKilograms(item), 0) +
    presentWholeFruit.reduce((sum, item) => sum + wholeFruitSucroseKilograms(item), 0);
  const additionSugarKg =
    presentFruit.length === 0 && presentSugar.length === 0 && presentWholeFruit.length === 0
      ? null
      : sucroseKg;

  // A hydrometer reading includes everything that was in the vessel when it
  // was taken, so an addition made before it is already in that number, both
  // in the gravity its sugar raised and in the alcohol made from it since.
  // Splitting the additions on the reading's date stops any of them being
  // counted twice, below and in `abvWithAdditions`.
  const measuredOn = measuredFg === null ? null : (input.measuredOn ?? null);
  const inReading = (item: BlendAdditionTiming): boolean =>
    measuredOn !== null &&
    item.addedOn !== null &&
    item.addedOn !== undefined &&
    item.addedOn.getTime() <= measuredOn.getTime();

  // Sugar that will still be unfermented when the bottles are capped. A row
  // can only be judged if it's dated and there's a packaging date, so undated
  // rows stay out of the dose.
  //
  // Rows made before the reading are left out too. The extract term above is
  // measured from that same gravity, so their sugar is already in it.
  // Counting it here as well would reduce the dose twice for the same fruit,
  // and the beer would come out under-carbonated.
  const stillSugarAtPackaging = (item: BlendAdditionTiming): boolean => {
    if (inReading(item)) return false;
    const days = contactDays(item.addedOn ?? null, input.packagedOn ?? null);
    return days !== null && days < ADDITION_FERMENTED_DAYS;
  };
  const primingSucroseKg =
    presentFruit.filter(stillSugarAtPackaging).reduce((s, i) => s + fruitSugarKilograms(i), 0) +
    presentSugar
      .filter(stillSugarAtPackaging)
      .reduce((s, i) => s + sugarAdditionSucroseKilograms(i), 0) +
    presentWholeFruit
      .filter(stillSugarAtPackaging)
      .reduce((s, i) => s + wholeFruitSucroseKilograms(i), 0);
  const additionPrimingSugarKg = primingSucroseKg > 0 ? primingSucroseKg : null;
  // This is the priming dose calculation in reverse: sucrose to grams of CO₂
  // by its yield, then CO₂ to volumes over the beer it dissolves in.
  const additionPrimingVolumes =
    totalVolumeL > 0
      ? (primingSucroseKg * 1000 * PRIMING_SUGAR_CO2_YIELD['table-sugar']) /
        (totalVolumeL * GRAMS_CO2_PER_VOLUME_PER_LITRE)
      : 0;

  const predictedVolumes =
    residualVolumes === null ? null : residualVolumes + extractVolumes + additionPrimingVolumes;
  const excessCarbonation = predictedVolumes !== null && predictedVolumes >= input.targetVolumes;

  const taGramsPerLitre = volumeWeightedMean(
    components.map((c) => ({ volumeL: c.volumeL, value: c.taGramsPerLitre })),
  );
  const srm = volumeWeightedMean(components.map((c) => ({ volumeL: c.volumeL, value: c.srm })));
  const componentAbv = volumeWeightedMean(
    components.map((c) => ({ volumeL: c.volumeL, value: c.abv })),
  );
  const og = volumeWeightedMean(components.map((c) => ({ volumeL: c.volumeL, value: c.og })));
  const predictedFg = volumeWeightedMean(
    components.map((c) => ({ volumeL: c.volumeL, value: c.fg })),
  );
  const fg = measuredFg ?? predictedFg;
  const ph = blendPh(
    components.flatMap((c) => (c.ph === null ? [] : [{ volumeL: c.volumeL, ph: c.ph }])),
  );

  // The OG we compute ABV from has to include the sugar of every addition made
  // before the reading. Otherwise the measured FG would be compared against
  // an OG the blend never had.
  const countedFruit = presentFruit.filter(inReading);
  const countedSpirit = presentSpirit.filter(inReading);
  const countedSucroseKg =
    countedFruit.reduce((s, i) => s + fruitSugarKilograms(i), 0) +
    presentSugar.filter(inReading).reduce((s, i) => s + sugarAdditionSucroseKilograms(i), 0) +
    presentWholeFruit.filter(inReading).reduce((s, i) => s + wholeFruitSucroseKilograms(i), 0);
  const countedVolumeL =
    countedFruit.reduce((s, i) => s + i.volumeL, 0) +
    countedSpirit.reduce((s, i) => s + i.volumeL, 0);
  const measuredVolumeL = totalVolumeL + countedVolumeL;
  const effectiveOg =
    og === null || measuredVolumeL <= 0
      ? og
      : og + sucrosePointLitres(countedSucroseKg) / 1000 / measuredVolumeL;
  const abv =
    measuredFg !== null && effectiveOg !== null && effectiveOg > measuredFg
      ? abvAdvanced(effectiveOg, measuredFg)
      : componentAbv;

  const priming =
    totalVolumeL > 0 && predictedVolumes !== null
      ? primingSugar({
          beerVolumeL: totalVolumeL,
          targetVolumes: input.targetVolumes,
          fermentationTempC: 20,
          residualVolumes: predictedVolumes,
          sugar: input.sugar ?? 'table-sugar',
        })
      : null;

  const acidShock = totalVolumeL > 0 ? acidShockStarter(totalVolumeL) : null;

  // Fruit sugar has to ferment down to the driest FG before it's alcohol,
  // while a spirit is already alcohol. Both dilute the blend, so both are in
  // the denominator. A weighed sugar ferments like fruit but adds no volume,
  // so it raises the gravity of the volume already in the vessel and stays
  // out of the denominator. Whole fruit works the same way as a weighed sugar:
  // the pulp stays behind, so all it contributes is sucrose, and the two
  // share one term.
  //
  // Every row here is one the measured FG has *not* already accounted for, so
  // with no measurement this is all of them.
  const pendingFruit = presentFruit.filter((item) => !inReading(item));
  const pendingSpirit = presentSpirit.filter((item) => !inReading(item));
  const fruitVolumeL = pendingFruit.reduce((sum, item) => sum + item.volumeL, 0);
  const spiritVolumeL = pendingSpirit.reduce((sum, item) => sum + item.volumeL, 0);
  const addedVolumeL = fruitVolumeL + spiritVolumeL;
  const sugarSucroseKg =
    presentSugar
      .filter((item) => !inReading(item))
      .reduce((sum, item) => sum + sugarAdditionSucroseKilograms(item), 0) +
    presentWholeFruit
      .filter((item) => !inReading(item))
      .reduce((sum, item) => sum + wholeFruitSucroseKilograms(item), 0);
  const abvWithAdditions =
    abv !== null && measuredVolumeL > 0 && (addedVolumeL > 0 || sugarSucroseKg > 0)
      ? (measuredVolumeL * abv +
          pendingFruit.reduce((sum, item) => {
            const extra =
              lowestFg !== null && item.sg > lowestFg ? abvAdvanced(item.sg, lowestFg) : 0;
            return sum + item.volumeL * extra;
          }, 0) +
          (lowestFg !== null && sugarSucroseKg > 0
            ? measuredVolumeL *
              abvAdvanced(lowestFg + sucroseGravityRise(sugarSucroseKg, measuredVolumeL), lowestFg)
            : 0) +
          pendingSpirit.reduce((sum, item) => sum + item.volumeL * item.abvPercent, 0)) /
        (measuredVolumeL + addedVolumeL)
      : null;

  const kegVolumeL = Math.max(0, Math.min(input.kegVolumeL ?? 0, totalVolumeL));
  const bottleVolumeL = Math.max(0, totalVolumeL - kegVolumeL);

  return {
    components,
    totalVolumeL,
    residualVolumes,
    extractVolumes,
    predictedVolumes,
    excessCarbonation,
    lowestFg,
    taGramsPerLitre,
    srm,
    abv,
    ph,
    og,
    fg,
    predictedFg,
    priming,
    acidShock,
    additionSugarKg,
    additionPrimingSugarKg,
    additionPrimingVolumes,
    abvWithAdditions,
    kegVolumeL,
    bottleVolumeL,
  };
}

/**
 * Crane's acid-shock starter for a blend of this size.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function acidShockStarter(blendVolumeL: Litres): AcidShockStarter {
  const yeastGrams = litresToGallons(blendVolumeL) * ACID_SHOCK_YEAST_GRAMS_PER_GALLON;
  const eachL = yeastGrams * ACID_SHOCK_STARTER_LITRES_PER_GRAM;
  return { yeastGrams, waterL: eachL, acidBeerL: eachL };
}

/**
 * Sucrose-equivalent in a fruit / syrup addition, kg.
 *
 * `points / 46` pounds of sugar per gallon of juice, from Crane's fruit row.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function fruitSugarKilograms(fruit: BlendFruitInput): number {
  const pounds =
    (sgToGravityPoints(fruit.sg) / SUCROSE_POINTS_PER_POUND_PER_GALLON) *
    litresToGallons(fruit.volumeL);
  return poundsToKg(pounds);
}

/**
 * How much of a kilogram of a given sugar ferments like a kilogram of sucrose.
 *
 * This is derived from the yield table in `carbonation.ts` instead of a
 * second table. That table gives the CO₂ per gram of each sugar, and CO₂ and
 * alcohol come from the same reaction in the same proportion, so a sugar that
 * yields four-fifths of sucrose's CO₂ counts as four-fifths of a kilogram of
 * sucrose. Dividing by sucrose's row makes table sugar 1, which matches the
 * sucrose units the fruit row uses.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function sucroseEquivalentFraction(sugar: PrimingSugar): number {
  return PRIMING_SUGAR_CO2_YIELD[sugar] / PRIMING_SUGAR_CO2_YIELD['table-sugar'];
}

/**
 * Sucrose-equivalent in a weighed sugar addition, kg. @see sucroseEquivalentFraction
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function sugarAdditionSucroseKilograms(item: BlendSugarInput): number {
  return item.massKg * sucroseEquivalentFraction(item.sugar);
}

/**
 * Sucrose-equivalent in a bucket of whole fruit, kg.
 *
 * `mass × percent / 100`. The percent already gives the share of the weight
 * that's sugar, and fruit sugar is fructose and glucose, which ferment out as
 * completely as sucrose. Stones and skins are included in the weighed mass
 * and excluded from the percent, so the percent is a share of the whole
 * fruit, not just the flesh.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function wholeFruitSucroseKilograms(item: BlendWholeFruitInput): number {
  return (item.massKg * item.sugarPercent) / 100;
}

/**
 * Extract in a mass of sucrose, in point·litres. It's the same 46 points per
 * pound per gallon with the volume divided back out.
 *
 * We use point·litres because extract adds up in that unit: a mass of sugar
 * carries the same extract whatever volume it's dissolved in, and the volume
 * only decides what gravity that comes to.
 */
function sucrosePointLitres(sucroseKg: number): number {
  return sucroseGravityRise(sucroseKg, 1) * 1000;
}

/**
 * Whole days an addition sat in the blend before packaging, or `null` when
 * the addition or the packaging isn't dated.
 *
 * The caller reads `null` as "can't judge", which leaves the dose unchanged.
 * It doesn't mean "long enough" or "not long enough".
 */
function contactDays(addedOn: Date | null, packagedOn: Date | null): number | null {
  if (addedOn === null || packagedOn === null) return null;
  return daysBetween(addedOn, packagedOn);
}

/**
 * The gravity a mass of sucrose adds to a volume of beer, SG.
 *
 * This is Crane's fruit row in reverse. At 46 points per pound per gallon, a
 * mass spread through a volume adds `(lb / gal) × 46` points, and a point is
 * a thousandth of a gravity unit. It's the same PPG as the fruit row because
 * it's the same sugar; the fruit row just measures it in juice.
 */
function sucroseGravityRise(sucroseKg: number, volumeL: Litres): number {
  if (volumeL <= 0) return 0;
  const points =
    (kgToPounds(sucroseKg) / litresToGallons(volumeL)) * SUCROSE_POINTS_PER_POUND_PER_GALLON;
  return points / 1000;
}

function minFinite(values: readonly (number | null)[]): number | null {
  let min: number | null = null;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) continue;
    if (min === null || value < min) min = value;
  }
  return min;
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/**
 * The blend's derived figures with their breakdowns.
 *
 * There are three explanations because they're three separate calculations a
 * brewer might want to check independently: the carbonation the blend
 * already holds, its pH, and the acid-shock starter.
 *
 * @category Blending, mead and spirits
 * @group Explanations
 */
export function blendExplanations(input: BlendInput): readonly Explanation[] {
  const result = evaluateBlend(input);
  const round = (n: number, dp = 3) => Number(n.toFixed(dp));
  const out: Explanation[] = [];

  out.push(
    explain(result.predictedVolumes ?? 0, {
      label: 'Carbonation the blend already holds',
      formula: 'blend-residual-plus-extract',
      // The extract term is written the way it was actually computed, because
      // a measured blend and an unmeasured one reach it two different ways, and
      // an expression that showed one while the number came from the other
      // would misstate its own arithmetic.
      expression: [
        'predicted = Σ(V × residual(T_peak) × barrelFactor)/ΣV',
        input.measuredFg === null || input.measuredFg === undefined
          ? '0.51 × Σ(V × Δpoints)/ΣV'
          : '0.51 × (measured − driest)',
        ...(result.additionPrimingSugarKg === null ? [] : ['addition sugar as CO₂']),
      ].join(' + '),
      inputs: {
        components: result.components.length,
        totalVolumeL: round(result.totalVolumeL, 2),
        residualVolumes: round(result.residualVolumes ?? 0),
        extractVolumes: round(result.extractVolumes),
        lowestFg: round(result.lowestFg ?? 0, 4),
        targetVolumes: round(input.targetVolumes, 2),
        barrelAgedResidualFactor: BARREL_AGED_RESIDUAL_FACTOR,
        extractCo2VolumesPerGravityPoint: EXTRACT_CO2_VOLUMES_PER_GRAVITY_POINT,
        ...(input.measuredFg === null || input.measuredFg === undefined
          ? {}
          : { measuredFg: round(input.measuredFg, 4) }),
        ...(result.additionPrimingSugarKg === null
          ? {}
          : {
              additionPrimingSugarKg: round(result.additionPrimingSugarKg, 3),
              additionPrimingVolumes: round(result.additionPrimingVolumes),
              additionFermentedDays: ADDITION_FERMENTED_DAYS,
            }),
      },
      unit: 'volumes CO₂',
      notes: [
        "Residual CO₂ is read at each component's peak temperature after attenuation, and halved where the beer sat in a barrel long enough to off-gas.",
        ...(input.measuredFg === null || input.measuredFg === undefined
          ? [
              'Every component sweeter than the driest still has extract in it, and the bugs will keep eating toward that floor in the bottle.',
            ]
          : [
              'The extract still to come is measured on the blend itself. A hydrometer in the vessel is more reliable than summing the gravities the components arrived with.',
            ]),
        ...(result.additionPrimingSugarKg === null
          ? []
          : [
              'An addition that went in less than three weeks before packaging has not fermented out, so its sugar is counted as priming sugar already in the beer and the dose comes down to match.',
            ]),
        ...(result.excessCarbonation
          ? ['The blend already meets or exceeds the target, so no priming sugar is called for.']
          : []),
      ],
      family: 'blending',
      sources: [TONSMEIRE_BLENDING_2014, CRANE_BLENDING_SHEET, BRAUKAISER_CARBONATION],
    }),
  );

  if (result.ph !== null) {
    out.push(
      explain(result.ph, {
        label: 'Blend pH',
        formula: 'hydrogen-ion-volume-weighted',
        expression: 'pH = −log₁₀( Σ(Vᵢ × 10^(−pHᵢ)) / Σ Vᵢ )',
        inputs: {
          components: result.components.filter((c) => c.ph !== null).length,
          totalVolumeL: round(result.totalVolumeL, 2),
          taGramsPerLitre: round(result.taGramsPerLitre ?? 0, 2),
        },
        unit: 'pH',
        notes: [
          'Exact for strong acids and an approximation for a buffered beer; averaging the pH numbers themselves would be worse.',
          'Components with no pH are left out of the average.',
        ],
        family: 'blending',
        sources: [TECHNIQUES_HOME_WINEMAKING_PH, CRANE_BLENDING_SHEET],
      }),
    );
  }

  if (result.acidShock !== null) {
    out.push(
      explain(result.acidShock.yeastGrams, {
        label: 'Acid-shock starter, dry yeast',
        formula: 'acid-shock-starter',
        expression: 'yeast_g = blend_gal × 0.3;  water_L = acid beer_L = yeast_g / 17',
        inputs: {
          totalVolumeL: round(result.totalVolumeL, 2),
          yeastGramsPerGallon: ACID_SHOCK_YEAST_GRAMS_PER_GALLON,
          waterL: round(result.acidShock.waterL, 3),
          acidBeerL: round(result.acidShock.acidBeerL, 3),
        },
        unit: 'g',
        notes: [
          'Pitched 24–48 h before packaging, split half water and half blend, so the yeast acclimates to the acidity before it has to carbonate anything.',
          'The more conservative of the two published rules of thumb.',
        ],
        family: 'blending',
        sources: [CRANE_BLENDING_SHEET, MILK_THE_FUNK_PACKAGING],
      }),
    );
  }

  return out;
}
