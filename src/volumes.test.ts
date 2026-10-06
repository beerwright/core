import { describe, expect, it } from 'vitest';
import { DEFAULT_EQUIPMENT_PROFILE, resolveEquipmentProfile } from './defaults';
import type { EquipmentProfile } from './types';
import {
  applyBoilShrinkage,
  boilOffVolume,
  decoctionVolume,
  infusionTemperature,
  infusionVolume,
  isNoSparge,
  mashThicknessFromStrike,
  planVolumes,
  projectVolumes,
  removeBoilShrinkage,
  splitStrikeAndSparge,
  strikeWaterTemperature,
  volumeWarnings,
} from './volumes';

const equipment: EquipmentProfile = {
  ...DEFAULT_EQUIPMENT_PROFILE,
  name: 'Reference 20 L system',
  grainAbsorptionLPerKg: 1.0,
  mashThicknessLPerKg: 3.0,
  boilOffRateLPerHour: 3.0,
  kettleDeadspaceL: 1.0,
  fermenterTrubLossL: 1.0,
  hopAbsorptionMlPerG: 6,
  dryHopAbsorptionMlPerG: 6,
};

const inputs = {
  grainKg: 4.9,
  kettleHopKg: 0.09,
  dryHopKg: 0.05,
  boilTimeMinutes: 60,
};

describe('planVolumes (backwards from the batch target)', () => {
  const waterfall = planVolumes(20, 'fermenter', equipment, inputs);

  /**
   * Hand-computed waterfall, all litres:
   * ```
   * hop absorption     0.090 kg × 6      =  0.540
   * dry-hop absorption 0.050 kg × 6      =  0.300
   * packaged           20 − 1.0 − 0.300  = 18.700
   * post-boil (20 °C)  20 + 1.0 + 0.540  = 21.540
   * post-boil (hot)    21.540 / 0.96     = 22.4375
   * boil-off           3.0 × 60/60       =  3.000
   * pre-boil           22.4375 + 3.000   = 25.4375
   * grain absorption   4.9 × 1.0         =  4.900
   * total water        25.4375 + 4.900   = 30.3375
   * strike             3.0 × 4.9         = 14.700
   * sparge             30.3375 − 14.700  = 15.6375
   * ```
   * Tolerance: 1e-9 L. This is exact arithmetic, not a fit.
   */
  it.each([
    ['packagedVolumeL', 18.7],
    ['volumeIntoFermenterL', 20],
    ['postBoilVolumeL', 21.54],
    ['postBoilVolumeHotL', 22.4375],
    ['boilOffL', 3],
    ['preBoilVolumeL', 25.4375],
    ['grainAbsorptionL', 4.9],
    ['totalWaterL', 30.3375],
    ['strikeWaterL', 14.7],
    ['spargeWaterL', 15.6375],
    ['kettleHopAbsorptionL', 0.54],
    ['dryHopAbsorptionL', 0.3],
    ['shrinkageL', 0.8975],
  ] as const)('%s = %f L', (key, expected) => {
    expect(waterfall[key]).toBeCloseTo(expected, 9);
  });

  it('accounts for every litre between total water and packaged beer', () => {
    expect(waterfall.totalWaterL - waterfall.totalLossL).toBeCloseTo(waterfall.packagedVolumeL, 9);
  });

  it('includes grain displacement in the mash volume', () => {
    // 14.7 L water + 4.9 kg × 0.6676 L/kg = 17.971 L
    expect(waterfall.mashVolumeL).toBeCloseTo(17.9712, 3);
  });

  it('hits the target when the basis is packaged instead', () => {
    const packagedPlan = planVolumes(20, 'packaged', equipment, inputs);
    expect(packagedPlan.packagedVolumeL).toBeCloseTo(20, 9);
    expect(packagedPlan.volumeIntoFermenterL).toBeCloseTo(21.3, 9);
  });
});

describe('projectVolumes (forwards from the water measured out)', () => {
  it('is the exact inverse of planVolumes', () => {
    const planned = planVolumes(20, 'fermenter', equipment, inputs);
    const projected = projectVolumes(
      { strikeWaterL: planned.strikeWaterL, spargeWaterL: planned.spargeWaterL },
      equipment,
      inputs,
    );
    for (const key of Object.keys(planned) as (keyof typeof planned)[]) {
      expect(projected[key], `stage ${key}`).toBeCloseTo(planned[key], 9);
    }
  });

  it.each([12, 19, 20, 23, 40])('round trips a %f L batch', (target) => {
    const planned = planVolumes(target, 'fermenter', equipment, inputs);
    const projected = projectVolumes(
      { strikeWaterL: planned.strikeWaterL, spargeWaterL: planned.spargeWaterL },
      equipment,
      inputs,
    );
    expect(projected.volumeIntoFermenterL).toBeCloseTo(target, 9);
  });

  it('round trips through a packaged-basis target', () => {
    const planned = planVolumes(19, 'packaged', equipment, inputs);
    const projected = projectVolumes(
      { strikeWaterL: planned.strikeWaterL, spargeWaterL: planned.spargeWaterL },
      equipment,
      inputs,
    );
    expect(projected.packagedVolumeL).toBeCloseTo(19, 9);
  });
});

describe('sparge splitting', () => {
  it('puts everything in the strike for a no-sparge profile', () => {
    const noSparge = resolveEquipmentProfile({ ...equipment, spargeType: 'no-sparge' });
    const waterfall = planVolumes(20, 'fermenter', noSparge, inputs);
    expect(waterfall.spargeWaterL).toBe(0);
    expect(waterfall.strikeWaterL).toBeCloseTo(waterfall.totalWaterL, 9);
  });

  it('does the same for full-volume BIAB, with lower absorption', () => {
    const biab = resolveEquipmentProfile({
      ...equipment,
      spargeType: 'biab-full-volume',
      grainAbsorptionLPerKg: 0.8,
      mashTunDeadspaceL: 0,
    });
    const waterfall = planVolumes(20, 'fermenter', biab, inputs);
    expect(waterfall.spargeWaterL).toBe(0);
    // 25.4375 + 4.9 × 0.8 = 29.3575 L, all of it mashed in
    expect(waterfall.strikeWaterL).toBeCloseTo(29.3575, 9);
    expect(isNoSparge(biab)).toBe(true);
  });

  it('rounds trips a BIAB batch forwards', () => {
    const biab = resolveEquipmentProfile({
      ...equipment,
      spargeType: 'biab-full-volume',
      grainAbsorptionLPerKg: 0.8,
    });
    const planned = planVolumes(20, 'fermenter', biab, inputs);
    const projected = projectVolumes(
      { strikeWaterL: planned.strikeWaterL, spargeWaterL: 0 },
      biab,
      inputs,
    );
    expect(projected.volumeIntoFermenterL).toBeCloseTo(20, 9);
  });

  it('caps the strike at the total when the mash would be thinner than the batch', () => {
    const split = splitStrikeAndSparge(10, equipment, { ...inputs, mashThicknessLPerKg: 4 });
    expect(split.strikeWaterL).toBe(10);
    expect(split.spargeWaterL).toBe(0);
  });

  it('honours a per-recipe thickness override', () => {
    const split = splitStrikeAndSparge(30, equipment, { ...inputs, mashThicknessLPerKg: 2.5 });
    expect(split.strikeWaterL).toBeCloseTo(12.25, 9);
    expect(split.spargeWaterL).toBeCloseTo(17.75, 9);
  });

  it('puts everything in the strike when there is no grain', () => {
    const split = splitStrikeAndSparge(25, equipment, { ...inputs, grainKg: 0 });
    expect(split.strikeWaterL).toBe(25);
    expect(split.spargeWaterL).toBe(0);
  });
});

/**
 * The two mash-tun figures sound similar but behave differently.
 *
 * `mashTunDeadspaceL` is the volume below an all-in-one's false bottom. It goes
 * back into the same kettle it came from, so it costs no water and loses no
 * wort. `mashTunLossL` is wort left behind in a separate tun, which is lost,
 * so it adds to the water requirement.
 */
describe('mash tun deadspace vs. mash tun loss', () => {
  const clean = planVolumes(20, 'fermenter', equipment, inputs);

  it('changes nothing anywhere when deadspace is set', () => {
    const deadspaced = planVolumes(
      20,
      'fermenter',
      { ...equipment, mashTunDeadspaceL: 6.8 },
      inputs,
    );
    expect(deadspaced).toEqual({ ...clean, mashTunDeadspaceL: 6.8 });
  });

  it('leaves deadspace out of the strike even on a no-sparge profile', () => {
    // On a rig that mashes the full volume, every litre of required water goes
    // into the strike, so counting a 6.8 L under-basket figure as a loss would
    // add 6.8 L to the water the brewer measures out.
    const base = { ...equipment, spargeType: 'no-sparge' } as const;
    const plain = planVolumes(20, 'fermenter', base, inputs);
    const deadspaced = planVolumes(20, 'fermenter', { ...base, mashTunDeadspaceL: 6.8 }, inputs);
    expect(deadspaced.strikeWaterL).toBeCloseTo(plain.strikeWaterL, 9);
    expect(deadspaced.totalLossL).toBeCloseTo(plain.totalLossL, 9);
  });

  it('makes loss do exactly what deadspace used to do', () => {
    const lossy = planVolumes(20, 'fermenter', { ...equipment, mashTunLossL: 1.5 }, inputs);
    // Hand-computed: total water 30.3375 + 1.5 = 31.8375 L, with the strike
    // fixed at 3.0 L/kg × 4.9 kg and the sparge taking the rest.
    expect(lossy.totalWaterL).toBeCloseTo(31.8375, 9);
    expect(lossy.strikeWaterL).toBeCloseTo(14.7, 9);
    expect(lossy.spargeWaterL).toBeCloseTo(17.1375, 9);
    expect(lossy.totalLossL).toBeCloseTo(clean.totalLossL + 1.5, 9);
    // Everything downstream of the tun is unchanged. The extra water replaces
    // the wort the tun keeps.
    expect(lossy.preBoilVolumeL).toBeCloseTo(clean.preBoilVolumeL, 9);
    expect(lossy.volumeIntoFermenterL).toBeCloseTo(20, 9);
  });

  it('stays an exact inverse with both fields set', () => {
    const both = { ...equipment, mashTunDeadspaceL: 6.8, mashTunLossL: 1.5 };
    const planned = planVolumes(20, 'fermenter', both, inputs);
    const projected = projectVolumes(
      { strikeWaterL: planned.strikeWaterL, spargeWaterL: planned.spargeWaterL },
      both,
      inputs,
    );
    for (const [key, value] of Object.entries(planned)) {
      if (typeof value !== 'number') continue;
      expect(projected[key as keyof typeof projected], key).toBeCloseTo(value, 9);
    }
  });

  it('reports deadspace without counting it in the total loss', () => {
    const both = planVolumes(
      20,
      'fermenter',
      { ...equipment, mashTunDeadspaceL: 6.8, mashTunLossL: 1.5 },
      inputs,
    );
    expect(both.mashTunDeadspaceL).toBe(6.8);
    expect(both.mashTunLossL).toBe(1.5);
    expect(both.totalWaterL - both.totalLossL).toBeCloseTo(both.packagedVolumeL, 9);
  });
});

describe('boil-off and shrinkage', () => {
  it('evaporates at the profile rate', () => {
    expect(boilOffVolume(3.5, 90)).toBeCloseTo(5.25, 9);
    expect(boilOffVolume(3.5, 0)).toBe(0);
  });

  it('shrinks by 4 %% by default', () => {
    expect(applyBoilShrinkage(25)).toBeCloseTo(24, 9);
  });

  it('round trips shrinkage', () => {
    expect(removeBoilShrinkage(applyBoilShrinkage(22.4375))).toBeCloseTo(22.4375, 9);
    expect(applyBoilShrinkage(removeBoilShrinkage(21.54, 5), 5)).toBeCloseTo(21.54, 9);
  });

  it('scales the boil-off with a longer boil', () => {
    const short = planVolumes(20, 'fermenter', equipment, { ...inputs, boilTimeMinutes: 60 });
    const long = planVolumes(20, 'fermenter', equipment, { ...inputs, boilTimeMinutes: 90 });
    expect(long.boilOffL - short.boilOffL).toBeCloseTo(1.5, 9);
    expect(long.totalWaterL - short.totalWaterL).toBeCloseTo(1.5, 9);
  });
});

describe('strikeWaterTemperature', () => {
  it('matches Palmer for a 3 L/kg mash', () => {
    // T_w = 66.7 + (0.4 / 3.0) × (66.7 − 20) = 66.7 + 6.2267 = 72.93 °C
    expect(
      strikeWaterTemperature({
        grainTempC: 20,
        targetMashTempC: 66.7,
        mashThicknessLPerKg: 3.0,
      }),
    ).toBeCloseTo(72.9267, 3);
  });

  it('needs hotter water for a thicker mash', () => {
    const thick = strikeWaterTemperature({
      grainTempC: 20,
      targetMashTempC: 66.7,
      mashThicknessLPerKg: 2.0,
    });
    const thin = strikeWaterTemperature({
      grainTempC: 20,
      targetMashTempC: 66.7,
      mashThicknessLPerKg: 4.0,
    });
    expect(thick).toBeGreaterThan(thin);
    // 66.7 + (0.4/2.0) × 46.7 = 76.04 °C
    expect(thick).toBeCloseTo(76.04, 2);
  });

  it('needs hotter water for colder grain', () => {
    const cold = strikeWaterTemperature({
      grainTempC: 5,
      targetMashTempC: 66.7,
      mashThicknessLPerKg: 3.0,
    });
    expect(cold).toBeGreaterThan(
      strikeWaterTemperature({ grainTempC: 25, targetMashTempC: 66.7, mashThicknessLPerKg: 3.0 }),
    );
  });

  it('adds nothing when grain is already at the target', () => {
    expect(
      strikeWaterTemperature({
        grainTempC: 66.7,
        targetMashTempC: 66.7,
        mashThicknessLPerKg: 3.0,
      }),
    ).toBeCloseTo(66.7, 9);
  });

  it('adds for a cold mash tun with thermal mass', () => {
    const withTun = strikeWaterTemperature({
      grainTempC: 20,
      targetMashTempC: 66.7,
      mashThicknessLPerKg: 3.0,
      tunThermalMassLEquivalent: 3,
      tunTempC: 10,
      grainKg: 4.9,
    });
    // 72.9267 + 3 × (66.7 − 10) / 14.7 = 72.9267 + 11.5714 = 84.50 °C
    expect(withTun).toBeCloseTo(84.4981, 3);
  });
});

describe('infusionVolume', () => {
  it('matches Palmer for a mash-out step', () => {
    // (75.6 − 66.7) × (0.4 × 4.9 + 14.7) / (100 − 75.6) = 8.9 × 16.66 / 24.4 = 6.077 L
    expect(
      infusionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 66.7,
        targetTempC: 75.6,
        infusionTempC: 100,
      }),
    ).toBeCloseTo(6.0768, 3);
  });

  it('needs nothing when already at target', () => {
    expect(
      infusionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 70,
        targetTempC: 70,
        infusionTempC: 100,
      }),
    ).toBe(0);
  });

  it('is unreachable when the infusion is not hotter than the target', () => {
    expect(
      infusionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 60,
        targetTempC: 100,
        infusionTempC: 100,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('needs more water for a bigger step', () => {
    const base = {
      currentMashWaterL: 14.7,
      grainKg: 4.9,
      currentTempC: 52,
      infusionTempC: 100,
    };
    expect(infusionVolume({ ...base, targetTempC: 72 })).toBeGreaterThan(
      infusionVolume({ ...base, targetTempC: 64 }),
    );
  });
});

describe('infusionTemperature', () => {
  const mash = {
    currentMashWaterL: 14.7,
    grainKg: 4.9,
    currentTempC: 66.7,
  };

  it('round-trips the volume infusionVolume asks for', () => {
    for (const [targetTempC, infusionTempC] of [
      [75.6, 100],
      [72, 82],
      [70, 90],
    ] as const) {
      const infusionVolumeL = infusionVolume({ ...mash, targetTempC, infusionTempC });
      expect(infusionTemperature({ ...mash, targetTempC, infusionVolumeL })).toBeCloseTo(
        infusionTempC,
        6,
      );
    }
  });

  it('matches Palmer solved the other way for a mash-out step', () => {
    // 75.6 + (75.6 − 66.7) × (0.4 × 4.9 + 14.7) / 8 = 75.6 + 18.534 = 94.13 °C
    expect(
      infusionTemperature({
        ...mash,
        targetTempC: 75.6,
        infusionVolumeL: 8,
      }),
    ).toBeCloseTo(94.1342, 3);
  });

  it('is unreachable when no water is added', () => {
    expect(infusionTemperature({ ...mash, targetTempC: 75.6, infusionVolumeL: 0 })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(infusionTemperature({ ...mash, targetTempC: 75.6, infusionVolumeL: -2 })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('decoctionVolume', () => {
  it('pulls a fraction of the mash proportional to the step size', () => {
    // (14.7 + 0.4 × 4.9) × (72 − 52) / (100 − 52) = 16.66 × 20 / 48 = 6.942 L
    expect(
      decoctionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 52,
        targetTempC: 72,
      }),
    ).toBeCloseTo(6.9417, 3);
  });

  it('pulls nothing when already at target', () => {
    expect(
      decoctionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 72,
        targetTempC: 72,
      }),
    ).toBe(0);
  });
});

describe('decoction evaporation in the waterfall', () => {
  const withEvap = { ...inputs, decoctionEvaporationL: 1.5 };

  it('is water the brewer has to measure out and never gets back', () => {
    const plain = planVolumes(20, 'fermenter', equipment, inputs);
    const decocted = planVolumes(20, 'fermenter', equipment, withEvap);
    // Same beer out of the kettle, 1.5 L more water in. The decoction boils use it.
    expect(decocted.totalWaterL).toBeCloseTo(plain.totalWaterL + 1.5, 9);
    expect(decocted.preBoilVolumeL).toBeCloseTo(plain.preBoilVolumeL, 9);
    expect(decocted.packagedVolumeL).toBeCloseTo(plain.packagedVolumeL, 9);
    expect(decocted.decoctionEvaporationL).toBe(1.5);
    expect(decocted.totalLossL).toBeCloseTo(plain.totalLossL + 1.5, 9);
  });

  it('keeps the two directions exact inverses', () => {
    const planned = planVolumes(20, 'fermenter', equipment, withEvap);
    const projected = projectVolumes(
      { strikeWaterL: planned.strikeWaterL, spargeWaterL: planned.spargeWaterL },
      equipment,
      withEvap,
    );
    expect(projected.preBoilVolumeL).toBeCloseTo(planned.preBoilVolumeL, 9);
    expect(projected.volumeIntoFermenterL).toBeCloseTo(20, 9);
  });

  it('leaves the accounting identity standing', () => {
    const w = planVolumes(20, 'fermenter', equipment, withEvap);
    expect(w.totalWaterL - w.totalLossL).toBeCloseTo(w.packagedVolumeL, 9);
  });

  it('is zero for the infusion mash every other test describes', () => {
    expect(planVolumes(20, 'fermenter', equipment, inputs).decoctionEvaporationL).toBe(0);
  });
});

describe('mashThicknessFromStrike', () => {
  it('inverts the thickness ratio', () => {
    expect(mashThicknessFromStrike(14.7, 4.9)).toBeCloseTo(3, 9);
    expect(mashThicknessFromStrike(14.7, 0)).toBe(0);
  });
});

describe('volumeWarnings', () => {
  it('is quiet on a sane batch', () => {
    expect(volumeWarnings(planVolumes(20, 'fermenter', equipment, inputs), equipment)).toEqual([]);
  });

  it('warns when the kettle is too small', () => {
    const small = resolveEquipmentProfile({ ...equipment, kettleVolumeL: 20 });
    const warnings = volumeWarnings(planVolumes(20, 'fermenter', small, inputs), small);
    expect(warnings.join(' ')).toMatch(/exceeds the kettle/);
  });

  it('warns when the mash tun is too small', () => {
    const small = resolveEquipmentProfile({ ...equipment, mashTunVolumeL: 15 });
    const warnings = volumeWarnings(planVolumes(20, 'fermenter', small, inputs), small);
    expect(warnings.join(' ')).toMatch(/exceeds the mash tun/);
  });

  it('warns when losses swallow the batch', () => {
    const lossy = resolveEquipmentProfile({ ...equipment, fermenterTrubLossL: 25 });
    const warnings = volumeWarnings(planVolumes(20, 'fermenter', lossy, inputs), lossy);
    expect(warnings.join(' ')).toMatch(/Packaged volume is zero or negative/);
  });
});

describe('top-up water', () => {
  it('reduces the water needed at the mash when the kettle is topped up', () => {
    const topUp = resolveEquipmentProfile({ ...equipment, topUpKettleL: 5 });
    const plain = planVolumes(20, 'fermenter', equipment, inputs);
    const topped = planVolumes(20, 'fermenter', topUp, inputs);
    expect(plain.totalWaterL - topped.totalWaterL).toBeCloseTo(5, 9);
    expect(topped.preBoilVolumeL).toBeCloseTo(plain.preBoilVolumeL, 9);
  });

  it('round trips with a fermenter top-up', () => {
    const topUp = resolveEquipmentProfile({ ...equipment, topUpFermenterL: 8 });
    const planned = planVolumes(20, 'fermenter', topUp, inputs);
    const projected = projectVolumes(
      { strikeWaterL: planned.strikeWaterL, spargeWaterL: planned.spargeWaterL },
      topUp,
      inputs,
    );
    expect(projected.volumeIntoFermenterL).toBeCloseTo(20, 9);
  });
});

describe('resolveEquipmentProfile', () => {
  it('fills defaults', () => {
    expect(resolveEquipmentProfile().mashEfficiencyPercent).toBe(75);
  });

  it('lets dry-hop absorption inherit an explicit kettle figure', () => {
    expect(resolveEquipmentProfile({ hopAbsorptionMlPerG: 9 }).dryHopAbsorptionMlPerG).toBe(9);
  });

  it('keeps an explicit dry-hop figure distinct', () => {
    const profile = resolveEquipmentProfile({
      hopAbsorptionMlPerG: 9,
      dryHopAbsorptionMlPerG: 2,
    });
    expect(profile.dryHopAbsorptionMlPerG).toBe(2);
  });

  it('omits optional capacities when not given', () => {
    expect(resolveEquipmentProfile().kettleVolumeL).toBeUndefined();
  });
});
