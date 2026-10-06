/**
 * Four small jobs from the cellar: a two-beer Pearson square, a blend of
 * three sours, a honey must and a jar of limoncello. Used by the Blending,
 * mead and spirits guide.
 */
import {
  type BlendComponentInput,
  evaluateBlend,
  pearsonSquare,
  proofAndSweeten,
  sugarToGravity,
} from '../../src/index';

// #region pearson
// How much of a 7.5 % sour and a 4.5 % sour make 20 L at 6.5 %?
const square = pearsonSquare({ a: 7.5, b: 4.5, target: 6.5, totalVolumeL: 20 });
// #endregion pearson

// #region blend
const sour = (
  name: string,
  volumeL: number,
  og: number,
  fg: number,
  ph: number,
): BlendComponentInput => ({
  name,
  volumeL,
  og,
  fg,
  ph,
  srm: 5,
  peakTempC: 22,
  barrelAged: true,
  naohMl: null,
});

const blend = evaluateBlend({
  components: [
    sour('Three-year barrel', 8, 1.062, 1.002, 3.3),
    sour('Two-year barrel', 10, 1.058, 1.004, 3.4),
    sour('One-year barrel', 6, 1.055, 1.008, 3.6),
  ],
  targetVolumes: 2.8,
  additions: [],
  kegVolumeL: null,
});
// #endregion blend

// #region must
// Honey to bring 15 L of water up to 1.100 for a traditional mead.
const honey = sugarToGravity({ currentSg: 1, targetSg: 1.1, volumeL: 15, sugar: 'honey' });
// #endregion must

// #region spirits
// A litre of lemon-peel macerate at 60 %, down to 28 % with 250 g of sugar per litre.
const limoncello = proofAndSweeten({
  volumeL: 1,
  abvPercent: 60,
  targetAbvPercent: 28,
  targetSugarGL: 250,
  sweetener: { kind: 'sugar' },
});
// #endregion spirits

/** The numbers the guide prints. */
export function blendingExample() {
  return {
    square,
    blend: {
      totalVolumeL: blend.totalVolumeL,
      abv: blend.abv,
      fg: blend.fg,
      ph: blend.ph,
      residualVolumes: blend.residualVolumes,
      extractVolumes: blend.extractVolumes,
      predictedVolumes: blend.predictedVolumes,
      excessCarbonation: blend.excessCarbonation,
      lowestFg: blend.lowestFg,
      primingGrams: blend.priming?.sugarGrams ?? null,
      primingVolumesToAdd: blend.priming?.volumesToAdd ?? null,
    },
    honeyKg: honey.massKg,
    limoncello,
  };
}
