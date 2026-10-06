/**
 * One thick pull from a protein rest to a saccharification rest. Used by the
 * Decoction guide.
 */
import { decoctionPull } from '../../src/index';

// #region pull
const pull = decoctionPull({
  mashWaterL: 15,
  mashGrainKg: 5,
  currentTempC: 52,
  targetTempC: 64,
  spec: { thickness: 'thick', boilMinutes: 20 },
});
// #endregion pull

/** The numbers the guide prints. */
export function decoctionExample() {
  return {
    pullVolumeL: pull.pullVolumeL,
    pullGrainKg: pull.pullGrainKg,
    awayMinutes: pull.awayMinutes,
    evaporationL: pull.evaporationL,
    fractionOfMash: pull.fractionOfMash,
    achievedTempC: pull.achievedTempC,
    restTempAtReturnC: pull.restTempAtReturnC,
    issues: pull.issues.map((issue) => issue.message),
    explain: pull.explain,
  };
}
