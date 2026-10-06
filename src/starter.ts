/**
 * Yeast starters.
 *
 * How many cells the batch needs, how many the packs in the fridge still have,
 * and, when there aren't enough, the starter that closes the gap.
 *
 * ```
 * target  = rate × volume × °P            targetPitchCells
 * on hand = packs × cells/pack × viability  packViability → availableCells
 * grow    = DME × growth-rate(inoculation)  starterGrowth  (Braukaiser)
 * plan    = one step, or two, or "buy another pack"  planStarter
 * ```
 *
 * For dry yeast, {@link dryYeastSachets} replaces all of the above. A starter
 * is how you fix a short liquid pack, and putting dry yeast in one makes the
 * pitch worse. The reasoning is in that function's doc comment.
 *
 * ## Relationship to `yeast.ts`
 *
 * `yeast.ts` handles the pitch itself: {@link cellsNeeded}, the viability decay
 * curve and {@link pitchPlan}'s "do you have enough packs?". This module
 * answers "no, so what do I do about it". It calls into `yeast.ts` for the
 * shared parts instead of repeating them: {@link targetPitchCells} and
 * {@link packViability} are the same arithmetic `pitchPlan` uses, under the
 * names a starter calculator's inputs use. The same pack shouldn't show as
 * 49 % viable in one place and 40 % in another. See {@link packViability} for
 * more on that.
 *
 * ## Relationship to `starter-growth.ts`
 *
 * The starter wort and the growth model (the DME convention, Braukaiser's four
 * constants, {@link starterGrowthRate} and {@link starterGrowth}) are in
 * `starter-growth.ts` and re-exported from here, so callers can import
 * everything starter-related from this module. They're in a separate file
 * because `yeast.ts` grows a saved starter inside {@link pitchPlan} and can't
 * import this file without an import cycle. The planning and the refusals are
 * here.
 *
 * ## Everything here is per litre of starter, not per litre of beer
 *
 * Cell counts are in billions throughout (the unit the labs and published
 * calculators use), extract in grams of DME, volumes in litres. A "growth
 * rate" in this module is always new billion cells per gram of dry extract,
 * and an "inoculation rate" is always billion cells pitched per gram of dry
 * extract. Those are Braukaiser's two axes, kept in his units so the
 * transcribed numbers can be checked against his chart.
 *
 * ## How accurate this is
 *
 * Kai's own answer, in the post the model comes from: "I expect yeast growth
 * calculators to have an error of +/- 15 % or more." By his 2013 talk he had
 * strains differing from each other by 2×, and concluded that "for a better
 * model a lot of characterization is needed". Nothing downstream of
 * {@link starterGrowth} should be shown with more precision than that, and a
 * plan that clears its target by a few per cent hasn't really cleared it.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import { TROESTER_NHC_2013, TROESTER_YEAST_GROWTH_2012, WHITE_ZAINASHEFF_2010 } from './sources';
import type { StarterYield } from './starter-growth';
import {
  MAX_GROWTH_PER_GRAM,
  STARTER_DME_GRAMS_PER_LITRE,
  STARTER_GRAVITY,
  starterDmeGrams,
  starterGrowth,
  UNSTIRRED_GROWTH_PER_GRAM,
} from './starter-growth';
import type { Litres, SpecificGravity, StarterMethod, YeastForm } from './types';
import { cellsNeeded, packRetentionPer30Days, viabilityFromManufactureDate } from './yeast';

/**
 * The starter wort and the growth model, re-exported so callers can import
 * everything starter-related from here. The header explains why they live in
 * `starter-growth.ts`.
 */
export {
  GROWTH_CEASES_INOCULATION_RATE,
  GROWTH_DECLINE_INTERCEPT,
  GROWTH_DECLINE_SLOPE,
  GROWTH_PLATEAU_INOCULATION_RATE,
  MAX_GROWTH_PER_GRAM,
  STARTER_DME_GRAMS_PER_LITRE,
  STARTER_GRAVITY,
  type StarterYield,
  starterDmeGrams,
  starterGrowth,
  starterGrowthRate,
  starterVolumeL,
  UNSTIRRED_GROWTH_PER_GRAM,
} from './starter-growth';

// ---------------------------------------------------------------------------
// Pitch rates
// ---------------------------------------------------------------------------

/**
 * Ale pitch rate: 0.75 million cells per millilitre per degree Plato.
 *
 * The standard figure from White & Zainasheff, *Yeast: The Practical Guide to
 * Beer Fermentation* (Brewers Publications, 2010), ch. 7. It's the default in
 * most homebrew pitching calculators, and the same constant `yeast.ts` uses
 * for an ale strain.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const ALE_PITCH_RATE = 0.75;

/**
 * Lager pitch rate: 1.5 M cells/mL/°P, double the ale rate.
 *
 * Also White & Zainasheff. The doubling isn't a safety margin. A lager
 * ferment is cold and slow and the yeast reproduces less in the wort, so the
 * cells have to be there at pitch instead of being grown in the beer.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const LAGER_PITCH_RATE = 1.5;

/**
 * An intentional under-pitch: 0.35 M cells/mL/°P.
 *
 * Roughly half the ale rate. Brewers pitch this low when they want yeast
 * character: hefeweizen banana and clove, Belgian phenolics, and kveik, which
 * is normally pitched thin and warm. Under-pitching is a legitimate technique
 * for these beers, so we offer the rate, but it isn't the default for
 * anything.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const LOW_PITCH_RATE = 0.35;

/**
 * Viable cells a pitch needs, in billions.
 *
 * ```
 * cells (billion) = rate (M/mL/°P) × volume (L) × °P
 * ```
 *
 * `rate` is million cells per mL per °P. The volume is the wort going into the
 * fermenter, not the nominal batch size. Gravity comes in as SG and is
 * converted with `sgToPlato` via {@link cellsNeeded}, so this always matches
 * {@link pitchPlan}.
 *
 * @category Yeast
 * @group Calculations
 */
export function targetPitchCells(volumeL: Litres, og: SpecificGravity, rate: number): number {
  return cellsNeeded({ volumeL, og, pitchRate: rate });
}

// ---------------------------------------------------------------------------
// Viability
// ---------------------------------------------------------------------------

/**
 * Fraction of a pack's cells still alive on a given day.
 *
 * Calls `yeast.ts`'s {@link viabilityFromManufactureDate}: 100 % on the date
 * printed on the pack, then exponential decay at 0.79 per 30 days for liquid
 * and 0.96 per 30 days for dry. A White Labs pack, recognised by its name,
 * decays on White Labs' own published curve instead, 0.946 per 30 days (see
 * `PUREPITCH_RETENTION_PER_30_DAYS`).
 *
 * ## Why not the linear "20 % a month" that's usually quoted
 *
 * Most calculators (Mr Malty's chart, and the usual summaries of the *Yeast*
 * book and White Labs' guidance) use a straight line losing about 20–21 % of
 * the original count per month, often floored at 10 % so it never reaches
 * zero. That's a convention, not a measurement. Real decay depends on the
 * strain, the cell density in the pack and, more than anything, how warm the
 * pack got in transit.
 *
 * We model the same ~21 %/month as a continuous exponential, for the reason
 * given on `VIABILITY_RETENTION_PER_30_DAYS`: the curve stays positive without
 * an arbitrary floor and the monthly loss compounds. Over the ages that
 * matter, the two differ by less than the convention's own uncertainty:
 *
 * | age | linear 20 %/mo | this engine (0.79^(d/30)) |
 * | --- | --- | --- |
 * | 1 month | 80 % | 79 % |
 * | 3 months | 40 % | 49 % |
 * | 6 months | 10 % (floor) | 24 % |
 *
 * The gap only gets large at ages where nobody would pitch the pack without
 * stepping it up anyway. Two different models would be worse: the same pack
 * would show 49 % in the pitch check and 40 % in the starter calculator. So
 * the starter calculator uses the same curve as {@link pitchPlan}.
 *
 * ## Dry yeast
 *
 * Dry yeast is made for shelf stability (vacuum-packed, low moisture, sold
 * with a two-year best-before), so date decay matters much less than the cells
 * per gram the manufacturer packed, which is where {@link availableCells} gets
 * its number. The 0.96/30 days is a small correction. A sachet inside its
 * best-before date is within a rounding error of its printed count.
 *
 * @category Yeast
 * @group Calculations
 */
export function packViability(
  manufacturedAt: Date,
  now: Date,
  form: YeastForm,
  /** The pack's name. A White Labs name selects their curve (see `packRetentionPer30Days`). */
  name = '',
): number {
  return viabilityFromManufactureDate(manufacturedAt, now, {
    form,
    retentionPer30Days: packRetentionPer30Days(form, name),
  });
}

/**
 * Fraction of a harvested slurry's cells still alive on a given day.
 *
 * Uses the same curve as {@link packViability} with the liquid constant,
 * counting from the day the yeast came out of the fermenter, since a jar of
 * slurry has no pack date. Sharing the decay model means a repitched
 * culture's viability can't come out differently depending on who asks.
 *
 * ## Why the liquid constant
 *
 * The two figures in `VIABILITY_RETENTION_PER_30_DAYS` describe two packaging
 * states, not two organisms. Dry yeast's 0.96 per 30 days is for a
 * vacuum-packed cake at roughly 5 % moisture, made for shelf life, with cells
 * that are metabolically dormant and using almost nothing. Harvested slurry is
 * the opposite: fully hydrated, suspended in beer, still respiring at fridge
 * temperature, and using up its glycogen and trehalose as it sits. That's the
 * same situation as a liquid pack, so it gets the liquid figure, 0.79 per 30
 * days.
 *
 * ## There's no source for this
 *
 * There's no published decay constant for homebrew-harvested slurry, and it
 * wouldn't be a single number if there were. It depends on how much beer and
 * trub came with it, whether it was rinsed, how cold it was kept, and how hard
 * the ferment it was cropped from worked the cells. Slurry taken at high
 * krausen off a healthy 1.048 ale is in better condition than the same strain
 * scraped off the cake after four weeks under a lager.
 *
 * So the liquid curve is a reasoned default, not a measurement, and it's no
 * better than the ±15 % the module header gives for everything downstream of
 * {@link starterGrowth}. Callers should show it as a whole percentage, as a
 * rough indication of freshness.
 *
 * @category Yeast
 * @group Calculations
 */
export function slurryViability(harvestedAt: Date, now: Date): number {
  return viabilityFromManufactureDate(harvestedAt, now, { form: 'liquid' });
}

// ---------------------------------------------------------------------------
// What is in the fridge
// ---------------------------------------------------------------------------

/**
 * Cells in a fresh liquid pack, in billions: 100.
 *
 * Wyeast's Activator smack pack and White Labs' PurePitch pouch are both sold
 * as "approximately 100 billion cells", and pitching calculators assume it.
 * It's a nominal figure (labs quote a count at packaging, not what's left by
 * the time it reaches your fridge), so {@link availableCells} lets callers
 * override it.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const CELLS_PER_LIQUID_PACK_BILLION = 100;

/**
 * Cells per gram of dry yeast, in billions: 10.
 *
 * The usual figure for modern active dry yeast. Fermentis publishes ≥ 6 × 10⁹
 * viable cells/g as a minimum spec and Lallemand quotes ≥ 5 × 10⁹, but
 * measured counts on fresh sachets are typically nearer 10 × 10⁹. Pitching
 * calculators use 10, so we do too, to agree with them. The spread between 6
 * and 10 is real, which is why this is a parameter. `yeast.ts`'s `pitchPlan`
 * uses the conservative 6 for "will one sachet do?", where underestimating is
 * the safe direction. Here the question is "how big a starter?", and a
 * pessimistic count wastes DME growing cells that were already there.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const CELLS_PER_GRAM_DRY_BILLION = 10;

/**
 * Standard dry sachet size in grams. US-05, S-04, BRY-97, Nottingham and W-34/70 all come in it.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const DRY_SACHET_GRAMS = 11.5;

/**
 * What the brewer has to pitch, before viability is applied.
 *
 * @category Yeast
 * @group Inputs
 */
export interface YeastOnHand {
  /** Dry or liquid. Decides whether {@link packs} or {@link gramsDry} counts. */
  readonly form: YeastForm;
  /** Number of liquid packs/vials. Defaults to 1 for liquid, ignored for dry when `gramsDry` is given. */
  readonly packs?: number;
  /** Grams of dry yeast. */
  readonly gramsDry?: number;
  /** Per-lab override for {@link CELLS_PER_LIQUID_PACK_BILLION}. */
  readonly cellsPerPackBillion?: number;
  /** Per-lab override for {@link CELLS_PER_GRAM_DRY_BILLION}. */
  readonly cellsPerGramBillion?: number;
}

/**
 * Viable cells on hand, in billions.
 *
 * ```
 * liquid: packs × cellsPerPack × viability
 * dry:    grams × cellsPerGram × viability
 * ```
 *
 * A dry entry with no `gramsDry` falls back to `packs` sachets of the standard
 * 11.5 g, which is what every major dry strain is sold in.
 *
 * @category Yeast
 * @group Calculations
 */
export function availableCells(yeast: YeastOnHand, viability: number): number {
  const factor = Math.max(0, viability);
  if (yeast.form === 'dry') {
    const perGram = yeast.cellsPerGramBillion ?? CELLS_PER_GRAM_DRY_BILLION;
    const grams = yeast.gramsDry ?? (yeast.packs ?? 1) * DRY_SACHET_GRAMS;
    return Math.max(0, grams) * perGram * factor;
  }
  const perPack = yeast.cellsPerPackBillion ?? CELLS_PER_LIQUID_PACK_BILLION;
  return Math.max(0, yeast.packs ?? 1) * perPack * factor;
}

/**
 * What {@link dryYeastSachets} works out.
 *
 * @category Yeast
 * @group Results
 */
export interface DrySachetPlan {
  /** Whole sachets to pitch. */
  readonly sachets: number;
  /** What that weighs, grams. */
  readonly gramsDry: number;
  /** Viable cells they supply, billion. */
  readonly cellsBillion: number;
}

/**
 * Sachets of dry yeast a pitch needs. For a dry-yeast shortfall, this
 * replaces a starter.
 *
 * A starter fixes a short liquid pack, and only a liquid one. Dry yeast is
 * dried with a full supply of the sterols and unsaturated fatty acids the
 * cells need to build membranes through their first divisions, and it's grown
 * and packed under aeration a homebrewer can't reproduce. In a starter it
 * spends those reserves fermenting sugar water. The count goes up, every cell
 * ends up in worse condition, and the pitch is worse than the sachet you
 * started with. Fermentis and Lallemand both say not to, and so does White &
 * Zainasheff's *Yeast*. The fix is another sachet, which costs less than the
 * DME would.
 *
 * So the dry-yeast branch of the calculator is just this division, rounded
 * up. It never offers a starter.
 *
 * @category Yeast
 * @group Calculations
 */
export function dryYeastSachets(
  targetCellsBillion: number,
  options: {
    /** Grams per sachet. Defaults to {@link DRY_SACHET_GRAMS}. */
    readonly gramsPerSachet?: number;
    /** Per-lab override for {@link CELLS_PER_GRAM_DRY_BILLION}. */
    readonly cellsPerGramBillion?: number;
    /** Viability of the sachets, as a fraction. Defaults to 1. */
    readonly viability?: number;
  } = {},
): DrySachetPlan {
  const gramsPerSachet = options.gramsPerSachet ?? DRY_SACHET_GRAMS;
  const perGram = options.cellsPerGramBillion ?? CELLS_PER_GRAM_DRY_BILLION;
  const perSachet = gramsPerSachet * perGram * (options.viability ?? 1);
  const sachets = perSachet > 0 ? Math.ceil(Math.max(0, targetCellsBillion) / perSachet) : 0;
  return {
    sachets,
    gramsDry: sachets * gramsPerSachet,
    cellsBillion: sachets * perSachet,
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Starter volumes are planned in quarter-litre steps.
 *
 * Nobody measures 1.37 L into a flask. A quarter litre is about the finest
 * division a 2 L Erlenmeyer's markings and a kitchen scale can reliably
 * resolve, and it puts the DME on a round 25 g.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const STARTER_VOLUME_INCREMENT_L = 0.25;

/**
 * The largest single step we'll plan: 4 litres.
 *
 * Above that a homebrewer runs out of flask. A 5 L Erlenmeyer is the biggest
 * common size and needs headspace for krausen. Anything bigger means building
 * the starter in a fermenter, which is a different setup. It can be
 * overridden, because some people do own a 6 L flask.
 *
 * @category Yeast
 * @group Constants and defaults
 */
export const DEFAULT_MAX_STEP_L = 4;

/**
 * Options for {@link planStarter}.
 *
 * @category Yeast
 * @group Inputs
 */
export interface StarterPlanOptions {
  /** Agitation. Defaults to `stir-plate`, the method Braukaiser's model was measured on. */
  readonly method?: StarterMethod;
  /** Largest single step, litres. Defaults to {@link DEFAULT_MAX_STEP_L}. */
  readonly maxStepL?: Litres;
  /** Volume rounding, litres. Defaults to {@link STARTER_VOLUME_INCREMENT_L}. */
  readonly incrementL?: Litres;
}

/**
 * One step of a starter plan.
 *
 * @category Yeast
 * @group Results
 */
export interface StarterStep extends StarterYield {
  /** 1-based step number. */
  readonly step: number;
}

/**
 * The answer {@link planStarter} gives.
 *
 * @category Yeast
 * @group Results
 */
export interface StarterPlan {
  /** Cells the batch needs, billion. */
  readonly targetCellsBillion: number;
  /** Viable cells the brewer already has, billion. */
  readonly availableCellsBillion: number;
  /** `false` when the packs on hand already reach the target, so no starter is needed. */
  readonly needed: boolean;
  /** `false` when no plan of one or two steps reaches the target. */
  readonly reachable: boolean;
  /** The steps to build, in order. Empty when `needed` is `false` or `reachable` is `false`. */
  readonly steps: readonly StarterStep[];
  /** Cells at the end of the plan, billion. Equals `availableCellsBillion` when no starter is built. */
  readonly finalCellsBillion: number;
  /** Total dry malt extract across every step, grams. */
  readonly totalDmeGrams: number;
  /**
   * When the plan is unreachable, how many times the yeast on hand would make
   * it reachable. `null` otherwise.
   */
  readonly suggestedPackMultiplier: number | null;
  /** The agitation the plan assumes. */
  readonly method: StarterMethod;
  /** Assumptions and refusals, as sentences ready to show a brewer. */
  readonly notes: readonly string[];
}

/**
 * Plan a starter: one step if one is enough, two if not, and never three.
 *
 * The search tries every combination on the quarter-litre grid up to
 * `maxStepL`. That's at most a few hundred, so the plan returned is the one
 * that uses the least DME to reach the target.
 *
 * - **No starter.** `available ≥ target` returns `needed: false` with no steps.
 *   A calculator that always produces a starter teaches brewers to build ones
 *   they don't need.
 * - **One step.** The smallest volume on the grid whose yield reaches the
 *   target.
 * - **Two steps.** All of step one's yield seeds step two, which is what
 *   decanting and pitching the slurry does. Among the pairs that work, the one
 *   using the least DME wins, and the smaller first step breaks ties.
 * - **No plan.** Three steps is a lab propagation schedule. It means a week of
 *   juggling flasks to save the price of a pack of yeast, so we don't plan
 *   one. The result says how many packs would have made a starter unnecessary
 *   ({@link StarterPlan.suggestedPackMultiplier}) instead.
 *
 * @category Yeast
 * @group Start here
 */
export function planStarter(
  targetCellsBillion: number,
  availableCellsBillion: number,
  options: StarterPlanOptions = {},
): StarterPlan {
  const method = options.method ?? 'stir-plate';
  const maxStepL = options.maxStepL ?? DEFAULT_MAX_STEP_L;
  const incrementL = options.incrementL ?? STARTER_VOLUME_INCREMENT_L;
  const target = Math.max(0, targetCellsBillion);
  const available = Math.max(0, availableCellsBillion);
  const notes: string[] = [];
  if (method !== 'stir-plate') {
    notes.push(
      `Without a stir plate the model yields a flat ${UNSTIRRED_GROWTH_PER_GRAM[method]} bn cells per gram of extract, against up to ${MAX_GROWTH_PER_GRAM} bn stirred.`,
    );
  }

  const base = {
    targetCellsBillion: target,
    availableCellsBillion: available,
    method,
  } as const;

  if (available >= target) {
    return {
      ...base,
      needed: false,
      reachable: true,
      steps: [],
      finalCellsBillion: available,
      totalDmeGrams: 0,
      suggestedPackMultiplier: null,
      notes: [
        ...notes,
        target > 0
          ? `${available.toFixed(0)} bn viable cells against ${target.toFixed(0)} bn needed. No starter required.`
          : 'No pitch to make.',
      ],
    };
  }

  const grid = volumeGrid(incrementL, maxStepL);
  const solved = solve(target, available, grid, method);

  if (solved !== null) {
    return {
      ...base,
      needed: true,
      reachable: true,
      steps: solved.map((step, index) => ({ ...step, step: index + 1 })),
      finalCellsBillion: solved[solved.length - 1]?.finalCellsBillion ?? available,
      totalDmeGrams: solved.reduce((sum, step) => sum + step.dmeGrams, 0),
      suggestedPackMultiplier: null,
      notes:
        solved.length > 1
          ? [
              ...notes,
              'Two steps: chill the first, decant the spent wort and pitch the whole slurry into the second.',
            ]
          : notes,
    };
  }

  // Two steps aren't enough. Work out how much more yeast would make it
  // reachable, since that's the decision the brewer has to make.
  let multiplier: number | null = null;
  for (let n = 2; n <= MAX_SUGGESTED_PACKS; n += 1) {
    const richer = available * n;
    if (richer >= target || solve(target, richer, grid, method) !== null) {
      multiplier = n;
      break;
    }
  }

  return {
    ...base,
    needed: true,
    reachable: false,
    steps: [],
    finalCellsBillion: available,
    totalDmeGrams: 0,
    suggestedPackMultiplier: multiplier,
    notes: [
      ...notes,
      `${target.toFixed(0)} bn cells is out of reach of two ${maxStepL} L steps from ${available.toFixed(0)} bn.`,
      multiplier === null
        ? 'More stepping will not fix this. Pitch fresh yeast, build the starter in a bigger vessel, or drop the pitch rate.'
        : `Start from ${multiplier}× the yeast (${multiplier} packs, or one fresh one) instead of adding a third step.`,
    ],
  };
}

/** The most packs {@link planStarter} will suggest before giving up. */
const MAX_SUGGESTED_PACKS = 10;

/** Every step volume the planner will consider, ascending. */
function volumeGrid(incrementL: Litres, maxStepL: Litres): readonly Litres[] {
  const grid: Litres[] = [];
  for (let v = incrementL; v <= maxStepL + 1e-9; v += incrementL) {
    grid.push(Number(v.toFixed(4)));
  }
  return grid;
}

/**
 * The least-DME plan of one or two steps that reaches `target`, or `null`.
 *
 * Tries every combination on the grid (at most a few hundred), so the answer is
 * exact. Volumes ascend, so the first single step
 * that clears the target is the smallest one, and the first second step that
 * clears it is the smallest for that first step.
 */
function solve(
  target: number,
  available: number,
  grid: readonly Litres[],
  method: StarterMethod,
): readonly StarterYield[] | null {
  for (const volumeL of grid) {
    const only = starterGrowth(available, starterDmeGrams(volumeL), method);
    if (only.finalCellsBillion >= target) return [only];
  }

  let best: readonly [StarterYield, StarterYield] | null = null;
  let bestDme = Number.POSITIVE_INFINITY;
  for (const firstL of grid) {
    const first = starterGrowth(available, starterDmeGrams(firstL), method);
    if (first.newCellsBillion <= 0) continue;
    for (const secondL of grid) {
      const second = starterGrowth(first.finalCellsBillion, starterDmeGrams(secondL), method);
      if (second.finalCellsBillion < target) continue;
      const dme = first.dmeGrams + second.dmeGrams;
      if (dme < bestDme - 1e-9) {
        best = [first, second];
        bestDme = dme;
      }
      break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/**
 * A starter plan with its breakdown.
 *
 * The value is the total dry malt extract the plan calls for, since that's what
 * the brewer weighs out. The steps and growth rates are in the inputs, and any
 * refusal is in the notes.
 *
 * @category Yeast
 * @group Explanations
 */
export function starterPlanExplained(
  targetCellsBillion: number,
  availableCellsBillion: number,
  options: StarterPlanOptions = {},
): Explanation {
  const plan = planStarter(targetCellsBillion, availableCellsBillion, options);
  const round = (n: number, dp = 1) => Number(n.toFixed(dp));
  const first = plan.steps[0];
  return explain(plan.totalDmeGrams, {
    label: 'Starter, dry malt extract',
    formula: 'braukaiser-starter-growth',
    expression: 'new cells = growthRate(cells pitched / g extract, agitation) × g extract',
    inputs: {
      targetCellsBillion: round(plan.targetCellsBillion),
      availableCellsBillion: round(plan.availableCellsBillion),
      method: plan.method,
      steps: plan.steps.length,
      ...(first
        ? {
            firstStepVolumeL: round(first.volumeL, 2),
            firstStepInoculationRate: round(first.inoculationRate, 3),
            firstStepGrowthRate: round(first.growthRate, 3),
          }
        : {}),
      finalCellsBillion: round(plan.finalCellsBillion),
      dmeGramsPerLitre: STARTER_DME_GRAMS_PER_LITRE,
      starterGravity: STARTER_GRAVITY,
    },
    unit: 'g',
    notes: [
      ...plan.notes,
      'The growth model was measured on stirred starters under foil; every other agitation method is a flat band, not a curve.',
      'Two steps at most. A third is a laboratory propagation schedule, so the planner refuses and says how many packs would have done instead.',
    ],
    family: 'yeast',
    sources: [TROESTER_YEAST_GROWTH_2012, TROESTER_NHC_2013, WHITE_ZAINASHEFF_2010],
  });
}
