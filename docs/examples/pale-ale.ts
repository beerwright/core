/**
 * The pale ale from the README, run through `calculateRecipe`. The Start here
 * guide prints what this returns.
 */
import { calculateRecipe, type RecipeInput } from '../../src/index';

// biome-ignore format: laid out like the README so it reads as one recipe
// #region recipe
export const paleAle: RecipeInput = {
  name: 'Pale ale',
  batchVolumeL: 20,
  boilTimeMinutes: 60,
  fermentables: [
    { name: 'Pale ale malt', amountKg: 4.5, class: 'grain', use: 'mash',
      extractFineGrindDryBasisPercent: 80, moisturePercent: 4, colorLovibond: 3 },
    { name: 'Crystal 60', amountKg: 0.4, class: 'steeping-grain', use: 'mash',
      extractFineGrindDryBasisPercent: 74, moisturePercent: 4, colorLovibond: 60 },
  ],
  hops: [
    { name: 'Centennial', amountKg: 0.02, alphaAcidPercent: 9.5, form: 'pellet',
      use: 'boil', timeMinutes: 60 },
    { name: 'Cascade', amountKg: 0.03, alphaAcidPercent: 6, form: 'pellet',
      use: 'boil', timeMinutes: 15 },
  ],
  yeasts: [{ name: 'US-05', type: 'ale', form: 'dry',
    attenuationMinPercent: 78, attenuationMaxPercent: 82 }],
};

const result = calculateRecipe(paleAle);

const { og, fg, abv, ibu, srm, colorHex } = result.vitals;
const { strikeWaterL, spargeWaterL, preBoilVolumeL, volumeIntoFermenterL } = result.volumes;
// #endregion recipe

/** The numbers the guide prints. */
export function paleAleExample() {
  return {
    og,
    fg,
    abv,
    ibu,
    srm,
    colorHex,
    strikeWaterL,
    spargeWaterL,
    preBoilVolumeL,
    volumeIntoFermenterL,
    warnings: result.warnings,
    explainKeys: Object.keys(result.explain),
    ogExplanation: result.explain.og,
  };
}
