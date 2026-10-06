import { describe, expect, it } from 'vitest';
import {
  alcoholByWeightPercent,
  apparentAttenuationPercent,
  brewhouseEfficiencyFromMeasurement,
  caloriesPer12UsFlOz,
  caloriesPerLitre,
  effectiveMashTempC,
  fermentableEfficiencyFraction,
  fermentablePointLitres,
  fermentablePointsPerKgPerL,
  fermentablePpg,
  gristKgForTargetOg,
  isMashGrain,
  mashEfficiencyFromMeasurement,
  mashGrainMass,
  platoToSgExact,
  predictFinalGravity,
  predictGravities,
  realAttenuationPercent,
  realExtractPlato,
  resolveAttenuationPercent,
  totalGristMass,
  yeastApparentAttenuationPercent,
} from './gravity';
import type { FermentableAddition, MashStep } from './types';
import { sgToPlato } from './units/gravity';

const paleMalt: FermentableAddition = {
  name: 'Pale Ale Malt',
  amountKg: 4.5,
  class: 'grain',
  use: 'mash',
  extractFineGrindDryBasisPercent: 80,
  moisturePercent: 4,
  colorLovibond: 3,
};

const dextrose: FermentableAddition = {
  name: 'Dextrose',
  amountKg: 0.5,
  class: 'sugar',
  use: 'boil',
  ppg: 46.214,
  colorLovibond: 0,
};

const lactose: FermentableAddition = {
  name: 'Lactose',
  amountKg: 0.5,
  class: 'non-fermentable',
  use: 'boil',
  ppg: 35,
  colorLovibond: 0,
};

describe('platoToSgExact', () => {
  it('is the exact inverse of sgToPlato', () => {
    for (let sg = 1.001; sg <= 1.13; sg += 0.001) {
      expect(platoToSgExact(sgToPlato(sg))).toBeCloseTo(sg, 11);
    }
  });

  it("inverts 0 °P to the ASBC cubic's own zero, not exactly 1.000", () => {
    // sgToPlato(1.000) = −0.003 °P. The published cubic doesn't pass exactly
    // through the origin, so its inverse of 0 °P is slightly above water. That
    // comes from the fit, and it's why we invert this polynomial instead of
    // pairing it with a different published approximation.
    expect(platoToSgExact(0)).toBeCloseTo(1, 4);
    expect(sgToPlato(platoToSgExact(0))).toBeCloseTo(0, 12);
  });
});

describe('fermentablePpg', () => {
  it('converts fine-grind dry basis with the moisture correction', () => {
    // (80 / 100) × (1 − 0.04) × 46.214 = 35.4924
    expect(fermentablePpg(paleMalt)).toBeCloseTo(35.4924, 4);
  });

  it('prefers an explicit ppg override', () => {
    expect(fermentablePpg({ ...paleMalt, ppg: 37 })).toBe(37);
  });

  it('subtracts the fine/coarse difference', () => {
    // ((80 − 2) / 100) × 0.96 × 46.214 = 34.6051
    expect(fermentablePpg({ ...paleMalt, fineCoarseDifferencePercent: 2 })).toBeCloseTo(34.605, 3);
  });

  it('defaults moisture by class when not stated', () => {
    const { moisturePercent: _omitted, ...noMoisture } = paleMalt;
    expect(fermentablePpg(noMoisture)).toBeCloseTo(35.4924, 4);
  });

  it('throws when neither yield figure is present', () => {
    expect(() =>
      fermentablePpg({
        name: 'Mystery',
        amountKg: 1,
        class: 'grain',
        use: 'mash',
        colorLovibond: 2,
      }),
    ).toThrow(/neither ppg nor extractFineGrindDryBasisPercent/);
  });

  it('converts PPG to points per kg per litre with the 8.345404 factor', () => {
    expect(fermentablePointsPerKgPerL({ ...paleMalt, ppg: 37 })).toBeCloseTo(37 * 8.345404, 6);
  });
});

describe('fermentableEfficiencyFraction', () => {
  it('applies mash efficiency to mashed grain', () => {
    expect(fermentableEfficiencyFraction(paleMalt, 75)).toBeCloseTo(0.75, 9);
  });

  it('gives extract, sugar and non-fermentables 100 % regardless of use', () => {
    expect(fermentableEfficiencyFraction(dextrose, 75)).toBe(1);
    expect(fermentableEfficiencyFraction(lactose, 75)).toBe(1);
    expect(fermentableEfficiencyFraction({ ...dextrose, use: 'fermenter' }, 75)).toBe(1);
  });

  it('applies the partial steep efficiency to steeped grain', () => {
    const steeped: FermentableAddition = { ...paleMalt, class: 'steeping-grain', use: 'steep' };
    expect(fermentableEfficiencyFraction(steeped, 75)).toBeCloseTo(0.5, 9);
    expect(fermentableEfficiencyFraction(steeped, 75, { steepEfficiencyPercent: 60 })).toBeCloseTo(
      0.6,
      9,
    );
  });

  it('gives grain thrown in the fermenter nothing', () => {
    expect(fermentableEfficiencyFraction({ ...paleMalt, use: 'fermenter' }, 75)).toBe(0);
  });
});

describe('grist masses', () => {
  it('totals every addition', () => {
    expect(totalGristMass([paleMalt, dextrose, lactose])).toBeCloseTo(5.5, 9);
  });

  it('counts only grain in the mash tun for absorption', () => {
    expect(mashGrainMass([paleMalt, dextrose, lactose])).toBeCloseTo(4.5, 9);
  });

  it('treats acid malt as mash grain, and extract as not', () => {
    const acidMalt: FermentableAddition = {
      ...paleMalt,
      name: 'Acidulated Malt',
      amountKg: 0.05,
      ph: { maltClass: 'acidulated' },
    };
    expect(isMashGrain(acidMalt)).toBe(true);
    expect(isMashGrain(dextrose)).toBe(false);
    expect(mashGrainMass([paleMalt, acidMalt, dextrose])).toBeCloseTo(4.55, 9);
  });
});

describe('gristKgForTargetOg', () => {
  const volumes = { preBoilVolumeL: 25.4375, postBoilVolumeL: 21.54, volumeIntoFermenterL: 20 };

  /** A grist stated as percentages: the shares, and what each row is. */
  const paleOnly = [{ percentOfGrist: 100, fermentable: paleMalt }];

  /**
   * The main property: size a grist to a gravity, run the forward calculation
   * on the result, and get the same gravity back.
   */
  it.each([1.04, 1.048, 1.052, 1.066, 1.09])('sizes a grist that reads %s back', (target) => {
    const kg = gristKgForTargetOg(paleOnly, volumes.postBoilVolumeL, 75, target);
    expect(kg).not.toBeNull();
    const result = predictGravities({
      fermentables: [{ ...paleMalt, amountKg: kg ?? 0 }],
      volumes,
      mashEfficiencyPercent: 75,
    });
    expect(result.og).toBeCloseTo(target, 6);
  });

  it('scales a bill down, which is what an overshoot needs', () => {
    // A grist that's too big has to come down. `sugarToTargetGravity` returns 0
    // for a negative deficit because it can only add.
    const big = gristKgForTargetOg(paleOnly, volumes.postBoilVolumeL, 75, 1.07);
    const small = gristKgForTargetOg(paleOnly, volumes.postBoilVolumeL, 75, 1.045);
    expect(big).not.toBeNull();
    expect(small).not.toBeNull();
    expect(small ?? 0).toBeLessThan(big ?? 0);
  });

  it('holds every share exactly through the rescale', () => {
    const grist = [
      { percentOfGrist: 80, fermentable: paleMalt },
      { percentOfGrist: 15, fermentable: { ...paleMalt, name: 'Munich' } },
      { percentOfGrist: 5, fermentable: dextrose },
    ];
    const kg = gristKgForTargetOg(grist, volumes.postBoilVolumeL, 75, 1.055) ?? 0;
    const amounts = grist.map((row) => (kg * row.percentOfGrist) / 100);
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    expect((amounts[0] ?? 0) / total).toBeCloseTo(0.8, 9);
    expect((amounts[2] ?? 0) / total).toBeCloseTo(0.05, 9);
  });

  it('gives sugar its own efficiency rather than the mash figure', () => {
    // Sugar dissolves completely, so a grist that's part sugar needs less mass
    // than an all-grain one to reach the same gravity. Applying the mash
    // efficiency to the whole bill would ask for too much.
    const mixed = [
      { percentOfGrist: 70, fermentable: paleMalt },
      { percentOfGrist: 30, fermentable: dextrose },
    ];
    const kg = gristKgForTargetOg(mixed, volumes.postBoilVolumeL, 75, 1.05) ?? 0;
    const result = predictGravities({
      fermentables: [
        { ...paleMalt, amountKg: kg * 0.7 },
        { ...dextrose, amountKg: kg * 0.3 },
      ],
      volumes,
      mashEfficiencyPercent: 75,
    });
    expect(result.og).toBeCloseTo(1.05, 6);
  });

  it('sizes a grist from nothing, not only from one that already has mass', () => {
    // The rows have 0 kg, which is what a new percent bill looks like. Scaling
    // the current gravity by a ratio wouldn't work here, because there's no
    // gravity to scale.
    const empty = [{ percentOfGrist: 100, fermentable: { ...paleMalt, amountKg: 0 } }];
    const kg = gristKgForTargetOg(empty, volumes.postBoilVolumeL, 75, 1.05);
    expect(kg ?? 0).toBeGreaterThan(0);
  });

  it('refuses a grist that cannot carry a gravity at all', () => {
    // Every row is a non-fermentable, or every share is zero. Neither should
    // throw. There's no mass that works, so the result is null.
    expect(
      gristKgForTargetOg([{ percentOfGrist: 100, fermentable: lactose }], 21.54, 75, 1.05),
    ).not.toBeNull(); // lactose still contributes gravity, just no alcohol
    expect(
      gristKgForTargetOg([{ percentOfGrist: 0, fermentable: paleMalt }], 21.54, 75, 1.05),
    ).toBeNull();
    expect(gristKgForTargetOg([], 21.54, 75, 1.05)).toBeNull();
  });

  it('refuses a target at or below water, and a volume that is not one', () => {
    expect(gristKgForTargetOg(paleOnly, 21.54, 75, 1)).toBeNull();
    expect(gristKgForTargetOg(paleOnly, 0, 75, 1.05)).toBeNull();
  });

  it('asks for more of a grist mashed at a worse efficiency', () => {
    const good = gristKgForTargetOg(paleOnly, 21.54, 80, 1.05) ?? 0;
    const poor = gristKgForTargetOg(paleOnly, 21.54, 60, 1.05) ?? 0;
    expect(poor).toBeGreaterThan(good);
  });
});

describe('predictGravities', () => {
  const volumes = { preBoilVolumeL: 25.4375, postBoilVolumeL: 21.54, volumeIntoFermenterL: 20 };

  it('reproduces the hand-computed pale-ale waterfall', () => {
    const result = predictGravities({
      fermentables: [paleMalt],
      volumes,
      mashEfficiencyPercent: 75,
    });
    // 4.5 kg × 296.198 pt·L/kg × 0.75 = 999.67 pt·L
    expect(result.maxPointLitres).toBeCloseTo(1332.89, 1);
    expect(result.preBoilGravity).toBeCloseTo(1.0393, 4);
    expect(result.og).toBeCloseTo(1.0464, 4);
    expect(result.postBoilGravity).toBe(result.og);
  });

  it('separates the measured OG from the OG-equivalent for fermenter sugar', () => {
    const result = predictGravities({
      fermentables: [paleMalt, { ...dextrose, use: 'fermenter' }],
      volumes,
      mashEfficiencyPercent: 75,
    });
    // Fermenter dextrose: 0.5 × 46.214 × 8.345404 = 192.85 pt·L over 20 L = 9.64 points
    expect(result.ogEquivalent - result.og).toBeCloseTo(0.00964, 5);
    expect(result.og).toBeCloseTo(1.0464, 4);
  });

  it('reports brewhouse efficiency below mash efficiency', () => {
    const result = predictGravities({
      fermentables: [paleMalt],
      volumes,
      mashEfficiencyPercent: 75,
    });
    expect(result.brewhouseEfficiencyPercent).toBeLessThan(75);
    expect(result.brewhouseEfficiencyPercent).toBeCloseTo(69.638, 2);
  });

  it('returns water for an empty grist', () => {
    const result = predictGravities({ fermentables: [], volumes, mashEfficiencyPercent: 75 });
    expect(result.og).toBe(1);
    expect(result.brewhouseEfficiencyPercent).toBe(0);
  });
});

describe('efficiency round trip', () => {
  const volumes = { preBoilVolumeL: 25.4375, postBoilVolumeL: 21.54, volumeIntoFermenterL: 20 };

  it.each([55, 62, 70, 75, 82, 90])(
    'recovers %i %% mash efficiency from the gravity it predicts',
    (eff) => {
      const predicted = predictGravities({
        fermentables: [paleMalt, dextrose, lactose],
        volumes,
        mashEfficiencyPercent: eff,
      });
      const recovered = mashEfficiencyFromMeasurement({
        fermentables: [paleMalt, dextrose, lactose],
        measuredGravity: predicted.og,
        measuredVolumeL: volumes.postBoilVolumeL,
      });
      expect(recovered).toBeCloseTo(eff, 6);
    },
  );

  it('recovers efficiency from a pre-boil sample too', () => {
    const predicted = predictGravities({
      fermentables: [paleMalt, dextrose],
      volumes,
      mashEfficiencyPercent: 68,
    });
    const recovered = mashEfficiencyFromMeasurement({
      fermentables: [paleMalt, dextrose],
      measuredGravity: predicted.preBoilGravity,
      measuredVolumeL: volumes.preBoilVolumeL,
      stage: 'pre-boil',
    });
    expect(recovered).toBeCloseTo(68, 6);
  });

  it('round trips brewhouse efficiency', () => {
    const predicted = predictGravities({
      fermentables: [paleMalt],
      volumes,
      mashEfficiencyPercent: 75,
    });
    const recovered = brewhouseEfficiencyFromMeasurement({
      fermentables: [paleMalt],
      measuredOg: predicted.og,
      volumeIntoFermenterL: volumes.volumeIntoFermenterL,
    });
    expect(recovered).toBeCloseTo(predicted.brewhouseEfficiencyPercent, 9);
  });
});

describe('predictFinalGravity', () => {
  it('applies the yeast attenuation when every fermentable is malt', () => {
    const result = predictFinalGravity({
      fermentables: [paleMalt],
      ogEquivalent: 1.05023,
      attenuationPercent: 80,
      mashEfficiencyPercent: 75,
    });
    expect(result.fg).toBeCloseTo(1.0097, 4);
    expect(result.netApparentAttenuationPercent).toBeCloseTo(80, 9);
  });

  it('dries the beer out when simple sugar is present', () => {
    const withSugar = predictFinalGravity({
      fermentables: [paleMalt, dextrose],
      ogEquivalent: 1.06,
      attenuationPercent: 75,
      mashEfficiencyPercent: 75,
    });
    expect(withSugar.netApparentAttenuationPercent).toBeGreaterThan(75);
    expect(withSugar.fg).toBeLessThan(
      predictFinalGravity({
        fermentables: [paleMalt],
        ogEquivalent: 1.06,
        attenuationPercent: 75,
        mashEfficiencyPercent: 75,
      }).fg,
    );
  });

  it('leaves lactose behind', () => {
    const result = predictFinalGravity({
      fermentables: [paleMalt, lactose],
      ogEquivalent: 1.06,
      attenuationPercent: 75,
      mashEfficiencyPercent: 75,
    });
    expect(result.netApparentAttenuationPercent).toBeLessThan(75);
  });

  it('honours a per-fermentable fermentability override', () => {
    const result = predictFinalGravity({
      fermentables: [{ ...paleMalt, fermentabilityPercent: 50 }],
      ogEquivalent: 1.05,
      attenuationPercent: 80,
      mashEfficiencyPercent: 75,
    });
    expect(result.netApparentAttenuationPercent).toBeCloseTo(50, 9);
  });

  it('round trips: attenuation in, attenuation back out', () => {
    for (const adf of [65, 70, 75, 80, 85]) {
      const fg = predictFinalGravity({
        fermentables: [paleMalt],
        ogEquivalent: 1.055,
        attenuationPercent: adf,
        mashEfficiencyPercent: 75,
      }).fg;
      expect(apparentAttenuationPercent(1.055, fg)).toBeCloseTo(adf, 9);
    }
  });
});

describe('attenuation resolution', () => {
  it('uses the midpoint of a yeast range', () => {
    expect(
      yeastApparentAttenuationPercent([
        { name: 'US-05', type: 'ale', attenuationMinPercent: 78, attenuationMaxPercent: 82 },
      ]),
    ).toBe(80);
  });

  it('takes the most attenuative strain in a blend', () => {
    expect(
      yeastApparentAttenuationPercent([
        { name: 'A', type: 'ale', attenuationMinPercent: 70, attenuationMaxPercent: 74 },
        { name: 'B', type: 'brett', attenuationMinPercent: 88, attenuationMaxPercent: 92 },
      ]),
    ).toBe(90);
  });

  it('lets an option override everything', () => {
    expect(
      resolveAttenuationPercent({
        yeasts: [{ name: 'A', type: 'ale', attenuationMinPercent: 70, attenuationMaxPercent: 74 }],
        options: { attenuationOverridePercent: 88 },
      }),
    ).toBe(88);
  });

  it('falls back to 75 % with no yeast', () => {
    expect(resolveAttenuationPercent({})).toBe(75);
  });

  it('shifts with mash temperature, with nothing to switch on', () => {
    const yeasts = [
      { name: 'A', type: 'ale' as const, attenuationMinPercent: 78, attenuationMaxPercent: 82 },
    ];
    // (66.7 − 63) × 1.2 = 4.44 points more attenuation
    expect(resolveAttenuationPercent({ yeasts, mashTempC: 63 })).toBeCloseTo(84.44, 2);
    // (66.7 − 69) × 1.2 = −2.76 points
    expect(resolveAttenuationPercent({ yeasts, mashTempC: 69 })).toBeCloseTo(77.24, 2);
    // No mash temperature to read: the yeast's own figure, unshifted.
    expect(resolveAttenuationPercent({ yeasts })).toBe(80);
  });

  it('lets the override beat the mash temperature', () => {
    expect(
      resolveAttenuationPercent({
        yeasts: [{ name: 'A', type: 'ale', attenuationMinPercent: 78, attenuationMaxPercent: 82 }],
        mashTempC: 63,
        options: { attenuationOverridePercent: 88 },
      }),
    ).toBe(88);
  });

  it('clamps the mash-temperature shift', () => {
    expect(
      resolveAttenuationPercent({
        yeasts: [{ name: 'A', type: 'ale', attenuationMinPercent: 78, attenuationMaxPercent: 82 }],
        mashTempC: 40,
      }),
    ).toBe(88);
  });
});

describe('effective mash temperature', () => {
  const step = (targetTempC: number, timeMinutes: number, type: MashStep['type'] = 'infusion') =>
    ({ name: 'Rest', type, targetTempC, timeMinutes }) satisfies MashStep;

  it('reads a single infusion straight off', () => {
    expect(effectiveMashTempC([step(67, 60)])).toBe(67);
  });

  it('weights a Hochkurz step mash by duration', () => {
    // (62 × 40 + 72 × 20) / 60 = 3920 / 60 = 65.333…
    expect(effectiveMashTempC([step(62, 40), step(72, 20)])).toBeCloseTo(65.3333, 4);
  });

  it('ignores a protein rest below the saccharification window', () => {
    expect(effectiveMashTempC([step(52, 20), step(66, 60)])).toBe(66);
  });

  it('ignores a mash-out above the saccharification window', () => {
    expect(effectiveMashTempC([step(66, 60), step(78, 10)])).toBe(66);
  });

  it('keeps the window inclusive at both ends', () => {
    expect(effectiveMashTempC([step(55, 30)])).toBe(55);
    expect(effectiveMashTempC([step(75, 30)])).toBe(75);
  });

  it('ignores sparge steps whatever their temperature', () => {
    expect(effectiveMashTempC([step(65, 60), step(75, 30, 'sparge')])).toBe(65);
  });

  it('counts decoction and temperature steps like infusions', () => {
    // (63 × 30 + 71 × 10) / 40 = 2600 / 40 = 65
    expect(effectiveMashTempC([step(63, 30, 'decoction'), step(71, 10, 'temperature')])).toBe(65);
  });

  it('gives a zero-duration step a minute of weight rather than dropping it', () => {
    // (60 × 1 + 70 × 1) / 2 = 65
    expect(effectiveMashTempC([step(60, 0), step(70, 0)])).toBe(65);
    // (70 × 59 + 60 × 1) / 60 = 4190 / 60 = 69.8333…
    expect(effectiveMashTempC([step(70, 59), step(60, 0)])).toBeCloseTo(69.8333, 4);
  });

  it('is undefined when nothing converts starch', () => {
    expect(effectiveMashTempC(undefined)).toBeUndefined();
    expect(effectiveMashTempC([])).toBeUndefined();
    expect(effectiveMashTempC([step(52, 20), step(78, 10)])).toBeUndefined();
    expect(effectiveMashTempC([step(66, 60, 'sparge')])).toBeUndefined();
  });
});

describe('attenuation, extract and calories', () => {
  it('computes apparent attenuation on the Plato scale', () => {
    // OE 12.4412, AE 2.4882 → 80 %
    // Inputs are the rounded fixture values, so the answer lands within 0.05 pts.
    expect(apparentAttenuationPercent(1.05023, 1.00971)).toBeCloseTo(80, 1);
  });

  it('computes real extract by Balling', () => {
    // 0.1808 × 12.4412 + 0.8192 × 2.4882 = 4.2877
    expect(realExtractPlato(1.05023, 1.00971)).toBeCloseTo(4.2877, 2);
  });

  it('makes real attenuation 0.8192 × apparent', () => {
    const apparent = apparentAttenuationPercent(1.05023, 1.00971);
    expect(realAttenuationPercent(1.05023, 1.00971)).toBeCloseTo(apparent * 0.8192, 6);
  });

  it('computes alcohol by weight', () => {
    expect(alcoholByWeightPercent(1.05023, 1.00971)).toBeCloseTo(4.2163, 2);
  });

  it('computes calories per 12 oz serving', () => {
    expect(caloriesPer12UsFlOz(1.05023, 1.00971)).toBeCloseTo(164.33, 1);
  });

  it('scales calories to a litre', () => {
    expect(caloriesPerLitre(1.05023, 1.00971)).toBeCloseTo(164.33 / 0.354882, 0);
  });

  it('gives a light beer fewer calories than a strong one', () => {
    expect(caloriesPerLitre(1.04, 1.008)).toBeLessThan(caloriesPerLitre(1.08, 1.018));
  });
});

describe('fermentablePointLitres', () => {
  it('multiplies mass, yield and efficiency', () => {
    // 4.5 kg × 296.198 × 0.75 = 999.67
    expect(fermentablePointLitres(paleMalt, 75)).toBeCloseTo(999.67, 1);
  });
});
