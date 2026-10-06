/**
 * The Pearson square.
 *
 * Given two lots and a target, it works out how much of each to take. A
 * winemaker draws it as a square with the two values on the left corners, the
 * target in the middle, and the differences read off diagonally.
 *
 * ## It's arithmetic, and the explanation note says so
 *
 * There's no model here and no coefficient to get wrong. It's a weighted
 * average solved for its weights, which is why `a` and `b` are unitless. The
 * caller decides whether they're percentages of alcohol, gravity points,
 * grams per litre of sugar or anything else that blends linearly. Don't use it
 * for pH, because pH is a logarithm and doesn't average. `blending.ts` weights
 * pH by [H⁺], so use that instead.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import { MARGALIT_WINE_CHEMISTRY_2004 } from './sources';
import type { Litres } from './types';

/**
 * Input to {@link pearsonSquare}.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface PearsonSquareInput {
  /** The first component's value. It's unitless here; see the module header. */
  readonly a: number;
  /** The second component's value, in the same unit as {@link a}. */
  readonly b: number;
  /** What the blend should come out at, in the same unit again. */
  readonly target: number;
  /** How much blend you want, in litres. */
  readonly totalVolumeL: Litres;
}

/**
 * Result of {@link pearsonSquare}.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface PearsonSquareResult {
  /** How much of the first component to take, in litres. */
  readonly volumeAL: Litres;
  /** How much of the second component to take, in litres. */
  readonly volumeBL: Litres;
}

/**
 * The share of each of two components that hits a target.
 *
 * ```
 * V_a = total × (target − b) / (a − b)
 * V_b = total − V_a
 * ```
 *
 * ## When it returns null
 *
 * A target outside the two values. Blending can't go past either component,
 * so two lots at 11 % and 13 % can't make 14 % in any proportion. The formula
 * itself doesn't catch this (it returns a share above one and a negative
 * volume for the other), so we check here instead of leaving the caller to
 * spot a negative litre.
 *
 * Two components with the same value. `a − b` is zero and every proportion
 * is equally right, so there's no answer to "how much of each". A blend of two
 * identical lots is whatever the blender likes.
 *
 * Both cases return `null`, so a caller that shows a result has to decide
 * what to say in place of a meaningless number.
 *
 * @category Blending, mead and spirits
 * @group Start here
 */
export function pearsonSquare(input: PearsonSquareInput): PearsonSquareResult | null {
  const { a, b, target, totalVolumeL } = input;
  if (a === b) return null;
  if (target < Math.min(a, b) || target > Math.max(a, b)) return null;
  const shareA = (target - b) / (a - b);
  return { volumeAL: totalVolumeL * shareA, volumeBL: totalVolumeL * (1 - shareA) };
}

/**
 * A sentence saying why the square returned `null`, or `null` if it didn't.
 *
 * {@link pearsonSquare} returns `null` for two different reasons and a caller
 * showing the result needs to say which. The sentence lives here so every
 * caller explains the same refusal the same way.
 *
 * It says "lots" and not "beers" because this function doesn't know what the
 * two numbers are. A caller that knows what they are can name them alongside
 * this sentence.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function pearsonSquareRefusal(input: PearsonSquareInput): string | null {
  if (pearsonSquare(input) !== null) return null;
  return input.a === input.b
    ? 'Both lots are the same, so any proportion hits the target. Change one of them.'
    : 'A target outside the two lots cannot be reached by blending them. Move the target between them, or change a lot.';
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/**
 * The square with its breakdown, or `null` when {@link pearsonSquare} returns
 * `null`.
 *
 * This is the only `*Explained` function in core that can return `null`. A
 * refusal has no number to explain, and making one up so the signature matched
 * the others would put a `NaN` in published docs.
 *
 * @category Blending, mead and spirits
 * @group Explanations
 */
export function pearsonSquareExplained(input: PearsonSquareInput): Explanation | null {
  const result = pearsonSquare(input);
  if (result === null) return null;
  const shareA = (input.target - input.b) / (input.a - input.b);
  return explain(result.volumeAL, {
    label: 'Pearson square, first component',
    formula: 'pearson-square',
    // Uses the same names as the inputs below instead of `a` and `b`, so the
    // formula and the input rows refer to the same two things.
    expression: 'V_first = total × (target − second) / (first − second)',
    // These keys are printed as row headings in the docs reference, and a row
    // called "A" means nothing without the formula next to it, so they're
    // named for what they are.
    inputs: {
      firstLot: round(input.a, 3),
      secondLot: round(input.b, 3),
      target: round(input.target, 3),
      totalVolumeL: round(input.totalVolumeL),
      shareOfFirstLot: round(shareA, 4),
      secondLotVolumeL: round(result.volumeBL),
    },
    unit: 'L',
    notes: [
      'A weighted average solved for its weights. The two values are unitless here: alcohol, gravity points, or anything else that blends linearly.',
      'Not for pH, which is a logarithm and does not average. Blending a pH is weighted by [H⁺].',
      'A target outside the two values cannot be reached by blending them, and neither can two components that are already the same.',
    ],
    family: 'cellar',
    sources: [MARGALIT_WINE_CHEMISTRY_2004],
  });
}
