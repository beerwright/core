/**
 * A tap water treated to a two-condition rule, then the mash pH it gives the
 * pale ale. Used by the Water and mash pH guide.
 */
import {
  predictMashPh,
  solveAdditionsForTargetPh,
  solveWaterRule,
  waterProfile,
} from '../../src/index';
import { paleAle } from './pale-ale';

// #region water
// A moderately hard tap water, as a US utility report gives it.
const tap = waterProfile({
  name: 'Tap',
  calciumPpm: 38,
  magnesiumPpm: 12,
  sodiumPpm: 25,
  chloridePpm: 30,
  sulfatePpm: 35,
  alkalinityPpmAsCaCO3: 110,
  ph: 7.8,
});

// At least 75 ppm calcium and twice as much sulfate as chloride.
const treatment = solveWaterRule({
  source: tap,
  rule: { minCalciumPpm: 75, sulfateChlorideRatio: 2 },
  volumes: { mashVolumeL: 14.7, spargeVolumeL: 15.4 },
});

const mash = predictMashPh({
  grist: paleAle.fermentables,
  water: treatment.treated.mash,
  mashVolumeL: 14.7,
});
// #endregion water

// #region acid
const lactic = solveAdditionsForTargetPh({
  targetPh: 5.4,
  agent: { kind: 'acid', acid: 'lactic' },
  grist: paleAle.fermentables,
  water: treatment.treated.mash,
  mashVolumeL: 14.7,
});
// #endregion acid

/** The numbers the guide prints. */
export function waterExample() {
  return {
    bicarbonatePpm: tap.bicarbonatePpm,
    additions: treatment.additions,
    rule: treatment.rule,
    mashCalciumPpm: treatment.treated.mash.calciumPpm,
    ph: mash.ph,
    distilledWaterPh: mash.distilledWaterPh,
    residualAlkalinityPpm: mash.residualAlkalinityPpm,
    contributions: mash.contributions,
    explain: mash.explain,
    lactic: { amount: lactic.amount, unit: lactic.unit, achievedPh: lactic.achievedPh },
    warnings: [...treatment.warnings, ...mash.warnings],
  };
}
