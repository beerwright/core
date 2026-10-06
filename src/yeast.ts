/**
 * Yeast and pitching: pitch rate, cell count for a batch, and viability decay
 * by manufacture date.
 *
 * Planning a starter (how big a flask closes a gap, and why we won't plan a
 * third step) is in `starter.ts`. This module handles the result: when a yeast
 * row carries a starter the brewer has already decided on, the pitch is the
 * cells that come out of the flask, and {@link pitchPlan} grows it through
 * `starter-growth.ts` to get that number. Braukaiser's constants are only
 * written down once, in that module.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import { MR_MALTY_VIABILITY, TROESTER_YEAST_GROWTH_2012, WHITE_ZAINASHEFF_2010 } from './sources';
import type { StarterYield } from './starter-growth';
import { starterDmeGrams, starterGrowth } from './starter-growth';
import type {
  Days,
  Litres,
  Percent,
  Plato,
  SpecificGravity,
  StarterMethod,
  YeastForm,
  YeastSelection,
  YeastStarter,
  YeastType,
} from './types';
import { sgToPlato } from './units/gravity';

/**
 * Dry-yeast dosage bands by strain type, in grams per hectolitre.
 *
 * Used for a dry strain whose maker doesn't publish a figure. Fermentis print
 * 50-80 g/hL across their ale range and 80-120 across their lagers, and
 * Lallemand's numbers are in the same range, so these are the manufacturers'
 * figures, not something we derived.
 *
 * We need them because a cell-count target doesn't work for dry yeast. The
 * 1.5 M cells/mL/°P lager rate is liquid-yeast practice from White &
 * Zainasheff, and dry yeast arrives with the glycogen and sterol reserves a
 * liquid pitch has to build in the wort. Judged on cells, a by-the-book
 * Fermentis lager dose looks like a heavy under-pitch: five sachets where the
 * maker asks for under two.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const DRY_DOSAGE_G_PER_HL: Readonly<
  Record<
    YeastType,
    {
      /** Lowest recommended dosage, g/hL. */
      min: number;
      /** Highest recommended dosage, g/hL. */
      max: number;
    }
  >
> = {
  ale: { min: 50, max: 80 },
  lager: { min: 80, max: 120 },
  wheat: { min: 50, max: 80 },
  wine: { min: 50, max: 80 },
  brett: { min: 50, max: 80 },
  other: { min: 50, max: 80 },
};

/**
 * The dosage band for a dry strain. Uses the maker's if published, otherwise the default for its type.
 *
 * @category Yeast
 * @group Calculations
 */
export function dryDosageBand(yeast: {
  readonly type: YeastType;
  readonly dosageGramsPerHl?: { readonly min: number; readonly max: number } | null;
}): {
  /** Lowest recommended dosage, g/hL. */
  min: number;
  /** Highest recommended dosage, g/hL. */
  max: number;
} {
  const published = yeast.dosageGramsPerHl;
  if (published && published.min > 0) return { min: published.min, max: published.max };
  return DRY_DOSAGE_G_PER_HL[yeast.type] ?? DRY_DOSAGE_G_PER_HL.ale;
}

/**
 * Whether a dry pitch reaches the maker's dosage, by mass.
 *
 * Short means below the bottom of the band. Anywhere inside the band is what
 * the maker recommends, so grams wanted is the minimum, not the midpoint. If
 * we used the midpoint, someone already at 80 g/hL would be told to reach 100.
 *
 * ## Why `heavy` isn't just "over the ceiling"
 *
 * A sachet is 11.5 g, and at homebrew volumes the band is often narrower than
 * that. S-23 into 17 L wants 13.7-20.5 g: one sachet is under the floor, two
 * is 23 g and over the ceiling, and no whole number of sachets lands inside.
 * If "over the ceiling" counted as heavy, the brewer would be told they're
 * short with one sachet and then told they're heavy with two.
 *
 * So a pitch only counts as heavy when it's over the ceiling and dropping one
 * pack would still clear the floor. Rounding up because sachets come whole is
 * fine. Pitching five where two would do wastes money and thins the ester
 * profile. Under 20 L of wort, nearly every pitch is the first case and almost
 * none are the second.
 *
 * @category Yeast
 * @group Calculations
 */
export function dryPitchPlan(input: {
  readonly yeasts: readonly YeastSelection[];
  readonly volumeL: number;
}): {
  /** Dry yeast in the pitch across every dry row, grams. */
  readonly gramsPitched: number;
  /** Grams needed to reach the bottom of the dosage band. */
  readonly gramsWanted: number;
  /** The dosage band used, g/hL. Taken from the first dry row. */
  readonly band: {
    /** Lowest recommended dosage, g/hL. */
    min: number;
    /** Highest recommended dosage, g/hL. */
    max: number;
  };
  /** Packs of the first dry row's size that reach `gramsWanted`, at least one. */
  readonly packsRequired: number;
  /** `true` when the pitch is below the bottom of the band. */
  readonly short: boolean;
  /** `true` when the pitch is over the band and would still reach it with one pack fewer. */
  readonly heavy: boolean;
} | null {
  const dry = input.yeasts.filter((yeast) => yeast.form === 'dry');
  if (dry.length === 0 || input.volumeL <= 0) return null;
  const hectolitres = input.volumeL / 100;
  const first = dry[0];
  if (first === undefined) return null;
  const band = dryDosageBand(first);
  const gramsWanted = band.min * hectolitres;
  const gramsPerPack = first.gramsPerPack ?? DRY_SACHET_GRAMS_DEFAULT;
  const gramsPitched = dry.reduce(
    (sum, yeast) => sum + (yeast.gramsPerPack ?? DRY_SACHET_GRAMS_DEFAULT) * (yeast.packs ?? 1),
    0,
  );
  const gramsCeiling = band.max * hectolitres;
  return {
    gramsPitched,
    gramsWanted,
    band,
    packsRequired: Math.max(1, Math.ceil(gramsWanted / gramsPerPack)),
    short: gramsPitched < gramsWanted,
    // Over the maker's ceiling, and still over the floor with one pack taken
    // out. The second condition is the one that usually decides it.
    heavy: gramsPitched > gramsCeiling && gramsPitched - gramsPerPack >= gramsWanted,
  };
}

/** Standard dry sachet size in grams. Duplicated from `starter.ts` to avoid an import cycle. */
const DRY_SACHET_GRAMS_DEFAULT = 11.5;

/**
 * Default pitch rates in million cells per millilitre per degree Plato.
 *
 * 0.75 for ales and 1.5 for lagers are the long-standing Chris White /
 * *Yeast* (White & Zainasheff, 2010) figures. Lagers get double because they
 * ferment cold and slowly. Wheat beers are pitched at the ale rate. Some
 * brewers underpitch them on purpose for more ester and phenol character, but
 * that's a choice and not a sensible default. Anything unclassified falls back
 * to the ale rate.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const DEFAULT_PITCH_RATES: Readonly<Record<YeastType, number>> = {
  ale: 0.75,
  lager: 1.5,
  wheat: 0.75,
  wine: 0.75,
  brett: 0.75,
  other: 0.75,
};

/**
 * The pitch rate to use for a yeast type, M cells/mL/°P.
 *
 * @category Yeast
 * @group Calculations
 */
export function defaultPitchRate(type: YeastType): number {
  return DEFAULT_PITCH_RATES[type] ?? DEFAULT_PITCH_RATES.ale;
}

/**
 * Input to {@link cellsNeeded}.
 *
 * @category Yeast
 * @group Inputs
 */
export interface PitchRateInput {
  /** Volume of wort being pitched, litres. */
  readonly volumeL: Litres;
  /** Wort gravity as SG. It's converted to °P internally. */
  readonly og: SpecificGravity;
  /** Pitch rate, million cells per mL per °P. */
  readonly pitchRate: number;
}

/**
 * Viable cells a pitch needs, in billions.
 *
 * ```
 * cells (billion) = rate (M/mL/°P) × volume (mL) × °P / 1000
 * ```
 *
 * The code multiplies by litres and skips the /1000: 1 M cells/mL over 1 L is
 * 10⁹ cells, which is one billion per litre per unit rate per °P.
 *
 * @category Yeast
 * @group Calculations
 */
export function cellsNeeded(input: PitchRateInput): number {
  const plato = sgToPlato(input.og);
  if (plato <= 0 || input.volumeL <= 0) return 0;
  return input.pitchRate * input.volumeL * plato;
}

/**
 * The pitch rate a given cell count achieves, in M cells/mL/°P. This is the
 * inverse of {@link cellsNeeded}, for "I have two packs, is that enough?".
 *
 * @category Yeast
 * @group Calculations
 */
export function pitchRateAchieved(
  cellsBillion: number,
  volumeL: Litres,
  og: SpecificGravity,
): number {
  const plato = sgToPlato(og);
  if (plato <= 0 || volumeL <= 0) return 0;
  return cellsBillion / (volumeL * plato);
}

/**
 * Wort strength in °P. Exported because pitch rates are always quoted in Plato.
 *
 * @category Yeast
 * @group Calculations
 */
export function pitchGravityPlato(og: SpecificGravity): Plato {
  return sgToPlato(og);
}

/**
 * Viability decay per 30 days, as the fraction remaining, by packaging form.
 *
 * - **Liquid** (Wyeast smack-packs, and any liquid pack whose maker publishes
 *   nothing better): 0.79, i.e. the widely used "~21 % loss per month" figure
 *   from Mr Malty's viability model. White Labs packs decay on their own
 *   published curve instead; see {@link PUREPITCH_RETENTION_PER_30_DAYS}.
 * - **Dry**: 0.96. Manufacturers publish roughly 20 % loss per year when stored
 *   refrigerated, which is ~4 % per month.
 *
 * We apply it as continuous exponential decay instead of a straight line, so
 * the curve stays positive and the monthly loss compounds.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const VIABILITY_RETENTION_PER_30_DAYS: Readonly<Record<YeastForm, number>> = {
  liquid: 0.79,
  dry: 0.96,
};

/**
 * White Labs PurePitch's decay per 30 days, as a fraction remaining.
 *
 * White Labs publish their own figures for the pouch: about 99 % viable at one
 * month, 98 % at two, 90 % at three, 84 % at four, 79 % at five and 72 % at six,
 * the month its best-by falls on. That's much gentler than the liquid default
 * of 0.79 per month, which comes from the vial era. That figure would put a
 * five-month-old pouch at 31 % and size a starter for more than twice the
 * cells it needs.
 *
 * Their curve is flat for two months and then falls, which no single
 * exponential matches. 0.946 passes through the six-month point
 * (0.716^(1/6)). Before that it reads a little low (85 % at three months
 * against their 90 %), so any error is toward a slightly bigger starter,
 * never a smaller one.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const PUREPITCH_RETENTION_PER_30_DAYS = 0.946;

/**
 * Whether a pack is from White Labs, judged by its name.
 *
 * We use the name because every caller has one. A catalog row is snapshotted
 * as "White Labs California Ale Yeast®", and an imported one usually includes
 * its WLP number. Dry White Labs strains stay on the dry curve, which is
 * gentler still.
 *
 * @category Yeast
 * @internal
 */
export function isWhiteLabsPack(name: string): boolean {
  return /white\s*labs|\bwlp\s?-?\d/i.test(name);
}

/**
 * The 30-day retention for a pack, by form, and by maker when we recognise it.
 *
 * @category Yeast
 * @group Calculations
 */
export function packRetentionPer30Days(form: YeastForm, name: string): number {
  if (form === 'liquid' && isWhiteLabsPack(name)) return PUREPITCH_RETENTION_PER_30_DAYS;
  return VIABILITY_RETENTION_PER_30_DAYS[form];
}

/**
 * Options for {@link viabilityFraction}.
 *
 * @category Yeast
 * @group Inputs
 */
export interface ViabilityOptions {
  /** Packaging form. Defaults to `liquid`. */
  readonly form?: YeastForm;
  /** Override the 30-day retention fraction. */
  readonly retentionPer30Days?: number;
  /** Viability at manufacture, as a fraction. Defaults to 1. */
  readonly initialViability?: number;
}

/**
 * Fraction of cells still viable after a number of days.
 *
 * ```
 * viability = initial × retention30^(days / 30)
 * ```
 *
 * This assumes refrigerated storage the whole time. A pack that spent a week
 * in a warm postal van decays much faster, and we have no way of knowing
 * that, so the retention constant can be overridden.
 *
 * @category Yeast
 * @group Calculations
 */
export function viabilityFraction(days: Days, options: ViabilityOptions = {}): number {
  const form = options.form ?? 'liquid';
  const retention = options.retentionPer30Days ?? VIABILITY_RETENTION_PER_30_DAYS[form];
  const initial = options.initialViability ?? 1;
  if (days <= 0) return initial;
  return initial * retention ** (days / 30);
}

/**
 * Days between two dates, including the fraction of a day, floored at zero.
 *
 * @category Yeast
 * @internal
 */
export function daysBetween(from: Date, to: Date): Days {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, ms / 86_400_000);
}

/**
 * Months from manufacture to the date printed on the pack, by packaging form.
 *
 * Some packs carry only a best-by date: White Labs PurePitch, and dry packets
 * from Fermentis. White Labs print a best-by six months after packaging (it
 * was four in the vial days); Fermentis quote 36 months from production for
 * dry yeast, and Lallemand the same. The viability curve runs from
 * manufacture, so a best-by is walked back by this many months.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const SHELF_LIFE_MONTHS: Readonly<Record<YeastForm, number>> = {
  liquid: 6,
  dry: 36,
};

/** `YYYY-MM-DD` moved by whole months, the day clamped to the month's end. */
function shiftIsoDate(isoDate: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const d = Math.min(day, daysIn(y, m));
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The manufacture date implied by a best-by date, or `null` if it isn't a valid date.
 *
 * @category Yeast
 * @group Calculations
 */
export function manufactureDateFromBestBy(bestBy: string, form: YeastForm): string | null {
  return shiftIsoDate(bestBy, -SHELF_LIFE_MONTHS[form]);
}

/**
 * The best-by date for a manufacture date. The inverse of {@link manufactureDateFromBestBy}.
 *
 * @category Yeast
 * @group Calculations
 */
export function bestByFromManufactureDate(manufactureDate: string, form: YeastForm): string | null {
  return shiftIsoDate(manufactureDate, SHELF_LIFE_MONTHS[form]);
}

/**
 * Viability of a pack from its manufacture date.
 *
 * @category Yeast
 * @group Calculations
 */
export function viabilityFromManufactureDate(
  manufactureDate: Date,
  asOf: Date,
  options: ViabilityOptions = {},
): number {
  return viabilityFraction(daysBetween(manufactureDate, asOf), options);
}

/**
 * One culture's starter, grown.
 *
 * The steps are the model's own {@link StarterYield}s, in order, so a caller can
 * show the flask sizes, the inoculation rates and the cells at each stage
 * without recomputing anything.
 *
 * @category Yeast
 * @group Results
 */
export interface PitchedStarter {
  /** The culture the starter is built from. */
  readonly name: string;
  /** Each step, in order. Step one is pitched with the packs' viable cells. */
  readonly steps: readonly StarterYield[];
  /** Cells the packs alone would have supplied, billion. */
  readonly fromPacksBillion: number;
  /** Cells at the end of the last step, in billions. This is what gets pitched. */
  readonly finalCellsBillion: number;
}

/**
 * Result of {@link pitchPlan}.
 *
 * @category Yeast
 * @group Results
 */
export interface PitchPlan {
  /** Viable cells the batch needs, billion. */
  readonly cellsNeededBillion: number;
  /**
   * Viable cells the pitch supplies, in billions, after growing any starters
   * on the rows. Equals {@link cellsFromPacksBillion} when no row has one.
   */
  readonly cellsAvailableBillion: number;
  /** Viable cells the packs supply on their own, billion, before any starter. */
  readonly cellsFromPacksBillion: number;
  /** The starters the rows carry, grown, in row order. Empty when there are none. */
  readonly starters: readonly PitchedStarter[];
  /** Shortfall (positive) or surplus (negative), billion cells. */
  readonly shortfallBillion: number;
  /** Packs required at the stated viability, rounded up. */
  readonly packsRequired: number;
  /** Pitch rate the selection achieves, M cells/mL/°P. */
  readonly achievedPitchRate: number;
  /** Pitch rate that was targeted, M cells/mL/°P. */
  readonly targetPitchRate: number;
  /** Mean viability of the selected packs, as a fraction. */
  readonly viability: number;
  /** Assumptions that were applied. */
  readonly notes: readonly string[];
}

/**
 * Input to {@link pitchPlan}.
 *
 * @category Yeast
 * @group Inputs
 */
export interface PitchPlanInput {
  /** The yeast rows being pitched. The first one's type sets the default pitch rate. */
  readonly yeasts: readonly YeastSelection[];
  /** Volume of wort being pitched, litres. */
  readonly volumeL: Litres;
  /** Wort gravity, SG. */
  readonly og: SpecificGravity;
  /** Pitch rate override, M cells/mL/°P. Defaults from the first yeast's type. */
  readonly pitchRate?: number;
  /** Date the pitch happens. Defaults to now. */
  readonly pitchDate?: Date;
  /** Cells per pack when a selection does not state one, billion. Defaults to 100. */
  readonly defaultCellsPerPackBillion?: number;
}

/**
 * Work out whether a yeast selection is enough for a batch.
 *
 * Liquid packs are assumed to hold 100 billion cells at manufacture (Wyeast and
 * White Labs both quote ~100 billion) unless the selection says otherwise. Dry
 * sachets are counted as `gramsPerPack × cellsPerGramBillion`, defaulting to
 * the commonly published 6 billion cells per gram when the catalog has no
 * figure.
 *
 * ## A row that carries a starter
 *
 * A saved starter is something the brewer has decided about this pitch, like
 * the manufacture date, so this function reports the cells it produces. The
 * steps are grown through {@link starterGrowth}: step one is pitched with that
 * row's viable pack cells, each later step with all of the previous step's
 * output, and the last step's total replaces the pack count for that row.
 *
 * The yield isn't stored. It's recomputed every time on Braukaiser's model,
 * which its author puts at ±15 % or worse. A starter can still leave a pitch
 * short, and that's correct: a two-litre flask isn't automatically enough for
 * a lager, so the shortfall check still runs.
 *
 * **Dry yeast is the exception: its starter is ignored.** A starter uses up
 * the sterols and unsaturated fatty acids dry yeast is packed with, so a dry
 * row's starter is ignored and a note says so. See `dryYeastSachets` for the
 * full reasoning. We enforce this here and not in the document schema because
 * every caller gets its cell count from this function. An imported file, a
 * tool call or a row switched from liquid to dry can all produce a dry row
 * with a starter, and none of them should be able to inflate a pitch.
 *
 * @category Yeast
 * @group Start here
 */
export function pitchPlan(input: PitchPlanInput): PitchPlan {
  const notes: string[] = [];
  const pitchDate = input.pitchDate ?? new Date();
  const first = input.yeasts[0];
  const targetPitchRate = input.pitchRate ?? defaultPitchRate(first?.type ?? 'ale');
  if (input.pitchRate === undefined) {
    notes.push(
      `Pitch rate defaulted to ${targetPitchRate} M cells/mL/°P for a ${first?.type ?? 'ale'} strain.`,
    );
  }

  const needed = cellsNeeded({ volumeL: input.volumeL, og: input.og, pitchRate: targetPitchRate });

  let available = 0;
  let fromPacks = 0;
  let viabilityWeight = 0;
  let viabilityTotal = 0;
  let cellsPerPackOfFirst = input.defaultCellsPerPackBillion ?? 100;
  const starters: PitchedStarter[] = [];

  for (const yeast of input.yeasts) {
    const form = yeast.form ?? 'liquid';
    const packs = yeast.packs ?? 1;
    let perPack = yeast.cellsPerPackBillion;
    if (perPack === undefined) {
      if (form === 'dry') {
        const grams = yeast.gramsPerPack ?? 11.5;
        const perGram = yeast.cellsPerGramBillion ?? 6;
        perPack = grams * perGram;
        notes.push(
          `${yeast.name}: assumed ${grams} g × ${perGram} bn cells/g = ${perPack.toFixed(0)} bn per sachet.`,
        );
      } else {
        perPack = input.defaultCellsPerPackBillion ?? 100;
        notes.push(`${yeast.name}: assumed ${perPack} bn cells per liquid pack at manufacture.`);
      }
    }
    if (yeast === first) cellsPerPackOfFirst = perPack;

    const viability =
      yeast.manufactureDate !== undefined
        ? viabilityFromManufactureDate(yeast.manufactureDate, pitchDate, {
            form,
            retentionPer30Days: packRetentionPer30Days(form, yeast.name),
          })
        : 1;
    if (yeast.manufactureDate === undefined) {
      notes.push(`${yeast.name}: no manufacture date, assumed 100 % viable.`);
    }

    const packCells = perPack * packs * viability;
    fromPacks += packCells;
    const starter = yeast.starter ?? null;
    if (starter === null || starter.stepVolumesL.length === 0) {
      available += packCells;
    } else if (form === 'dry') {
      // Ignored. The doc comment on pitchPlan explains why this check is here
      // and not in the schema.
      available += packCells;
      notes.push(
        `${yeast.name}: the starter on this row is ignored. Dry yeast is packed with the sterols its first divisions need, and a starter uses them up on sugar water. Pitch another sachet instead.`,
      );
    } else {
      const grown = growStarter(yeast.name, starter, packCells);
      starters.push(grown);
      available += grown.finalCellsBillion;
      notes.push(starterNote(grown, starter.method));
    }

    viabilityWeight += packs;
    viabilityTotal += viability * packs;
  }

  const viability = viabilityWeight > 0 ? viabilityTotal / viabilityWeight : 1;
  const perPackViable = cellsPerPackOfFirst * viability;
  const packsRequired = perPackViable > 0 ? Math.ceil(needed / perPackViable) : 0;

  return {
    cellsNeededBillion: needed,
    cellsAvailableBillion: available,
    cellsFromPacksBillion: fromPacks,
    starters,
    shortfallBillion: needed - available,
    packsRequired,
    achievedPitchRate: pitchRateAchieved(available, input.volumeL, input.og),
    targetPitchRate,
    viability,
    notes,
  };
}

/**
 * Walk a saved starter's steps through the growth model.
 *
 * Step one is inoculated with the viable cells the packs supply, and every
 * later step with the previous step's entire output, which is what chilling a
 * flask, decanting the spent wort and pitching the slurry does. Each step's
 * volume is converted to DME at the 10 : 1 convention `starter-growth.ts`
 * documents.
 *
 * A step of zero or less adds nothing instead of throwing. The model's floor
 * is zero growth, so a nonsense volume returns what went in.
 *
 * Exported so anything that shows a saved starter prints the same count
 * {@link pitchPlan} uses. A second copy of this loop could drift and disagree.
 *
 * @category Yeast
 * @group Calculations
 */
export function growStarter(
  name: string,
  starter: YeastStarter,
  fromPacksBillion: number,
): PitchedStarter {
  const steps: StarterYield[] = [];
  let cells = fromPacksBillion;
  for (const volumeL of starter.stepVolumesL) {
    const step = starterGrowth(cells, starterDmeGrams(Math.max(0, volumeL)), starter.method);
    steps.push(step);
    cells = step.finalCellsBillion;
  }
  return { name, steps, fromPacksBillion, finalCellsBillion: cells };
}

/**
 * The note a grown starter adds to the pitch plan.
 *
 * It names the model and its error bar next to the number, because the
 * model's author puts it at ±15 % or worse. Without that, "210 bn" looks like
 * a measurement.
 */
function starterNote(grown: PitchedStarter, method: StarterMethod): string {
  const volumes = grown.steps.map((step) => `${trimZeros(step.volumeL)} L`).join(' then ');
  return `${grown.name}: a ${volumes} ${METHOD_WORDS[method]} starter is planned; Braukaiser's model puts it at ${grown.finalCellsBillion.toFixed(0)} bn cells, ±15 %.`;
}

/** The word for each agitation method in "a 2 L … starter". */
const METHOD_WORDS: Readonly<Record<StarterMethod, string>> = {
  'stir-plate': 'stir-plate',
  shaken: 'shaken',
  still: 'unstirred',
};

/** Formats a flask volume without trailing zeros: `2`, `1.5`. */
function trimZeros(volumeL: number): string {
  return String(Number(volumeL.toFixed(2)));
}

/**
 * Apparent attenuation range of a yeast, in %, for a "78–82 %" label.
 *
 * @category Yeast
 * @group Calculations
 */
export function attenuationRange(yeast: YeastSelection): {
  /** Published minimum apparent attenuation, %. */
  readonly minPercent: Percent;
  /** Published maximum apparent attenuation, %. */
  readonly maxPercent: Percent;
} {
  return { minPercent: yeast.attenuationMinPercent, maxPercent: yeast.attenuationMaxPercent };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/**
 * The pitch a batch needs, with its breakdown.
 *
 * The value is the cell count the batch needs, in billions, because the rest
 * of the pitch decision depends on it. Packs required, viability and the rate
 * achieved are in the inputs.
 *
 * @category Yeast
 * @group Explanations
 */
export function pitchPlanExplained(input: PitchPlanInput): Explanation {
  const plan = pitchPlan(input);
  const round = (n: number, dp = 1) => Number(n.toFixed(dp));
  return explain(plan.cellsNeededBillion, {
    label: 'Viable cells needed',
    formula: 'pitch-rate-plato',
    expression: 'cells (bn) = rate (M cells/mL/°P) × volume (L) × °P',
    inputs: {
      volumeL: round(input.volumeL, 2),
      og: Number(input.og.toFixed(4)),
      gravityPlato: round(pitchGravityPlato(input.og), 2),
      targetPitchRate: plan.targetPitchRate,
      cellsAvailableBillion: round(plan.cellsAvailableBillion),
      // Always include the pack count, so a reader can see how much came from
      // the packs and how much from a starter. It equals cellsAvailableBillion
      // when no row has a starter.
      cellsFromPacksBillion: round(plan.cellsFromPacksBillion),
      ...(plan.starters.length > 0
        ? {
            starterSteps: plan.starters
              .flatMap((grown) => grown.steps.map((step) => `${trimZeros(step.volumeL)} L`))
              .join(' then '),
            starterMethod: plan.starters[0]?.steps[0]?.method ?? 'stir-plate',
          }
        : {}),
      shortfallBillion: round(plan.shortfallBillion),
      packsRequired: plan.packsRequired,
      viability: round(plan.viability, 3),
      achievedPitchRate: round(plan.achievedPitchRate, 3),
    },
    unit: 'billion cells',
    notes: [
      ...plan.notes,
      'Ale and lager rates differ by a factor of two because a lager ferments cold and slowly.',
      ...(plan.shortfallBillion > 0
        ? [
            plan.starters.length > 0
              ? 'The selection is short of the target even with the starter: a bigger starter, or another pack, closes the rest.'
              : 'The selection is short of the target: another pack, or a starter, closes the gap.',
          ]
        : []),
    ],
    family: 'yeast',
    sources: [
      WHITE_ZAINASHEFF_2010,
      MR_MALTY_VIABILITY,
      ...(plan.starters.length > 0 ? [TROESTER_YEAST_GROWTH_2012] : []),
    ],
  });
}
