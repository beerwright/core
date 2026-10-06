/**
 * Kettle pH tests.
 *
 * Each expected number is worked out by hand in the comment above it, using
 * the same constants `mashPh.test.ts` checks: lactic acid at 88 % w/w is 1.209 g/mL
 * and 11.811 mmol/mL, and the carbonate speciation is `carbonateProtonsDonated`
 * on pKa 6.35 / 10.33.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KETTLE_TARGET_PH,
  estimateKettleBufferingMEqPerPh,
  kettleAcidDose,
  kettleBufferingEstimate,
  kettleBufferingPerLitreMEqPerPh,
  observedKettleBuffering,
  waterBufferingMEqPerPhPerLitre,
} from './kettlePh';
import { acidStrengthMEqPerUnit } from './mashPh';
import { RO_WATER, waterProfile } from './water';

/** A sample municipal water: 90 ppm HCO₃ at pH 7.6. */
const MUNICIPAL = waterProfile({
  name: 'Sample municipal',
  calciumPpm: 45,
  magnesiumPpm: 8,
  bicarbonatePpm: 90,
  ph: 7.6,
});

describe('waterBufferingMEqPerPhPerLitre', () => {
  it('titrates the carbonate that is left over one pH unit', () => {
    // Alk = 90 / 61.016 = 1.47500 mEq/L. f(7.6) = 0.948613, so
    // C_T = 1.47500 / 0.948613 = 1.554905 mmol/L. f(5.4) − f(4.4)
    // = 0.100885 − 0.011096 = 0.089789, so β = 1.554905 × 0.089789
    // = 0.139614 mEq per pH per litre.
    expect(waterBufferingMEqPerPhPerLitre(MUNICIPAL, 5.4)).toBeCloseTo(0.13961, 4);
  });

  it('is zero for water with no alkalinity', () => {
    expect(waterBufferingMEqPerPhPerLitre(RO_WATER, 5.4)).toBe(0);
  });
});

describe('estimateKettleBufferingMEqPerPh', () => {
  /** 5 kg of pale malt at 40 mEq/kg/pH, 15 L of mash water and 15 L of sparge. */
  const brew = {
    gristBufferingMEqPerPh: 200,
    mashProfile: MUNICIPAL,
    mashVolumeL: 15,
    spargeProfile: MUNICIPAL,
    spargeVolumeL: 15,
  } as const;

  it('spreads the grist and water buffering through the whole liquor', () => {
    // Liquor = 200 + 0.139614 × 30 = 204.18842 mEq/pH over 30 L,
    // so 6.80628 mEq/pH per litre.
    expect(kettleBufferingPerLitreMEqPerPh(brew)).toBeCloseTo(6.80628, 4);
  });

  it('carries that share into the kettle in proportion to the pre-boil volume', () => {
    // 26 L of the 30 L liquor reaches the kettle, so 6.80628 × 26 = 176.96 mEq/pH.
    expect(estimateKettleBufferingMEqPerPh({ ...brew, preBoilVolumeL: 26 })).toBeCloseTo(
      176.963,
      3,
    );
  });

  it('is zero with no liquor and zero with no wort in the kettle', () => {
    expect(
      estimateKettleBufferingMEqPerPh({
        ...brew,
        mashVolumeL: 0,
        spargeVolumeL: 0,
        preBoilVolumeL: 26,
      }),
    ).toBe(0);
    expect(estimateKettleBufferingMEqPerPh({ ...brew, preBoilVolumeL: 0 })).toBe(0);
  });
});

describe('kettleAcidDose', () => {
  it('solves the dose against the acid strength at the target pH', () => {
    // 30 mEq/pH × (5.35 − 5.10) = 7.5 mEq. 88 % lactic is 11.81110 mmol/mL and
    // donates 0.945587 protons at pH 5.10, so 11.168421 mEq/mL:
    // 7.5 / 11.168421 = 0.671536 mL.
    const dose = kettleAcidDose({
      bufferingMEqPerPh: 30,
      measuredPh: 5.35,
      targetPh: DEFAULT_KETTLE_TARGET_PH,
      acid: 'lactic',
      concentrationPercent: 88,
    });
    expect(dose.milliequivalents).toBeCloseTo(7.5, 6);
    expect(dose.amount).toBeCloseTo(0.671536, 6);
    expect(dose.unit).toBe('mL');
    expect(dose.noAcidNeeded).toBe(false);
  });

  it('weighs a solid acid in grams', () => {
    const dose = kettleAcidDose({
      bufferingMEqPerPh: 30,
      measuredPh: 5.35,
      targetPh: 5.1,
      acid: 'citric',
    });
    expect(dose.unit).toBe('g');
    expect(dose.amount).toBeGreaterThan(0);
  });

  it('asks for nothing when the wort is already at the target', () => {
    const dose = kettleAcidDose({
      bufferingMEqPerPh: 180,
      measuredPh: 5.1,
      targetPh: 5.1,
      acid: 'lactic',
    });
    expect(dose.amount).toBe(0);
    expect(dose.milliequivalents).toBe(0);
    expect(dose.noAcidNeeded).toBe(true);
  });

  it('asks for nothing when the wort is already under the target', () => {
    expect(
      kettleAcidDose({ bufferingMEqPerPh: 180, measuredPh: 4.9, targetPh: 5.1, acid: 'lactic' })
        .noAcidNeeded,
    ).toBe(true);
  });

  it('is zero rather than infinite when the buffering is unknown', () => {
    const dose = kettleAcidDose({
      bufferingMEqPerPh: 0,
      measuredPh: 5.4,
      targetPh: 5.1,
      acid: 'lactic',
    });
    expect(dose.amount).toBe(0);
    expect(dose.noAcidNeeded).toBe(false);
  });
});

describe('observedKettleBuffering', () => {
  it('reads the buffering back out of a before-and-after pair', () => {
    // 4 mL of 88 % lactic at pH 5.10 is 4 × 11.168421 = 44.673686 mEq,
    // and it moved the wort 5.35 → 5.10, so 44.673686 / 0.25 = 178.6947 mEq/pH.
    const observed = observedKettleBuffering({
      phBefore: 5.35,
      phAfter: 5.1,
      acid: 'lactic',
      concentrationPercent: 88,
      amount: 4,
    });
    expect(observed).toBeCloseTo(178.6947, 4);
  });

  it('round-trips a dose: solve it, add it, and the buffering comes back', () => {
    const buffering = 176.963;
    const dose = kettleAcidDose({
      bufferingMEqPerPh: buffering,
      measuredPh: 5.42,
      targetPh: 5.1,
      acid: 'lactic',
      concentrationPercent: 88,
    });
    const observed = observedKettleBuffering({
      phBefore: 5.42,
      phAfter: 5.1,
      acid: 'lactic',
      concentrationPercent: 88,
      amount: dose.amount,
    });
    expect(observed).toBeCloseTo(buffering, 6);
  });

  it('says nothing when the pH did not fall', () => {
    expect(
      observedKettleBuffering({ phBefore: 5.1, phAfter: 5.1, acid: 'lactic', amount: 4 }),
    ).toBeNull();
    expect(
      observedKettleBuffering({ phBefore: 5.1, phAfter: 5.2, acid: 'lactic', amount: 4 }),
    ).toBeNull();
  });

  it('says nothing when nothing was added', () => {
    expect(
      observedKettleBuffering({ phBefore: 5.4, phAfter: 5.1, acid: 'lactic', amount: 0 }),
    ).toBeNull();
  });

  it('uses the acid strength at the pH the wort landed on', () => {
    const strength = acidStrengthMEqPerUnit('lactic', 5.1, 88);
    expect(
      observedKettleBuffering({
        phBefore: 5.6,
        phAfter: 5.1,
        acid: 'lactic',
        concentrationPercent: 88,
        amount: 1,
      }),
    ).toBeCloseTo(strength / 0.5, 9);
  });
});

describe('kettleBufferingEstimate', () => {
  it('falls back to the model with nothing observed', () => {
    expect(kettleBufferingEstimate([], 177)).toEqual({
      bufferingMEqPerPh: 177,
      basis: 'model',
      observationCount: 0,
    });
  });

  it('holds a single observation back rather than dosing off one brew day', () => {
    expect(kettleBufferingEstimate([210], 177)).toEqual({
      bufferingMEqPerPh: 177,
      basis: 'model',
      observationCount: 1,
    });
  });

  it('takes the median once two brews have spoken', () => {
    expect(kettleBufferingEstimate([210, 190], 177)).toEqual({
      bufferingMEqPerPh: 200,
      basis: 'observed',
      observationCount: 2,
    });
  });

  it('ignores the brew day that was not usual', () => {
    // A meter left in hot wort makes a dose look like it barely needed any
    // buffering. The mean would be 138.75, and the median is 195.
    expect(kettleBufferingEstimate([190, 200, 200, 10], 177).bufferingMEqPerPh).toBe(195);
  });

  it('drops zero and non-finite observations before counting them', () => {
    expect(kettleBufferingEstimate([0, Number.NaN, 190], 177)).toEqual({
      bufferingMEqPerPh: 177,
      basis: 'model',
      observationCount: 1,
    });
  });
});
