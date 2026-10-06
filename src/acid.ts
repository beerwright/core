/**
 * Raising the titratable acidity of a must or a juice.
 *
 * This is the cellar acid addition, which is a different calculation from the
 * brewing one. For a mash, acid is dosed against alkalinity to reach a target
 * pH. Here it's dosed against a titration, which measures how much acid is in
 * the drink and not how sour it tastes. The answer is grams of a solid acid
 * instead of millilitres of a solution.
 *
 * Canonical units: litres, grams per litre, grams.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import { ILAND_GRAPES_AND_WINE_2004 } from './sources';
import type { Litres } from './types';

/**
 * The three acids a cellar keeps.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type CellarAcid = 'tartaric' | 'malic' | 'citric';

/**
 * Display names for the acids.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const CELLAR_ACID_LABELS: Readonly<Record<CellarAcid, string>> = {
  tartaric: 'Tartaric',
  malic: 'Malic',
  citric: 'Citric',
};

/**
 * Equivalent weight of each acid, g per equivalent.
 *
 * Molecular weight over the number of protons: tartaric 150.09 / 2 = 75.0,
 * malic 134.09 / 2 = 67.0, citric 192.12 / 3 = 64.0. Dividing by the protons
 * is what makes the three comparable, and showing the working lets you check
 * the values.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const ACID_EQUIVALENT_WEIGHTS: Readonly<Record<CellarAcid, number>> = {
  tartaric: 75,
  malic: 67,
  citric: 64,
};

/**
 * The acid titratable acidity is reported as.
 *
 * Wine and cider labs express TA as grams of tartaric acid per litre, whatever
 * acid is in the sample. That's why {@link ACID_EQUIVALENT_WEIGHTS} values are
 * divided by tartaric's.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const TA_REFERENCE_ACID: CellarAcid = 'tartaric';

/**
 * Input to {@link acidAdjustment}.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface AcidAdjustmentInput {
  /** How much there is to treat, litres. */
  readonly volumeL: Litres;
  /** Titratable acidity now, g/L as tartaric. */
  readonly currentTaGL: number;
  /** Titratable acidity wanted, g/L as tartaric. */
  readonly targetTaGL: number;
  /** Which acid is being added. */
  readonly acid: CellarAcid;
}

/**
 * Result of {@link acidAdjustment}.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface AcidAdjustmentResult {
  /** What to weigh out, grams. */
  readonly grams: number;
}

/**
 * Acid to raise a titratable acidity to a target.
 *
 * ```
 * g/L = (target TA − current TA) × equivalent weight of the acid / 75
 * g   = g/L × volume_L
 * ```
 *
 * TA is reported as tartaric, so a gram of tartaric acid per litre raises TA by
 * one gram per litre and the factor is 1. Malic and citric have lower
 * equivalent weights (67 and 64, against tartaric's 75), so a gram of either
 * carries more acidity and you need less of them for the same change. That's
 * the only correction, and it's why a recipe that says "add 2 g/L of acid"
 * without naming the acid is under-specified.
 *
 * ## Lowering acidity
 *
 * A target below the current figure returns zero. Taking acid out is
 * deacidification (potassium bicarbonate, calcium carbonate, or a malolactic
 * fermentation), and each of those changes the drink in ways an addition
 * doesn't. Carbonate removes potassium and tartrate together and moves the pH
 * much further than the TA, and malolactic converts the malic acid instead of
 * removing it. A negative weight would describe an operation that doesn't
 * exist.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidAdjustment(input: AcidAdjustmentInput): AcidAdjustmentResult {
  const delta = input.targetTaGL - input.currentTaGL;
  if (delta <= 0 || input.volumeL <= 0) return { grams: 0 };
  const gramsPerLitre =
    (delta * ACID_EQUIVALENT_WEIGHTS[input.acid]) / ACID_EQUIVALENT_WEIGHTS[TA_REFERENCE_ACID];
  return { grams: gramsPerLitre * input.volumeL };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/**
 * The acid addition with its breakdown. @see acidAdjustment
 *
 * @category Water and mash pH
 * @group Explanations
 */
export function acidAdjustmentExplained(input: AcidAdjustmentInput): Explanation {
  const result = acidAdjustment(input);
  const delta = input.targetTaGL - input.currentTaGL;
  return explain(result.grams, {
    label: 'Acid to raise titratable acidity',
    formula: 'ta-equivalent-weight',
    expression: 'g = (target TA − current TA) × (equivalent weight / 75) × volume_L',
    inputs: {
      volumeL: round(input.volumeL),
      currentTaGramsPerLitre: round(input.currentTaGL),
      targetTaGramsPerLitre: round(input.targetTaGL),
      acid: input.acid,
      equivalentWeight: ACID_EQUIVALENT_WEIGHTS[input.acid],
      taChangeGramsPerLitre: round(Math.max(0, delta)),
      doseGramsPerLitre: round(input.volumeL > 0 ? result.grams / input.volumeL : 0),
    },
    unit: 'g',
    notes: [
      'Titratable acidity is reported as tartaric, so tartaric is dosed one for one and the other two are scaled by their equivalent weights.',
      ...(delta <= 0
        ? [
            'The target is at or below the current acidity, so the answer is zero: lowering acidity is deacidification, which is a different operation.',
          ]
        : []),
    ],
    family: 'cellar',
    sources: [ILAND_GRAPES_AND_WINE_2004],
  });
}
