/**
 * The pale ale on a smaller kettle, checked before brew day, and its
 * bitterness under a second model. Used by the Recipe guide.
 */
import { calculateRecipe, type EquipmentProfileInput, recipeChecks } from '../../src/index';
import { paleAle } from './pale-ale';

// #region checks
const equipment: EquipmentProfileInput = {
  name: '25 L kettle',
  kettleVolumeL: 25,
  fermenterVolumeL: 23,
};

const calculation = calculateRecipe(paleAle, equipment);
const { findings, supersedes } = recipeChecks({ recipe: paleAle, equipment, calculation });

const summary = findings.map((finding) => `${finding.severity}: ${finding.id}`);
// #endregion checks

// #region options
const tinseth = calculation.vitals.ibu;
const rager = calculateRecipe(paleAle, equipment, { ibuFormula: 'rager' }).vitals.ibu;
// #endregion options

/** The numbers the guide prints. */
export function recipeChecksExample() {
  return {
    preBoilVolumeL: calculation.volumes.preBoilVolumeL,
    findings,
    summary,
    supersedes,
    warnings: calculation.warnings,
    tinseth,
    rager,
  };
}
