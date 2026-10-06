/**
 * Volume conversions.
 *
 * Canonical unit inside the engine: litres.
 * "gal" and "qt" mean the US liquid measures. The imperial versions are here
 * too, because UK brewers use them.
 */

/**
 * Litres in one US liquid gallon (exact).
 *
 * @category Units
 * @group Constants and defaults
 */
export const LITRES_PER_US_GALLON = 3.785411784;

/**
 * Litres in one US liquid quart (exact: a quarter of a US gallon).
 *
 * @category Units
 * @group Constants and defaults
 */
export const LITRES_PER_US_QUART = LITRES_PER_US_GALLON / 4;

/**
 * Litres in one imperial gallon (exact).
 *
 * @category Units
 * @group Constants and defaults
 */
export const LITRES_PER_IMPERIAL_GALLON = 4.54609;

/**
 * Litres in one imperial quart (exact).
 *
 * @category Units
 * @group Constants and defaults
 */
export const LITRES_PER_IMPERIAL_QUART = LITRES_PER_IMPERIAL_GALLON / 4;

/**
 * Convert litres to US liquid gallons.
 *
 * @category Units
 * @group Calculations
 */
export function litresToGallons(litres: number): number {
  return litres / LITRES_PER_US_GALLON;
}

/**
 * Convert US liquid gallons to litres.
 *
 * @category Units
 * @group Start here
 */
export function gallonsToLitres(gallons: number): number {
  return gallons * LITRES_PER_US_GALLON;
}

/**
 * Convert litres to US liquid quarts.
 *
 * @category Units
 * @group Calculations
 */
export function litresToQuarts(litres: number): number {
  return litres / LITRES_PER_US_QUART;
}

/**
 * Convert US liquid quarts to litres.
 *
 * @category Units
 * @group Calculations
 */
export function quartsToLitres(quarts: number): number {
  return quarts * LITRES_PER_US_QUART;
}

/**
 * Convert litres to imperial gallons.
 *
 * @category Units
 * @group Calculations
 */
export function litresToImperialGallons(litres: number): number {
  return litres / LITRES_PER_IMPERIAL_GALLON;
}

/**
 * Convert imperial gallons to litres.
 *
 * @category Units
 * @group Calculations
 */
export function imperialGallonsToLitres(gallons: number): number {
  return gallons * LITRES_PER_IMPERIAL_GALLON;
}

/**
 * Convert litres to imperial quarts.
 *
 * @category Units
 * @group Calculations
 */
export function litresToImperialQuarts(litres: number): number {
  return litres / LITRES_PER_IMPERIAL_QUART;
}

/**
 * Convert imperial quarts to litres.
 *
 * @category Units
 * @group Calculations
 */
export function imperialQuartsToLitres(quarts: number): number {
  return quarts * LITRES_PER_IMPERIAL_QUART;
}

/**
 * Litres in one US fluid ounce (exact: a 128th of a US gallon).
 *
 * This is for bottle sizes, not ingredient volumes. A 12 oz longneck and a
 * 22 oz bomber are the two bottles American homebrewers prime for.
 *
 * @category Units
 * @group Constants and defaults
 */
export const LITRES_PER_US_FLUID_OUNCE = LITRES_PER_US_GALLON / 128;

/**
 * Convert litres to US fluid ounces.
 *
 * @category Units
 * @group Calculations
 */
export function litresToFluidOunces(litres: number): number {
  return litres / LITRES_PER_US_FLUID_OUNCE;
}

/**
 * Convert US fluid ounces to litres.
 *
 * @category Units
 * @group Calculations
 */
export function fluidOuncesToLitres(fluidOunces: number): number {
  return fluidOunces * LITRES_PER_US_FLUID_OUNCE;
}

/**
 * Convert litres to millilitres.
 *
 * @category Units
 * @group Calculations
 */
export function litresToMillilitres(litres: number): number {
  return litres * 1000;
}

/**
 * Convert millilitres to litres.
 *
 * @category Units
 * @group Calculations
 */
export function millilitresToLitres(millilitres: number): number {
  return millilitres / 1000;
}
