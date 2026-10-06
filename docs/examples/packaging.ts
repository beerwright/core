/**
 * The same 2.4 volumes three ways: primed in bottles, force carbonated in a
 * keg, and a cider sulfited before it's sweetened. Used by the Packaging
 * guide.
 */
import { pressureFromCo2Volumes, primingSugar, psiToBar, sulfiteDose } from '../../src/index';

// #region bottle
const bottles = primingSugar({
  beerVolumeL: 19,
  targetVolumes: 2.4,
  fermentationTempC: 20,
  sugar: 'table-sugar',
});
// #endregion bottle

// #region keg
const kegPsi = pressureFromCo2Volumes(4, 2.4);
const kegBar = psiToBar(kegPsi);
// #endregion keg

// #region sulfite
const cider = sulfiteDose({ volumeL: 20, ph: 3.5 });
// #endregion sulfite

/** The numbers the guide prints. */
export function packagingExample() {
  return {
    sugarGrams: bottles.sugarGrams,
    residualVolumes: bottles.residualVolumes,
    kegPsi,
    kegBar,
    freeSo2MgL: cider.freeSo2MgL,
    metabisulfiteGrams: cider.metabisulfiteGrams,
  };
}
