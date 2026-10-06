/**
 * Lists every explanation for a calculator reference.
 *
 * Given one worked example with enough in it to cover every family of numbers,
 * this returns every {@link Explanation} the engine produces for it, in a
 * stable order. A calculator reference is that list grouped by family.
 *
 * It lives next to the models so that the citation test checks the same set
 * of explanations a reference publishes. `reference.test.ts` calls this with a
 * fixture and asserts that every explanation has a citation.
 *
 * This file doesn't compute anything. Each value comes from the module that
 * owns its model, and this only decides what the reference shows and in what
 * order.
 */

import type { AcidAdjustmentInput } from './acid';
import { acidAdjustmentExplained } from './acid';
import type { BlendInput } from './blending';
import { blendExplanations } from './blending';
import type { PrimingInput } from './carbonation';
import { forcedCarbonationExplained, primingSugarExplained } from './carbonation';
import {
  hydrometerCorrectionExplained,
  refractometerFinalGravityExplained,
  refractometerGravityExplained,
  volumeCorrectionExplained,
} from './corrections';
import type { DecoctionPullInput } from './decoction';
import { decoctionPull } from './decoction';
import type { Explanation, ExplanationFamily } from './explain';
import { EXPLANATION_FAMILIES } from './explain';
import type { HopStorage } from './hop-freshness';
import { hopFreshnessExplained } from './hop-freshness';
import type { NutrientScheduleInput, SugarToGravityInput } from './must';
import { nutrientScheduleExplained, sugarToGravityExplained } from './must';
import type { PearsonSquareInput } from './pearson';
import { pearsonSquareExplained } from './pearson';
import { calculateRecipe } from './recipe';
import type { ProofAndSweetenInput } from './spirits';
import { proofAndSweetenExplained } from './spirits';
import type { SorbateDoseInput, SulfiteDoseInput } from './stabilising';
import { sorbateDoseExplained, sulfiteDoseExplained } from './stabilising';
import type { StarterPlanOptions } from './starter';
import { starterPlanExplained } from './starter';
import type {
  AbvFormula,
  CalculationOptions,
  Celsius,
  ColorFormula,
  EquipmentProfileInput,
  IbuFormula,
  Litres,
  Percent,
  RecipeInput,
  SpecificGravity,
} from './types';
import type { WaterSolverInput } from './waterSolver';
import { solveWaterProfile } from './waterSolver';
import type { PitchPlanInput } from './yeast';
import { pitchPlanExplained } from './yeast';

/**
 * One worked example with enough in it to cover every family.
 *
 * Only {@link recipe} is required. If a field is left out, that family has
 * nothing to show and is missing from the result (it isn't returned empty).
 *
 * @category Explanations and sources
 * @group Explanations
 */
export interface ReferenceExample {
  /** The recipe the worked example is about. */
  readonly recipe: RecipeInput;
  /** The equipment the recipe is calculated on. Defaults apply when it's left out. */
  readonly equipment?: EquipmentProfileInput;
  /** Calculation options for the recipe. These pick the formulas the base run uses. */
  readonly options?: CalculationOptions;
  /**
   * Bitterness models to show side by side, in addition to whichever one
   * `options` selects. We show them together because the three give different
   * answers for the same hop schedule.
   */
  readonly bitternessFormulas?: readonly IbuFormula[];
  /** Colour fits to show side by side. */
  readonly colorFormulas?: readonly ColorFormula[];
  /** ABV formulas to show side by side. */
  readonly abvFormulas?: readonly AbvFormula[];
  /** The packaging dose. */
  readonly priming?: PrimingInput;
  /** A regulator setting to reach the same carbonation without sugar. */
  readonly forcedCarbonation?: {
    /** Temperature of the beer, in °C. */
    readonly tempC: Celsius;
    /** Carbonation to reach, in volumes of CO₂. */
    readonly targetVolumes: number;
  };
  /** A refractometer reading before the boil and another at the end of fermentation. */
  readonly refractometer?: {
    /** Reading before fermentation, in °Brix as the refractometer shows it. */
    readonly originalMeasuredBrix: number;
    /** Reading at the end of fermentation, in °Brix as the refractometer shows it. */
    readonly finalMeasuredBrix: number;
    /** Wort correction factor the readings are divided by. Uses the package default when left out. */
    readonly wortCorrectionFactor?: number;
  };
  /** A hydrometer reading taken warm. */
  readonly hydrometer?: {
    /** The gravity read off the hydrometer, as specific gravity. */
    readonly measuredGravity: SpecificGravity;
    /** Temperature of the sample, in °C. */
    readonly sampleTempC: Celsius;
  };
  /** A kettle volume read hot off the sight glass. */
  readonly hotVolume?: {
    /** The volume read hot, in liters. */
    readonly volumeL: Litres;
    /** Temperature of the wort when it was read, in °C. */
    readonly measuredAtC: Celsius;
  };
  /** The pitch. */
  readonly pitch?: PitchPlanInput;
  /** The starter, if the pitch needs one. */
  readonly starter?: {
    /** Cells the pitch needs, in billions. */
    readonly targetCellsBillion: number;
    /** Cells on hand before the starter, in billions. */
    readonly availableCellsBillion: number;
    /** Starter planning options. Defaults apply when left out. */
    readonly options?: StarterPlanOptions;
  };
  /** A hop that has been in the freezer a while. */
  readonly hopStorage?: {
    /** The hop's alpha acid before storage, in percent. */
    readonly alphaAcidPercent: Percent;
    /** How and how long the hop has been stored. */
    readonly storage: HopStorage;
  };
  /** A blend. It's a different beer from the worked example, and its explanation says so. */
  readonly blend?: BlendInput;
  /** A salt solve against a target profile. */
  readonly waterSolver?: WaterSolverInput;
  /** A decoction pull. The worked example's recipe doesn't have a decoction mash. */
  readonly decoction?: DecoctionPullInput;
  /**
   * The six cellar calculations, which are about a mead instead of the worked
   * example's beer. They're independent of each other, so an example can have
   * a sulfite dose without a nutrient schedule and still get the sulfite
   * explanation.
   */
  readonly sugarToGravity?: SugarToGravityInput;
  /** A staggered nutrient schedule for the mead. */
  readonly nutrients?: NutrientScheduleInput;
  /** A sulfite dose. */
  readonly sulfite?: SulfiteDoseInput;
  /** A sorbate dose. */
  readonly sorbate?: SorbateDoseInput;
  /** An acid adjustment. */
  readonly acid?: AcidAdjustmentInput;
  /** A Pearson square blend of two components to a target. */
  readonly pearson?: PearsonSquareInput;
  /**
   * A jar of macerate proofed down and sweetened. It's the only drink in the
   * reference that isn't fermented.
   */
  readonly proofAndSweeten?: ProofAndSweetenInput;
}

/**
 * Every explanation the reference publishes for one example, in a stable
 * order. The recipe's own vitals come first, then the standalone calculators
 * that take their own inputs.
 *
 * The order matters because the output gets written out and diffed, so two
 * runs on the same example must produce identical output.
 *
 * @category Explanations and sources
 * @group Start here
 */
export function referenceExplanations(example: ReferenceExample): readonly Explanation[] {
  const { recipe, equipment = {}, options = {} } = example;
  const out: Explanation[] = [];

  const base = calculateRecipe(recipe, equipment, options);
  for (const explanation of Object.values(base.explain)) out.push(explanation);

  // Alternate formulas. We only take the one number each variant run changes.
  // Everything else it produces is the same as the base run and would be a
  // duplicate.
  for (const formula of example.bitternessFormulas ?? []) {
    if (formula === (options.ibuFormula ?? 'tinseth')) continue;
    const alt = calculateRecipe(recipe, equipment, { ...options, ibuFormula: formula });
    const ibu = alt.explain.ibu;
    if (ibu) out.push(ibu);
  }
  for (const formula of example.colorFormulas ?? []) {
    if (formula === (options.colorFormula ?? 'morey')) continue;
    const alt = calculateRecipe(recipe, equipment, { ...options, colorFormula: formula });
    const srm = alt.explain.srm;
    if (srm) out.push(srm);
  }
  for (const formula of example.abvFormulas ?? []) {
    if (formula === (options.abvFormula ?? 'advanced')) continue;
    const alt = calculateRecipe(recipe, equipment, { ...options, abvFormula: formula });
    const abv = alt.explain.abv;
    if (abv) out.push(abv);
  }

  if (example.decoction) out.push(decoctionPull(example.decoction).explain);
  if (example.waterSolver) out.push(solveWaterProfile(example.waterSolver).explain);
  if (example.priming) out.push(primingSugarExplained(example.priming));
  if (example.forcedCarbonation) {
    out.push(
      forcedCarbonationExplained(
        example.forcedCarbonation.tempC,
        example.forcedCarbonation.targetVolumes,
      ),
    );
  }
  if (example.refractometer) {
    const r = example.refractometer;
    out.push(
      r.wortCorrectionFactor === undefined
        ? refractometerGravityExplained(r.originalMeasuredBrix)
        : refractometerGravityExplained(r.originalMeasuredBrix, r.wortCorrectionFactor),
    );
    out.push(
      r.wortCorrectionFactor === undefined
        ? refractometerFinalGravityExplained(r.originalMeasuredBrix, r.finalMeasuredBrix)
        : refractometerFinalGravityExplained(
            r.originalMeasuredBrix,
            r.finalMeasuredBrix,
            r.wortCorrectionFactor,
          ),
    );
  }
  if (example.hydrometer) {
    out.push(
      hydrometerCorrectionExplained(
        example.hydrometer.measuredGravity,
        example.hydrometer.sampleTempC,
      ),
    );
  }
  if (example.hotVolume) {
    out.push(volumeCorrectionExplained(example.hotVolume.volumeL, example.hotVolume.measuredAtC));
  }
  if (example.pitch) out.push(pitchPlanExplained(example.pitch));
  if (example.starter) {
    const s = example.starter;
    out.push(
      s.options === undefined
        ? starterPlanExplained(s.targetCellsBillion, s.availableCellsBillion)
        : starterPlanExplained(s.targetCellsBillion, s.availableCellsBillion, s.options),
    );
  }
  if (example.hopStorage) {
    out.push(
      hopFreshnessExplained(example.hopStorage.alphaAcidPercent, example.hopStorage.storage),
    );
  }
  if (example.blend) out.push(...blendExplanations(example.blend));

  if (example.sugarToGravity) out.push(sugarToGravityExplained(example.sugarToGravity));
  if (example.nutrients) out.push(nutrientScheduleExplained(example.nutrients));
  if (example.sulfite) out.push(sulfiteDoseExplained(example.sulfite));
  if (example.sorbate) out.push(sorbateDoseExplained(example.sorbate));
  if (example.acid) out.push(acidAdjustmentExplained(example.acid));
  if (example.pearson) {
    // This can return null. A square whose target is outside its two
    // components has no volume to publish. See `pearsonSquareExplained`.
    const square = pearsonSquareExplained(example.pearson);
    if (square) out.push(square);
  }
  if (example.proofAndSweeten) {
    // This can return null too, for the same reason. If water can't bring it
    // down to the target strength, there's no volume to publish.
    const spirit = proofAndSweetenExplained(example.proofAndSweeten);
    if (spirit) out.push(spirit);
  }

  return out;
}

/**
 * The same set, grouped by family and in {@link EXPLANATION_FAMILIES} order.
 *
 * Families with nothing to show are left out instead of being included empty,
 * so a caller iterating this only writes the pages it has content for.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export function referenceExplanationsByFamily(
  example: ReferenceExample,
): ReadonlyMap<ExplanationFamily, readonly Explanation[]> {
  const all = referenceExplanations(example);
  const grouped = new Map<ExplanationFamily, Explanation[]>();
  for (const explanation of all) {
    const family = explanation.family;
    if (family === undefined) continue;
    const bucket = grouped.get(family);
    if (bucket) bucket.push(explanation);
    else grouped.set(family, [explanation]);
  }
  const ordered = new Map<ExplanationFamily, readonly Explanation[]>();
  for (const family of EXPLANATION_FAMILIES) {
    const bucket = grouped.get(family);
    if (bucket && bucket.length > 0) ordered.set(family, bucket);
  }
  return ordered;
}
