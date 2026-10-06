/**
 * Pre-brew checks: undersized equipment, a short pitch, mash pH out of range
 * and the like, in one pass before brew day.
 *
 * Nothing here calculates anything new. Every figure this module compares
 * against a limit was produced by `calculateRecipe`, `predictMashPh`,
 * `planVolumes` or `pitchPlan` before this function was called. This module
 * just checks whether each one is all right.
 *
 * ## Findings are data
 *
 * Each check returns a tagged object with an `id`, a severity and the numbers
 * that triggered it. It never returns a string. Callers write the wording,
 * keyed by `id`, for two reasons:
 *
 * - Wording. "The boil starts with 31 L in a 30 L kettle" is a sentence for a
 *   person. `{id: 'boil-over-kettle', preBoilVolumeL: 31.2, kettleVolumeL: 30}`
 *   is a fact, and only facts belong in a calculation engine.
 * - Units. The brewer's equipment may be in gallons or litres, and this module
 *   works in litres. A finding with numbers can be formatted. A finding with a
 *   formatted string can't be unformatted.
 *
 * ## Severity is about whether brew day goes wrong
 *
 * `warning` means the brew won't do what you expect: wort on the floor, a
 * mash that won't fit, a pitch too small for the beer. `note` means it's
 * worth a look but may be what you meant. A recipe outside its style's range
 * is the typical case, because brewing an ordinary bitter hoppier than the
 * guideline on purpose isn't an error.
 *
 * ## Missing inputs
 *
 * No check fires on a missing input. A profile with no kettle capacity gives
 * no kettle finding, a recipe with no yeast gives no pitch finding, and a beer
 * with no style gives no style findings. Complaining about every empty field
 * would bury the findings that matter.
 */

import { resolveEquipmentProfile } from './defaults';
import type { RecipeCalculation } from './recipe';
import { planStarter } from './starter';
import type {
  EquipmentProfileInput,
  FermentableAddition,
  Litres,
  RecipeInput,
  SpecificGravity,
} from './types';
import { volumeWarningEntries } from './volumes';
import { dryPitchPlan, pitchPlan } from './yeast';

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/**
 * An inclusive numeric band. It's the same `{ min, max }` shape the style
 * ranges use elsewhere, so values can be passed in without converting them.
 *
 * @category Recipe
 * @group Inputs
 */
export interface Band {
  /** Lowest value inside the band, in the unit of the value being checked. */
  readonly min: number;
  /** Highest value inside the band, in the unit of the value being checked. */
  readonly max: number;
}

/**
 * Where a value sits relative to a band. `no-range` when there is no band.
 *
 * @category Recipe
 * @group Results
 */
export type BandStatus = 'in-range' | 'below' | 'above' | 'no-range';

/**
 * Classifies a value against a band.
 *
 * This is exported so anything else that shows whether a beer is in style can
 * use the same arithmetic as these checks, and the two can't disagree.
 *
 * A non-finite value is `no-range`. An OG the engine couldn't compute isn't
 * below the band, and reporting it as a miss would put a finding on every
 * empty recipe.
 *
 * @category Recipe
 * @group Calculations
 */
export function bandStatus(value: number, range: Band | null): BandStatus {
  if (range === null || !Number.isFinite(value)) return 'no-range';
  if (value < range.min) return 'below';
  if (value > range.max) return 'above';
  return 'in-range';
}

/**
 * The mash pH band treated as "in range".
 *
 * 5.2–5.6 measured at room temperature is the range modern references agree
 * on. Below it the beer tastes thin and sharp and the enzymes slow down. Above
 * it you get tannin extraction and a dull, harsh bitterness. The target inside
 * the band is a per-recipe field that defaults to 5.40. The band is where the
 * number is acceptable, and the target is where the brewer is aiming.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MASH_PH_BAND: Band = { min: 5.2, max: 5.6 };

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * The share of the fermenter that must be left empty, as a fraction.
 *
 * 25 % is the homebrew rule of thumb, and it's about krausen, not spillage. A
 * vigorous ale at 20 °C throws a head that fills most of the free space in the
 * first 48 hours, and a batch filled past this line reaches the lid. It's a
 * fraction of the vessel because the foam scales with the batch, not the
 * bucket.
 *
 * Some brewers fill tighter than this on purpose and use a blow-off tube, so
 * the finding is a `note` until the beer won't physically fit, and only then a
 * `warning`.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const FERMENTER_HEADSPACE_FRACTION = 0.25;

/**
 * How far under the target pitch rate is close enough, as a fraction.
 *
 * A pitch rate is built on a viability estimate, a round-number cell count
 * printed on a pack, and a volume the brewer hasn't measured yet. 0.72 against
 * a 0.75 target is within the model's own error, so we don't flag it. 10 %
 * under is inside the noise.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const PITCH_ADEQUATE_FRACTION = 0.9;

/**
 * Below this share of the target, an under-pitch stops being a note.
 *
 * At about three quarters of the target rate, the published effects become ones
 * a drinker can taste and not just ones a lab can measure: more esters and
 * higher alcohols than the style wants, a slower start, and a longer lag that
 * gives anything else in the fermenter a chance.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const PITCH_WARNING_FRACTION = 0.75;

/**
 * How far outside a yeast's published range a primary can be before we flag
 * it, in °C.
 *
 * A range published in whole °C and a schedule entered in whole °F can't line
 * up exactly. 59 °F is 15.0 °C but 64 °F is 17.8 °C, and a brewer who entered
 * the edge of the range they were shown should count as inside it. Half a
 * degree Celsius is just under one Fahrenheit degree, which covers the
 * rounding in a °F entry.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const FERMENT_TEMP_TOLERANCE_C = 0.5;

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * How much a finding matters. See the module header.
 *
 * @category Recipe
 * @group Results
 */
export type RecipeCheckSeverity = 'warning' | 'note';

/**
 * Which vitals are compared against the style's published band.
 *
 * @category Recipe
 * @group Results
 */
export type StyleBandVital = 'og' | 'fg' | 'ibu' | 'srm';

/**
 * The style's published bands, as much of them as the caller has.
 *
 * @category Recipe
 * @group Inputs
 */
export interface StyleBands {
  /** Original gravity band, as specific gravity. `null` when the style doesn't give one. */
  readonly og: Band | null;
  /** Final gravity band, as specific gravity. `null` when the style doesn't give one. */
  readonly fg: Band | null;
  /** Bitterness band, in IBU. `null` when the style doesn't give one. */
  readonly ibu: Band | null;
  /** Color band, in SRM. `null` when the style doesn't give one. */
  readonly srm: Band | null;
}

/**
 * Every finding carries at least this.
 *
 * @category Recipe
 * @group Results
 */
export interface CheckBase {
  /** Whether the finding is a `warning` or a `note`. */
  readonly severity: RecipeCheckSeverity;
}

/**
 * One thing the pre-brew pass found. Discriminate on `id`.
 *
 * @category Recipe
 * @group Results
 */
export type RecipeCheck =
  /** The boil won't fit in the kettle. */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'boil-over-kettle';
      /** Wort volume at the start of the boil, in liters. */
      readonly preBoilVolumeL: Litres;
      /** The kettle's capacity, in liters. */
      readonly kettleVolumeL: Litres;
      /** How much the pre-boil volume exceeds the kettle, in liters. */
      readonly overflowL: Litres;
    })
  /** The mash won't fit in the tun. */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'mash-over-tun';
      /** Volume of the mash, grain and water together, in liters. */
      readonly mashVolumeL: Litres;
      /** The mash tun's capacity, in liters. */
      readonly mashTunVolumeL: Litres;
      /** How much the mash exceeds the tun, in liters. */
      readonly overflowL: Litres;
    })
  /**
   * The fermenter has too little room over the beer. `headspaceL` is negative
   * if the batch doesn't fit at all, which is the `warning` case.
   */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'fermenter-headspace';
      /** Wort going into the fermenter, in liters. */
      readonly volumeIntoFermenterL: Litres;
      /** The fermenter's capacity, in liters. */
      readonly fermenterVolumeL: Litres;
      /** Room left over the wort, in liters. Negative when the batch doesn't fit. */
      readonly headspaceL: Litres;
      /** Room the check wants left over the wort, in liters (see {@link FERMENTER_HEADSPACE_FRACTION}). */
      readonly wantedHeadspaceL: Litres;
    })
  /**
   * The predicted mash pH is outside the band. `acidAdded` says whether
   * anything is already acidifying the mash, so callers can tell "you haven't
   * adjusted this" from "you've adjusted it and it's still out".
   */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'mash-ph-out-of-band';
      /** The predicted mash pH. */
      readonly ph: number;
      /** The pH band it was checked against, {@link MASH_PH_BAND}. */
      readonly band: Band;
      /** Which side of the band the pH falls on. */
      readonly direction: 'below' | 'above';
      /** True when an acid addition or acidulated malt is already in the recipe. */
      readonly acidAdded: boolean;
    })
  /**
   * An acid addition for sparge water on equipment that doesn't sparge.
   *
   * The acid list isn't updated when the equipment changes, so a recipe moved
   * to a no-sparge or BIAB profile keeps its `sparge` acid addition. This is
   * always a `note`. `predictMashPh` already ignores a sparge acid, so the
   * calculated figures are right. The problem is that every acid addition is
   * a brew-day instruction, and this one tells the brewer to treat water they
   * won't use.
   */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'sparge-acid-without-sparge';
      /** How many sparge acid additions the recipe has. */
      readonly additions: number;
    })
  /**
   * The yeast pitch is short of the style-appropriate rate. `remedy` says
   * which fix `starter.ts` thinks will reach the target.
   *
   * `starter-planned` means the recipe already has a starter, `pitchPlan` has
   * grown it, and the pitch is still short by `shortfallBillion`. This is why
   * a saved starter is stored as its inputs and not as a boolean. A flag
   * saying "a starter is planned" would have hidden this finding.
   */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'pitch-short';
      /** Pitch rate the recipe's yeast reaches, in million cells per mL per °Plato. */
      readonly achievedPitchRate: number;
      /** Pitch rate aimed for, in million cells per mL per °Plato. */
      readonly targetPitchRate: number;
      /** Cells still needed to reach the target, in billions. */
      readonly shortfallBillion: number;
      /** Packs needed to reach the target with no starter, rounded up. */
      readonly packsRequired: number;
      /** The fix most likely to reach the target. */
      readonly remedy: 'starter' | 'starter-planned' | 'more-packs';
    })
  /**
   * A dry yeast pitch short of the maker's dosage.
   *
   * This is separate from `pitch-short` because dry yeast is specified by
   * mass. It compares grams against a published g/hL band and never converts
   * to cells. See `DRY_DOSAGE_G_PER_HL` for why a cell-count target overstates
   * a dry pitch.
   */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'pitch-short-dry';
      /** Dry yeast in the recipe, in grams. */
      readonly gramsPitched: number;
      /** Dry yeast the maker's lowest dosage asks for at this volume, in grams. */
      readonly gramsWanted: number;
      /** The maker's dosage band, in grams per hectoliter. */
      readonly band: Band;
      /** Sachets needed to reach `gramsWanted`, rounded up. */
      readonly packsRequired: number;
    })
  /**
   * More dry yeast than the maker asks for, by more than rounding up to whole
   * sachets explains.
   *
   * This is never a warning. Over-pitching dry yeast costs money and a little
   * ester character, but it won't ruin the beer. See `dryPitchPlan` for why
   * this isn't just "over the ceiling". At homebrew volumes a whole number of
   * sachets usually can't land inside the band, and flagging that would
   * contradict the shortfall check.
   */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'pitch-heavy-dry';
      /** Dry yeast in the recipe, in grams. */
      readonly gramsPitched: number;
      /** Dry yeast the maker's lowest dosage asks for at this volume, in grams. */
      readonly gramsEnough: number;
      /** The maker's dosage band, in grams per hectoliter. */
      readonly band: Band;
      /** Sachets that cover `gramsEnough`, rounded up. */
      readonly packsSuggested: number;
    })
  /**
   * A primary fermentation step sits outside a yeast's published range.
   *
   * There's one per yeast, for the primary step furthest outside its range, so
   * a schedule with two warm primaries gives one finding. It's always a
   * `note`, because a Kölsch strain run cool or a saison yeast pushed hot can
   * be intentional. It's meant to catch a schedule nobody updated, like an
   * ale's 20 °C primary left in place with a lager yeast.
   */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'ferment-temp-outside-yeast';
      /** Name of the yeast, as given in the recipe. */
      readonly yeastName: string;
      /** Temperature of the primary step furthest outside the range, in °C. */
      readonly tempC: number;
      /** Bottom of the yeast's published range, in °C. */
      readonly rangeMinC: number;
      /** Top of the yeast's published range, in °C. */
      readonly rangeMaxC: number;
      /** Which side of the range the step falls on. */
      readonly direction: 'below' | 'above';
    })
  /** A vital sits outside the chosen style's published band. */
  | (CheckBase & {
      /** Which check this is. */
      readonly id: 'style-band';
      /** Which vital is outside its band. */
      readonly vital: StyleBandVital;
      /** The recipe's value for that vital, in the same unit as the band. */
      readonly value: number;
      /** The style's band for that vital. */
      readonly band: Band;
      /** Which side of the band the value falls on. */
      readonly direction: 'below' | 'above';
    });

/**
 * What {@link recipeChecks} was given. Only `styleBands` and `now` are optional.
 *
 * @category Recipe
 * @group Inputs
 */
export interface RecipeCheckInput {
  /** The recipe being checked. */
  readonly recipe: RecipeInput;
  /** The equipment profile it will be brewed on. Missing capacities skip their checks. */
  readonly equipment: EquipmentProfileInput;
  /** What `calculateRecipe` returned for this recipe and equipment. */
  readonly calculation: RecipeCalculation;
  /** The chosen style's bands, or `null` when no style is chosen. */
  readonly styleBands?: StyleBands | null;
  /**
   * The time to judge the pitch at, for yeast viability.
   *
   * There's no default, because reading the clock here would give different
   * answers for the same recipe and make it hard to test. If it's omitted the
   * pitch check doesn't run. See {@link recipeChecks}.
   */
  readonly now?: Date;
}

/**
 * The pass's output.
 *
 * @category Recipe
 * @group Results
 */
export interface RecipeCheckResult {
  /** The findings, in brew-day order: kettle, mash, fermenter, pH, pitch, ferment temperature, style. */
  readonly findings: readonly RecipeCheck[];
  /**
   * Engine warning strings that these findings replace.
   *
   * `calculateRecipe` already puts "Pre-boil volume 31.0 L exceeds the kettle's
   * 30 L." in `warnings`, so a caller showing both the findings and the
   * warnings would show the same fact twice. Other callers read the warnings
   * on their own, so we keep them there. This returns the exact strings that
   * the findings replace, and a caller showing both can filter them out.
   */
  readonly supersedes: readonly string[];
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/**
 * Checks a recipe's calculated numbers and reports what's worth knowing
 * before brew day.
 *
 * This is pure: the same inputs give the same findings, with no clock and no
 * IO. Findings are ordered by when the problem happens on brew day: kettle,
 * mash, fermenter, pH, pitch, ferment temperature, style. That's the order a
 * brewer goes through the day in.
 *
 * @category Recipe
 * @group Start here
 */
export function recipeChecks(input: RecipeCheckInput): RecipeCheckResult {
  const { calculation, recipe } = input;
  const equipment = resolveEquipmentProfile(input.equipment);
  const volumes = calculation.volumes;
  const findings: RecipeCheck[] = [];
  const supersedes: string[] = [];

  // --- Capacity. Both are `warning`s, since overflowing wort is never intended.
  const { kettleVolumeL, mashTunVolumeL, fermenterVolumeL } = equipment;
  if (kettleVolumeL !== undefined && volumes.preBoilVolumeL > kettleVolumeL) {
    findings.push({
      id: 'boil-over-kettle',
      severity: 'warning',
      preBoilVolumeL: volumes.preBoilVolumeL,
      kettleVolumeL,
      overflowL: volumes.preBoilVolumeL - kettleVolumeL,
    });
  }
  if (mashTunVolumeL !== undefined && volumes.mashVolumeL > mashTunVolumeL) {
    findings.push({
      id: 'mash-over-tun',
      severity: 'warning',
      mashVolumeL: volumes.mashVolumeL,
      mashTunVolumeL,
      overflowL: volumes.mashVolumeL - mashTunVolumeL,
    });
  }
  // The engine's warning strings for the two checks above. We take them from
  // `volumeWarningEntries` instead of rebuilding them, so they can't drift.
  for (const entry of volumeWarningEntries(volumes, equipment)) {
    if (entry.id === 'kettle-capacity' || entry.id === 'mash-tun-capacity') {
      supersedes.push(entry.message);
    }
  }

  // --- Headspace. A note until the beer doesn't fit, then a warning.
  if (fermenterVolumeL !== undefined && volumes.volumeIntoFermenterL > 0) {
    const headspaceL = fermenterVolumeL - volumes.volumeIntoFermenterL;
    const wantedHeadspaceL = fermenterVolumeL * FERMENTER_HEADSPACE_FRACTION;
    if (headspaceL < wantedHeadspaceL) {
      findings.push({
        id: 'fermenter-headspace',
        severity: headspaceL < 0 ? 'warning' : 'note',
        volumeIntoFermenterL: volumes.volumeIntoFermenterL,
        fermenterVolumeL,
        headspaceL,
        wantedHeadspaceL,
      });
    }
  }

  // --- Mash pH. Only if the recipe has water chemistry. Without it there's no
  // prediction, because `predictMashPh` was never run.
  const mashPh = calculation.water?.mashPh.ph;
  if (mashPh !== undefined && Number.isFinite(mashPh)) {
    const status = bandStatus(mashPh, MASH_PH_BAND);
    if (status === 'below' || status === 'above') {
      findings.push({
        id: 'mash-ph-out-of-band',
        severity: 'warning',
        ph: mashPh,
        band: MASH_PH_BAND,
        direction: status,
        acidAdded: isAcidified(recipe),
      });
    }
  }

  // --- A sparge acid with no sparge. We check the calculated sparge volume
  // instead of the profile's `spargeType`, so BIAB, no-sparge and any other
  // full-volume setup are all covered by one condition.
  const spargeAcids =
    calculation.water !== undefined && calculation.water.spargeVolumeL <= 0
      ? (recipe.water?.acidAdditions ?? []).filter(
          (acid) => acid.target === 'sparge' && (acid.millilitres ?? acid.grams ?? 0) > 0,
        )
      : [];
  if (spargeAcids.length > 0) {
    findings.push({
      id: 'sparge-acid-without-sparge',
      severity: 'note',
      additions: spargeAcids.length,
    });
  }

  // --- Pitch. Needs a yeast, a gravity, a volume and a date. If any is
  // missing, the check is skipped.
  const pitch = pitchFinding(input, equipment.fermenterTrubLossL);
  if (pitch !== null) findings.push(pitch);

  // --- Ferment temperature against each yeast's range. These are notes,
  // because running a strain outside its range can be intentional.
  findings.push(...fermentTempFindings(recipe));

  // --- Style. These are all notes, because a beer outside its style can be intentional.
  findings.push(...styleFindings(calculation, input.styleBands ?? null));

  return { findings, supersedes };
}

/**
 * Whether anything in this recipe is acidifying the mash.
 *
 * There are two sources and we check both. An acid addition is a water
 * chemistry field, and acidulated malt is a fermentable that carries lactic
 * acid. A brewer who used 2 % acid malt has adjusted their pH just as much as
 * one who added 4 mL of lactic, and the check shouldn't say otherwise.
 */
function isAcidified(recipe: RecipeInput): boolean {
  if ((recipe.water?.acidAdditions?.length ?? 0) > 0) return true;
  return recipe.fermentables.some(hasLacticAcid);
}

/** Acidulated malt, or any fermentable carrying a lactic-acid content. */
function hasLacticAcid(fermentable: FermentableAddition): boolean {
  const ph = fermentable.ph;
  if (ph === undefined) return false;
  if (ph.maltClass === 'acidulated') return true;
  return (ph.acidContentPercentLactic ?? 0) > 0;
}

/**
 * The pitch finding, or `null` if a required input is missing.
 *
 * The volume is the wort that reaches the yeast: the volume into the
 * fermenter, minus the trub left behind. The gravity is the OG, which is what
 * a pitch rate is defined against. Both come from the calculation, and the
 * arithmetic is in `yeast.ts`.
 *
 * The remedy comes from `starter.ts`. A liquid pack short of a lager pitch is
 * usually a step or two on a stir plate away. Dry yeast never gets a starter.
 * You buy another sachet, so the dry branch doesn't ask.
 *
 * There's no separate branch for a starter saved on the recipe. `pitchPlan`
 * grows it and reports the cells that come out of the flask, so a starter
 * that reaches the target raises `achievedPitchRate` past
 * `PITCH_ADEQUATE_FRACTION` and this returns `null`. A starter that falls
 * short still produces a finding, and the remedy says which case it is.
 */
function pitchFinding(input: RecipeCheckInput, trubLossL: Litres): RecipeCheck | null {
  const { recipe, calculation, now } = input;
  const yeasts = recipe.yeasts ?? [];
  if (now === undefined || yeasts.length === 0) return null;

  const og: SpecificGravity = calculation.vitals.og;
  const volumeL = calculation.volumes.volumeIntoFermenterL - trubLossL;
  if (!Number.isFinite(og) || og <= 1 || volumeL <= 0) return null;

  // Dry yeast is judged by mass against its maker's dosage, never by cell
  // count. A cell count would ask for five sachets where Fermentis ask for
  // under two, because the 1.5 M cells/mL/°P lager rate is liquid-yeast
  // practice and dry yeast carries reserves a liquid pitch has to build.
  const dryPlan = dryPitchPlan({ yeasts, volumeL });
  if (dryPlan !== null) {
    if (dryPlan.heavy) {
      return {
        id: 'pitch-heavy-dry',
        severity: 'note',
        gramsPitched: dryPlan.gramsPitched,
        gramsEnough: dryPlan.gramsWanted,
        band: dryPlan.band,
        packsSuggested: dryPlan.packsRequired,
      };
    }
    if (!dryPlan.short) return null;
    return {
      id: 'pitch-short-dry',
      severity:
        dryPlan.gramsPitched < dryPlan.gramsWanted * PITCH_WARNING_FRACTION ? 'warning' : 'note',
      gramsPitched: dryPlan.gramsPitched,
      gramsWanted: dryPlan.gramsWanted,
      band: dryPlan.band,
      packsRequired: dryPlan.packsRequired,
    };
  }

  const plan = pitchPlan({ yeasts, volumeL, og, pitchDate: now });
  if (plan.targetPitchRate <= 0) return null;
  const ratio = plan.achievedPitchRate / plan.targetPitchRate;
  if (ratio >= PITCH_ADEQUATE_FRACTION) return null;

  // A recipe that already has a starter isn't offered another one. Its cells
  // are already in `cellsAvailableBillion`, so planning from that figure would
  // plan a starter on top of a starter. We just report that the planned one
  // falls short.
  const starter =
    plan.starters.length > 0
      ? null
      : planStarter(plan.cellsNeededBillion, plan.cellsAvailableBillion);
  return {
    id: 'pitch-short',
    severity: ratio < PITCH_WARNING_FRACTION ? 'warning' : 'note',
    achievedPitchRate: plan.achievedPitchRate,
    targetPitchRate: plan.targetPitchRate,
    shortfallBillion: plan.shortfallBillion,
    packsRequired: plan.packsRequired,
    remedy: starter === null ? 'starter-planned' : starter.reachable ? 'starter' : 'more-packs',
  };
}

/**
 * Which side of a yeast's range a temperature falls, beyond
 * {@link FERMENT_TEMP_TOLERANCE_C}, or `null` if it's inside.
 *
 * This is exported so other code that reports fermentation temperature
 * against a yeast's range agrees with these checks.
 *
 * @category Recipe
 * @group Calculations
 */
export function fermentTempOutside(tempC: number, range: Band): 'below' | 'above' | null {
  if (!Number.isFinite(tempC) || range.max < range.min) return null;
  if (tempC > range.max + FERMENT_TEMP_TOLERANCE_C) return 'above';
  if (tempC < range.min - FERMENT_TEMP_TOLERANCE_C) return 'below';
  return null;
}

/**
 * One note per yeast whose range is missed by a primary step.
 *
 * Every primary step is checked, because a schedule with a cool start and a
 * warm finish has two `primary` steps. The step reported is the one furthest
 * outside. A yeast with no range, or a recipe with no primary step, gives no
 * finding (see the module header on missing inputs).
 */
function fermentTempFindings(recipe: RecipeInput): readonly RecipeCheck[] {
  const primaries = (recipe.fermentationSteps ?? []).filter((step) => step.type === 'primary');
  if (primaries.length === 0) return [];
  const findings: RecipeCheck[] = [];
  for (const yeast of recipe.yeasts ?? []) {
    const { temperatureMinC: min, temperatureMaxC: max } = yeast;
    if (min === undefined || max === undefined) continue;
    let worst: { tempC: number; direction: 'below' | 'above'; excess: number } | null = null;
    for (const step of primaries) {
      const direction = fermentTempOutside(step.tempC, { min, max });
      if (direction === null) continue;
      const excess = direction === 'above' ? step.tempC - max : min - step.tempC;
      if (worst === null || excess > worst.excess) {
        worst = { tempC: step.tempC, direction, excess };
      }
    }
    if (worst !== null) {
      findings.push({
        id: 'ferment-temp-outside-yeast',
        severity: 'note',
        yeastName: yeast.name,
        tempC: worst.tempC,
        rangeMinC: min,
        rangeMaxC: max,
        direction: worst.direction,
      });
    }
  }
  return findings;
}

/**
 * One note per vital outside its style band.
 *
 * FG is included and ABV isn't. ABV follows from OG and FG, so a recipe with
 * both in band can't have an out-of-band ABV worth reporting, and one with OG
 * out of band already has a finding for it. A third finding restating the
 * first two would just be noise.
 */
function styleFindings(
  calculation: RecipeCalculation,
  bands: StyleBands | null,
): readonly RecipeCheck[] {
  if (bands === null) return [];
  const vitals = calculation.vitals;
  const pairs: readonly (readonly [StyleBandVital, number, Band | null])[] = [
    ['og', vitals.og, bands.og],
    ['fg', vitals.fg, bands.fg],
    ['ibu', vitals.ibu, bands.ibu],
    ['srm', vitals.srm, bands.srm],
  ];
  const findings: RecipeCheck[] = [];
  for (const [vital, value, band] of pairs) {
    const status = bandStatus(value, band);
    if (band !== null && (status === 'below' || status === 'above')) {
      findings.push({ id: 'style-band', severity: 'note', vital, value, band, direction: status });
    }
  }
  return findings;
}
