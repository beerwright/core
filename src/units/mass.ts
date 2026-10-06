/**
 * Mass conversions.
 *
 * Canonical unit inside the engine: kilograms.
 * All factors are the exact international avoirdupois definitions.
 */

/**
 * Kilograms in one avoirdupois pound (exact).
 *
 * @category Units
 * @group Constants and defaults
 */
export const KG_PER_POUND = 0.45359237;

/**
 * Kilograms in one avoirdupois ounce (exact: one sixteenth of a pound).
 *
 * @category Units
 * @group Constants and defaults
 */
export const KG_PER_OUNCE = KG_PER_POUND / 16;

/**
 * Convert kilograms to pounds.
 *
 * @category Units
 * @group Calculations
 */
export function kgToPounds(kg: number): number {
  return kg / KG_PER_POUND;
}

/**
 * Convert pounds to kilograms.
 *
 * @category Units
 * @group Calculations
 */
export function poundsToKg(pounds: number): number {
  return pounds * KG_PER_POUND;
}

/**
 * Convert kilograms to ounces.
 *
 * @category Units
 * @group Calculations
 */
export function kgToOunces(kg: number): number {
  return kg / KG_PER_OUNCE;
}

/**
 * Convert ounces to kilograms.
 *
 * @category Units
 * @group Calculations
 */
export function ouncesToKg(ounces: number): number {
  return ounces * KG_PER_OUNCE;
}

/**
 * Convert kilograms to grams.
 *
 * @category Units
 * @group Calculations
 */
export function kgToGrams(kg: number): number {
  return kg * 1000;
}

/**
 * Convert grams to kilograms.
 *
 * @category Units
 * @group Calculations
 */
export function gramsToKg(grams: number): number {
  return grams / 1000;
}

/**
 * Split a mass into whole pounds plus the remaining ounces — the way US
 * brewers write grain bills ("9 lb 4 oz").
 *
 * @category Units
 * @group Calculations
 */
export function kgToPoundsOunces(kg: number): {
  /** Whole pounds. */
  pounds: number;
  /** The remaining ounces, fractional, below 16. */
  ounces: number;
} {
  const totalOunces = kgToOunces(kg);
  const pounds = Math.floor(totalOunces / 16);
  return { pounds, ounces: totalOunces - pounds * 16 };
}
