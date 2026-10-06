/**
 * Readings from brew day and bottling day, turned into gravities and an ABV.
 * Used by the Recipe guide.
 */
import { abv, correctHydrometerReading, refractometerFinalGravityRaw } from '../../src/index';

// #region readings
// The hydrometer read 1.048 in a sample still at 32 °C.
const og = correctHydrometerReading(1.048, 32);

// The refractometer read 12.4 °Bx before pitching and 6.6 °Bx at the end.
const fg = refractometerFinalGravityRaw(12.4, 6.6);

const strength = abv(og, fg);
// #endregion readings

/** The numbers the guide prints. */
export function gravityExample() {
  return { og, fg, strength };
}
