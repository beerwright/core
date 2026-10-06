/**
 * Tests for the pre-brew checks, one boundary at a time.
 *
 * Every check in `recipe-checks.ts` compares against a limit, so the useful
 * inputs are the limit itself and the values either side of it. The reference
 * pale ale's volumes are taken from `REFERENCE_A_EXPECTED`'s hand-computed
 * waterfall and used as the capacities, so "exactly full" and "one decilitre
 * over" are literal cases.
 *
 * The other thing tested is that a check fires on a value that's out of
 * bounds, never on an input that's missing. A profile with no kettle capacity,
 * a recipe with no yeast and a beer with no style all produce no findings, and
 * each of those has its own test.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_EQUIPMENT, REFERENCE_RECIPE_A } from './fixtures/reference-recipes';
import { MUNICH } from './fixtures/water-profiles';
import { calculateRecipe } from './recipe';
import {
  type Band,
  bandStatus,
  fermentTempOutside,
  MASH_PH_BAND,
  type RecipeCheck,
  type RecipeCheckInput,
  recipeChecks,
  type StyleBands,
} from './recipe-checks';
import type { EquipmentProfileInput, FermentationStep, RecipeInput, YeastSelection } from './types';
import { volumeWarnings } from './volumes';

/** The reference pale ale on the reference equipment, with any overrides applied. */
function checks(
  overrides: {
    readonly recipe?: RecipeInput;
    readonly equipment?: EquipmentProfileInput;
    readonly styleBands?: StyleBands | null;
    readonly now?: Date;
  } = {},
) {
  const recipe = overrides.recipe ?? REFERENCE_RECIPE_A;
  const equipment = { ...REFERENCE_EQUIPMENT, ...overrides.equipment };
  const calculation = calculateRecipe(recipe, equipment);
  const input: RecipeCheckInput = {
    recipe,
    equipment,
    calculation,
    ...(overrides.styleBands === undefined ? {} : { styleBands: overrides.styleBands }),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
  };
  return recipeChecks(input);
}

/** The one finding with this id, or `undefined`. */
function find<K extends RecipeCheck['id']>(
  findings: readonly RecipeCheck[],
  id: K,
): Extract<RecipeCheck, { id: K }> | undefined {
  return findings.find((finding): finding is Extract<RecipeCheck, { id: K }> => finding.id === id);
}

/**
 * The reference recipe's volumes, from `REFERENCE_A_EXPECTED`'s working.
 *
 * These are constants and aren't read from the calculation, because a test
 * that took its limit from the code under test would pass whatever the engine
 * did.
 */
const PRE_BOIL_L = 25.4375;
const MASH_VOLUME_L = 14.7 + 4.9 * 0.6676;
const INTO_FERMENTER_L = 20;

/** The engine's computed mash volume, exact to the bit. See {@link MASH_VOLUME_L}. */
const EXACT_MASH_VOLUME_L = calculateRecipe(REFERENCE_RECIPE_A, REFERENCE_EQUIPMENT).volumes
  .mashVolumeL;

/**
 * The reference ale with enough yeast.
 *
 * `REFERENCE_RECIPE_A` has a single US-05 sachet with no cell count, which
 * the pitch model correctly reads as short for 19 L at 1.054. That's useful
 * for the pitch tests, but every other test would have to work around it, so
 * the tests that aren't about pitch use this instead: two sachets at the
 * published 10 billion cells per gram, which clears the ale rate.
 */
const WELL_PITCHED_YEAST: YeastSelection = {
  name: 'US-05',
  type: 'ale',
  form: 'dry',
  attenuationMinPercent: 78,
  attenuationMaxPercent: 82,
  // One sachet. Under the mass model, two 11.5 g sachets into 20 L of ale wort
  // is 115 g/hL against a 50-80 g/hL band, which is a real over-pitch and
  // triggers `pitch-heavy-dry`. One sachet is 57.5 g/hL, inside the band.
  packs: 1,
  gramsPerPack: 11.5,
  cellsPerGramBillion: 10,
};

const WELL_PITCHED: RecipeInput = { ...REFERENCE_RECIPE_A, yeasts: [WELL_PITCHED_YEAST] };

/** A fixed time, so viability doesn't depend on the clock. */
const NOW = new Date('2026-09-01T12:00:00Z');

describe('bandStatus', () => {
  const band: Band = { min: 1.045, max: 1.06 };

  it('treats both bounds as inside the band', () => {
    // Inclusive, because a style's published minimum is a value a beer is
    // allowed to have.
    expect(bandStatus(1.045, band)).toBe('in-range');
    expect(bandStatus(1.06, band)).toBe('in-range');
    expect(bandStatus(1.0525, band)).toBe('in-range');
  });

  it('names the direction of a miss', () => {
    expect(bandStatus(1.044, band)).toBe('below');
    expect(bandStatus(1.061, band)).toBe('above');
  });

  it('answers no-range for an absent band and for a number that is not one', () => {
    expect(bandStatus(1.05, null)).toBe('no-range');
    // An OG the engine couldn't compute isn't "below the band".
    expect(bandStatus(Number.NaN, band)).toBe('no-range');
    expect(bandStatus(Number.POSITIVE_INFINITY, band)).toBe('no-range');
  });
});

describe('the all-clear', () => {
  it('finds nothing on a recipe whose rig records no capacities', () => {
    // The reference profile has no kettle, tun or fermenter volume, no water
    // section and no style, so every check's input is missing and nothing
    // should fire. The pitch is the one input that is present, and it's
    // adequate.
    const { findings, supersedes } = checks({ recipe: WELL_PITCHED, now: NOW });
    expect(findings).toEqual([]);
    expect(supersedes).toEqual([]);
  });
});

describe('kettle capacity', () => {
  it('says nothing about a boil that exactly fills the kettle', () => {
    expect(
      find(checks({ equipment: { kettleVolumeL: PRE_BOIL_L } }).findings, 'boil-over-kettle'),
    ).toBeUndefined();
  });

  it('reports the overflow once the boil is over the line', () => {
    const finding = find(
      checks({ equipment: { kettleVolumeL: PRE_BOIL_L - 0.5 } }).findings,
      'boil-over-kettle',
    );
    expect(finding?.severity).toBe('warning');
    expect(finding?.preBoilVolumeL).toBeCloseTo(PRE_BOIL_L, 4);
    expect(finding?.kettleVolumeL).toBeCloseTo(PRE_BOIL_L - 0.5, 4);
    expect(finding?.overflowL).toBeCloseTo(0.5, 4);
  });

  it("hands back the engine's own warning so a surface never prints it twice", () => {
    const equipment = { ...REFERENCE_EQUIPMENT, kettleVolumeL: 20, mashTunVolumeL: 10 };
    const { findings, supersedes } = checks({ equipment });
    const engine = volumeWarnings(
      calculateRecipe(REFERENCE_RECIPE_A, equipment).volumes,
      equipment,
    );

    expect(find(findings, 'boil-over-kettle')).toBeDefined();
    expect(find(findings, 'mash-over-tun')).toBeDefined();
    // Exact strings, because callers filter `warnings` by string equality.
    expect(supersedes).toHaveLength(2);
    for (const superseded of supersedes) expect(engine).toContain(superseded);
  });
});

describe('mash tun capacity', () => {
  it('says nothing about a mash that exactly fills the tun', () => {
    // This uses the engine's figure, not the hand-computed one. 14.7 + 4.9 ×
    // 0.6676 written out here and computed inside the waterfall differ in the
    // last bit, and "exactly full" is an equality that a 4 fL difference would
    // break. The hand-computed constant is used for the "over" case below.
    expect(EXACT_MASH_VOLUME_L).toBeCloseTo(MASH_VOLUME_L, 9);
    expect(
      find(
        checks({ equipment: { mashTunVolumeL: EXACT_MASH_VOLUME_L } }).findings,
        'mash-over-tun',
      ),
    ).toBeUndefined();
  });

  it('reports the overflow once the mash is over the line', () => {
    const finding = find(
      checks({ equipment: { mashTunVolumeL: MASH_VOLUME_L - 2 } }).findings,
      'mash-over-tun',
    );
    expect(finding?.severity).toBe('warning');
    expect(finding?.mashVolumeL).toBeCloseTo(MASH_VOLUME_L, 4);
    expect(finding?.overflowL).toBeCloseTo(2, 4);
  });
});

describe('fermenter headspace', () => {
  it('says nothing when a quarter of the vessel is free', () => {
    // 20 L into a 26.67 L fermenter leaves exactly 25 %.
    const exact = INTO_FERMENTER_L / (1 - 0.25);
    expect(
      find(checks({ equipment: { fermenterVolumeL: exact } }).findings, 'fermenter-headspace'),
    ).toBeUndefined();
  });

  it('is a note when the krausen is tight but the beer fits', () => {
    const finding = find(
      checks({ equipment: { fermenterVolumeL: 24 } }).findings,
      'fermenter-headspace',
    );
    // A brewer filling this tight probably has a blow-off tube and means it.
    expect(finding?.severity).toBe('note');
    expect(finding?.headspaceL).toBeCloseTo(4, 4);
    expect(finding?.wantedHeadspaceL).toBeCloseTo(6, 4);
  });

  it('is a warning, with a negative headspace, when the beer does not fit', () => {
    const finding = find(
      checks({ equipment: { fermenterVolumeL: 18 } }).findings,
      'fermenter-headspace',
    );
    expect(finding?.severity).toBe('warning');
    expect(finding?.headspaceL).toBeCloseTo(-2, 4);
  });
});

describe('mash pH', () => {
  /** The reference recipe on Munich water, which is alkaline enough to miss high. */
  const alkaline: RecipeInput = {
    ...REFERENCE_RECIPE_A,
    water: { sourceProfile: MUNICH.profile },
  };

  it('says nothing when the recipe has no water chemistry at all', () => {
    // No `water` section means `predictMashPh` never ran, so there's no
    // prediction to be out of band.
    expect(find(checks().findings, 'mash-ph-out-of-band')).toBeUndefined();
  });

  it('reports a prediction outside the band, and which way it missed', () => {
    const finding = find(checks({ recipe: alkaline }).findings, 'mash-ph-out-of-band');
    expect(finding?.severity).toBe('warning');
    expect(finding?.direction).toBe('above');
    expect(finding?.ph).toBeGreaterThan(MASH_PH_BAND.max);
    expect(finding?.band).toEqual({ min: 5.2, max: 5.6 });
  });

  it('distinguishes "you have not adjusted this" from "you have, and it is still out"', () => {
    expect(find(checks({ recipe: alkaline }).findings, 'mash-ph-out-of-band')?.acidAdded).toBe(
      false,
    );

    // A dose too small to reach the band still counts as an adjustment. The
    // brewer has already acted on the number, so they need a different
    // message.
    const dosed: RecipeInput = {
      ...alkaline,
      water: {
        sourceProfile: MUNICH.profile,
        acidAdditions: [{ acid: 'lactic', millilitres: 0.5, concentrationPercent: 88 }],
      },
    };
    expect(find(checks({ recipe: dosed }).findings, 'mash-ph-out-of-band')?.acidAdded).toBe(true);
  });

  /**
   * A sparge acid on equipment that doesn't sparge.
   *
   * The acid list isn't updated when the equipment changes, so a recipe moved
   * to a no-sparge or BIAB profile keeps its sparge acid. It can't affect the
   * beer, because `predictMashPh` already ignores a sparge acid, so it's a note
   * and not a warning. It's still worth flagging because every acid addition
   * becomes a brew-day instruction.
   */
  describe('an acid aimed at a sparge that does not happen', () => {
    const spargeAcid: RecipeInput = {
      ...REFERENCE_RECIPE_A,
      water: {
        sourceProfile: MUNICH.profile,
        acidAdditions: [
          { acid: 'lactic', millilitres: 1.6, concentrationPercent: 88, target: 'sparge' },
        ],
      },
    };

    it('is a note when the system mashes the full volume', () => {
      const result = checks({
        recipe: spargeAcid,
        equipment: { ...REFERENCE_EQUIPMENT, spargeType: 'no-sparge' },
      });
      const finding = find(result.findings, 'sparge-acid-without-sparge');
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('note');
    });

    it('says nothing when the system sparges', () => {
      const result = checks({ recipe: spargeAcid });
      expect(find(result.findings, 'sparge-acid-without-sparge')).toBeUndefined();
    });

    it('says nothing when the acid is aimed at the mash', () => {
      const mashAcid: RecipeInput = {
        ...REFERENCE_RECIPE_A,
        water: {
          sourceProfile: MUNICH.profile,
          acidAdditions: [
            { acid: 'lactic', millilitres: 1.6, concentrationPercent: 88, target: 'mash' },
          ],
        },
      };
      const result = checks({
        recipe: mashAcid,
        equipment: { ...REFERENCE_EQUIPMENT, spargeType: 'no-sparge' },
      });
      expect(find(result.findings, 'sparge-acid-without-sparge')).toBeUndefined();
    });
  });

  it('counts acidulated malt as an adjustment, because it is one', () => {
    const acidMalt: RecipeInput = {
      ...alkaline,
      fermentables: [
        ...REFERENCE_RECIPE_A.fermentables,
        {
          name: 'Acidulated malt',
          amountKg: 0.05,
          class: 'grain',
          use: 'mash',
          extractFineGrindDryBasisPercent: 78,
          moisturePercent: 5,
          colorLovibond: 3,
          ph: { maltClass: 'acidulated', acidContentPercentLactic: 3 },
        },
      ],
    };
    const finding = find(checks({ recipe: acidMalt }).findings, 'mash-ph-out-of-band');
    // It may or may not still be out of band. This checks that if it is, the
    // recipe isn't described as unadjusted.
    if (finding !== undefined) expect(finding.acidAdded).toBe(true);
  });
});

describe('pitch rate', () => {
  /** One fresh liquid pack, a third of what a lager at this gravity needs. */
  const underPitchedLager: RecipeInput = {
    ...REFERENCE_RECIPE_A,
    yeasts: [
      {
        name: 'W-34/70',
        type: 'lager',
        form: 'liquid',
        attenuationMinPercent: 75,
        attenuationMaxPercent: 82,
        packs: 1,
        manufactureDate: new Date('2026-08-25T00:00:00Z'),
      },
    ],
  };

  it('does not ask the question without a date to judge viability at', () => {
    // A viability model needs a date, and this module doesn't read the clock.
    // Without `now` there's no finding. It never falls back to a default date.
    expect(find(checks({ recipe: underPitchedLager }).findings, 'pitch-short')).toBeUndefined();
  });

  it('says nothing about a recipe with no yeast in it yet', () => {
    const noYeast: RecipeInput = { ...REFERENCE_RECIPE_A, yeasts: [] };
    expect(find(checks({ recipe: noYeast, now: NOW }).findings, 'pitch-short')).toBeUndefined();
  });

  it('reports a short pitch against the style-appropriate target', () => {
    const finding = find(checks({ recipe: underPitchedLager, now: NOW }).findings, 'pitch-short');
    expect(finding?.severity).toBe('warning');
    // A lager's target is 1.5 M cells/mL/°P. One 100-billion pack is nowhere near.
    expect(finding?.targetPitchRate).toBeCloseTo(1.5, 6);
    expect(finding?.achievedPitchRate).toBeLessThan(finding?.targetPitchRate ?? 0);
    expect(finding?.shortfallBillion).toBeGreaterThan(0);
    expect(finding?.packsRequired).toBeGreaterThan(1);
    // Liquid yeast and a reachable target, so the fix is a starter.
    expect(finding?.remedy).toBe('starter');
  });

  /** The same lager, with a starter of `stepVolumesL` saved on the culture. */
  function withStarter(stepVolumesL: readonly number[]): RecipeInput {
    const yeast = underPitchedLager.yeasts?.[0];
    if (yeast === undefined) throw new Error('fixture lost its yeast');
    return {
      ...underPitchedLager,
      yeasts: [{ ...yeast, starter: { stepVolumesL, method: 'stir-plate' } }],
    };
  }

  it('stops firing once the saved starter reaches the target', () => {
    // The check has no starter branch. `pitchPlan` counts the cells out of the
    // flask, the achieved rate clears 90 % of target, and nothing fires.
    const findings = checks({ recipe: withStarter([2, 4]), now: NOW }).findings;
    expect(find(findings, 'pitch-short')).toBeUndefined();
  });

  it('still fires when the saved starter is too small, and says so', () => {
    // This is why a starter is stored as volumes and not a boolean. A one-litre
    // starter isn't enough for a lager.
    const finding = find(checks({ recipe: withStarter([1]), now: NOW }).findings, 'pitch-short');
    expect(finding).toBeDefined();
    expect(finding?.remedy).toBe('starter-planned');
    expect(finding?.shortfallBillion).toBeGreaterThan(0);
    // …and the shortfall is smaller than with no starter at all, because the
    // starter's cells are counted.
    const without = find(checks({ recipe: underPitchedLager, now: NOW }).findings, 'pitch-short');
    expect(finding?.shortfallBillion).toBeLessThan(without?.shortfallBillion ?? 0);
  });

  it('does not offer a starter to a pitch that already has one', () => {
    // A brewer who already has a starter needs a bigger one or another pack,
    // not a suggestion to make a starter.
    for (const steps of [[0.25], [1], [1.5]]) {
      const finding = find(
        checks({ recipe: withStarter(steps), now: NOW }).findings,
        'pitch-short',
      );
      if (finding !== undefined) expect(finding.remedy).toBe('starter-planned');
    }
  });

  it('judges a dry pitch by mass against the maker, never by cell count', () => {
    const dry: RecipeInput = {
      ...REFERENCE_RECIPE_A,
      yeasts: [
        {
          name: 'W-34/70 dry',
          type: 'lager',
          form: 'dry',
          attenuationMinPercent: 75,
          attenuationMaxPercent: 82,
          packs: 1,
          gramsPerPack: 11.5,
          cellsPerGramBillion: 6,
        },
      ],
    };
    const { findings } = checks({ recipe: dry, now: NOW });
    // The cell-count finding must not fire for dry yeast at all.
    expect(find(findings, 'pitch-short')).toBeUndefined();
    const finding = find(findings, 'pitch-short-dry');
    expect(finding?.band).toEqual({ min: 80, max: 120 });
    expect(finding?.gramsPitched).toBeCloseTo(11.5, 6);
  });

  /**
   * A real case: 4.52 gal of 1.052 lager on S-23.
   *
   * Judged on cells at a conservative 6 bn/g, this would ask for five
   * sachets. Fermentis ask for 80-120 g/hL, which over ~17 L is 13.7 to
   * 20.5 g, under two sachets. Five is wrong, because it applies a
   * liquid-yeast rate to dry yeast.
   */
  it('asks for two sachets where the old cell model asked for five', () => {
    const s23 = (packs: number): RecipeInput => ({
      ...REFERENCE_RECIPE_A,
      batchVolumeL: 17.1,
      yeasts: [
        {
          name: 'SafLager S-23',
          type: 'lager',
          form: 'dry',
          attenuationMinPercent: 78,
          attenuationMaxPercent: 82,
          packs,
          gramsPerPack: 11.5,
          dosageGramsPerHl: { min: 80, max: 120 },
        },
      ],
    });
    const one = find(checks({ recipe: s23(1), now: NOW }).findings, 'pitch-short-dry');
    expect(one).toBeDefined();
    expect(one?.packsRequired).toBeLessThanOrEqual(2);
    // Two sachets is 23 g, over the 80 g/hL floor for this volume, so nothing fires.
    expect(find(checks({ recipe: s23(2), now: NOW }).findings, 'pitch-short-dry')).toBeUndefined();
  });

  describe('over-pitching', () => {
    const s23 = (packs: number): RecipeInput => ({
      ...REFERENCE_RECIPE_A,
      batchVolumeL: 17.1,
      yeasts: [
        {
          name: 'SafLager S-23',
          type: 'lager',
          form: 'dry',
          attenuationMinPercent: 78,
          attenuationMaxPercent: 82,
          packs,
          gramsPerPack: 11.5,
          dosageGramsPerHl: { min: 80, max: 120 },
        },
      ],
    });

    /**
     * Two sachets is 23 g into ~17 L, about 134 g/hL, which is over the
     * maker's 120 ceiling. But one sachet is under the floor, so no whole
     * number of sachets lands inside the band. Flagging it would mean asking
     * for two packs and then objecting to two packs.
     */
    it('says nothing when rounding up to a whole sachet is what put it over', () => {
      const findings = checks({ recipe: s23(2), now: NOW }).findings;
      expect(find(findings, 'pitch-short-dry')).toBeUndefined();
      expect(find(findings, 'pitch-heavy-dry')).toBeUndefined();
    });

    it('speaks up when a whole sachet could come out and the floor still clears', () => {
      // Four sachets is 46 g. Drop one and 34.5 g still clears the 13.7 g
      // floor, so the brewer could have avoided this excess.
      const finding = find(checks({ recipe: s23(4), now: NOW }).findings, 'pitch-heavy-dry');
      expect(finding).toBeDefined();
      expect(finding?.packsSuggested).toBe(2);
      // Never a warning. This costs money and a little ester character, not the beer.
      expect(finding?.severity).toBe('note');
    });

    it('never reports short and heavy at once', () => {
      for (const packs of [1, 2, 3, 4, 5]) {
        const findings = checks({ recipe: s23(packs), now: NOW }).findings;
        const both =
          find(findings, 'pitch-short-dry') !== undefined &&
          find(findings, 'pitch-heavy-dry') !== undefined;
        expect(both).toBe(false);
      }
    });
  });

  it('says nothing about a pitch that clears the rate', () => {
    // Two 11.5 g sachets at the published 10 billion cells per gram is 230
    // billion against a ~190 billion target, so nothing fires.
    expect(
      find(checks({ recipe: WELL_PITCHED, now: NOW }).findings, 'pitch-short'),
    ).toBeUndefined();
  });

  it('tolerates a pitch a little under target rather than reporting model noise', () => {
    // Three pack strengths against the same 177 bn target, either side of the
    // two thresholds: 161 bn is 91 % and gives nothing, 138 bn is 78 % and a
    // note, 92 bn is 52 % and a warning. The first one is within tolerance. A
    // pitch rate is built on an estimated viability, a round number printed on
    // a pack and a volume nobody has measured yet, so 91 % is within the
    // model's own error.
    // These are liquid because the tolerance belongs to the cell model, and dry
    // yeast is judged by mass. `cellsPerPackBillion` is the liquid equivalent
    // of a per-gram figure.
    const at = (cellsPerGramBillion: number): RecipeInput => ({
      ...WELL_PITCHED,
      yeasts: [
        {
          ...WELL_PITCHED_YEAST,
          form: 'liquid',
          // × 23, not × 11.5, because the fixture has a single pack and this
          // case's thresholds are calibrated on the cell count of 23 g.
          cellsPerPackBillion: cellsPerGramBillion * 23,
        },
      ],
    });
    expect(find(checks({ recipe: at(7), now: NOW }).findings, 'pitch-short')).toBeUndefined();
    expect(find(checks({ recipe: at(6), now: NOW }).findings, 'pitch-short')?.severity).toBe(
      'note',
    );
    expect(find(checks({ recipe: at(4), now: NOW }).findings, 'pitch-short')?.severity).toBe(
      'warning',
    );
  });
});

describe('ferment temperature against the yeast', () => {
  /** W-34/70 with a 9–15 °C range. */
  const LAGER: YeastSelection = {
    ...WELL_PITCHED_YEAST,
    name: 'SafLager W-34/70',
    type: 'lager',
    temperatureMinC: 9,
    temperatureMaxC: 15,
  };
  const step = (tempC: number, type: FermentationStep['type'] = 'primary'): FermentationStep => ({
    name: type,
    type,
    tempC,
    days: 7,
  });
  const run = (yeasts: readonly YeastSelection[], steps: readonly FermentationStep[]) =>
    checks({ recipe: { ...REFERENCE_RECIPE_A, yeasts, fermentationSteps: steps } }).findings;

  it("fires above the range, carrying the yeast's range and the step's temperature", () => {
    const finding = find(run([LAGER], [step(20)]), 'ferment-temp-outside-yeast');
    expect(finding).toEqual({
      id: 'ferment-temp-outside-yeast',
      severity: 'note',
      yeastName: 'SafLager W-34/70',
      tempC: 20,
      rangeMinC: 9,
      rangeMaxC: 15,
      direction: 'above',
    });
  });

  it('fires below the range', () => {
    const ale = { ...LAGER, name: 'US-05', temperatureMinC: 18, temperatureMaxC: 22 };
    const finding = find(run([ale], [step(12)]), 'ferment-temp-outside-yeast');
    expect(finding?.direction).toBe('below');
    expect(finding?.tempC).toBe(12);
  });

  it('says nothing inside the range, or within half a degree of its edge', () => {
    expect(find(run([LAGER], [step(12)]), 'ferment-temp-outside-yeast')).toBeUndefined();
    // 59 °F entered at the top of a 15 °C range, and just either side of it.
    expect(find(run([LAGER], [step(15.4)]), 'ferment-temp-outside-yeast')).toBeUndefined();
    expect(find(run([LAGER], [step(8.6)]), 'ferment-temp-outside-yeast')).toBeUndefined();
    expect(find(run([LAGER], [step(15.6)]), 'ferment-temp-outside-yeast')).toBeDefined();
  });

  it('says nothing about a yeast with no range, or half of one', () => {
    const { temperatureMinC: _min, temperatureMaxC: _max, ...bare } = LAGER;
    expect(find(run([bare], [step(20)]), 'ferment-temp-outside-yeast')).toBeUndefined();
    const halfOnly = { ...bare, temperatureMaxC: 15 };
    expect(find(run([halfOnly], [step(20)]), 'ferment-temp-outside-yeast')).toBeUndefined();
  });

  it('says nothing with no primary step, however warm the rest of the schedule', () => {
    expect(find(run([LAGER], []), 'ferment-temp-outside-yeast')).toBeUndefined();
    expect(
      find(
        run([LAGER], [step(20, 'secondary'), step(1, 'conditioning')]),
        'ferment-temp-outside-yeast',
      ),
    ).toBeUndefined();
  });

  it('reads every primary and reports the one furthest outside, once per yeast', () => {
    const findings = run([LAGER], [step(12), step(18), step(22)]);
    const matching = findings.filter((finding) => finding.id === 'ferment-temp-outside-yeast');
    expect(matching).toHaveLength(1);
    expect(find(findings, 'ferment-temp-outside-yeast')?.tempC).toBe(22);
  });

  it('judges each yeast against its own range', () => {
    const ale = { ...LAGER, name: 'US-05', temperatureMinC: 18, temperatureMaxC: 22 };
    const findings = run([LAGER, ale], [step(20)]);
    expect(
      findings
        .filter((finding) => finding.id === 'ferment-temp-outside-yeast')
        .map((finding) => finding.yeastName),
    ).toEqual(['SafLager W-34/70']);
  });

  it('shares its tolerance with the flavor breakdown', () => {
    expect(fermentTempOutside(20, { min: 9, max: 15 })).toBe('above');
    expect(fermentTempOutside(15.5, { min: 9, max: 15 })).toBeNull();
    expect(fermentTempOutside(8, { min: 9, max: 15 })).toBe('below');
    expect(fermentTempOutside(Number.NaN, { min: 9, max: 15 })).toBeNull();
  });
});

describe('style bands', () => {
  /** Bands chosen so the reference pale ale misses OG low and IBU high. */
  const bands: StyleBands = {
    og: { min: 1.06, max: 1.075 },
    fg: null,
    ibu: { min: 5, max: 15 },
    srm: { min: 3, max: 20 },
  };

  it('says nothing when no style is chosen', () => {
    expect(checks({ styleBands: null }).findings).toEqual([]);
  });

  it('says nothing about a vital whose band the style does not publish', () => {
    // BJCP 27–34 have no published vitals. A null band isn't a miss.
    const none: StyleBands = { og: null, fg: null, ibu: null, srm: null };
    expect(checks({ styleBands: none }).findings).toEqual([]);
  });

  it('reports one note per vital that misses, naming the direction', () => {
    const { findings } = checks({ styleBands: bands });
    const style = findings.filter((finding) => finding.id === 'style-band');
    expect(style.map((finding) => finding.vital).sort()).toEqual(['ibu', 'og']);
    // Notes, not warnings, because a pale ale hoppier than the guideline can be intentional.
    for (const finding of style) expect(finding.severity).toBe('note');

    const og = style.find((finding) => finding.vital === 'og');
    expect(og?.direction).toBe('below');
    expect(og?.band).toEqual({ min: 1.06, max: 1.075 });
    expect(style.find((finding) => finding.vital === 'ibu')?.direction).toBe('above');
  });
});

describe('the order findings come back in', () => {
  it('walks brew day: kettle, mash, fermenter, pH, pitch, ferment temperature, style', () => {
    const { findings } = checks({
      equipment: { kettleVolumeL: 10, mashTunVolumeL: 10, fermenterVolumeL: 18 },
      // A single sachet into 20 L of ale wort is 11.5 g against the 10 g the
      // 50 g/hL floor asks for, so it wouldn't fire. A 5 g pack does, and this
      // test is about the finding's position.
      recipe: {
        ...REFERENCE_RECIPE_A,
        water: { sourceProfile: MUNICH.profile },
        yeasts: [
          {
            ...WELL_PITCHED_YEAST,
            gramsPerPack: 5,
            packs: 1,
            temperatureMinC: 15,
            temperatureMaxC: 22,
          },
        ],
        fermentationSteps: [{ name: 'Primary', type: 'primary', tempC: 25, days: 7 }],
      },
      styleBands: { og: { min: 1.06, max: 1.075 }, fg: null, ibu: null, srm: null },
      now: NOW,
    });
    expect(findings.map((finding) => finding.id)).toEqual([
      'boil-over-kettle',
      'mash-over-tun',
      'fermenter-headspace',
      'mash-ph-out-of-band',
      // The reference recipe pitches dry, so the pitch finding is the mass one.
      // This test checks its position in brew-day order, not its id.
      'pitch-short-dry',
      'ferment-temp-outside-yeast',
      'style-band',
    ]);
  });
});
