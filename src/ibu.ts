/**
 * Bitterness.
 *
 * There are three models to choose from, Tinseth (the default), Rager and
 * Garetz, plus a temperature-corrected treatment of whirlpool and hop-stand
 * additions. Modern hoppy recipes put a lot of their hops there, so without it
 * their IBU figures are badly off.
 *
 * All three models reduce to the same shape:
 *
 * ```
 * IBU = utilisation × (mg/L of alpha acid)
 * mg/L = alphaAcid% / 100 × mass_g × 1000 / volume_L
 * ```
 *
 * and differ only in how utilisation is computed.
 *
 * For a whirlpool addition we also need to know how hot the wort was and how
 * it cooled over the stand. The addition has the temperature the stand started
 * at and, optionally, the one it ended at. The stand models below turn that
 * pair into effective boil-minutes, plus a sentence saying what the stand
 * contributed.
 */

import { resolveCalculationOptions } from './defaults';
import type { Source } from './explain';
import {
  GARETZ_USING_HOPS_1994,
  HOSOM_MIBU_2018,
  MALOWICKI_2005,
  RAGER_1990,
  TINSETH_1997,
} from './sources';
import type {
  CalculationOptions,
  Celsius,
  HopAddition,
  Ibu,
  IbuFormula,
  Litres,
  Minutes,
  Percent,
  SpecificGravity,
} from './types';

// ---------------------------------------------------------------------------
// Tinseth
// ---------------------------------------------------------------------------

/**
 * Tinseth's "bigness factor": `1.65 × 0.000125^(Gb − 1)`.
 *
 * This models how wort gravity suppresses iso-alpha-acid solubility. `Gb` is
 * the boil gravity (SG). Source: Glenn Tinseth, "Hop Utilization" (1997),
 * realbeer.com.
 *
 * @category Hops
 * @group Calculations
 */
export function tinsethBignessFactor(boilGravity: SpecificGravity): number {
  return 1.65 * 0.000125 ** (boilGravity - 1);
}

/**
 * Tinseth's boil-time factor: `(1 − e^(−0.04 t)) / 4.15`.
 *
 * This is the integrated form of a first-order isomerisation with rate 0.04 min⁻¹,
 * normalised so utilisation asymptotes at 1/4.15 ≈ 0.241. Source: Tinseth
 * (1997). `t` is minutes at boiling temperature.
 *
 * @category Hops
 * @group Calculations
 */
export function tinsethBoilTimeFactor(minutes: Minutes): number {
  return (1 - Math.exp(-0.04 * minutes)) / 4.15;
}

/**
 * Tinseth utilisation as a fraction: bigness × boil-time factor.
 *
 * This reproduces Tinseth's published utilisation table, which was generated
 * from this formula. For example, 1.050 at 60 min gives 0.231.
 *
 * @category Hops
 * @group Calculations
 */
export function tinsethUtilization(boilGravity: SpecificGravity, minutes: Minutes): number {
  return tinsethBignessFactor(boilGravity) * tinsethBoilTimeFactor(minutes);
}

// ---------------------------------------------------------------------------
// Rager
// ---------------------------------------------------------------------------

/**
 * Rager utilisation as a fraction: `(18.11 + 13.86 × tanh((t − 31.32) / 18.27)) / 100`.
 *
 * Source: Jackie Rager, *Zymurgy* Special Issue 1990. It runs consistently
 * higher than Tinseth. Rager noted that his numbers suit full-wort boils.
 *
 * @category Hops
 * @group Calculations
 */
export function ragerUtilization(minutes: Minutes): number {
  return (18.11 + 13.86 * Math.tanh((minutes - 31.32) / 18.27)) / 100;
}

/**
 * Rager's gravity adjustment: `(Gb − 1.050) / 0.2` above 1.050, else 0.
 *
 * The final IBU is divided by `(1 + GA)`.
 *
 * @category Hops
 * @group Calculations
 */
export function ragerGravityAdjustment(boilGravity: SpecificGravity): number {
  return boilGravity > 1.05 ? (boilGravity - 1.05) / 0.2 : 0;
}

// ---------------------------------------------------------------------------
// Garetz
// ---------------------------------------------------------------------------

/**
 * Garetz utilisation as a fraction:
 * `(7.2994 + 15.0746 × tanh((t − 21.86) / 24.71)) / 100`, floored at zero.
 *
 * ## Why the floor
 *
 * Garetz published a table of utilisations, and this tanh is the curve people
 * usually fit to it. The fit crosses zero at 8.80 minutes and keeps going. At
 * 5 minutes it gives −1.6 %, and at the couple of effective minutes a
 * whirlpool addition works out to, −2.9 %. Without the floor, those hop
 * additions would make the beer less bitter, and on a modern recipe with a
 * late charge and a stand they'd subtract from the total. None of the rows in
 * Garetz's table are negative. The negative values come from reading the fit
 * outside the range it was fitted over, so we hold it at zero there.
 *
 * We use zero instead of extrapolating the low end of the table, because that
 * would mean inventing a curve Garetz didn't publish. A brewer who wants late
 * additions counted properly can use Tinseth with the temperature-corrected
 * stand model.
 *
 * Source: Mark Garetz, *Using Hops* (1994).
 *
 * @category Hops
 * @group Calculations
 */
export function garetzUtilization(minutes: Minutes): number {
  return Math.max(0, (7.2994 + 15.0746 * Math.tanh((minutes - 21.86) / 24.71)) / 100);
}

/**
 * Garetz's temperature (elevation) factor: `1 + (elevation_ft / 550) × 0.02`.
 *
 * Elevation lowers the boiling point, which slows isomerisation. Takes metres
 * and converts them to feet (1 m = 3.280839895 ft).
 *
 * @category Hops
 * @group Calculations
 */
export function garetzTemperatureFactor(elevationM: number): number {
  return 1 + ((elevationM * 3.280839895) / 550) * 0.02;
}

// ---------------------------------------------------------------------------
// Temperature-corrected isomerisation (whirlpool / hop stand)
// ---------------------------------------------------------------------------

/**
 * Pre-exponential factor of the alpha-acid isomerisation rate, min⁻¹ (Malowicki 2005).
 *
 * @category Hops
 * @group Constants and defaults
 */
export const MALOWICKI_PRE_EXPONENTIAL = 7.9e11;

/**
 * Activation energy over the gas constant for that rate, in kelvin (Malowicki 2005).
 *
 * @category Hops
 * @group Constants and defaults
 */
export const MALOWICKI_EA_OVER_R = 11858;

/**
 * First-order isomerisation rate constant at a temperature, min⁻¹.
 *
 * `k₁(T) = 7.9×10¹¹ × exp(−11858 / T)` with `T` in kelvin. Source: Malowicki,
 * *Hop bitter acid isomerization and degradation kinetics* (MSc, Oregon State,
 * 2005). At 100 °C it returns 0.01245 min⁻¹.
 *
 * This isn't the same as Tinseth's 0.04 min⁻¹. Tinseth's constant is an
 * empirical fit to measured utilisation, so it also includes losses to trub,
 * break and foam. The two are only used together through
 * {@link relativeIsomerisationRate}, which is a ratio. The absolute rate
 * cancels out and only the well-established Arrhenius temperature dependence
 * is left.
 *
 * @category Hops
 * @group Calculations
 */
export function isomerisationRateConstant(tempC: Celsius): number {
  return MALOWICKI_PRE_EXPONENTIAL * Math.exp(-MALOWICKI_EA_OVER_R / (tempC + 273.15));
}

/**
 * Isomerisation rate at a temperature relative to boiling, dimensionless.
 *
 * `r(T) = k₁(T) / k₁(100 °C)`. It's about 0.166 at 80 °C and 0.056 at 60 °C,
 * which is why a 30-minute stand at 80 °C is worth only about five
 * boil-minutes.
 *
 * @category Hops
 * @group Calculations
 */
export function relativeIsomerisationRate(tempC: Celsius): number {
  return isomerisationRateConstant(tempC) / isomerisationRateConstant(100);
}

/**
 * Tuning for {@link standEffectiveBoilMinutes}.
 *
 * @category Hops
 * @group Inputs
 */
export interface StandModelOptions {
  /** Stand duration, minutes. */
  readonly standMinutes: Minutes;
  /** Wort temperature at the start of the stand, °C. */
  readonly startTempC: Celsius;
  /** Ambient temperature the wort decays towards, °C. */
  readonly ambientTempC: Celsius;
  /** Cooling rate constant `k`, per minute. Ignored when {@link endTempC} is usable. */
  readonly coolingRateConstantPerMin: number;
  /** Integration step, minutes. */
  readonly integrationStepMinutes: Minutes;
  /**
   * Wort temperature at the end of the stand, °C, if the brewer knows it.
   *
   * If it's set, `k` is solved so the curve ends there, and
   * {@link coolingRateConstantPerMin} is ignored:
   * `k = ln((T₀ − T_a) / (T_end − T_a)) / t`. An end equal to the start gives
   * `k = 0`, which is the fixed-temperature integral. An end above the start,
   * or at or below ambient, isn't a cooling curve, so the stand is treated as
   * held at the start temperature.
   */
  readonly endTempC?: Celsius;
}

/**
 * Converts a hop stand into effective boil-minutes.
 *
 * Tinseth's boil-time factor is the integral of a first-order process running
 * at a fixed rate. When the rate varies with temperature, the correct
 * substitution is the *time integral of the relative rate*:
 *
 * ```
 * t_eff = ∫₀^t r(T(τ)) dτ
 * ```
 *
 * and then any of the time-based utilisation curves can be evaluated at
 * `t_eff`. That substitution lets the whirlpool models work with all three
 * bitterness formulas without special cases.
 *
 * We assume the wort cools exponentially towards ambient:
 * `T(τ) = T_ambient + (T₀ − T_ambient) · e^(−k τ)`, following the mIBU approach
 * of John-Paul Hosom (*A Modified IBU Calculation*, 2018). The integral uses
 * the trapezium rule. `k` defaults to 0.015 min⁻¹ (see
 * `DEFAULT_WHIRLPOOL_COOLING_RATE_PER_MIN`).
 *
 * The default `k` is a model assumption. A caller that knows the temperature
 * at the end of the stand can pass {@link StandModelOptions.endTempC}, and `k`
 * is solved from the two temperatures. A held stand is the degenerate case of
 * that solve and goes straight to
 * {@link fixedTemperatureStandEffectiveBoilMinutes}.
 *
 * @category Hops
 * @group Calculations
 */
export function standEffectiveBoilMinutes(options: StandModelOptions): Minutes {
  const { standMinutes, startTempC, ambientTempC, endTempC } = options;
  if (standMinutes <= 0) return 0;
  if (endTempC !== undefined && !coolsFrom(startTempC, endTempC, ambientTempC)) {
    // Either the stand was held, or the two temperatures don't describe a
    // cooling curve. Both use the fixed-temperature integral at the start.
    return fixedTemperatureStandEffectiveBoilMinutes(standMinutes, startTempC);
  }
  const coolingRateConstantPerMin =
    endTempC === undefined
      ? options.coolingRateConstantPerMin
      : Math.log((startTempC - ambientTempC) / (endTempC - ambientTempC)) / standMinutes;
  const step = Math.min(Math.max(options.integrationStepMinutes, 1e-4), standMinutes);
  const tempAt = (t: Minutes) =>
    ambientTempC + (startTempC - ambientTempC) * Math.exp(-coolingRateConstantPerMin * t);

  let total = 0;
  let t = 0;
  let previous = relativeIsomerisationRate(tempAt(0));
  while (t < standMinutes) {
    const next = Math.min(t + step, standMinutes);
    const rate = relativeIsomerisationRate(tempAt(next));
    total += ((previous + rate) / 2) * (next - t);
    previous = rate;
    t = next;
  }
  return total;
}

/**
 * A stand held at one temperature for its whole duration:
 * `t_eff = t × r(T)`. This is the simpler of the two stand models. It fits a
 * recirculating whirlpool with active temperature control, and overestimates
 * for a kettle left to cool.
 *
 * @category Hops
 * @group Calculations
 */
export function fixedTemperatureStandEffectiveBoilMinutes(
  standMinutes: Minutes,
  tempC: Celsius,
): Minutes {
  if (standMinutes <= 0) return 0;
  return standMinutes * relativeIsomerisationRate(tempC);
}

/**
 * Whether a start/end pair describes wort cooling towards ambient.
 *
 * Returns false for a held stand, where the two are equal. It also returns
 * false for an end above the start, or at or below ambient. A brewer can type
 * these while entering a real reading, and no exponential decay can reach
 * them.
 */
function coolsFrom(startTempC: Celsius, endTempC: Celsius, ambientTempC: Celsius): boolean {
  return endTempC < startTempC && endTempC > ambientTempC && startTempC > ambientTempC;
}

// ---------------------------------------------------------------------------
// Per-addition IBU
// ---------------------------------------------------------------------------

/**
 * The bitterness contribution of one hop addition.
 *
 * @category Hops
 * @group Results
 */
export interface HopIbuContribution {
  /** Index into the recipe's hop array. */
  readonly index: number;
  /** The addition's {@link HopAddition.id}, when it has one. */
  readonly id?: string;
  /** The addition's display name. */
  readonly name: string;
  /** This addition's bitterness, IBU. */
  readonly ibu: Ibu;
  /** Utilisation achieved, as a fraction. */
  readonly utilizationFraction: number;
  /**
   * Minutes at boiling temperature this addition is equivalent to. For boil
   * additions it's the stated time. For whirlpool additions it's much less
   * than the stand time.
   */
  readonly effectiveBoilMinutes: Minutes;
  /**
   * A one-sentence description of this addition's stand, or `null` if it isn't
   * a whirlpool addition or the whirlpool model is `none`.
   *
   * It's a separate field, and also a line in {@link notes}, so the recipe
   * explanation can show the working per addition without parsing prose.
   */
  readonly standDescription: string | null;
  /** The form multiplier that was applied. */
  readonly formMultiplier: number;
  /** Alpha acid concentration the addition put into the wort, mg/L. */
  readonly alphaAcidMgPerL: number;
  /** Bitterness model that produced the number. */
  readonly formula: IbuFormula;
  /** Why this addition got the treatment it did. */
  readonly notes: readonly string[];
}

/**
 * Input to {@link calculateIbu}.
 *
 * @category Hops
 * @group Inputs
 */
export interface IbuInput {
  /** The hop schedule. Dry and keg hops are included and contribute zero. */
  readonly hops: readonly HopAddition[];
  /** Wort volume the bitterness is expressed against, litres. */
  readonly volumeL: Litres;
  /** Gravity the model's gravity term uses, SG. */
  readonly boilGravity: SpecificGravity;
  /** Total boil length, minutes. First-wort hops are in for all of it. */
  readonly boilTimeMinutes: Minutes;
  /** Calculation options, including the bitterness model. Defaults apply to anything left out. */
  readonly options?: CalculationOptions;
}

/**
 * Result of {@link calculateIbu}.
 *
 * @category Hops
 * @group Results
 */
export interface IbuResult {
  /** Total bitterness, IBU. */
  readonly ibu: Ibu;
  /** Each addition's share, in the order of {@link IbuInput.hops}. */
  readonly contributions: readonly HopIbuContribution[];
  /** Bitterness model that produced the numbers. */
  readonly formula: IbuFormula;
}

/** Whirlpool temperature to use if an addition doesn't give one, °C. */
const FALLBACK_WHIRLPOOL_TEMP_C = 80;

/**
 * Computes total and per-addition IBU.
 *
 * How each use is handled:
 * - `boil`: the stated time at boiling.
 * - `first-wort`: the full boil time, times the first-wort bonus (1.10 by
 *   default). FWH sits in the kettle while it heats and isomerises throughout.
 * - `whirlpool`: the stand converted to effective boil-minutes by the selected
 *   {@link WhirlpoolModel}, along the curve the addition's start and end
 *   temperatures describe. `none` contributes zero.
 * - `dry-hop`: always 0 IBU. Dry hops add aroma and perceived bitterness, but
 *   no measurable iso-alpha-acid.
 * - `keg`: also 0 IBU, for the same reason. Nothing isomerises in a cold keg,
 *   just as in a fermenter, so the two share a branch.
 *
 * @category Hops
 * @group Start here
 */
export function calculateIbu(input: IbuInput): IbuResult {
  const options = resolveCalculationOptions(input.options);
  const formula = options.ibuFormula;
  const contributions: HopIbuContribution[] = [];

  // Garetz's hopping-rate factor depends on the answer, so the whole model is
  // solved by fixed-point iteration; every other model converges immediately.
  let totalIbu = 0;
  const iterations = formula === 'garetz' ? 12 : 1;
  for (let pass = 0; pass < iterations; pass += 1) {
    contributions.length = 0;
    let running = 0;
    for (const [index, hop] of input.hops.entries()) {
      const contribution = contributionFor(index, hop, input, options, totalIbu);
      contributions.push(contribution);
      running += contribution.ibu;
    }
    if (Math.abs(running - totalIbu) < 1e-9) {
      totalIbu = running;
      break;
    }
    totalIbu = running;
  }

  return { ibu: totalIbu, contributions, formula };
}

function contributionFor(
  index: number,
  hop: HopAddition,
  input: IbuInput,
  options: ReturnType<typeof resolveCalculationOptions>,
  currentTotalIbu: Ibu,
): HopIbuContribution {
  const notes: string[] = [];
  const formMultiplier = options.hopFormMultipliers[hop.form] ?? 1;
  const alphaAcidMgPerL =
    input.volumeL > 0
      ? ((hop.alphaAcidPercent / 100) * hop.amountKg * 1_000_000) / input.volumeL
      : 0;

  const base = {
    index,
    name: hop.name,
    standDescription: null,
    formMultiplier,
    alphaAcidMgPerL,
    formula: options.ibuFormula,
  };
  const idPart = hop.id !== undefined ? { id: hop.id } : {};

  // Pre-isomerised extract. We check this before `use` because its bitterness
  // doesn't depend on where in the process it's added. It was isomerised in a
  // factory, so a post-fermentation dose is as bitter as a kettle one. If it
  // fell through to the `dry-hop` branch below, it would report 0 IBU for a
  // product that's only there for bitterness.
  if (hop.form === 'iso-extract') {
    const isoPercent = hop.isoAlphaPercent ?? hop.alphaAcidPercent;
    if (hop.isoAlphaPercent === undefined) {
      notes.push(
        "No iso-alpha figure given, so the alpha-acid percentage was read as one. Enter the product's iso-alpha content for a true figure.",
      );
    }
    const isoMgPerL =
      input.volumeL > 0 ? ((isoPercent / 100) * hop.amountKg * 1_000_000) / input.volumeL : 0;
    const recovery = options.isoExtractRecovery;
    notes.push(
      `Pre-isomerized extract: ${isoMgPerL.toFixed(1)} mg/L iso-alpha × ${recovery} recovery, independent of boil time.`,
    );
    return {
      ...base,
      ...idPart,
      ibu: isoMgPerL * recovery * options.utilizationMultiplier,
      utilizationFraction: recovery,
      effectiveBoilMinutes: 0,
      notes,
    };
  }

  if (hop.use === 'dry-hop' || hop.use === 'keg') {
    notes.push('Dry hops contribute no measurable iso-alpha-acid: 0 IBU by definition.');
    return {
      ...base,
      ...idPart,
      ibu: 0,
      utilizationFraction: 0,
      effectiveBoilMinutes: 0,
      notes,
    };
  }

  let effectiveMinutes: Minutes;
  let useBonus = 1;
  /**
   * Built later because the sentence quotes the addition's own IBU, which
   * isn't known until the utilisation below has been applied.
   */
  let describeStand: ((ibu: Ibu) => string) | null = null;

  if (hop.use === 'first-wort') {
    effectiveMinutes = input.boilTimeMinutes;
    useBonus = options.firstWortMultiplier;
    notes.push(
      `First-wort hop: treated as a full ${input.boilTimeMinutes} min boil addition × ${options.firstWortMultiplier} utilization bonus.`,
    );
  } else if (hop.use === 'whirlpool') {
    const model = options.whirlpool.model;
    const startTempC = hop.whirlpoolTempC ?? FALLBACK_WHIRLPOOL_TEMP_C;
    if (model === 'none') {
      effectiveMinutes = 0;
      notes.push('Whirlpool model "none": stand additions contribute 0 IBU.');
    } else if (model === 'fixed-temperature') {
      effectiveMinutes = fixedTemperatureStandEffectiveBoilMinutes(hop.timeMinutes, startTempC);
      describeStand = (ibu) => heldStand(hop, startTempC, effectiveMinutes, ibu);
    } else {
      effectiveMinutes = standEffectiveBoilMinutes({
        standMinutes: hop.timeMinutes,
        startTempC,
        ambientTempC: options.whirlpool.ambientTempC,
        coolingRateConstantPerMin: options.whirlpool.coolingRateConstantPerMin,
        integrationStepMinutes: options.whirlpool.integrationStepMinutes,
        ...(hop.whirlpoolEndTempC === undefined ? {} : { endTempC: hop.whirlpoolEndTempC }),
      });
      const endTempC = hop.whirlpoolEndTempC;
      describeStand =
        endTempC === undefined
          ? (ibu) =>
              `${standOpening(hop)} from ${degrees(startTempC)} cooling${standWorth(effectiveMinutes, ibu)}`
          : coolsFrom(startTempC, endTempC, options.whirlpool.ambientTempC)
            ? (ibu) =>
                `${standOpening(hop)} from ${degrees(startTempC)} to ${degrees(endTempC)}${standWorth(effectiveMinutes, ibu)}`
            : (ibu) => heldStand(hop, startTempC, effectiveMinutes, ibu);
    }
  } else {
    effectiveMinutes = hop.timeMinutes;
    if (options.whirlpool.includePostBoilIsomerisationForBoilHops) {
      const extra = postBoilExtraMinutes(input, options);
      if (extra > 0) {
        effectiveMinutes += extra;
        notes.push(
          `Boil addition credited with ${extra.toFixed(2)} extra effective boil-minutes of post-flameout isomerization.`,
        );
      }
    }
  }

  const utilization =
    utilizationFor(options.ibuFormula, effectiveMinutes, input.boilGravity, options, {
      volumeL: input.volumeL,
      currentTotalIbu,
    }) *
    formMultiplier *
    useBonus *
    options.utilizationMultiplier;

  const ibu = utilization * alphaAcidMgPerL;
  const standDescription = describeStand === null ? null : describeStand(ibu);
  if (standDescription !== null) notes.push(standDescription);

  return {
    ...base,
    ...idPart,
    standDescription,
    ibu,
    utilizationFraction: utilization,
    effectiveBoilMinutes: effectiveMinutes,
    notes,
  };
}

/**
 * The three stand sentences are all built from these four pieces so they
 * share one shape.
 *
 * Temperatures are in whole degrees because a brewer reads the kettle to the
 * degree. The two derived figures are to one decimal.
 */
function standOpening(hop: HopAddition): string {
  return `${hop.name}, ${hop.timeMinutes} min`;
}

function standWorth(effectiveMinutes: Minutes, ibu: Ibu): string {
  return `: worth ${effectiveMinutes.toFixed(1)} boil minutes, ${ibu.toFixed(1)} IBU.`;
}

function degrees(tempC: Celsius): string {
  return `${tempC.toFixed(0)} °C`;
}

/** A stand at one temperature, whether the brewer chose it or we fell back to it. */
function heldStand(hop: HopAddition, tempC: Celsius, effectiveMinutes: Minutes, ibu: Ibu): string {
  return `${standOpening(hop)} held at ${degrees(tempC)}${standWorth(effectiveMinutes, ibu)}`;
}

/** Longest stand in the recipe, converted to effective boil-minutes. */
function postBoilExtraMinutes(
  input: IbuInput,
  options: ReturnType<typeof resolveCalculationOptions>,
): Minutes {
  let longest = 0;
  for (const hop of input.hops) {
    if (hop.use !== 'whirlpool') continue;
    const startTempC = hop.whirlpoolTempC ?? FALLBACK_WHIRLPOOL_TEMP_C;
    const minutes =
      options.whirlpool.model === 'fixed-temperature'
        ? fixedTemperatureStandEffectiveBoilMinutes(hop.timeMinutes, startTempC)
        : standEffectiveBoilMinutes({
            standMinutes: hop.timeMinutes,
            startTempC,
            ambientTempC: options.whirlpool.ambientTempC,
            coolingRateConstantPerMin: options.whirlpool.coolingRateConstantPerMin,
            integrationStepMinutes: options.whirlpool.integrationStepMinutes,
            ...(hop.whirlpoolEndTempC === undefined ? {} : { endTempC: hop.whirlpoolEndTempC }),
          });
    longest = Math.max(longest, minutes);
  }
  return longest;
}

function utilizationFor(
  formula: IbuFormula,
  minutes: Minutes,
  boilGravity: SpecificGravity,
  options: ReturnType<typeof resolveCalculationOptions>,
  context: { readonly volumeL: Litres; readonly currentTotalIbu: Ibu },
): number {
  switch (formula) {
    case 'rager':
      return ragerUtilization(minutes) / (1 + ragerGravityAdjustment(boilGravity));
    case 'garetz': {
      // Garetz applies three multiplicative penalties to raw utilisation. The
      // concentration factor is 1 here because we already express IBU against
      // the same volume the alpha acids were added to.
      const gravityFactor = (boilGravity - 1.05) / 0.2 + 1;
      const hoppingRateFactor = context.currentTotalIbu / 260 + 1;
      const temperatureFactor = garetzTemperatureFactor(options.elevationM);
      const combined = gravityFactor * hoppingRateFactor * temperatureFactor;
      return garetzUtilization(minutes) / combined;
    }
    default:
      return tinsethUtilization(boilGravity, minutes);
  }
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

/**
 * BU:GU, bitterness units over gravity units, the standard balance figure.
 *
 * `BU:GU = IBU / ((OG − 1) × 1000)`. Around 0.5 is balanced, ≥0.8 is firmly
 * bitter, ≤0.3 is malty.
 *
 * @category Hops
 * @group Calculations
 */
export function buGuRatio(ibu: Ibu, og: SpecificGravity): number {
  const gu = (og - 1) * 1000;
  return gu > 0 ? ibu / gu : 0;
}

/**
 * Which gravity the bitterness model should use, per
 * `CalculationOptions.bitternessGravityBasis`.
 *
 * Tinseth recommends the average gravity over the boil. Most calculators use
 * the post-boil figure, and we default to that so our numbers line up with
 * BeerSmith and Brewfather.
 *
 * @category Hops
 * @group Calculations
 */
export function bitternessGravity(
  basis: 'pre-boil' | 'post-boil' | 'average-boil',
  preBoilGravity: SpecificGravity,
  postBoilGravity: SpecificGravity,
): SpecificGravity {
  switch (basis) {
    case 'pre-boil':
      return preBoilGravity;
    case 'average-boil':
      return (preBoilGravity + postBoilGravity) / 2;
    default:
      return postBoilGravity;
  }
}

/**
 * The citation key each bitterness model reports in its explanation.
 *
 * @category Hops
 * @internal
 */
export const IBU_FORMULA_NAMES: Readonly<Record<IbuFormula, string>> = {
  tinseth: 'tinseth-1997',
  rager: 'rager-1990',
  garetz: 'garetz-1994',
};

/**
 * The formula each bitterness model applies, written out for the explanation.
 *
 * @category Hops
 * @internal
 */
export const IBU_FORMULA_EXPRESSIONS: Readonly<Record<IbuFormula, string>> = {
  tinseth: 'IBU = 1.65 × 0.000125^(Gb−1) × (1 − e^(−0.04t))/4.15 × (AA% × g × 1000 / L)',
  rager: 'IBU = (18.11 + 13.86 tanh((t−31.32)/18.27))/100 × (AA% × g × 1000 / L) / (1 + GA)',
  garetz: 'IBU = U(t) × (AA% × g × 1000 / L) / (GF × HF × TF)',
};

/**
 * Where each bitterness model comes from, for the explanation's citation.
 *
 * @category Hops
 * @internal
 */
export const IBU_FORMULA_SOURCES: Readonly<Record<IbuFormula, readonly Source[]>> = {
  tinseth: [TINSETH_1997],
  rager: [RAGER_1990],
  garetz: [GARETZ_USING_HOPS_1994],
};

/**
 * The extra citations a temperature-corrected hop stand brings in.
 *
 * The stand models plug into whichever utilisation curve is selected, so
 * these are cited alongside the model's own source.
 *
 * @category Hops
 * @internal
 */
export const WHIRLPOOL_SOURCES: readonly Source[] = [MALOWICKI_2005, HOSOM_MIBU_2018];

/**
 * Total alpha acid added to the kettle, in mg/L of the given volume.
 *
 * @category Hops
 * @group Calculations
 */
export function alphaAcidUnits(hops: readonly HopAddition[], volumeL: Litres): number {
  if (volumeL <= 0) return 0;
  let total = 0;
  for (const hop of hops) {
    // Fermenter and keg additions never go in the kettle, so they don't count
    // towards the alpha acid that went into the boil.
    if (hop.use === 'dry-hop' || hop.use === 'keg') continue;
    total += ((hop.alphaAcidPercent / 100) * hop.amountKg * 1_000_000) / volumeL;
  }
  return total;
}

/**
 * Alpha-acid percentage as a fraction, for callers that want the raw number.
 *
 * @category Hops
 * @group Calculations
 */
export function alphaAcidFraction(percent: Percent): number {
  return percent / 100;
}
