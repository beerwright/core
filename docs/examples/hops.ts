/**
 * A boil addition and a whirlpool addition, one of them from a bag that has
 * been open in the fridge for a year. Used by the Hops guide.
 */
import { agedAlphaAcidPercent, calculateIbu, type HopAddition } from '../../src/index';

// #region age
// Cascade loses about half its alpha in six months at room temperature.
const cascadeAlpha = agedAlphaAcidPercent(6.5, {
  alphaLostSixMonths: 0.5,
  months: 12,
  storageC: 4,
  packaging: 'wrapped',
});
// #endregion age

// #region ibu
const hops: HopAddition[] = [
  {
    name: 'Magnum',
    amountKg: 0.015,
    alphaAcidPercent: 12,
    form: 'pellet',
    use: 'boil',
    timeMinutes: 60,
  },
  {
    name: 'Cascade',
    amountKg: 0.05,
    alphaAcidPercent: cascadeAlpha,
    form: 'pellet',
    use: 'whirlpool',
    timeMinutes: 20,
    whirlpoolTempC: 85,
  },
];

const bitterness = calculateIbu({
  hops,
  volumeL: 21,
  boilGravity: 1.05,
  boilTimeMinutes: 60,
});
// #endregion ibu

/** The numbers the guide prints. */
export function hopsExample() {
  return {
    cascadeAlpha,
    ibu: bitterness.ibu,
    contributions: bitterness.contributions.map((c) => ({
      name: c.name,
      ibu: c.ibu,
      effectiveBoilMinutes: c.effectiveBoilMinutes,
      standDescription: c.standDescription,
      notes: c.notes,
    })),
  };
}
