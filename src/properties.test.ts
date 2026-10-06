/**
 * Property tests.
 *
 * These are plain Vitest loops over a spread of inputs. We don't use a
 * property-testing library because the engine has no runtime dependencies.
 * Each block states the invariant it checks and the epsilon it allows.
 */

import { describe, expect, it } from 'vitest';
import {
  REFERENCE_EQUIPMENT,
  REFERENCE_RECIPE_A,
  REFERENCE_RECIPE_B,
} from './fixtures/reference-recipes';
import {
  brewhouseEfficiencyFromMeasurement,
  mashEfficiencyFromMeasurement,
  predictGravities,
} from './gravity';
import { calculateIbu, tinsethBoilTimeFactor, tinsethUtilization } from './ibu';
import { calculateRecipe } from './recipe';
import type { EquipmentProfile, HopAddition, RecipeInput } from './types';
import { planVolumes, projectVolumes } from './volumes';

/**
 * Scale a recipe and its equipment by `k`.
 *
 * Masses and the target volume scale. So do the equipment's fixed losses and
 * the boil-off rate, because a bigger system has a bigger kettle deadspace and
 * a wider surface. Per-unit rates (absorption per kg, shrinkage %, efficiency
 * %, mash thickness) are intensive and don't change. Scaled this way, every
 * concentration in the recipe should stay the same.
 */
function scale(recipe: RecipeInput, equipment: EquipmentProfile, k: number) {
  return {
    recipe: {
      ...recipe,
      batchVolumeL: recipe.batchVolumeL * k,
      fermentables: recipe.fermentables.map((f) => ({ ...f, amountKg: f.amountKg * k })),
      hops: recipe.hops.map((h) => ({ ...h, amountKg: h.amountKg * k })),
    } satisfies RecipeInput,
    equipment: {
      ...equipment,
      mashTunDeadspaceL: equipment.mashTunDeadspaceL * k,
      mashTunLossL: equipment.mashTunLossL * k,
      kettleDeadspaceL: equipment.kettleDeadspaceL * k,
      chillerLossL: equipment.chillerLossL * k,
      fermenterTrubLossL: equipment.fermenterTrubLossL * k,
      topUpKettleL: equipment.topUpKettleL * k,
      topUpFermenterL: equipment.topUpFermenterL * k,
      boilOffRateLPerHour: equipment.boilOffRateLPerHour * k,
    } satisfies EquipmentProfile,
  };
}

const SCALE_FACTORS = [0.5, 0.75, 1.5, 2, 3, 10];

describe('scaling invariance', () => {
  /** Epsilon: 1e-9 for gravity, 1e-7 for the derived percentages and ratios. */
  const GRAVITY_EPSILON = 1e-9;
  const DERIVED_EPSILON = 1e-7;

  for (const recipe of [REFERENCE_RECIPE_A, REFERENCE_RECIPE_B]) {
    describe(recipe.name ?? 'recipe', () => {
      const base = calculateRecipe(recipe, REFERENCE_EQUIPMENT);

      it.each(SCALE_FACTORS)('preserves every vital when scaled ×%f', (k) => {
        const scaled = scale(recipe, REFERENCE_EQUIPMENT, k);
        const result = calculateRecipe(scaled.recipe, scaled.equipment);

        expect(Math.abs(result.vitals.og - base.vitals.og)).toBeLessThan(GRAVITY_EPSILON);
        expect(Math.abs(result.vitals.fg - base.vitals.fg)).toBeLessThan(GRAVITY_EPSILON);
        expect(Math.abs(result.vitals.preBoilGravity - base.vitals.preBoilGravity)).toBeLessThan(
          GRAVITY_EPSILON,
        );
        expect(Math.abs(result.vitals.abv - base.vitals.abv)).toBeLessThan(DERIVED_EPSILON);
        expect(Math.abs(result.vitals.ibu - base.vitals.ibu)).toBeLessThan(DERIVED_EPSILON);
        expect(Math.abs(result.vitals.srm - base.vitals.srm)).toBeLessThan(DERIVED_EPSILON);
        expect(Math.abs(result.vitals.buGu - base.vitals.buGu)).toBeLessThan(DERIVED_EPSILON);
        expect(
          Math.abs(
            result.vitals.brewhouseEfficiencyPercent - base.vitals.brewhouseEfficiencyPercent,
          ),
        ).toBeLessThan(DERIVED_EPSILON);
      });

      it.each(SCALE_FACTORS)('scales every volume linearly by %f', (k) => {
        const scaled = scale(recipe, REFERENCE_EQUIPMENT, k);
        const result = calculateRecipe(scaled.recipe, scaled.equipment);
        for (const key of [
          'strikeWaterL',
          'spargeWaterL',
          'totalWaterL',
          'preBoilVolumeL',
          'postBoilVolumeL',
          'volumeIntoFermenterL',
          'packagedVolumeL',
        ] as const) {
          expect(result.volumes[key], `${key} at ×${k}`).toBeCloseTo(base.volumes[key] * k, 6);
        }
      });

      it.each(SCALE_FACTORS)('scales per-addition IBU linearly by %f', (k) => {
        const scaled = scale(recipe, REFERENCE_EQUIPMENT, k);
        const result = calculateRecipe(scaled.recipe, scaled.equipment);
        for (const [index, contribution] of result.hops.entries()) {
          expect(contribution.ibu, `hop ${index} at ×${k}`).toBeCloseTo(
            base.hops[index]?.ibu ?? 0,
            9,
          );
        }
      });
    });
  }
});

describe('efficiency round trip', () => {
  /** Epsilon is 1e-6 percentage points, because this is an algebraic inverse. */
  it.each([50, 58, 65, 70, 75, 80, 85, 92])(
    'predicts a gravity from %i %% mash efficiency and recovers it',
    (efficiency) => {
      const result = calculateRecipe(REFERENCE_RECIPE_A, {
        ...REFERENCE_EQUIPMENT,
        mashEfficiencyPercent: efficiency,
      });
      const recovered = mashEfficiencyFromMeasurement({
        fermentables: REFERENCE_RECIPE_A.fermentables,
        measuredGravity: result.vitals.og,
        measuredVolumeL: result.volumes.postBoilVolumeL,
      });
      expect(recovered).toBeCloseTo(efficiency, 6);
    },
  );

  /** A grist with all four efficiency regimes at once. */
  const mixedGrist: RecipeInput = {
    ...REFERENCE_RECIPE_A,
    fermentables: [...REFERENCE_RECIPE_A.fermentables, ...REFERENCE_RECIPE_B.fermentables.slice(1)],
  };

  it.each([50, 65, 75, 85])(
    'recovers %i %% from a grist mixing mashed grain, steep, extract and lactose',
    (efficiency) => {
      const result = calculateRecipe(mixedGrist, {
        ...REFERENCE_EQUIPMENT,
        mashEfficiencyPercent: efficiency,
      });
      const recovered = mashEfficiencyFromMeasurement({
        fermentables: mixedGrist.fermentables,
        measuredGravity: result.vitals.og,
        measuredVolumeL: result.volumes.postBoilVolumeL,
      });
      expect(recovered).toBeCloseTo(efficiency, 6);
    },
  );

  it('reports NaN rather than 0 for an all-extract recipe', () => {
    const result = calculateRecipe(REFERENCE_RECIPE_B, REFERENCE_EQUIPMENT);
    expect(
      mashEfficiencyFromMeasurement({
        fermentables: REFERENCE_RECIPE_B.fermentables.filter((f) => f.use !== 'steep'),
        measuredGravity: result.vitals.og,
        measuredVolumeL: result.volumes.postBoilVolumeL,
      }),
    ).toBeNaN();
  });

  it('round trips brewhouse efficiency across a range of losses', () => {
    for (const trub of [0, 0.5, 1, 2, 4]) {
      const equipment = { ...REFERENCE_EQUIPMENT, fermenterTrubLossL: trub };
      const result = calculateRecipe(REFERENCE_RECIPE_A, equipment);
      const recovered = brewhouseEfficiencyFromMeasurement({
        fermentables: REFERENCE_RECIPE_A.fermentables,
        measuredOg: result.vitals.og,
        volumeIntoFermenterL: result.volumes.volumeIntoFermenterL,
      });
      expect(recovered).toBeCloseTo(result.vitals.brewhouseEfficiencyPercent, 9);
    }
  });

  it('keeps brewhouse efficiency at or below mash efficiency', () => {
    for (const kettleDeadspace of [0, 0.5, 1, 2, 3]) {
      const result = calculateRecipe(REFERENCE_RECIPE_A, {
        ...REFERENCE_EQUIPMENT,
        kettleDeadspaceL: kettleDeadspace,
      });
      expect(result.vitals.brewhouseEfficiencyPercent).toBeLessThanOrEqual(
        result.vitals.mashEfficiencyPercent + 1e-9,
      );
    }
  });
});

describe('volume waterfall forward/backward consistency', () => {
  /** Epsilon: 1e-9 L. */
  const grid = [
    { grainKg: 0, kettleHopKg: 0, dryHopKg: 0, boilTimeMinutes: 60 },
    { grainKg: 2, kettleHopKg: 0.02, dryHopKg: 0, boilTimeMinutes: 30 },
    { grainKg: 4.9, kettleHopKg: 0.09, dryHopKg: 0.05, boilTimeMinutes: 60 },
    { grainKg: 12, kettleHopKg: 0.35, dryHopKg: 0.4, boilTimeMinutes: 90 },
  ];

  for (const spargeType of ['batch', 'fly', 'no-sparge', 'biab-full-volume'] as const) {
    it.each(grid)(`round trips a ${spargeType} profile with %o`, (inputs) => {
      const equipment: EquipmentProfile = { ...REFERENCE_EQUIPMENT, spargeType };
      for (const target of [10, 20, 40]) {
        const planned = planVolumes(target, 'fermenter', equipment, inputs);
        const projected = projectVolumes(
          { strikeWaterL: planned.strikeWaterL, spargeWaterL: planned.spargeWaterL },
          equipment,
          inputs,
        );
        expect(projected.volumeIntoFermenterL).toBeCloseTo(target, 9);
        expect(projected.packagedVolumeL).toBeCloseTo(planned.packagedVolumeL, 9);
        expect(projected.preBoilVolumeL).toBeCloseTo(planned.preBoilVolumeL, 9);
      }
    });
  }

  it('conserves litres: total water − losses = packaged', () => {
    for (const inputs of grid) {
      for (const target of [10, 20, 40]) {
        const w = planVolumes(target, 'fermenter', REFERENCE_EQUIPMENT, inputs);
        expect(w.totalWaterL - w.totalLossL).toBeCloseTo(w.packagedVolumeL, 9);
      }
    }
  });
});

describe('monotonicity', () => {
  const hop = (overrides: Partial<HopAddition> = {}): HopAddition => ({
    name: 'Test',
    amountKg: 0.03,
    alphaAcidPercent: 10,
    form: 'pellet',
    use: 'boil',
    timeMinutes: 60,
    ...overrides,
  });

  it('gives more IBU for more hops', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let grams = 0; grams <= 200; grams += 10) {
      const ibu = calculateIbu({
        hops: [hop({ amountKg: grams / 1000 })],
        volumeL: 20,
        boilGravity: 1.05,
        boilTimeMinutes: 60,
      }).ibu;
      expect(ibu).toBeGreaterThanOrEqual(previous);
      previous = ibu;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it('gives more IBU for a higher alpha acid', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let aa = 2; aa <= 20; aa += 1) {
      const ibu = calculateIbu({
        hops: [hop({ alphaAcidPercent: aa })],
        volumeL: 20,
        boilGravity: 1.05,
        boilTimeMinutes: 60,
      }).ibu;
      expect(ibu).toBeGreaterThan(previous);
      previous = ibu;
    }
  });

  it('gives more IBU for a longer boil, approaching the Tinseth asymptote', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let minutes = 0; minutes <= 180; minutes += 5) {
      const utilization = tinsethUtilization(1.05, minutes);
      expect(utilization).toBeGreaterThanOrEqual(previous);
      previous = utilization;
    }
    // The boil-time factor approaches 1/4.15, so utilisation approaches
    // bigness × 1/4.15 and never goes over it.
    const ceiling = tinsethUtilization(1.05, Number.POSITIVE_INFINITY);
    expect(tinsethBoilTimeFactor(180)).toBeLessThan(1 / 4.15);
    expect(tinsethUtilization(1.05, 180)).toBeLessThan(ceiling);
    expect(tinsethUtilization(1.05, 600)).toBeCloseTo(ceiling, 4);
  });

  it('gives less IBU at higher boil gravity', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let points = 20; points <= 120; points += 5) {
      const utilization = tinsethUtilization(1 + points / 1000, 60);
      expect(utilization).toBeLessThan(previous);
      previous = utilization;
    }
  });

  it('gives a higher OG for more grain', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let kg = 1; kg <= 12; kg += 0.5) {
      const og = calculateRecipe(
        {
          ...REFERENCE_RECIPE_A,
          fermentables: [{ ...REFERENCE_RECIPE_A.fermentables[0], amountKg: kg }],
        } as RecipeInput,
        REFERENCE_EQUIPMENT,
      ).vitals.og;
      expect(og).toBeGreaterThan(previous);
      previous = og;
    }
  });

  it('gives a lower FG for a more attenuative yeast', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let attenuation = 60; attenuation <= 95; attenuation += 5) {
      const fg = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT, {
        attenuationOverridePercent: attenuation,
      }).vitals.fg;
      expect(fg).toBeLessThan(previous);
      previous = fg;
    }
  });

  it('gives a darker colour for more crystal malt', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let kg = 0; kg <= 2; kg += 0.1) {
      const srm = calculateRecipe(
        {
          ...REFERENCE_RECIPE_A,
          fermentables: [
            REFERENCE_RECIPE_A.fermentables[0],
            { ...REFERENCE_RECIPE_A.fermentables[1], amountKg: kg },
          ],
        } as RecipeInput,
        REFERENCE_EQUIPMENT,
      ).vitals.srm;
      expect(srm).toBeGreaterThanOrEqual(previous);
      previous = srm;
    }
  });

  it('gives a higher OG for a higher mash efficiency', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let efficiency = 50; efficiency <= 95; efficiency += 5) {
      const og = predictGravities({
        fermentables: REFERENCE_RECIPE_A.fermentables,
        volumes: { preBoilVolumeL: 25, postBoilVolumeL: 21, volumeIntoFermenterL: 20 },
        mashEfficiencyPercent: efficiency,
      }).og;
      expect(og).toBeGreaterThan(previous);
      previous = og;
    }
  });
});
