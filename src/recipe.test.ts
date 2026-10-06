import { describe, expect, it } from 'vitest';
import {
  REFERENCE_A_EXPECTED,
  REFERENCE_B_EXPECTED,
  REFERENCE_EQUIPMENT,
  REFERENCE_RECIPE_A,
  REFERENCE_RECIPE_B,
} from './fixtures/reference-recipes';
import { calculateRecipe } from './recipe';
import type { RecipeInput } from './types';

/**
 * ## Tolerance policy for the golden reference recipes
 *
 * | Quantity                | Tolerance      | Why |
 * | ----------------------- | -------------- | --- |
 * | Volumes                 | 0.001 L        | exact arithmetic, only fixture rounding |
 * | Gravity (SG)            | 0.00005        | fixture values are printed to 5 dp |
 * | ABV, IBU, SRM, °P       | 0.005 absolute | fixture values are printed to 3 dp |
 * | Efficiency, calories    | 0.05 / 0.5     | fixture values are printed to 2 dp |
 *
 * None of these numbers come from fitting another tool's output. Each one is
 * reproduced from the published formula in the fixture's comments.
 */
const SG = 4; // toBeCloseTo digits → 0.00005
const THREE_DP = 2; // → 0.005

describe('reference recipe A — all-grain American Pale Ale', () => {
  const result = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT);
  const e = REFERENCE_A_EXPECTED;

  it('plans the volume waterfall', () => {
    expect(result.volumes.strikeWaterL).toBeCloseTo(e.strikeWaterL, 6);
    expect(result.volumes.spargeWaterL).toBeCloseTo(e.spargeWaterL, 6);
    expect(result.volumes.totalWaterL).toBeCloseTo(e.totalWaterL, 6);
    expect(result.volumes.preBoilVolumeL).toBeCloseTo(e.preBoilVolumeL, 6);
    expect(result.volumes.postBoilVolumeL).toBeCloseTo(e.postBoilVolumeL, 6);
    expect(result.volumes.volumeIntoFermenterL).toBeCloseTo(e.volumeIntoFermenterL, 6);
    expect(result.volumes.packagedVolumeL).toBeCloseTo(e.packagedVolumeL, 6);
  });

  it('computes the per-fermentable yields', () => {
    expect(result.fermentables[0]?.ppg).toBeCloseTo(e.palePpg, 3);
    expect(result.fermentables[1]?.ppg).toBeCloseTo(e.crystalPpg, 3);
    // 4.5 / 4.9 = 91.84 % of grist
    expect(result.fermentables[0]?.percentOfGrist).toBeCloseTo(91.8367, 3);
    expect(result.fermentables[1]?.percentOfGrist).toBeCloseTo(8.1633, 3);
  });

  it('computes the gravity waterfall', () => {
    expect(result.vitals.preBoilGravity).toBeCloseTo(e.preBoilGravity, SG);
    expect(result.vitals.og).toBeCloseTo(e.og, SG);
    expect(result.vitals.ogEquivalent).toBeCloseTo(e.og, SG);
    expect(result.vitals.originalExtractPlato).toBeCloseTo(e.originalExtractPlato, THREE_DP);
  });

  it('computes final gravity from the yeast midpoint', () => {
    expect(result.vitals.yeastAttenuationPercent).toBe(80);
    expect(result.vitals.fg).toBeCloseTo(e.fg, SG);
    expect(result.vitals.apparentAttenuationPercent).toBeCloseTo(80, 6);
  });

  it('computes both ABV formulas', () => {
    expect(result.vitals.abvSimple).toBeCloseTo(e.abvSimple, THREE_DP);
    expect(result.vitals.abvAdvanced).toBeCloseTo(e.abvAdvanced, THREE_DP);
    expect(result.vitals.abv).toBe(result.vitals.abvAdvanced);
  });

  it('computes per-addition and total bitterness', () => {
    for (const [index, expected] of e.ibuByAddition.entries()) {
      expect(result.hops[index]?.ibu, `hop ${index}`).toBeCloseTo(expected, THREE_DP);
    }
    expect(result.vitals.ibu).toBeCloseTo(e.ibu, THREE_DP);
    expect(result.vitals.buGu).toBeCloseTo(e.buGu, 3);
  });

  it('computes colour', () => {
    expect(result.vitals.mcu).toBeCloseTo(e.mcu, THREE_DP);
    expect(result.vitals.srm).toBeCloseTo(e.srm, THREE_DP);
    expect(result.vitals.ebc).toBeCloseTo(e.ebc, THREE_DP);
    expect(result.vitals.colorHex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('computes efficiency, calories and strike temperature', () => {
    expect(result.vitals.mashEfficiencyPercent).toBe(75);
    expect(result.vitals.brewhouseEfficiencyPercent).toBeCloseTo(e.brewhouseEfficiencyPercent, 2);
    expect(result.vitals.realExtractPlato).toBeCloseTo(e.realExtractPlato, THREE_DP);
    expect(result.vitals.caloriesPer12UsFlOz).toBeCloseTo(e.caloriesPer12UsFlOz, 1);
    expect(result.strikeTemperatureC).toBeCloseTo(e.strikeTemperatureC, 2);
  });

  it('raises no warnings', () => {
    expect(result.warnings).toEqual([]);
  });
});

describe('reference recipe B — extract milk stout', () => {
  const result = calculateRecipe(REFERENCE_RECIPE_B, REFERENCE_EQUIPMENT);
  const e = REFERENCE_B_EXPECTED;

  it('plans the volume waterfall with only steeped grain absorbing', () => {
    expect(result.volumes.strikeWaterL).toBeCloseTo(e.strikeWaterL, 6);
    expect(result.volumes.spargeWaterL).toBeCloseTo(e.spargeWaterL, 6);
    expect(result.volumes.preBoilVolumeL).toBeCloseTo(e.preBoilVolumeL, 6);
    expect(result.volumes.postBoilVolumeL).toBeCloseTo(e.postBoilVolumeL, 6);
    expect(result.volumes.packagedVolumeL).toBeCloseTo(e.packagedVolumeL, 6);
    // 0.8 kg of steeped grain, not the 4.3 kg of total "grist"
    expect(result.volumes.grainAbsorptionL).toBeCloseTo(0.8, 9);
  });

  it('gives extract and lactose 100 % efficiency and steeped grain 50 %', () => {
    expect(result.fermentables[0]?.efficiencyPercent).toBe(100);
    expect(result.fermentables[1]?.efficiencyPercent).toBe(50);
    expect(result.fermentables[2]?.efficiencyPercent).toBe(50);
    expect(result.fermentables[3]?.efficiencyPercent).toBe(100);
  });

  it('puts the extract in at the boil, not the mash', () => {
    expect(result.fermentables[0]?.stage).toBe('boil');
    expect(result.fermentables[1]?.stage).toBe('pre-boil');
    expect(result.vitals.preBoilGravity).toBeCloseTo(e.preBoilGravity, SG);
    expect(result.vitals.og).toBeCloseTo(e.og, SG);
  });

  it('leaves lactose in the finished beer', () => {
    expect(result.vitals.yeastAttenuationPercent).toBe(72);
    expect(result.vitals.apparentAttenuationPercent).toBeCloseTo(
      e.netApparentAttenuationPercent,
      1,
    );
    expect(result.vitals.fg).toBeCloseTo(e.fg, SG);
    // Without the lactose handling this would finish near 1.018.
    expect(result.vitals.fg).toBeGreaterThan(1.02);
  });

  it('computes ABV, bitterness and colour', () => {
    expect(result.vitals.abvAdvanced).toBeCloseTo(e.abvAdvanced, THREE_DP);
    expect(result.vitals.ibu).toBeCloseTo(e.ibu, THREE_DP);
    expect(result.vitals.mcu).toBeCloseTo(e.mcu, THREE_DP);
    expect(result.vitals.srm).toBeCloseTo(e.srm, THREE_DP);
  });

  it('credits the first-wort hop with a full boil plus the bonus', () => {
    expect(result.hops[0]?.effectiveBoilMinutes).toBe(60);
    expect(result.hops[0]?.notes.join(' ')).toMatch(/First-wort hop/);
  });
});

describe('explanations', () => {
  const result = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT);

  it('explains every headline number', () => {
    for (const key of [
      'preBoilGravity',
      'og',
      'fg',
      'abv',
      'ibu',
      'srm',
      'buGu',
      'calories',
      'brewhouseEfficiency',
      'volumes',
    ]) {
      expect(result.explain[key], `missing explanation for ${key}`).toBeDefined();
    }
  });

  it('names the formula that actually ran', () => {
    expect(result.explain.ibu?.formula).toBe('tinseth-1997');
    expect(result.explain.srm?.formula).toBe('morey-1999');
    expect(result.explain.abv?.formula).toBe('abv-cutaia-1995');
  });

  it('switches the cited formula with the option', () => {
    const rager = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT, {
      ibuFormula: 'rager',
      colorFormula: 'mosher',
      abvFormula: 'simple',
    });
    expect(rager.explain.ibu?.formula).toBe('rager-1990');
    expect(rager.explain.srm?.formula).toBe('mosher-1994');
    expect(rager.explain.abv?.formula).toBe('abv-simple-131.25');
    expect(rager.vitals.abv).toBe(rager.vitals.abvSimple);
  });

  it('carries the value it explains', () => {
    expect(result.explain.og?.value).toBe(result.vitals.og);
    expect(result.explain.ibu?.value).toBe(result.vitals.ibu);
    expect(result.explain.srm?.value).toBe(result.vitals.srm);
    expect(result.explain.calories?.value).toBe(result.vitals.caloriesPer12UsFlOz);
  });

  it('records the inputs that produced the number', () => {
    expect(result.explain.ibu?.inputs.whirlpoolModel).toBe('mibu');
    expect(result.explain.ibu?.inputs.volumeBasis).toBe('post-boil');
    expect(result.explain.srm?.inputs.mcu).toBeCloseTo(14.53, 1);
  });

  it('writes the formula out', () => {
    expect(result.explain.srm?.expression).toBe('SRM = 1.4922 × MCU^0.6859');
  });

  it('notes when the net attenuation differs from the yeast figure', () => {
    const stout = calculateRecipe(REFERENCE_RECIPE_B, REFERENCE_EQUIPMENT);
    expect(stout.explain.fg?.notes?.join(' ')).toMatch(/differs from the yeast/);
  });

  it('notes the fermenter addition in the OG explanation', () => {
    const recipe: RecipeInput = {
      ...REFERENCE_RECIPE_A,
      fermentables: [
        ...REFERENCE_RECIPE_A.fermentables,
        {
          name: 'Dextrose (fermenter)',
          amountKg: 0.3,
          class: 'sugar',
          use: 'fermenter',
          ppg: 46.214,
          colorLovibond: 0,
        },
      ],
    };
    const withSugar = calculateRecipe(recipe, REFERENCE_EQUIPMENT);
    expect(withSugar.vitals.ogEquivalent).toBeGreaterThan(withSugar.vitals.og);
    expect(withSugar.explain.og?.notes?.join(' ')).toMatch(/OG-equivalent/);
  });
});

/**
 * What the bitterness explanation says about whirlpool stands.
 *
 * The formula, the volume and the model name don't show where a whirlpool
 * addition's IBU came from. The per-addition notes do, with one line per
 * stand and the dry-hop line after them.
 */
describe('the working behind a whirlpool addition', () => {
  const stand = (
    name: string,
    whirlpoolTempC: number,
    whirlpoolEndTempC?: number,
  ): NonNullable<RecipeInput['hops']>[number] => ({
    name,
    amountKg: 0.04,
    alphaAcidPercent: 6,
    form: 'pellet',
    use: 'whirlpool',
    timeMinutes: 20,
    whirlpoolTempC,
    ...(whirlpoolEndTempC === undefined ? {} : { whirlpoolEndTempC }),
  });

  it('shows one line per stand, in recipe order, above the dry-hop line', () => {
    const result = calculateRecipe(
      {
        ...REFERENCE_RECIPE_A,
        hops: [
          { ...REFERENCE_RECIPE_A.hops[0], name: 'Magnum' } as (typeof REFERENCE_RECIPE_A.hops)[0],
          stand('Cascade', 85, 70),
          stand('Citra', 75, 75),
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    const notes = result.explain.ibu?.notes ?? [];

    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/^Cascade, 20 min from 85 °C to 70 °C: worth /);
    expect(notes[1]).toMatch(/^Citra, 20 min held at 75 °C: worth /);
    expect(notes[2]).toBe('Dry hops contribute 0 IBU.');
  });

  it('says nothing about a recipe with no stand in it', () => {
    const result = calculateRecipe(
      { ...REFERENCE_RECIPE_A, hops: [REFERENCE_RECIPE_A.hops[0]] as RecipeInput['hops'] },
      REFERENCE_EQUIPMENT,
    );
    expect(result.explain.ibu?.notes).toEqual(['Dry hops contribute 0 IBU.']);
  });
});

/**
 * The mash schedule always affects final gravity. There's no option to enable.
 *
 * Every expectation below is recipe A's own arithmetic with one number changed:
 * OE = 12.4412 °P (see the fixture), the grist is all grain so the net apparent
 * attenuation equals the yeast's, and the yeast's 80 % midpoint moves by
 * 1.2 points per °C away from 66.7 °C.
 *
 * ```
 * 63.0 °C  → 80 + 3.7000 × 1.2 = 84.44 % → AE = 1.93585 °P → FG = 1.00755
 * 69.0 °C  → 80 − 2.3000 × 1.2 = 77.24 % → AE = 2.83162 °P → FG = 1.01107
 * 65.3333  → 80 + 1.3667 × 1.2 = 81.64 % → AE = 2.28420 °P → FG = 1.00891
 * ```
 */
describe('mash schedule and final gravity', () => {
  const withMash = (mashSteps: NonNullable<RecipeInput['mashSteps']>): RecipeInput => ({
    ...REFERENCE_RECIPE_A,
    mashSteps,
  });
  const rest = (targetTempC: number, timeMinutes: number) => ({
    name: 'Rest',
    type: 'infusion' as const,
    targetTempC,
    timeMinutes,
  });

  it('finishes drier from a cool mash than a warm one', () => {
    const cool = calculateRecipe(withMash([rest(63, 60)]), REFERENCE_EQUIPMENT);
    const warm = calculateRecipe(withMash([rest(69, 60)]), REFERENCE_EQUIPMENT);

    expect(cool.vitals.yeastAttenuationPercent).toBeCloseTo(84.44, 6);
    expect(cool.vitals.fg).toBeCloseTo(1.00755, SG);
    expect(cool.vitals.apparentAttenuationPercent).toBeCloseTo(84.44, 1);

    expect(warm.vitals.yeastAttenuationPercent).toBeCloseTo(77.24, 6);
    expect(warm.vitals.fg).toBeCloseTo(1.01107, SG);
    expect(warm.vitals.apparentAttenuationPercent).toBeCloseTo(77.24, 1);

    expect(cool.vitals.fg).toBeLessThan(warm.vitals.fg);
    expect(cool.vitals.abv).toBeGreaterThan(warm.vitals.abv);
  });

  it('reads a step mash as the duration-weighted mean of its rests', () => {
    // 52 °C protein rest and 76 °C mash-out convert nothing and are excluded;
    // what is left is 62 × 40 + 72 × 20 over 60 minutes = 65.3333 °C.
    const result = calculateRecipe(
      withMash([rest(52, 20), rest(62, 40), rest(72, 20), rest(76, 10)]),
      REFERENCE_EQUIPMENT,
    );
    expect(result.vitals.yeastAttenuationPercent).toBeCloseTo(81.64, 6);
    expect(result.vitals.fg).toBeCloseTo(1.00891, SG);
    // Strike water still targets the first rest, not the weighted mean:
    // 52 + (0.4 / 3.0) × (52 − 20) = 56.267 °C.
    expect(result.strikeTemperatureC).toBeCloseTo(56.267, 2);
  });

  it('leaves the yeast figure alone when there is no mash to read', () => {
    const noMash = calculateRecipe(withMash([]), REFERENCE_EQUIPMENT);
    expect(noMash.vitals.yeastAttenuationPercent).toBe(80);
    expect(noMash.vitals.fg).toBeCloseTo(REFERENCE_A_EXPECTED.fg, SG);
    // Recipe B is the real extract case: no mash steps at all, 72 % untouched.
    expect(
      calculateRecipe(REFERENCE_RECIPE_B, REFERENCE_EQUIPMENT).vitals.yeastAttenuationPercent,
    ).toBe(72);
  });

  it('lets the attenuation override beat the mash temperature', () => {
    const result = calculateRecipe(withMash([rest(63, 60)]), REFERENCE_EQUIPMENT, {
      attenuationOverridePercent: 75,
    });
    expect(result.vitals.yeastAttenuationPercent).toBe(75);
  });
});

describe('option plumbing', () => {
  it('changes IBU when the whirlpool model changes', () => {
    const mibu = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT).vitals.ibu;
    const none = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT, {
      whirlpool: { model: 'none' },
    }).vitals.ibu;
    const fixed = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT, {
      whirlpool: { model: 'fixed-temperature' },
    }).vitals.ibu;
    expect(none).toBeLessThan(mibu);
    expect(mibu).toBeLessThan(fixed);
  });

  it('changes IBU when the gravity basis changes', () => {
    const postBoil = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT).vitals.ibu;
    const average = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT, {
      bitternessGravityBasis: 'average-boil',
    }).vitals.ibu;
    // A lower average boil gravity means less suppression, so more bitterness.
    expect(average).toBeGreaterThan(postBoil);
  });

  it('accepts a partial equipment profile and fills the rest', () => {
    const result = calculateRecipe(REFERENCE_RECIPE_A, { mashEfficiencyPercent: 68 });
    expect(result.vitals.mashEfficiencyPercent).toBe(68);
    expect(result.volumes.packagedVolumeL).toBeGreaterThan(0);
  });

  it('accepts no equipment at all', () => {
    const result = calculateRecipe(REFERENCE_RECIPE_A);
    expect(result.vitals.og).toBeGreaterThan(1);
  });

  it('honours an attenuation override', () => {
    const result = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT, {
      attenuationOverridePercent: 90,
    });
    expect(result.vitals.yeastAttenuationPercent).toBe(90);
    expect(result.vitals.fg).toBeLessThan(
      calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT).vitals.fg,
    );
  });
});

describe('a decoction mash', () => {
  /** Reference recipe A's grist and hops, remashed as a double decoction. */
  const decocted: RecipeInput = {
    ...REFERENCE_RECIPE_A,
    mashSteps: [
      { name: 'Protein', type: 'infusion', targetTempC: 52, timeMinutes: 15 },
      { name: 'Saccharification', type: 'decoction', targetTempC: 64, timeMinutes: 40 },
      { name: 'Mash-out', type: 'decoction', targetTempC: 76, timeMinutes: 10 },
    ],
  };
  const result = calculateRecipe(decocted, REFERENCE_EQUIPMENT);

  it('sizes every pull in the schedule', () => {
    expect(result.decoctions?.pulls).toHaveLength(2);
    for (const pull of result.decoctions?.pulls ?? []) {
      expect(pull.pullVolumeL).toBeGreaterThan(0);
      expect(pull.pullGrainKg).toBeGreaterThan(0);
    }
  });

  it('lands each pull on the rest it was sized for', () => {
    const pulls = result.decoctions?.pulls ?? [];
    expect(pulls[0]?.achievedTempC).toBeCloseTo(64, 6);
    expect(pulls[1]?.achievedTempC).toBeCloseTo(76, 6);
  });

  it('starts the first pull from the rest the strike water landed on', () => {
    // The protein rest is an infusion, so the 64 °C pull is sized from 52 °C.
    // `stepIndex` is the rest's position in the full schedule (1, the
    // saccharification step), not its position in a list of decoctions only.
    expect(result.decoctions?.pulls.map((p) => p.stepIndex)).toEqual([1, 2]);
    expect(result.strikeTemperatureC).toBeGreaterThan(52);
  });

  it('makes the brewer measure out the water the pots will boil away', () => {
    const infused = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT);
    const evaporated = result.decoctions?.totalEvaporationL ?? 0;
    expect(evaporated).toBeCloseTo(1.0, 9); // 2 pulls × 20 min at 1.5 L/h
    expect(result.volumes.decoctionEvaporationL).toBeCloseTo(evaporated, 9);
    expect(result.volumes.totalWaterL).toBeCloseTo(infused.volumes.totalWaterL + evaporated, 9);
    // The packaged volume is unchanged.
    expect(result.volumes.packagedVolumeL).toBeCloseTo(infused.volumes.packagedVolumeL, 9);
  });

  it('costs the brew day, and says how much', () => {
    expect(result.decoctions?.addedBrewDayMinutes).toBeGreaterThan(60);
  });

  it('leaves an infusion mash with no decoction section at all', () => {
    expect(calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT).decoctions).toBeUndefined();
  });

  it('surfaces an impossible pull on the warnings rail', () => {
    const impossible = calculateRecipe(
      {
        ...decocted,
        mashSteps: [
          { name: 'Protein', type: 'infusion', targetTempC: 52, timeMinutes: 15 },
          { name: 'Too far', type: 'decoction', targetTempC: 99, timeMinutes: 10 },
        ],
      },
      REFERENCE_EQUIPMENT,
    );
    expect(impossible.warnings.some((w) => w.startsWith('Decoction 1:'))).toBe(true);
  });

  it('says nothing on the rail about a schedule that works', () => {
    expect(result.warnings.some((w) => w.startsWith('Decoction'))).toBe(false);
  });
});

/**
 * A keg hop is weighed like a dry hop and soaks up beer like one, so the
 * waterfall charges its loss after the kettle, not before.
 */
describe('keg hops in the volume waterfall', () => {
  const withHop = (use: 'boil' | 'dry-hop' | 'keg'): RecipeInput => ({
    ...REFERENCE_RECIPE_A,
    hops: [
      ...REFERENCE_RECIPE_A.hops,
      {
        name: 'Citra',
        amountKg: 0.05,
        alphaAcidPercent: 12,
        form: 'pellet',
        use,
        timeMinutes: 0,
      },
    ],
  });

  it('costs beer after the kettle and not in it', () => {
    const plain = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT);
    const keg = calculateRecipe(withHop('keg'), REFERENCE_EQUIPMENT);
    const dry = calculateRecipe(withHop('dry-hop'), REFERENCE_EQUIPMENT);

    expect(keg.volumes.kettleHopAbsorptionL).toBeCloseTo(plain.volumes.kettleHopAbsorptionL, 9);
    expect(keg.volumes.dryHopAbsorptionL).toBeCloseTo(dry.volumes.dryHopAbsorptionL, 9);
    expect(keg.volumes.packagedVolumeL).toBeCloseTo(dry.volumes.packagedVolumeL, 9);
    expect(keg.volumes.packagedVolumeL).toBeLessThan(plain.volumes.packagedVolumeL);
  });
});
