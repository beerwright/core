/**
 * One question, one function: how much sugar primes this batch? Used by the
 * Start here and Packaging guides.
 */
import { primingSugar } from '../../src/index';

// #region priming
const dose = primingSugar({
  beerVolumeL: 19,
  targetVolumes: 2.4,
  fermentationTempC: 20,
  sugar: 'corn-sugar',
});

dose.sugarGrams; // grams of corn sugar for the whole batch
dose.residualVolumes; // CO₂ the beer already holds from fermentation
// #endregion priming

/** The numbers the guide prints. */
export function primingExample() {
  return dose;
}
