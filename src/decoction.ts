/**
 * Decoction mashing. The method, with the derivation of the balance below, is
 * written out in `docs/decoction.md`.
 *
 * Part of the mash is pulled into a pot, boiled, and stirred back in; the
 * returned heat carries the rest of the mash up to the next step. The pull is
 * sized so that it lands on the step temperature:
 *
 * ```
 *            C·(T₂ − T_r) + e·(T_ret − T₂)
 * C_pull  =  ─────────────────────────────
 *                    T_ret − T_r
 * ```
 *
 * where `C = W + c·G` is the mash's heat capacity in water-equivalent litres,
 * `T_r` is what the tun has drifted down to by the time the decoction comes
 * back, `T_ret` is the temperature it comes back *at*, and `e` is the water the
 * pot boiled away.
 *
 * ## How this relates to `volumes.ts`' `decoctionVolume`
 *
 * {@link decoctionVolume} is the classic form and calls into this module. This
 * module drops three of the classic form's assumptions. Each one makes the
 * classic pull too small, so the mash undershoots the rest.
 *
 * - **The tun cools while the decoction is out.** A thick pull is away for
 *   35–50 minutes once its conversion rest, its ramp to the boil, the boil and
 *   a slow return are counted. An insulated cooler drops 1–3 °C in that window;
 *   on a 10 °C step that is a 10–30 % error in the pull.
 * - **The pull does not come back at 100 °C.** It comes back at 96–99 °C, cooled
 *   by the pot, the transfer and the stirring-in.
 * - **The boil costs water.** Three 20-minute decoction boils evaporate
 *   1.5–3 L, which never reaches the kettle and which thickens the mash step by
 *   step.
 *
 * Set the standing loss to zero, the return temperature to 100 °C and the
 * boil-off to zero, and the formula above reduces to
 * `C·(T₂ − T₁)/(100 − T₁)`. We rely on that: a recipe with no decoction detail
 * gets the classic number to the last decimal, and `decoction.test.ts` checks
 * it.
 *
 * ## Heat capacity and pot volume
 *
 * `C_pull` is in *water-equivalent litres*, which is a heat capacity, not a
 * volume you can pour. Converting it to the litre mark on the pot needs
 * something the classic formula never asks for: **how thick the pull is**.
 * Grain has `c ≈ 0.4` of water's specific heat, so at the same volume a thick
 * pull and a thin one differ in capacity by about 16 %. Sizing them the same
 * way is the largest error in the textbook form, and {@link resolvePullRatio}
 * is where this module accounts for it.
 *
 * Thickness has a floor above zero. Grain can't be pulled drier than the
 * liquid it holds, so the floor is the rig's grain absorption (~1 L/kg). A
 * "thick" pull at 0.5 L/kg isn't something anyone can lift out of a tun.
 *
 * ## A thick pull needs a bigger volume
 *
 * Grain solids are dense — 1 / 0.6676 ≈ 1.5 kg per litre of the volume they
 * displace — but they carry only `c = 0.4` of water's specific heat per
 * kilogram. Multiply the two and a litre of grain solids holds about 0.6 of the
 * heat a litre of water does, so at 1 L/kg a thick pull carries 0.84 of the
 * capacity per litre of pot that a liquid pull carries, and has to be about
 * 19 % larger to do the same job.
 *
 * This goes against the idea that a thick pull is "more concentrated", and it's
 * why the traditional thick decoction is quoted as roughly a third of the mash
 * while a thin one is smaller. It also means the usual limit is grain, not
 * water. A thick pull out of a 3 L/kg mash is grain-rich compared with the tun
 * it comes from, so on a big step the tun runs out of grain long before it
 * runs out of liquid. That case raises `pull-exceeds-mash`.
 *
 * ## What this module does not model
 *
 * Colour, efficiency and mash pH. A decoction does change all three, but the
 * effect depends so much on the process that a confident number would be worse
 * than none. `docs/decoction.md` explains each one. This module covers the heat
 * balance and the water bookkeeping, which can both be calculated exactly.
 */

import {
  DEFAULT_DECOCTION_BOIL_OFF_L_PER_HOUR,
  DEFAULT_EQUIPMENT_PROFILE,
  DEFAULT_MASH_STANDING_LOSS_C_PER_HOUR,
  GRAIN_DISPLACEMENT_L_PER_KG,
  GRAIN_SPECIFIC_HEAT_RATIO,
} from './defaults';
import type { Explanation } from './explain';
import { explain } from './explain';
import { PALMER_HOW_TO_BREW } from './sources';
import type {
  Celsius,
  DecoctionSpec,
  DecoctionThickness,
  Kilograms,
  Litres,
  MashStep,
  Minutes,
} from './types';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * How long a decoction boils when the step does not say, **minutes**.
 *
 * This is the middle of the traditional range: Czech triple-decoction schedules
 * run 10–20 minutes a pull, German practice 15–30. It's long enough for the
 * Maillard development the technique is done for, and short enough that the
 * pot doesn't boil off too much of the mash's water.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DEFAULT_DECOCTION_BOIL_MINUTES = 20;

/**
 * Temperature a decoction is back at when it is stirred in, **°C**.
 *
 * The pull doesn't come back at 100 °C. The pot is carried, poured slowly and
 * stirred into a mash 40 °C colder than it is. 98 °C is a realistic planning
 * figure and errs on the safe side, since assuming 100 makes every pull too
 * small.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DEFAULT_DECOCTION_RETURN_TEMP_C = 98;

/**
 * Minutes to bring a pulled decoction from its rest to a boil, on a domestic burner.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DEFAULT_DECOCTION_RAMP_MINUTES = 12;

/**
 * Minutes to return a decoction to the tun, stirring as it goes.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DEFAULT_DECOCTION_RETURN_MINUTES = 5;

/**
 * Water per kilogram of grain in a `medium` pull, **litres per kilogram**.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const MEDIUM_DECOCTION_RATIO_L_PER_KG = 1.5;

/**
 * Fraction of the mash's heat capacity above which a pull gets a warning.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DECOCTION_DOMINATES_MASH_FRACTION = 0.5;

/**
 * Mash thickness below which the schedule has boiled away too much water,
 * **litres per kilogram**.
 *
 * The ratio falls as the decoctions evaporate (*lower* L/kg is *thicker*), and
 * below about 2 L/kg a mash is stiff enough to stir badly and convert unevenly.
 * Traditional decoction schedules start thin, at 3 L/kg and up, because they
 * lose water to the pot.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DECOCTION_MASH_THICKENED_L_PER_KG = 2.0;

/**
 * Minutes a decoction schedule can add to the brew day before it gets a note.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DECOCTION_LONG_BREW_DAY_MINUTES = 90;

/** Floating-point slack for the feasibility comparisons, in litres or kilograms. */
const EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/**
 * Problems with a decoction, plus notes the brewer should see.
 *
 * @category Decoction
 * @group Results
 */
export type DecoctionIssueCode =
  /** The pull is bigger than the mash it comes out of. */
  | 'pull-exceeds-mash'
  /** The pull does not fit the pot it would be boiled in. */
  | 'pull-exceeds-pot'
  /** Boiling mash is not hot enough to reach the target rest. */
  | 'target-unreachable'
  /** The requested pull was thicker than grain can be drained. */
  | 'thickness-clamped'
  /** A grain-free pull wants more free liquid than the mash holds. */
  | 'thin-pull-short-of-liquid'
  /** More than half the mash, by heat capacity, is in the pot. */
  | 'pull-dominates-mash'
  /** The boil would evaporate the pull dry. */
  | 'evaporation-exceeds-pull'
  /** The schedule's evaporation leaves the mash too stiff. */
  | 'mash-thickened'
  /** A thick pull will scorch if it is not stirred. */
  | 'scorch-risk'
  /** The schedule is a long day. */
  | 'long-brew-day';

/**
 * One problem with a decoction, as structured data.
 *
 * `error` means the pull as specified can't happen, and the numbers next to it
 * are only arithmetic, not advice. `warning` means it can happen but probably
 * shouldn't. `note` means it will happen and there's something the brewer
 * should know. Callers sort by `severity`. `decoctionWarnings` flattens issues
 * into the string list `RecipeCalculation.warnings` takes.
 *
 * @category Decoction
 * @group Results
 */
export interface DecoctionIssue {
  /** Which problem this is. */
  readonly code: DecoctionIssueCode;
  /** How serious it is: `error`, `warning` or `note`, as described above. */
  readonly severity: 'error' | 'warning' | 'note';
  /**
   * What's wrong and what to do about it, as a full sentence.
   *
   * Some messages run past a hundred characters, which is too long for a table
   * cell. Use {@link short} there.
   */
  readonly message: string;
  /**
   * The same problem in a few words, for places with no room, such as a table
   * cell.
   *
   * Truncating {@link message} would cut it off partway through the advice,
   * which is the part that tells the brewer what to do. So `short` says what's
   * wrong and `message` says what to do.
   */
  readonly short: string;
  /**
   * {@link message} with each of its numbers replaced by a `{name}` placeholder
   * naming an entry in {@link quantities}.
   *
   * Set on every issue that quotes a measurement, and absent on the ones that
   * quote a percentage, a number of minutes or no number at all. A caller that
   * shows gallons instead of litres renders this with
   * {@link renderDecoctionIssue}. Anything else can use `message` as it is.
   */
  readonly template?: string;
  /**
   * The numbers that fill {@link template}'s placeholders, canonical and
   * unrounded.
   *
   * Keyed by placeholder name. They're canonical because the rest of the
   * package uses canonical units and a display layer needs them as input. The
   * litres in `message` are rendered from these.
   */
  readonly quantities?: Readonly<Record<string, DecoctionQuantity>>;
}

/**
 * What one of a {@link DecoctionIssue}'s embedded numbers measures.
 *
 * @category Decoction
 * @group Results
 */
export type DecoctionQuantityKind = 'volume' | 'temperature' | 'thickness';

/**
 * One number quoted inside a {@link DecoctionIssue}, in the unit core stores.
 *
 * @category Decoction
 * @group Results
 */
export interface DecoctionQuantity {
  /** What the number measures, which decides the unit it's converted to. */
  readonly kind: DecoctionQuantityKind;
  /** Canonical: litres, °C, or L/kg. */
  readonly value: number;
  /**
   * Decimal places the **canonical** rendering rounds to, overriding the
   * default for the kind (volume 1, temperature 1, thickness 2).
   *
   * Set only where a message needs a fixed precision. The return temperature of
   * an unreachable target is quoted to the whole degree. A display formatter
   * should keep its own precision for gallons or °F.
   */
  readonly precision?: number;
}

/**
 * An issue's sentence, with its numbers written in whatever units the reader
 * uses.
 *
 * `format` gets each quantity and returns the number *and its unit*. The
 * templates have no units of their own, because "5.3 gal" and "20.1 L" differ
 * in more than the digits. An issue with no template renders as its
 * {@link DecoctionIssue.message}. So does one where a placeholder has no
 * matching quantity, because a brewer reads this sentence and one in canonical
 * units is better than a broken one.
 *
 * @category Decoction
 * @group Calculations
 */
export function renderDecoctionIssue(
  issue: DecoctionIssue,
  format: (quantity: DecoctionQuantity) => string,
): string {
  if (issue.template === undefined || issue.quantities === undefined) return issue.message;
  const rendered = renderTemplate(issue.template, issue.quantities, format);
  return rendered ?? issue.message;
}

/** Substitute every `{name}`, or `null` if one of them names no quantity. */
function renderTemplate(
  template: string,
  quantities: Readonly<Record<string, DecoctionQuantity>>,
  format: (quantity: DecoctionQuantity) => string,
): string | null {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const quantity = quantities[name];
    if (quantity === undefined) {
      missing = true;
      return whole;
    }
    return format(quantity);
  });
  return missing ? null : out;
}

/** Decimal places a canonical quantity is quoted to when it does not say. */
const CANONICAL_PRECISION: Readonly<Record<DecoctionQuantityKind, number>> = {
  volume: 1,
  temperature: 1,
  thickness: 2,
};

/** A quantity in the units this package stores, as {@link DecoctionIssue.message} shows it. */
function canonicalQuantity(quantity: DecoctionQuantity): string {
  const decimals = quantity.precision ?? CANONICAL_PRECISION[quantity.kind];
  const value = quantity.value.toFixed(decimals);
  switch (quantity.kind) {
    case 'volume':
      return `${value} L`;
    case 'temperature':
      return `${value} °C`;
    case 'thickness':
      return `${value} L/kg`;
  }
}

/**
 * An issue whose sentence quotes measurements, written once as a template.
 *
 * {@link DecoctionIssue.message} is the template rendered in canonical units.
 * That way the string in `decoctionWarnings` and `RecipeCalculation.warnings`
 * can't drift from the one a caller renders in its own units, because both come
 * from the same template.
 */
function quantifiedIssue(a: {
  code: DecoctionIssueCode;
  severity: DecoctionIssue['severity'];
  short: string;
  template: string;
  quantities: Readonly<Record<string, DecoctionQuantity>>;
}): DecoctionIssue {
  return {
    code: a.code,
    severity: a.severity,
    short: a.short,
    message: renderTemplate(a.template, a.quantities, canonicalQuantity) ?? a.template,
    template: a.template,
    quantities: a.quantities,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * The rig's contribution to a decoction, all optional.
 *
 * These are properties of a mash tun, a pot and a burner, not of a recipe,
 * which is also why `mashTunThermalMassLEquivalent` is on the equipment
 * profile. They're passed as plain numbers here, and the caller fills them from
 * the profile.
 *
 * @category Decoction
 * @group Inputs
 */
export interface DecoctionRigOptions {
  /** Ratio of grain to water specific heat. Defaults to 0.4. */
  readonly grainSpecificHeatRatio?: number;
  /** Liquid the grain holds, **L/kg**. The floor on how thick a pull can be. Defaults to 1.0. */
  readonly grainAbsorptionLPerKg?: number;
  /** Volume the grain itself occupies, **L/kg**. Defaults to 0.6676. */
  readonly grainDisplacementLPerKg?: number;
  /** Temperature the pull is at when it is stirred back in, **°C**. Defaults to 98. */
  readonly returnTempC?: Celsius;
  /** Evaporation from the decoction pot, **L/h**. Defaults to 1.5. */
  readonly boilOffLPerHour?: number;
  /** Heat the resting mash loses, **°C/h**. Defaults to 2. */
  readonly standingLossCPerHour?: number;
  /** Minutes to bring the pull to a boil. Defaults to 12. */
  readonly rampMinutes?: Minutes;
  /** Minutes to return the pull to the tun. Defaults to 5. */
  readonly returnMinutes?: Minutes;
  /** Decoction pot capacity, **litres**. Only used to raise a feasibility issue. */
  readonly potVolumeL?: Litres;
}

/**
 * Input to {@link decoctionPull}.
 *
 * @category Decoction
 * @group Inputs
 */
export interface DecoctionPullInput extends DecoctionRigOptions {
  /** Water in the mash before the pull, **litres**. */
  readonly mashWaterL: Litres;
  /** Grain in the mash, **kilograms**. */
  readonly mashGrainKg: Kilograms;
  /** Temperature the mash is resting at, **°C**. */
  readonly currentTempC: Celsius;
  /** Temperature the step is aiming for, **°C**. */
  readonly targetTempC: Celsius;
  /** How the brewer wants the pull taken. Defaults to a thick pull, boiled 20 minutes. */
  readonly spec?: DecoctionSpec;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/**
 * The mash left behind once a decoction has been returned.
 *
 * @category Decoction
 * @group Results
 */
export interface MashAfterDecoction {
  /** Water still in the tun, **litres**, after the pull's evaporation. */
  readonly waterL: Litres;
  /** Grain in the tun, **kilograms**. Unchanged, because a decoction returns its grain. */
  readonly grainKg: Kilograms;
  /** Where the mash actually landed, **°C**. */
  readonly tempC: Celsius;
  /** Thickness after the return, **litres per kilogram**. */
  readonly thicknessLPerKg: number;
}

/**
 * One sized decoction.
 *
 * @category Decoction
 * @group Results
 */
export interface DecoctionPull {
  /** What the pot reads once the pull is in it, **litres**. */
  readonly pullVolumeL: Litres;
  /** Grain in the pull, **kilograms**. Zero for a `thin` pull. */
  readonly pullGrainKg: Kilograms;
  /** Liquid in the pull, **litres**. */
  readonly pullWaterL: Litres;
  /** The pull's heat capacity, **water-equivalent litres** — `w + c·g`. */
  readonly heatCapacityLEquivalent: Litres;
  /** Water per kilogram of grain in the pull after clamping, **litres per kilogram**. */
  readonly ratioLPerKg: number;
  /** Water the boil evaporates, **litres**. */
  readonly evaporationL: Litres;
  /** Temperature the pull returns at, **°C**. */
  readonly returnTempC: Celsius;
  /**
   * Temperature the mash was resting at when the pull was taken, **°C**.
   *
   * Reported because {@link restTempAtReturnC} only makes sense next to it.
   * The difference is the drift, which is zero on a rig that heats the mash
   * while it rests. A caller that shows only one of them can't tell a tun that
   * cooled from one that held temperature.
   */
  readonly currentTempC: Celsius;
  /** What the resting mash has drifted to by the time the pull returns, **°C**. */
  readonly restTempAtReturnC: Celsius;
  /** How long the pull is out of the tun, **minutes** — rest + ramp + boil + return. */
  readonly awayMinutes: Minutes;
  /**
   * Where the mash actually lands, **°C**.
   *
   * Equal to the target for a pull this module sized. It differs when the
   * brewer set {@link DecoctionSpec.pullVolumeL} to fit their own pot, which is
   * why it's reported.
   */
  readonly achievedTempC: Celsius;
  /** The pull as a fraction of the mash, **by heat capacity**, 0–1. */
  readonly fractionOfMash: number;
  /** Index of the rest this pull reaches, into {@link DecoctionPlanInput.steps}. */
  readonly stepIndex: number;
  /** The mash the next step starts from. */
  readonly mashAfter: MashAfterDecoction;
  /** Problems with this pull. */
  readonly issues: readonly DecoctionIssue[];
  /** The breakdown behind {@link pullVolumeL}. */
  readonly explain: Explanation;
}

/**
 * One rest in a mash schedule, decocted or not.
 *
 * Every rest is listed, not only the decocted ones, because a decoction is
 * sized against the rest just before it, and that rest is often reached some
 * other way. A Hochkurz mash infuses to 62 °C and decocts from there. Given
 * only the decoctions, {@link planDecoctions} would size the second pull as if
 * it started from the first pull's target, which isn't true on a mixed
 * schedule.
 *
 * @category Decoction
 * @group Inputs
 */
export interface DecoctionScheduleStep {
  /** Rest temperature, **°C**. */
  readonly targetTempC: Celsius;
  /** Whether this rest is reached by pulling a decoction. */
  readonly decoction: boolean;
  /** How the pull is taken. Ignored unless {@link decoction}. */
  readonly spec?: DecoctionSpec;
  /**
   * Water an infusion adds to reach this rest, **litres**. Defaults to 0.
   *
   * Carried through because it changes the mash a later decoction is sized
   * against. An infusion between two pulls both dilutes the tun and adds to it.
   */
  readonly waterAddedL?: Litres;
}

/**
 * Input to {@link planDecoctions}.
 *
 * @category Decoction
 * @group Inputs
 */
export interface DecoctionPlanInput extends DecoctionRigOptions {
  /** Water in the mash at dough-in, **litres**. */
  readonly mashWaterL: Litres;
  /** Grain in the mash, **kilograms**. */
  readonly mashGrainKg: Kilograms;
  /** Temperature of the first rest, **°C** — where the strike water landed. */
  readonly startTempC: Celsius;
  /** The decoctions, in execution order. */
  readonly steps: readonly DecoctionScheduleStep[];
}

/**
 * A whole decoction schedule, each pull sized against the mash the last one left.
 *
 * @category Decoction
 * @group Results
 */
export interface DecoctionPlan {
  /** Each pull, in execution order. */
  readonly pulls: readonly DecoctionPull[];
  /** Water the pots boil away across the schedule, **litres**. */
  readonly totalEvaporationL: Litres;
  /** Minutes the decoctions add to the brew day. */
  readonly addedBrewDayMinutes: Minutes;
  /** Mash thickness once every pull is back, **litres per kilogram**. */
  readonly finalMashThicknessLPerKg: number;
  /** Problems with the schedule as a whole. Per-pull problems live on the pull. */
  readonly issues: readonly DecoctionIssue[];
}

// ---------------------------------------------------------------------------
// Thickness
// ---------------------------------------------------------------------------

/**
 * Water per kilogram of grain for a named pull thickness, **litres per
 * kilogram** — or `null` for `thin`, which takes no grain at all.
 *
 * `thick` is the rig's grain absorption because that's the physical floor.
 * Grain drained on a slotted spoon still holds about a litre of liquid per
 * kilogram, and no scooping technique gets below it.
 *
 * @category Decoction
 * @group Calculations
 */
export function thicknessRatioLPerKg(
  thickness: DecoctionThickness,
  grainAbsorptionLPerKg: number,
): number | null {
  switch (thickness) {
    case 'thick':
      return grainAbsorptionLPerKg;
    case 'medium':
      return MEDIUM_DECOCTION_RATIO_L_PER_KG;
    case 'thin':
      return null;
  }
}

/**
 * The pull ratio a spec asks for, clamped to what's physically possible.
 *
 * Returns `null` for a grain-free pull. An explicit `ratioLPerKg` wins over
 * `thickness`. Either way the result is never below the grain's own
 * absorption, and `clamped` says whether that floor was applied.
 *
 * @category Decoction
 * @group Calculations
 */
export function resolvePullRatio(
  spec: DecoctionSpec | undefined,
  grainAbsorptionLPerKg: number,
): {
  /** Liters of liquid per kilogram of grain in the pull, or `null` for a grain-free pull. */
  readonly ratioLPerKg: number | null;
  /** `true` when the requested ratio was below the grain's absorption and was raised to it. */
  readonly clamped: boolean;
} {
  const requested =
    spec?.ratioLPerKg ?? thicknessRatioLPerKg(spec?.thickness ?? 'thick', grainAbsorptionLPerKg);
  if (requested === null) return { ratioLPerKg: null, clamped: false };
  if (requested < grainAbsorptionLPerKg) {
    return { ratioLPerKg: grainAbsorptionLPerKg, clamped: true };
  }
  return { ratioLPerKg: requested, clamped: false };
}

// ---------------------------------------------------------------------------
// The pull
// ---------------------------------------------------------------------------

/**
 * Size one decoction.
 *
 * Uses the heat balance derived in `docs/decoction.md`, against the mash as it
 * will be *when the pull comes back*, not as it is when the pull leaves. The
 * module comment explains why those differ and by how much.
 *
 * Edge cases get the same answers as in the classic form, since
 * {@link decoctionVolume} calls this: a target at or below the mash's current
 * temperature pulls nothing, and a target at or above the return temperature
 * is unreachable and reports an infinite capacity instead of a wrong volume
 * that looks plausible.
 *
 * @category Decoction
 * @group Start here
 */
export function decoctionPull(input: DecoctionPullInput): DecoctionPull {
  const c = input.grainSpecificHeatRatio ?? GRAIN_SPECIFIC_HEAT_RATIO;
  const absorption = input.grainAbsorptionLPerKg ?? DEFAULT_EQUIPMENT_PROFILE.grainAbsorptionLPerKg;
  const displacement = input.grainDisplacementLPerKg ?? GRAIN_DISPLACEMENT_L_PER_KG;
  const returnTempC = input.returnTempC ?? DEFAULT_DECOCTION_RETURN_TEMP_C;
  const boilOffLPerHour = input.boilOffLPerHour ?? DEFAULT_DECOCTION_BOIL_OFF_L_PER_HOUR;
  const standingLoss = input.standingLossCPerHour ?? DEFAULT_MASH_STANDING_LOSS_C_PER_HOUR;
  const rampMinutes = input.rampMinutes ?? DEFAULT_DECOCTION_RAMP_MINUTES;
  const returnMinutes = input.returnMinutes ?? DEFAULT_DECOCTION_RETURN_MINUTES;

  const spec = input.spec;
  const boilMinutes = spec?.boilMinutes ?? DEFAULT_DECOCTION_BOIL_MINUTES;
  const restMinutes = spec?.restBeforeBoil?.minutes ?? 0;

  const W = input.mashWaterL;
  const G = input.mashGrainKg;
  const T1 = input.currentTempC;
  const T2 = input.targetTempC;

  const mashCapacityL = W + c * G;
  const awayMinutes = restMinutes + rampMinutes + boilMinutes + returnMinutes;
  const restTempAtReturnC = T1 - standingLoss * (awayMinutes / 60);
  const evaporationL = boilOffLPerHour * (boilMinutes / 60);

  const issues: DecoctionIssue[] = [];
  const { ratioLPerKg, clamped } = resolvePullRatio(spec, absorption);
  if (clamped) {
    issues.push(
      quantifiedIssue({
        code: 'thickness-clamped',
        severity: 'note',
        short: 'Thickened to what grain holds',
        template: 'Pull thickened to {absorption}: drained grain still holds that much liquid.',
        quantities: { absorption: { kind: 'thickness', value: absorption } },
      }),
    );
  }

  // The two edge cases, kept identical to the classic form.
  //
  // The first check compares the step temperatures, not the drifted one. That
  // matters once standing loss is modelled: a mash at 72 °C with a 72 °C target
  // will have drifted below 72 by the time any pull could return, but the
  // schedule doesn't call for a pull there. The standing-loss term only corrects
  // a pull the schedule already asks for. With the loss set to zero the two
  // checks agree, which keeps `decoctionVolume`'s results exact.
  if (T2 - T1 <= 0) {
    return emptyPull({
      W,
      G,
      c,
      ratioLPerKg,
      evaporationL: 0,
      returnTempC,
      restTempAtReturnC,
      awayMinutes,
      mashCapacityL,
      T1,
      T2,
      issues,
    });
  }
  if (returnTempC - T2 <= 0) {
    issues.push(
      quantifiedIssue({
        code: 'target-unreachable',
        severity: 'error',
        short: 'Too hot to reach',
        template: 'A decoction returning at {returnTemp} cannot raise the mash to {targetTemp}.',
        quantities: {
          // Whole degrees, because the return temperature is an assumption
          // about the rig, not a measurement. 98.0 would suggest a precision
          // nobody set.
          returnTemp: { kind: 'temperature', value: returnTempC, precision: 0 },
          targetTemp: { kind: 'temperature', value: T2 },
        },
      }),
    );
    return infinitePull({
      W,
      G,
      ratioLPerKg,
      evaporationL,
      returnTempC,
      restTempAtReturnC,
      awayMinutes,
      mashCapacityL,
      T1,
      T2,
      issues,
    });
  }

  // The heat balance: the pull's heat capacity, in water-equivalent litres.
  const solvedCapacityL =
    (mashCapacityL * (T2 - restTempAtReturnC) + evaporationL * (returnTempC - T2)) /
    (returnTempC - restTempAtReturnC);

  // Capacity into a bucket at the requested thickness: g = C_pull / (ρ + c), w = ρ·g.
  let pullGrainKg: Kilograms;
  let pullWaterL: Litres;
  if (spec?.pullVolumeL !== undefined) {
    // The brewer set the volume. Split it at the same ratio and let
    // `achievedTempC` report where the mash actually lands.
    const v = Math.max(0, spec.pullVolumeL);
    if (ratioLPerKg === null) {
      pullGrainKg = 0;
      pullWaterL = v;
    } else {
      pullGrainKg = v / (ratioLPerKg + displacement);
      pullWaterL = ratioLPerKg * pullGrainKg;
    }
  } else if (ratioLPerKg === null) {
    pullGrainKg = 0;
    pullWaterL = solvedCapacityL;
  } else {
    pullGrainKg = solvedCapacityL / (ratioLPerKg + c);
    pullWaterL = ratioLPerKg * pullGrainKg;
  }

  const heatCapacityLEquivalent = pullWaterL + c * pullGrainKg;
  const pullVolumeL = pullWaterL + pullGrainKg * displacement;
  const fractionOfMash = mashCapacityL > 0 ? heatCapacityLEquivalent / mashCapacityL : 0;

  // Mix the returned pull back into what stayed behind. For the solved pull this
  // gives T₂ exactly. For an overridden volume it gives the real result, which
  // is why we compute it instead of assuming T₂.
  const remainderCapacityL = mashCapacityL - heatCapacityLEquivalent;
  const returnedCapacityL = heatCapacityLEquivalent - evaporationL;
  const totalCapacityL = returnedCapacityL + remainderCapacityL;
  const achievedTempC =
    totalCapacityL > 0
      ? (returnedCapacityL * returnTempC + remainderCapacityL * restTempAtReturnC) / totalCapacityL
      : T2;

  issues.push(
    ...pullIssues({
      W,
      G,
      absorption,
      pullGrainKg,
      pullWaterL,
      pullVolumeL,
      heatCapacityLEquivalent,
      mashCapacityL,
      evaporationL,
      fractionOfMash,
      ratioLPerKg,
      potVolumeL: input.potVolumeL,
    }),
  );

  const waterAfterL = Math.max(0, W - evaporationL);
  return {
    pullVolumeL,
    pullGrainKg,
    pullWaterL,
    heatCapacityLEquivalent,
    ratioLPerKg: ratioLPerKg ?? 0,
    evaporationL,
    returnTempC,
    currentTempC: T1,
    restTempAtReturnC,
    awayMinutes,
    achievedTempC,
    fractionOfMash,
    stepIndex: 0,
    mashAfter: {
      waterL: waterAfterL,
      grainKg: G,
      tempC: achievedTempC,
      thicknessLPerKg: G > 0 ? waterAfterL / G : 0,
    },
    issues,
    explain: explain(pullVolumeL, {
      label: 'Decoction pull',
      formula: 'decoction-heat-balance',
      expression: 'C_pull = (C·(T₂ − T_r) + e·(T_ret − T₂)) / (T_ret − T_r)',
      inputs: {
        mashWaterL: W,
        mashGrainKg: G,
        mashCapacityLEquivalent: mashCapacityL,
        currentTempC: T1,
        targetTempC: T2,
        restTempAtReturnC,
        returnTempC,
        evaporationL,
        pullCapacityLEquivalent: heatCapacityLEquivalent,
        ratioLPerKg: ratioLPerKg ?? 0,
        grainSpecificHeatRatio: c,
      },
      unit: 'L',
      notes: pullNotes(ratioLPerKg, spec, awayMinutes, T1, restTempAtReturnC),
      family: 'decoction',
      sources: [PALMER_HOW_TO_BREW],
    }),
  };
}

/** Notes attached to a pull's breakdown, listing the assumptions behind it. */
function pullNotes(
  ratioLPerKg: number | null,
  spec: DecoctionSpec | undefined,
  awayMinutes: Minutes,
  currentTempC: Celsius,
  restTempAtReturnC: Celsius,
): readonly string[] {
  const notes: string[] = [];
  notes.push(
    ratioLPerKg === null
      ? 'Grain-free pull: liquid only, so it carries no starch to gelatinize.'
      : `Pulled at ${ratioLPerKg.toFixed(2)} L of liquid per kg of grain.`,
  );
  const drift = currentTempC - restTempAtReturnC;
  if (drift > 0.05) {
    notes.push(
      `The tun is left for ${Math.round(awayMinutes)} min and drifts ${drift.toFixed(1)} °C, which the pull is sized to make up.`,
    );
  }
  if (spec?.pullVolumeL !== undefined) {
    notes.push('Volume overridden by the brewer; the achieved temperature is computed from it.');
  }
  notes.push('Color, efficiency and pH effects of the boil are not modeled.');
  return notes;
}

/** Feasibility checks against the tun and the pot, plus scorching and boil-off. */
function pullIssues(a: {
  W: Litres;
  G: Kilograms;
  absorption: number;
  pullGrainKg: Kilograms;
  pullWaterL: Litres;
  pullVolumeL: Litres;
  heatCapacityLEquivalent: Litres;
  mashCapacityL: Litres;
  evaporationL: Litres;
  fractionOfMash: number;
  ratioLPerKg: number | null;
  potVolumeL: Litres | undefined;
}): readonly DecoctionIssue[] {
  const issues: DecoctionIssue[] = [];

  if (
    a.heatCapacityLEquivalent > a.mashCapacityL + EPSILON ||
    a.pullGrainKg > a.G + EPSILON ||
    a.pullWaterL > a.W + EPSILON
  ) {
    issues.push(
      quantifiedIssue({
        code: 'pull-exceeds-mash',
        severity: 'error',
        short: 'Bigger than the mash',
        template:
          'The step needs {pullVolume} of mash pulled, which is more than the tun holds. Split the step or use a thinner pull.',
        quantities: { pullVolume: { kind: 'volume', value: a.pullVolumeL } },
      }),
    );
  } else if (a.fractionOfMash > DECOCTION_DOMINATES_MASH_FRACTION) {
    issues.push({
      code: 'pull-dominates-mash',
      severity: 'warning',
      short: 'Over half the mash',
      message: `${Math.round(a.fractionOfMash * 100)} % of the mash goes in the pot for this step. That is a big jump to make in one decoction.`,
    });
  }

  if (a.potVolumeL !== undefined && a.pullVolumeL > a.potVolumeL + EPSILON) {
    issues.push(
      quantifiedIssue({
        code: 'pull-exceeds-pot',
        severity: 'error',
        short: 'Too big for the pot',
        template: 'The pull is {pullVolume} and the decoction pot holds {potVolume}.',
        quantities: {
          pullVolume: { kind: 'volume', value: a.pullVolumeL },
          potVolume: { kind: 'volume', value: a.potVolumeL },
        },
      }),
    );
  }

  // Free liquid is what is not held by the grain bed. A grain-free pull can only
  // take from that.
  if (a.ratioLPerKg === null) {
    const freeLiquidL = a.W - a.G * a.absorption;
    if (a.pullWaterL > freeLiquidL + EPSILON) {
      issues.push(
        quantifiedIssue({
          code: 'thin-pull-short-of-liquid',
          severity: 'error',
          short: 'Not enough free liquid',
          template:
            'A liquid-only pull needs {pullWater} but only {freeLiquid} is not held by the grain. Pull some grain with it.',
          quantities: {
            pullWater: { kind: 'volume', value: a.pullWaterL },
            freeLiquid: { kind: 'volume', value: Math.max(0, freeLiquidL) },
          },
        }),
      );
    }
  } else if (a.ratioLPerKg <= a.absorption + EPSILON && a.pullGrainKg > 0) {
    issues.push({
      code: 'scorch-risk',
      severity: 'note',
      short: 'Stir it while it heats',
      message: 'A pull this thick scorches on a direct flame. Stir it the whole time it heats.',
    });
  }

  if (a.evaporationL >= a.pullWaterL - EPSILON && a.pullWaterL > 0) {
    issues.push({
      code: 'evaporation-exceeds-pull',
      severity: 'error',
      short: 'The boil would dry it out',
      message: 'The boil would evaporate the pull dry. Shorten it or take a bigger pull.',
    });
  }

  return issues;
}

/** The "already at temperature" answer: pull nothing, change nothing. */
function emptyPull(a: {
  W: Litres;
  G: Kilograms;
  c: number;
  ratioLPerKg: number | null;
  evaporationL: Litres;
  returnTempC: Celsius;
  restTempAtReturnC: Celsius;
  awayMinutes: Minutes;
  mashCapacityL: Litres;
  T1: Celsius;
  T2: Celsius;
  issues: readonly DecoctionIssue[];
}): DecoctionPull {
  return {
    pullVolumeL: 0,
    pullGrainKg: 0,
    pullWaterL: 0,
    heatCapacityLEquivalent: 0,
    ratioLPerKg: a.ratioLPerKg ?? 0,
    evaporationL: 0,
    returnTempC: a.returnTempC,
    currentTempC: a.T1,
    restTempAtReturnC: a.restTempAtReturnC,
    awayMinutes: 0,
    achievedTempC: a.T1,
    fractionOfMash: 0,
    stepIndex: 0,
    mashAfter: {
      waterL: a.W,
      grainKg: a.G,
      tempC: a.T1,
      thicknessLPerKg: a.G > 0 ? a.W / a.G : 0,
    },
    issues: a.issues,
    explain: explain(0, {
      label: 'Decoction pull',
      formula: 'decoction-heat-balance',
      expression: 'C_pull = (C·(T₂ − T_r) + e·(T_ret − T₂)) / (T_ret − T_r)',
      inputs: { currentTempC: a.T1, targetTempC: a.T2, mashCapacityLEquivalent: a.mashCapacityL },
      unit: 'L',
      notes: ['The mash is already at or above this step, so nothing is pulled.'],
      family: 'decoction',
      sources: [PALMER_HOW_TO_BREW],
    }),
  };
}

/** The "boiling mash is not hot enough" answer, matching the classic form's infinity. */
function infinitePull(a: {
  W: Litres;
  G: Kilograms;
  ratioLPerKg: number | null;
  evaporationL: Litres;
  returnTempC: Celsius;
  restTempAtReturnC: Celsius;
  awayMinutes: Minutes;
  mashCapacityL: Litres;
  T1: Celsius;
  T2: Celsius;
  issues: readonly DecoctionIssue[];
}): DecoctionPull {
  const inf = Number.POSITIVE_INFINITY;
  return {
    pullVolumeL: inf,
    pullGrainKg: inf,
    pullWaterL: inf,
    heatCapacityLEquivalent: inf,
    ratioLPerKg: a.ratioLPerKg ?? 0,
    evaporationL: a.evaporationL,
    returnTempC: a.returnTempC,
    currentTempC: a.T1,
    restTempAtReturnC: a.restTempAtReturnC,
    awayMinutes: a.awayMinutes,
    achievedTempC: a.returnTempC,
    fractionOfMash: inf,
    stepIndex: 0,
    mashAfter: {
      waterL: a.W,
      grainKg: a.G,
      tempC: a.returnTempC,
      thicknessLPerKg: a.G > 0 ? a.W / a.G : 0,
    },
    issues: a.issues,
    explain: explain(inf, {
      label: 'Decoction pull',
      formula: 'decoction-heat-balance',
      expression: 'C_pull = (C·(T₂ − T_r) + e·(T_ret − T₂)) / (T_ret − T_r)',
      inputs: {
        currentTempC: a.T1,
        targetTempC: a.T2,
        returnTempC: a.returnTempC,
        mashCapacityLEquivalent: a.mashCapacityL,
      },
      unit: 'L',
      notes: ['The target is at or above the temperature the pull returns at.'],
      family: 'decoction',
      sources: [PALMER_HOW_TO_BREW],
    }),
  };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

/**
 * Size every decoction in a schedule, carrying the mash from one to the next.
 *
 * Each pull is sized against the mash **as the previous pull left it**, minus
 * the water that boiled away and at the temperature it actually reached. Most
 * calculators that offer a triple decoction size every pull against the
 * original mash, which overstates the later pulls. By the third one the tun
 * has lost 2–3 L and its thickness has changed.
 *
 * @category Decoction
 * @group Start here
 */
export function planDecoctions(input: DecoctionPlanInput): DecoctionPlan {
  const { steps, mashWaterL, mashGrainKg, startTempC, ...rig } = input;

  const pulls: DecoctionPull[] = [];
  let waterL = mashWaterL;
  let tempC = startTempC;
  let addedBrewDayMinutes = 0;
  let totalEvaporationL = 0;

  for (const [stepIndex, step] of steps.entries()) {
    waterL += step.waterAddedL ?? 0;
    if (!step.decoction) {
      // Reached some other way — an infusion, or direct heat. Nothing is
      // pulled, but the rest still sets where the next decoction starts from.
      tempC = step.targetTempC;
      continue;
    }
    const pull = decoctionPull({
      ...rig,
      mashWaterL: waterL,
      mashGrainKg,
      currentTempC: tempC,
      targetTempC: step.targetTempC,
      ...(step.spec !== undefined ? { spec: step.spec } : {}),
    });
    pulls.push({ ...pull, stepIndex });
    if (!Number.isFinite(pull.pullVolumeL)) break;
    waterL = pull.mashAfter.waterL;
    tempC = pull.mashAfter.tempC;
    addedBrewDayMinutes += pull.awayMinutes;
    totalEvaporationL += pull.evaporationL;
  }

  const finalMashThicknessLPerKg = mashGrainKg > 0 ? waterL / mashGrainKg : 0;
  const issues: DecoctionIssue[] = [];
  if (pulls.length > 0 && finalMashThicknessLPerKg < DECOCTION_MASH_THICKENED_L_PER_KG) {
    issues.push(
      quantifiedIssue({
        code: 'mash-thickened',
        severity: 'warning',
        short: 'The mash ends up stiff',
        template:
          'The decoctions boil off {evaporation}, leaving the mash at {thickness}. Mash in thinner or shorten the boils.',
        quantities: {
          evaporation: { kind: 'volume', value: totalEvaporationL },
          thickness: { kind: 'thickness', value: finalMashThicknessLPerKg },
        },
      }),
    );
  }
  if (addedBrewDayMinutes > DECOCTION_LONG_BREW_DAY_MINUTES) {
    issues.push({
      code: 'long-brew-day',
      severity: 'note',
      short: 'A long brew day',
      message: `The decoctions add ${Math.round(addedBrewDayMinutes)} min to the brew day.`,
    });
  }

  return { pulls, totalEvaporationL, addedBrewDayMinutes, finalMashThicknessLPerKg, issues };
}

/**
 * Water a schedule's decoction boils will evaporate, **litres**.
 *
 * This is separate from {@link planDecoctions} because the volume waterfall
 * needs it *before* the pulls are sized, or the two would depend on each
 * other. That works because evaporation is modelled as a rate over the boil,
 * not a fraction of the pull; see {@link DEFAULT_DECOCTION_BOIL_OFF_L_PER_HOUR}.
 * Pass the specs of the decocted steps. A step with no spec of its own boils
 * for the default 20 minutes.
 *
 * @category Decoction
 * @group Calculations
 */
export function decoctionEvaporation(
  specs: readonly (DecoctionSpec | undefined)[],
  boilOffLPerHour: number = DEFAULT_DECOCTION_BOIL_OFF_L_PER_HOUR,
): Litres {
  let total = 0;
  for (const spec of specs) {
    total += boilOffLPerHour * ((spec?.boilMinutes ?? DEFAULT_DECOCTION_BOIL_MINUTES) / 60);
  }
  return total;
}

/**
 * A decoction plan's problems as the string list `RecipeCalculation.warnings`
 * takes, numbered by pull.
 *
 * Notes are left out because they belong next to the number they qualify. A
 * recipe-wide warning list is for things that are wrong, and `volumeWarnings`
 * follows the same rule.
 *
 * @category Decoction
 * @group Calculations
 */
export function decoctionWarnings(plan: DecoctionPlan): readonly string[] {
  const out: string[] = [];
  for (const [index, pull] of plan.pulls.entries()) {
    for (const issue of pull.issues) {
      if (issue.severity === 'note') continue;
      out.push(`Decoction ${index + 1}: ${issue.message}`);
    }
  }
  for (const issue of plan.issues) {
    if (issue.severity === 'note') continue;
    out.push(issue.message);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Named schedules
// ---------------------------------------------------------------------------

/**
 * A named mash schedule built around decoctions.
 *
 * @category Decoction
 * @group Results
 */
export interface DecoctionSchedulePreset {
  /** Stable id, safe to persist and to refer to by name. */
  readonly id: string;
  /** What brewers call it. */
  readonly name: string;
  /** One sentence on what it is for. A caller may reword it. */
  readonly description: string;
  /** The whole mash schedule, in execution order — not only the decocted rests. */
  readonly steps: readonly MashStep[];
}

/**
 * Ready-made decoction schedules.
 *
 * We only include schedules with a settled shape in the literature (Kunze;
 * Narziß; standard Czech practice). Anything else would be our own guess under
 * a traditional name. A brewer who wants the Narziß enhanced double can build
 * it from the double.
 *
 * Two details matter:
 *
 * - **The thick pulls carry a conversion rest.** A pull taken from a protein
 *   rest is full of unconverted starch, and boiling unconverted starch sets it
 *   and loses the extract. Traditional practice holds the pull near 70 °C
 *   until it converts, then boils it; the presets do the same.
 * - **The triple's last pull is thin.** By that point there's nothing to gain
 *   from boiling more grain, and the pull is only there to raise the
 *   temperature. Here a grain-free pull is traditional practice, not a
 *   shortcut.
 *
 * @category Decoction
 * @group Constants and defaults
 */
export const DECOCTION_SCHEDULES: readonly DecoctionSchedulePreset[] = [
  {
    id: 'hochkurz-single',
    name: 'Hochkurz, single decoction',
    description:
      'A maltose rest, one thick pull to the saccharification rest, and out. The short modern schedule.',
    steps: [
      { name: 'Maltose rest', type: 'infusion', targetTempC: 63, timeMinutes: 40 },
      {
        name: 'Saccharification',
        type: 'decoction',
        targetTempC: 72,
        timeMinutes: 20,
        decoction: {
          thickness: 'thick',
          boilMinutes: 15,
          restBeforeBoil: { tempC: 70, minutes: 10 },
        },
      },
      { name: 'Mash-out', type: 'temperature', targetTempC: 78, timeMinutes: 10 },
    ],
  },
  {
    id: 'double',
    name: 'Double decoction',
    description:
      'Mash in at a protein rest, then two thick pulls up through saccharification. Undermodified malt and classic German lager.',
    steps: [
      { name: 'Protein rest', type: 'infusion', targetTempC: 52, timeMinutes: 15 },
      {
        name: 'Maltose rest',
        type: 'decoction',
        targetTempC: 63,
        timeMinutes: 40,
        decoction: {
          thickness: 'thick',
          boilMinutes: 20,
          restBeforeBoil: { tempC: 70, minutes: 15 },
        },
      },
      {
        name: 'Saccharification',
        type: 'decoction',
        targetTempC: 72,
        timeMinutes: 20,
        decoction: {
          thickness: 'thick',
          boilMinutes: 15,
          restBeforeBoil: { tempC: 70, minutes: 10 },
        },
      },
      { name: 'Mash-out', type: 'temperature', targetTempC: 78, timeMinutes: 10 },
    ],
  },
  {
    id: 'triple-bohemian',
    name: 'Triple decoction, Bohemian',
    description:
      'Mash in cold, three pulls, a long day. The schedule Czech pale lager is built on.',
    steps: [
      { name: 'Mash-in', type: 'infusion', targetTempC: 37, timeMinutes: 20 },
      {
        name: 'Protein rest',
        type: 'decoction',
        targetTempC: 52,
        timeMinutes: 15,
        decoction: {
          thickness: 'thick',
          boilMinutes: 15,
          restBeforeBoil: { tempC: 70, minutes: 15 },
        },
      },
      {
        name: 'Maltose rest',
        type: 'decoction',
        targetTempC: 64,
        timeMinutes: 30,
        decoction: {
          thickness: 'thick',
          boilMinutes: 20,
          restBeforeBoil: { tempC: 70, minutes: 15 },
        },
      },
      {
        name: 'Saccharification',
        type: 'decoction',
        targetTempC: 72,
        timeMinutes: 20,
        // Thin, because by now there's nothing to gain from boiling more grain.
        decoction: { thickness: 'thin', boilMinutes: 10 },
      },
      { name: 'Mash-out', type: 'temperature', targetTempC: 76, timeMinutes: 10 },
    ],
  },
];

/**
 * One named schedule by id, or `undefined`.
 *
 * Named `find…` and not `decoctionSchedule` because `recipe.ts` already has a
 * private function with that name that does something else: it turns a
 * recipe's rests into the step list `planDecoctions` takes.
 *
 * @category Decoction
 * @group Calculations
 */
export function findDecoctionSchedule(id: string): DecoctionSchedulePreset | undefined {
  return DECOCTION_SCHEDULES.find((preset) => preset.id === id);
}
