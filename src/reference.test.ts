import { describe, expect, it } from 'vitest';
import type { Explanation, Source } from './explain';
import { EXPLANATION_FAMILIES } from './explain';
import type { ReferenceExample } from './reference';
import { referenceExplanations, referenceExplanationsByFamily } from './reference';
import { RO_WATER, waterProfile } from './water';

/**
 * A complete example, with a field for every family.
 *
 * The citation test runs over the same set of explanations a reference
 * publishes, so a formula that would reach a reader without a source fails a
 * test in this package before anyone sees it on a rendered page.
 */
const EXAMPLE: ReferenceExample = {
  recipe: {
    name: 'Reference pale ale',
    batchVolumeL: 20,
    boilTimeMinutes: 60,
    fermentables: [
      {
        name: 'Pale ale malt',
        amountKg: 4.5,
        class: 'grain',
        use: 'mash',
        ppg: 37,
        colorLovibond: 3,
      },
      {
        name: 'Caramalt',
        amountKg: 0.35,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 34,
        colorLovibond: 30,
      },
    ],
    hops: [
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
        amountKg: 0.03,
        alphaAcidPercent: 5.5,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 10,
      },
      {
        name: 'Citra',
        amountKg: 0.04,
        alphaAcidPercent: 12.5,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 20,
        whirlpoolTempC: 80,
      },
    ],
    yeasts: [
      {
        name: 'US-05',
        type: 'ale',
        form: 'dry',
        attenuationMinPercent: 78,
        attenuationMaxPercent: 82,
      },
    ],
    mashSteps: [{ name: 'Saccharification', type: 'infusion', targetTempC: 66, timeMinutes: 60 }],
    fermentationSteps: [{ name: 'Primary', type: 'primary', tempC: 19, days: 12 }],
    water: {
      sourceProfile: waterProfile({
        name: 'Reference tap water',
        calciumPpm: 40,
        magnesiumPpm: 8,
        sodiumPpm: 12,
        chloridePpm: 25,
        sulfatePpm: 45,
        bicarbonatePpm: 90,
        ph: 7.6,
      }),
      saltAdditions: [{ salt: 'gypsum', grams: 4, target: 'mash' }],
      acidAdditions: [{ acid: 'lactic', millilitres: 3, target: 'mash' }],
      targetMashPh: 5.4,
      acidifySparge: true,
    },
  },
  options: { ibuFormula: 'tinseth' },
  bitternessFormulas: ['tinseth', 'rager', 'garetz'],
  colorFormulas: ['morey', 'daniels', 'mosher'],
  abvFormulas: ['advanced', 'simple'],
  priming: { beerVolumeL: 19, targetVolumes: 2.4, fermentationTempC: 19, sugar: 'corn-sugar' },
  forcedCarbonation: { tempC: 4, targetVolumes: 2.4 },
  refractometer: { originalMeasuredBrix: 12.8, finalMeasuredBrix: 6.4 },
  hydrometer: { measuredGravity: 1.048, sampleTempC: 30 },
  hotVolume: { volumeL: 24, measuredAtC: 100 },
  pitch: {
    yeasts: [
      {
        name: 'US-05',
        type: 'ale',
        form: 'dry',
        attenuationMinPercent: 78,
        attenuationMaxPercent: 82,
      },
    ],
    volumeL: 20,
    og: 1.05,
  },
  starter: { targetCellsBillion: 200, availableCellsBillion: 80 },
  hopStorage: {
    alphaAcidPercent: 6.4,
    storage: { alphaLostSixMonths: 0.5, months: 6, storageC: -12, packaging: 'vacuum' },
  },
  blend: {
    components: [
      {
        name: 'Barrel one',
        volumeL: 19,
        og: 1.056,
        fg: 1.004,
        ph: 3.4,
        srm: 6,
        peakTempC: 22,
        barrelAged: true,
        naohMl: 12.2,
      },
      {
        name: 'Barrel two',
        volumeL: 11,
        og: 1.052,
        fg: 1.01,
        ph: 3.6,
        srm: 9,
        peakTempC: 21,
        barrelAged: false,
        naohMl: 8.4,
      },
    ],
    targetVolumes: 2.6,
    additions: [],
    kegVolumeL: null,
  },
  waterSolver: {
    source: waterProfile({
      name: 'Reference tap water',
      calciumPpm: 40,
      magnesiumPpm: 8,
      sodiumPpm: 12,
      chloridePpm: 25,
      sulfatePpm: 45,
      bicarbonatePpm: 90,
    }),
    target: waterProfile({
      name: 'Pale ale target',
      calciumPpm: 90,
      magnesiumPpm: 10,
      sodiumPpm: 15,
      chloridePpm: 55,
      sulfatePpm: 130,
      bicarbonatePpm: 40,
    }),
    volumes: { mashVolumeL: 18, spargeVolumeL: 12 },
    dilutionProfile: RO_WATER,
  },
  decoction: {
    mashWaterL: 16,
    mashGrainKg: 5,
    currentTempC: 52,
    targetTempC: 65,
  },
  // The six cellar calculations use a mead instead of this pale ale, for the
  // same reason the blend and the decoction have their own inputs. The pale
  // ale wouldn't give them anything to show.
  sugarToGravity: { currentSg: 1.02, targetSg: 1.11, volumeL: 19, sugar: 'honey' },
  nutrients: { volumeL: 19, originalSg: 1.11, demand: 'medium' },
  sulfite: { volumeL: 19, ph: 3.4 },
  sorbate: { volumeL: 19, abvPercent: 12 },
  acid: { volumeL: 19, currentTaGL: 4.5, targetTaGL: 6, acid: 'tartaric' },
  pearson: { a: 14, b: 9, target: 12, totalVolumeL: 19 },
  proofAndSweeten: {
    volumeL: 1,
    abvPercent: 60,
    targetAbvPercent: 30,
    targetSugarGL: 150,
    sweetener: { kind: 'sugar' },
  },
};

const describeExplanation = (explanation: Explanation) =>
  `${explanation.label} (${explanation.formula})`;

const explanations = referenceExplanations(EXAMPLE);

describe('referenceExplanations', () => {
  it('produces something for the worked example', () => {
    expect(explanations.length).toBeGreaterThan(20);
  });

  it('is stable: two runs on the same example agree exactly', () => {
    expect(JSON.stringify(referenceExplanations(EXAMPLE))).toBe(JSON.stringify(explanations));
  });

  // This is the main test in the file. A reader can't check a calculation that's
  // published without a citation. The failure message names the formula, so
  // the log tells you which one to fix.
  it('gives every published number at least one source', () => {
    const uncited = explanations
      .filter((e) => (e.sources ?? []).length === 0)
      .map(describeExplanation);
    expect(uncited, `uncited calculations: ${uncited.join(', ')}`).toEqual([]);
  });

  it('files every published number under a family', () => {
    const unfiled = explanations.filter((e) => e.family === undefined).map(describeExplanation);
    expect(unfiled, `unfiled calculations: ${unfiled.join(', ')}`).toEqual([]);
  });

  it('gives every source a title, and a usable link where it claims one', () => {
    const sources: Source[] = explanations.flatMap((e) => [...(e.sources ?? [])]);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source.title.trim().length).toBeGreaterThan(0);
      if (source.url !== undefined) expect(source.url).toMatch(/^https?:\/\/\S+$/);
      if (source.year !== undefined) expect(source.year).toBeGreaterThan(1800);
    }
  });

  it('shows the three bitterness models side by side on one hop schedule', () => {
    const formulas = explanations
      .filter((e) => e.family === 'bitterness' && e.label === 'Bitterness')
      .map((e) => e.formula);
    expect(formulas).toEqual(['tinseth-1997', 'rager-1990', 'garetz-1994']);
  });
});

describe('referenceExplanationsByFamily', () => {
  const byFamily = referenceExplanationsByFamily(EXAMPLE);

  it('reaches every family the reference declares', () => {
    const missing = EXPLANATION_FAMILIES.filter((family) => !byFamily.has(family));
    expect(missing, `families with no explanation: ${missing.join(', ')}`).toEqual([]);
  });

  it('returns the families in declaration order', () => {
    expect([...byFamily.keys()]).toEqual(
      EXPLANATION_FAMILIES.filter((family) => byFamily.has(family)),
    );
  });

  it('loses nothing on the way through', () => {
    const total = [...byFamily.values()].reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(explanations.length);
  });
});
