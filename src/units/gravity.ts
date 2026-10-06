/**
 * Gravity / extract conversions.
 *
 * Canonical unit inside the engine: specific gravity (SG) at 20 °C/20 °C.
 */

/**
 * Specific gravity to degrees Plato.
 *
 * ASBC cubic polynomial fit of the Plato table:
 *   °P = -616.868 + 1111.14·SG − 630.272·SG² + 135.997·SG³
 *
 * Accurate to well under 0.1 °P across the range of interest (1.000–1.130).
 *
 * @category Units
 * @group Start here
 */
export function sgToPlato(sg: number): number {
  return -616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3;
}

/**
 * Degrees Plato to specific gravity.
 *
 * Standard inversion used by brewing calculators:
 *   SG = 1 + °P / (258.6 − (°P / 258.2) × 227.1)
 *
 * @category Units
 * @group Calculations
 */
export function platoToSg(plato: number): number {
  return 1 + plato / (258.6 - (plato / 258.2) * 227.1);
}

/**
 * Specific gravity to "gravity points" (the brewer's shorthand: 1.048 → 48).
 *
 * @category Units
 * @group Calculations
 */
export function sgToGravityPoints(sg: number): number {
  return (sg - 1) * 1000;
}

/**
 * Gravity points back to specific gravity (48 → 1.048).
 *
 * @category Units
 * @group Calculations
 */
export function gravityPointsToSg(points: number): number {
  return 1 + points / 1000;
}

/**
 * Specific gravity to degrees Brix.
 *
 * Brix and Plato are different scales (sucrose vs. maltose reference) but are
 * numerically within ~0.05 of each other over the brewing range, so we treat a
 * refractometer's Brix reading as Plato here. Wort-correction factors are a
 * separate concern handled by the refractometer module.
 *
 * @category Units
 * @group Calculations
 */
export function sgToBrix(sg: number): number {
  return sgToPlato(sg);
}

/**
 * Degrees Brix to specific gravity. See {@link sgToBrix} for the caveat.
 *
 * @category Units
 * @group Calculations
 */
export function brixToSg(brix: number): number {
  return platoToSg(brix);
}
