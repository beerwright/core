/**
 * Alcohol by volume.
 *
 * There are two formulas, both exported. `CalculationOptions.abvFormula`
 * picks one, and the default is `advanced`.
 */

import type { Source } from './explain';
import { PALMER_HOW_TO_BREW, ZYMURGY_ABV_1995 } from './sources';
import type { AbvFormula, Percent, SpecificGravity } from './types';

/**
 * The homebrewer's rule of thumb: `ABV% = (OG − FG) × 131.25`.
 *
 * It's a linear fit. It's close enough below about 1.070 and reads
 * increasingly low above it. We keep it because most recipe books quote it
 * and people expect to be able to reproduce their numbers.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function abvSimple(og: SpecificGravity, fg: SpecificGravity): Percent {
  return (og - fg) * 131.25;
}

/**
 * The more accurate formula, and the engine default.
 *
 * ```
 * ABV% = (76.08 × (OG − FG) / (1.775 − OG)) × (FG / 0.794)
 * ```
 *
 * The first term is alcohol by weight from the gravity drop; `FG / 0.794`
 * converts weight to volume using the density of ethanol (0.794 g/mL). It's usually
 * attributed to a 1995 *Zymurgy* article, and BeerSmith, Brewer's Friend and
 * Brewfather all use it. It pulls away from {@link abvSimple} above ~7 % ABV,
 * and it's the more accurate of the two there.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function abvAdvanced(og: SpecificGravity, fg: SpecificGravity): Percent {
  return ((76.08 * (og - fg)) / (1.775 - og)) * (fg / 0.794);
}

/**
 * Run whichever ABV formula the options select.
 *
 * @category Gravity and ABV
 * @group Start here
 */
export function abv(
  og: SpecificGravity,
  fg: SpecificGravity,
  formula: AbvFormula = 'advanced',
): Percent {
  return formula === 'simple' ? abvSimple(og, fg) : abvAdvanced(og, fg);
}

/**
 * The citation key each formula reports in its explanation.
 *
 * @category Gravity and ABV
 * @internal
 */
export const ABV_FORMULA_NAMES: Readonly<Record<AbvFormula, string>> = {
  simple: 'abv-simple-131.25',
  advanced: 'abv-cutaia-1995',
};

/**
 * The formula each ABV model applies, written out for the explanation.
 *
 * @category Gravity and ABV
 * @internal
 */
export const ABV_FORMULA_EXPRESSIONS: Readonly<Record<AbvFormula, string>> = {
  simple: 'ABV% = (OG − FG) × 131.25',
  advanced: 'ABV% = (76.08 × (OG − FG) / (1.775 − OG)) × (FG / 0.794)',
};

/**
 * Where each ABV formula comes from, for the explanation's citation.
 *
 * @category Gravity and ABV
 * @internal
 */
export const ABV_FORMULA_SOURCES: Readonly<Record<AbvFormula, readonly Source[]>> = {
  simple: [PALMER_HOW_TO_BREW],
  advanced: [ZYMURGY_ABV_1995],
};
