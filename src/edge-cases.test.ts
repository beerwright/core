/**
 * Edge cases the engine has to handle without breaking.
 *
 * Callers recompute a recipe on every keystroke, so the engine regularly sees
 * half-finished recipes: no hops yet, no yeast picked, a grist of one
 * ingredient, an amount that's briefly zero. None of these should throw,
 * return `NaN`, or produce a nonsensical vital.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_EQUIPMENT } from './fixtures/reference-recipes';
import { calculateRecipe } from './recipe';
import type { FermentableAddition, RecipeInput } from './types';

const baseRecipe: RecipeInput = {
  name: 'Edge case',
  batchVolumeL: 20,
  batchVolumeBasis: 'fermenter',
  boilTimeMinutes: 60,
  fermentables: [],
  hops: [],
};

const paleMalt: FermentableAddition = {
  name: 'Pale Ale Malt',
  amountKg: 4.5,
  class: 'grain',
  use: 'mash',
  extractFineGrindDryBasisPercent: 80,
  moisturePercent: 4,
  colorLovibond: 3,
};

/** Every vital must be a real, finite number. */
function expectAllFinite(result: ReturnType<typeof calculateRecipe>): void {
  for (const [key, value] of Object.entries(result.vitals)) {
    if (typeof value === 'number') {
      expect(Number.isFinite(value), `vitals.${key} = ${value}`).toBe(true);
    }
  }
  for (const [key, value] of Object.entries(result.volumes)) {
    expect(Number.isFinite(value), `volumes.${key} = ${value}`).toBe(true);
  }
}

describe('zero-hop recipe', () => {
  const result = calculateRecipe({ ...baseRecipe, fermentables: [paleMalt] }, REFERENCE_EQUIPMENT);

  it('reports zero bitterness and zero BU:GU', () => {
    expect(result.vitals.ibu).toBe(0);
    expect(result.vitals.buGu).toBe(0);
    expect(result.hops).toHaveLength(0);
  });

  it('still computes every other vital', () => {
    expect(result.vitals.og).toBeGreaterThan(1);
    expect(result.vitals.fg).toBeGreaterThan(1);
    expect(result.vitals.abv).toBeGreaterThan(0);
    expect(result.vitals.srm).toBeGreaterThan(0);
    expectAllFinite(result);
  });

  it('loses no volume to hop absorption', () => {
    expect(result.volumes.kettleHopAbsorptionL).toBe(0);
    expect(result.volumes.dryHopAbsorptionL).toBe(0);
  });

  it('says so in the warnings', () => {
    expect(result.warnings.join(' ')).toMatch(/No hops/);
  });
});

describe('100 % extract recipe', () => {
  const result = calculateRecipe(
    {
      ...baseRecipe,
      fermentables: [
        {
          name: 'Light DME',
          amountKg: 3.2,
          class: 'dry-extract',
          use: 'boil',
          ppg: 44,
          colorLovibond: 8,
        },
      ],
      hops: [
        {
          name: 'Magnum',
          amountKg: 0.015,
          alphaAcidPercent: 13,
          form: 'pellet',
          use: 'boil',
          timeMinutes: 60,
        },
      ],
    },
    REFERENCE_EQUIPMENT,
  );

  it('applies no mash efficiency', () => {
    expect(result.fermentables[0]?.efficiencyPercent).toBe(100);
  });

  it('needs no strike water and no mash', () => {
    expect(result.volumes.grainAbsorptionL).toBe(0);
    expect(result.strikeTemperatureC).toBeUndefined();
  });

  it('has no extract in the wort before the boil', () => {
    expect(result.vitals.preBoilGravity).toBe(1);
    expect(result.vitals.og).toBeGreaterThan(1.05);
  });

  it('computes every vital', () => {
    expect(result.vitals.ibu).toBeGreaterThan(0);
    expect(result.vitals.abv).toBeGreaterThan(0);
    expectAllFinite(result);
  });

  it('reports a brewhouse efficiency at or below 100 %', () => {
    expect(result.vitals.brewhouseEfficiencyPercent).toBeGreaterThan(80);
    expect(result.vitals.brewhouseEfficiencyPercent).toBeLessThanOrEqual(100);
  });
});

describe('non-fermentable-only addition', () => {
  it('raises gravity but leaves FG equal to OG', () => {
    const result = calculateRecipe(
      {
        ...baseRecipe,
        fermentables: [
          {
            name: 'Lactose',
            amountKg: 0.5,
            class: 'non-fermentable',
            use: 'boil',
            ppg: 35,
            colorLovibond: 0,
          },
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.og).toBeGreaterThan(1);
    expect(result.vitals.fg).toBeCloseTo(result.vitals.og, 9);
    expect(result.vitals.abv).toBeCloseTo(0, 9);
    expect(result.vitals.apparentAttenuationPercent).toBeCloseTo(0, 9);
    expectAllFinite(result);
  });

  it('sweetens a beer that would otherwise finish dry', () => {
    const withoutLactose = calculateRecipe(
      { ...baseRecipe, fermentables: [paleMalt] },
      REFERENCE_EQUIPMENT,
    );
    const withLactose = calculateRecipe(
      {
        ...baseRecipe,
        fermentables: [
          paleMalt,
          {
            name: 'Lactose',
            amountKg: 0.5,
            class: 'non-fermentable',
            use: 'boil',
            ppg: 35,
            colorLovibond: 0,
          },
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    expect(withLactose.vitals.fg).toBeGreaterThan(withoutLactose.vitals.fg);
    expect(withLactose.vitals.apparentAttenuationPercent).toBeLessThan(
      withoutLactose.vitals.apparentAttenuationPercent,
    );
  });
});

describe('zero-minute additions', () => {
  const zeroMinuteRecipe: RecipeInput = {
    ...baseRecipe,
    fermentables: [paleMalt],
    hops: [
      {
        name: 'Flameout boil',
        amountKg: 0.05,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 0,
      },
      {
        name: 'Zero-length stand',
        amountKg: 0.05,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 0,
        whirlpoolTempC: 85,
      },
    ],
  };

  it('gives both exactly zero IBU', () => {
    const result = calculateRecipe(zeroMinuteRecipe, REFERENCE_EQUIPMENT);
    expect(result.hops[0]?.ibu).toBe(0);
    expect(result.hops[1]?.ibu).toBe(0);
    expect(result.vitals.ibu).toBe(0);
  });

  it('still charges the volume waterfall for the hops in the kettle', () => {
    const result = calculateRecipe(zeroMinuteRecipe, REFERENCE_EQUIPMENT);
    // 0.10 kg × 6 L/kg = 0.6 L
    expect(result.volumes.kettleHopAbsorptionL).toBeCloseTo(0.6, 9);
  });

  it('handles a zero-minute boil', () => {
    const result = calculateRecipe(
      { ...zeroMinuteRecipe, boilTimeMinutes: 0 },
      REFERENCE_EQUIPMENT,
    );
    expect(result.volumes.boilOffL).toBe(0);
    expect(result.volumes.preBoilVolumeL).toBeCloseTo(result.volumes.postBoilVolumeHotL, 9);
    expectAllFinite(result);
  });
});

describe('degenerate inputs', () => {
  it('handles an empty recipe', () => {
    const result = calculateRecipe(baseRecipe, REFERENCE_EQUIPMENT);
    expect(result.vitals.og).toBe(1);
    expect(result.vitals.fg).toBe(1);
    expect(result.vitals.abv).toBe(0);
    expect(result.vitals.ibu).toBe(0);
    expect(result.vitals.srm).toBe(0);
    expect(result.vitals.colorHex).toBe('#FFF9E6');
    expectAllFinite(result);
  });

  it('handles a zero-mass fermentable mid-edit', () => {
    const result = calculateRecipe(
      { ...baseRecipe, fermentables: [{ ...paleMalt, amountKg: 0 }] },
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.og).toBe(1);
    expect(result.fermentables[0]?.percentOfGrist).toBe(0);
    expectAllFinite(result);
  });

  it('handles a zero-mass hop mid-edit', () => {
    const result = calculateRecipe(
      {
        ...baseRecipe,
        fermentables: [paleMalt],
        hops: [
          {
            name: 'Empty',
            amountKg: 0,
            alphaAcidPercent: 10,
            form: 'pellet',
            use: 'boil',
            timeMinutes: 60,
          },
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.ibu).toBe(0);
    expectAllFinite(result);
  });

  it('handles a zero-alpha hop', () => {
    const result = calculateRecipe(
      {
        ...baseRecipe,
        fermentables: [paleMalt],
        hops: [
          {
            name: 'Spent',
            amountKg: 0.03,
            alphaAcidPercent: 0,
            form: 'pellet',
            use: 'boil',
            timeMinutes: 60,
          },
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.ibu).toBe(0);
    expectAllFinite(result);
  });

  it('warns and still computes with no yeast selected', () => {
    const result = calculateRecipe(
      { ...baseRecipe, fermentables: [paleMalt] },
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.yeastAttenuationPercent).toBe(75);
    expect(result.warnings.join(' ')).toMatch(/No yeast selected/);
  });

  it('handles a batch so small the losses swallow it', () => {
    const result = calculateRecipe(
      { ...baseRecipe, batchVolumeL: 1, fermentables: [paleMalt] },
      { ...REFERENCE_EQUIPMENT, fermenterTrubLossL: 5 },
    );
    expect(result.warnings.join(' ')).toMatch(/Packaged volume is zero or negative/);
    expectAllFinite(result);
  });

  it('handles a dry-hop-only schedule', () => {
    const result = calculateRecipe(
      {
        ...baseRecipe,
        fermentables: [paleMalt],
        hops: [
          {
            name: 'Citra',
            amountKg: 0.1,
            alphaAcidPercent: 12,
            form: 'cryo',
            use: 'dry-hop',
            timeMinutes: 0,
            dryHopDays: 5,
          },
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.ibu).toBe(0);
    expect(result.volumes.kettleHopAbsorptionL).toBe(0);
    expect(result.volumes.dryHopAbsorptionL).toBeCloseTo(0.6, 9);
    expectAllFinite(result);
  });

  it('handles a grist that is only fermenter sugar', () => {
    const result = calculateRecipe(
      {
        ...baseRecipe,
        fermentables: [
          {
            name: 'Honey',
            amountKg: 1,
            class: 'sugar',
            use: 'fermenter',
            ppg: 35,
            colorLovibond: 2,
          },
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.og).toBe(1);
    expect(result.vitals.ogEquivalent).toBeGreaterThan(1);
    expect(result.vitals.abv).toBeGreaterThan(0);
    expect(result.vitals.fg).toBeCloseTo(1, 2);
    expectAllFinite(result);
  });
});
