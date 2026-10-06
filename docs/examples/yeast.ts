/**
 * A lager pitch from two liquid packs that are two months old, and the
 * starter that makes up the difference. Used by the Yeast guide.
 */
import { pitchPlan, planStarter } from '../../src/index';

// #region pitch
const pitch = pitchPlan({
  yeasts: [
    {
      name: 'Wyeast 2124 Bohemian Lager',
      type: 'lager',
      form: 'liquid',
      attenuationMinPercent: 73,
      attenuationMaxPercent: 77,
      packs: 2,
      manufactureDate: new Date('2026-08-01'),
    },
  ],
  volumeL: 20,
  og: 1.048,
  pitchDate: new Date('2026-10-01'),
});
// #endregion pitch

// #region starter
const starter = planStarter(pitch.cellsNeededBillion, pitch.cellsFromPacksBillion);
const steps = starter.steps.map((step) => ({
  litres: step.volumeL,
  dmeGrams: step.dmeGrams,
  cellsAfter: step.finalCellsBillion,
}));
// #endregion starter

/** The numbers the guide prints. */
export function yeastExample() {
  return { pitch, starter, steps };
}
