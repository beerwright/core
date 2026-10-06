/**
 * The worked examples in `docs/guides` are code in `docs/examples`, pulled
 * into the guides with `{@includeCode}`. This runs each one and checks every
 * number the guide prints, to the precision it prints it, so a change to the
 * engine that moves a number in the guides fails here first.
 */
import { describe, expect, it } from 'vitest';
import { blendingExample } from '../docs/examples/blending';
import { decoctionExample } from '../docs/examples/decoction';
import { explanationExample } from '../docs/examples/explanation';
import { gravityExample } from '../docs/examples/gravity';
import { hopsExample } from '../docs/examples/hops';
import { packagingExample } from '../docs/examples/packaging';
import { paleAleExample } from '../docs/examples/pale-ale';
import { primingExample } from '../docs/examples/priming';
import { recipeChecksExample } from '../docs/examples/recipe-checks';
import { waterExample } from '../docs/examples/water';
import { yeastExample } from '../docs/examples/yeast';
import { DEFAULT_EQUIPMENT_PROFILE } from './defaults';

/** A number as the guide prints it, to `digits` decimal places. */
function printed(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined) throw new Error('expected a number');
  return value.toFixed(digits);
}

describe('Start here', () => {
  const pale = paleAleExample();

  it('prints the pale ale’s vitals', () => {
    expect(printed(pale.og, 3)).toBe('1.051');
    expect(printed(pale.fg, 3)).toBe('1.010');
    expect(printed(pale.abv, 1)).toBe('5.5');
    expect(printed(pale.ibu, 0)).toBe('33');
    expect(printed(pale.srm, 1)).toBe('9.4');
    expect(pale.colorHex).toBe('#E28100');
  });

  it('prints the pale ale’s volumes', () => {
    expect(printed(pale.strikeWaterL, 1)).toBe('14.7');
    expect(printed(pale.spargeWaterL, 1)).toBe('15.4');
    expect(printed(pale.preBoilVolumeL, 1)).toBe('25.2');
    expect(printed(pale.volumeIntoFermenterL, 0)).toBe('20');
  });

  it('says the pale ale has no warnings and names the explanations', () => {
    expect(pale.warnings).toEqual([]);
    expect(pale.explainKeys).toEqual(expect.arrayContaining(['og', 'fg', 'abv', 'ibu', 'srm']));
  });

  it('prints the priming dose', () => {
    const dose = primingExample();
    expect(printed(dose.sugarGrams, 0)).toBe('129');
    expect(printed(dose.residualVolumes, 2)).toBe('0.86');
    expect(printed(dose.volumesToAdd, 2)).toBe('1.54');
  });

  it('prints the start of the priming explanation', () => {
    const { working, text } = explanationExample();
    expect(text.slice(0, 6)).toEqual([
      'Priming sugar: 129.0 g',
      '  sugar_g = (target − residual) × beerVolume_L × 1.96 / CO₂ yield per gram of sugar',
      '  beerVolumeL = 19',
      '  targetVolumes = 2.4',
      '  fermentationTempC = 20',
      '  residualVolumes = 0.86',
    ]);
    expect(working.notes).toHaveLength(3);
    expect(working.sources).toHaveLength(3);
    expect(working.sources?.[0]?.author).toBe('Kai Troester (Braukaiser)');
    expect(working.sources?.[0]?.title).toMatch(/Sugar Additions for Carbonation/);
  });

  it('describes the default equipment and the Rager comparison', () => {
    expect(DEFAULT_EQUIPMENT_PROFILE.mashEfficiencyPercent).toBe(75);
    const { tinseth, rager } = recipeChecksExample();
    expect(printed(tinseth, 1)).toBe('33.0');
    expect(printed(rager, 1)).toBe('37.7');
  });
});

describe('Recipe guide', () => {
  const example = recipeChecksExample();

  it('prints the two findings on a 25 L kettle', () => {
    expect(printed(example.preBoilVolumeL, 1)).toBe('25.2');
    expect(example.summary).toEqual(['warning: boil-over-kettle', 'note: fermenter-headspace']);
    const [kettle, headspace] = example.findings;
    if (kettle?.id !== 'boil-over-kettle') throw new Error('expected the kettle finding first');
    if (headspace?.id !== 'fermenter-headspace') throw new Error('expected the headspace finding');
    expect(printed(kettle.overflowL, 2)).toBe('0.19');
    expect(printed(headspace.headspaceL, 0)).toBe('3');
    expect(printed(headspace.wantedHeadspaceL, 2)).toBe('5.75');
  });

  it('prints the warning that the kettle finding supersedes', () => {
    const sentence = "Pre-boil volume 25.2 L exceeds the kettle's 25 L.";
    expect(example.warnings).toContain(sentence);
    expect(example.supersedes).toEqual([sentence]);
  });

  it('prints the working behind the OG', () => {
    const og = paleAleExample().ogExplanation;
    expect(og?.formula).toBe('extract-bookkeeping');
    expect(og?.inputs.postBoilVolumeL).toBe(21.3);
    expect(og?.inputs.mashEfficiencyPercent).toBe(75);
    expect(og?.inputs.totalPointLitres).toBe(1081.9);
    expect(og?.inputs.theoreticalMaxPointLitres).toBe(1442.5);
    expect(og?.sources?.[0]?.title).toBe('How to Brew');
  });

  it('prints the brew-day readings', () => {
    const { og, fg, strength } = gravityExample();
    expect(printed(og, 3)).toBe('1.052');
    expect(printed(fg, 3)).toBe('1.011');
    expect(printed(strength, 1)).toBe('5.5');
  });
});

describe('Water and mash pH guide', () => {
  const example = waterExample();

  it('prints the bicarbonate and the salts the rule needs', () => {
    expect(printed(example.bicarbonatePpm, 0)).toBe('134');
    expect(example.additions.map((a) => [a.salt, printed(a.grams, 1)])).toEqual([
      ['gypsum', '3.4'],
      ['calcium-chloride-dihydrate', '1.2'],
    ]);
    expect(printed(example.rule.calciumAchievedPpm, 1)).toBe('75.2');
    expect(printed(example.rule.ratioAchieved, 2)).toBe('1.99');
    expect(example.rule.calciumMet && example.rule.ratioMet).toBe(true);
  });

  it('prints the mash pH, its warning and the acid that fixes it', () => {
    expect(printed(example.ph, 2)).toBe('5.67');
    expect(printed(example.distilledWaterPh, 2)).toBe('5.63');
    expect(example.contributions.waterAlkalinityMEq).toBeLessThan(
      -(example.contributions.calciumMEq + example.contributions.magnesiumMEq),
    );
    expect(example.warnings).toContain(
      'Predicted mash pH 5.67 is above 5.6: expect harsh tannin extraction, dull bitterness and hazy beer.',
    );
    expect(example.lactic.unit).toBe('mL');
    expect(printed(example.lactic.amount, 1)).toBe('5.2');
    expect(printed(example.lactic.achievedPh, 2)).toBe('5.40');
  });

  it('prints the model name and the alkalinity note', () => {
    expect(example.explain.formula).toBe('charge-balance-troester');
    expect(example.explain.notes?.some((note) => note.startsWith('82 % of the measured'))).toBe(
      true,
    );
  });
});

describe('Hops guide', () => {
  const example = hopsExample();

  it('prints the aged alpha and the IBU', () => {
    expect(printed(example.cascadeAlpha, 1)).toBe('4.0');
    expect(printed(example.ibu, 1)).toBe('24.3');
    const [magnum, cascade] = example.contributions;
    expect(printed(magnum?.ibu, 1)).toBe('21.7');
    expect(printed(cascade?.ibu, 1)).toBe('2.5');
    expect(printed(cascade?.effectiveBoilMinutes, 1)).toBe('2.5');
    expect(cascade?.standDescription).toBe(
      'Cascade, 20 min from 85 °C cooling: worth 2.5 boil minutes, 2.5 IBU.',
    );
  });
});

describe('Yeast guide', () => {
  const { pitch, starter } = yeastExample();

  it('prints the pitch', () => {
    expect(printed(pitch.cellsNeededBillion, 0)).toBe('357');
    expect(pitch.targetPitchRate).toBe(1.5);
    expect(printed(pitch.viability * 100, 0)).toBe('62');
    expect(printed(pitch.cellsFromPacksBillion, 0)).toBe('124');
    expect(printed(pitch.shortfallBillion, 0)).toBe('234');
    expect(pitch.packsRequired).toBe(6);
    expect(pitch.notes).toHaveLength(2);
    expect(pitch.notes[0]).toMatch(/1\.5 M cells\/mL\/°P for a lager/);
    expect(pitch.notes[1]).toMatch(/100 bn cells per liquid pack/);
  });

  it('prints the one-step starter', () => {
    expect(starter.method).toBe('stir-plate');
    expect(starter.steps).toHaveLength(1);
    expect(starter.steps[0]?.volumeL).toBe(1.75);
    expect(starter.steps[0]?.dmeGrams).toBe(175);
    expect(printed(starter.finalCellsBillion, 0)).toBe('369');
  });
});

describe('Decoction guide', () => {
  const pull = decoctionExample();

  it('prints the pull', () => {
    expect(printed(pull.pullVolumeL, 1)).toBe('6.1');
    expect(printed(pull.pullGrainKg, 1)).toBe('3.7');
    expect(pull.awayMinutes).toBe(37);
    expect(printed(pull.restTempAtReturnC, 1)).toBe('50.8');
    expect(printed(pull.evaporationL, 1)).toBe('0.5');
    expect(printed(pull.achievedTempC, 0)).toBe('64');
    expect(pull.issues).toEqual([
      'A pull this thick scorches on a direct flame. Stir it the whole time it heats.',
    ]);
    expect(pull.explain.notes).toContain(
      'Color, efficiency and pH effects of the boil are not modeled.',
    );
  });
});

describe('Packaging guide', () => {
  const example = packagingExample();

  it('prints the bottle, keg and cider doses', () => {
    expect(printed(example.sugarGrams, 0)).toBe('111');
    expect(printed(example.residualVolumes, 2)).toBe('0.86');
    expect(printed(primingExample().sugarGrams, 0)).toBe('129');
    expect(printed(example.kegPsi, 1)).toBe('10.7');
    expect(printed(example.kegBar, 2)).toBe('0.74');
    expect(printed(example.freeSo2MgL, 0)).toBe('40');
    expect(printed(example.metabisulfiteGrams, 2)).toBe('1.39');
  });
});

describe('Blending, mead and spirits guide', () => {
  const example = blendingExample();

  it('prints the Pearson square', () => {
    expect(printed(example.square?.volumeAL, 1)).toBe('13.3');
    expect(printed(example.square?.volumeBL, 1)).toBe('6.7');
  });

  it('prints the blend and its priming', () => {
    const { blend } = example;
    expect(blend.totalVolumeL).toBe(24);
    expect(printed(blend.abv, 1)).toBe('7.3');
    expect(printed(blend.ph, 2)).toBe('3.40');
    expect(printed(blend.fg, 4)).toBe('1.0043');
    expect(printed(blend.residualVolumes, 2)).toBe('0.41');
    expect(printed(blend.lowestFg, 3)).toBe('1.002');
    expect(printed(blend.extractVolumes, 2)).toBe('1.19');
    expect(printed(blend.predictedVolumes, 2)).toBe('1.60');
    expect(printed(blend.primingVolumesToAdd, 1)).toBe('1.2');
    expect(printed(blend.primingGrams, 0)).toBe('110');
    expect(blend.excessCarbonation).toBe(false);
  });

  it('prints the honey and the limoncello', () => {
    expect(printed(example.honeyKg, 1)).toBe('5.1');
    expect(printed(example.limoncello?.sugarKg, 2)).toBe('0.54');
    expect(printed(example.limoncello?.waterL, 2)).toBe('0.81');
    expect(printed(example.limoncello?.finalVolumeL, 2)).toBe('2.14');
  });
});
