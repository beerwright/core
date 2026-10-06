import { describe, expect, it } from 'vitest';
import { starterDmeGrams, starterGrowth } from './starter-growth';
import type { YeastSelection } from './types';
import { sgToPlato } from './units/gravity';
import {
  attenuationRange,
  bestByFromManufactureDate,
  cellsNeeded,
  DEFAULT_PITCH_RATES,
  daysBetween,
  defaultPitchRate,
  growStarter,
  isWhiteLabsPack,
  manufactureDateFromBestBy,
  PUREPITCH_RETENTION_PER_30_DAYS,
  packRetentionPer30Days,
  pitchGravityPlato,
  pitchPlan,
  pitchPlanExplained,
  pitchRateAchieved,
  SHELF_LIFE_MONTHS,
  VIABILITY_RETENTION_PER_30_DAYS,
  viabilityFraction,
  viabilityFromManufactureDate,
} from './yeast';

describe('pitch rates', () => {
  it('uses the published White & Zainasheff figures', () => {
    expect(DEFAULT_PITCH_RATES.ale).toBe(0.75);
    expect(DEFAULT_PITCH_RATES.lager).toBe(1.5);
    expect(defaultPitchRate('lager')).toBe(1.5);
  });

  it('falls back to the ale rate for unclassified strains', () => {
    expect(defaultPitchRate('other')).toBe(0.75);
  });
});

describe('cellsNeeded', () => {
  /**
   * 20 L of 1.050 wort (12.3876 °P) at the ale rate:
   * ```
   * 0.75 M/mL/°P × 20 L × 12.3876 °P = 185.81 billion cells
   * ```
   */
  it('computes the ale pitch longhand', () => {
    expect(cellsNeeded({ volumeL: 20, og: 1.05, pitchRate: 0.75 })).toBeCloseTo(185.81, 1);
  });

  it('doubles for a lager', () => {
    const ale = cellsNeeded({ volumeL: 20, og: 1.05, pitchRate: 0.75 });
    const lager = cellsNeeded({ volumeL: 20, og: 1.05, pitchRate: 1.5 });
    expect(lager).toBeCloseTo(ale * 2, 9);
  });

  it('scales with volume and with gravity', () => {
    expect(cellsNeeded({ volumeL: 40, og: 1.05, pitchRate: 0.75 })).toBeCloseTo(
      cellsNeeded({ volumeL: 20, og: 1.05, pitchRate: 0.75 }) * 2,
      9,
    );
    expect(cellsNeeded({ volumeL: 20, og: 1.08, pitchRate: 0.75 })).toBeGreaterThan(
      cellsNeeded({ volumeL: 20, og: 1.05, pitchRate: 0.75 }),
    );
  });

  it('is zero for water or an empty fermenter', () => {
    expect(cellsNeeded({ volumeL: 20, og: 1.0, pitchRate: 0.75 })).toBe(0);
    expect(cellsNeeded({ volumeL: 0, og: 1.05, pitchRate: 0.75 })).toBe(0);
  });

  it('round trips through pitchRateAchieved', () => {
    const cells = cellsNeeded({ volumeL: 23, og: 1.062, pitchRate: 0.9 });
    expect(pitchRateAchieved(cells, 23, 1.062)).toBeCloseTo(0.9, 9);
  });

  it('exposes the gravity in Plato', () => {
    expect(pitchGravityPlato(1.05)).toBeCloseTo(sgToPlato(1.05), 12);
  });
});

describe('viability decay', () => {
  it('loses about 21 %% per month for liquid yeast', () => {
    expect(VIABILITY_RETENTION_PER_30_DAYS.liquid).toBe(0.79);
    expect(viabilityFraction(30)).toBeCloseTo(0.79, 9);
    expect(viabilityFraction(90)).toBeCloseTo(0.79 ** 3, 9);
  });

  it('decays dry yeast far more slowly', () => {
    expect(viabilityFraction(180, { form: 'dry' })).toBeGreaterThan(
      viabilityFraction(180, { form: 'liquid' }),
    );
    expect(viabilityFraction(365, { form: 'dry' })).toBeCloseTo(0.96 ** (365 / 30), 9);
  });

  it('is 100 %% on the day of manufacture', () => {
    expect(viabilityFraction(0)).toBe(1);
    expect(viabilityFraction(-5)).toBe(1);
  });

  it('never reaches zero', () => {
    expect(viabilityFraction(3650)).toBeGreaterThan(0);
  });

  it('is monotonically decreasing', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let days = 0; days <= 365; days += 5) {
      const value = viabilityFraction(days);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('honours a custom retention constant', () => {
    expect(viabilityFraction(30, { retentionPer30Days: 0.5 })).toBeCloseTo(0.5, 9);
  });

  it('computes from manufacture dates', () => {
    const made = new Date('2026-01-01T00:00:00Z');
    const pitched = new Date('2026-01-31T00:00:00Z');
    expect(daysBetween(made, pitched)).toBeCloseTo(30, 9);
    expect(viabilityFromManufactureDate(made, pitched)).toBeCloseTo(0.79, 9);
  });

  it('treats a future manufacture date as fresh', () => {
    const made = new Date('2026-06-01T00:00:00Z');
    const pitched = new Date('2026-01-01T00:00:00Z');
    expect(viabilityFromManufactureDate(made, pitched)).toBe(1);
  });
});

const liquidPack: YeastSelection = {
  name: 'Wyeast 1056',
  type: 'ale',
  form: 'liquid',
  attenuationMinPercent: 73,
  attenuationMaxPercent: 77,
  cellsPerPackBillion: 100,
};

describe('pitchPlan', () => {
  it('reports a shortfall for a single fresh liquid pack in a 20 L ale', () => {
    const plan = pitchPlan({ yeasts: [liquidPack], volumeL: 20, og: 1.05 });
    expect(plan.cellsNeededBillion).toBeCloseTo(185.81, 1);
    expect(plan.cellsAvailableBillion).toBeCloseTo(100, 9);
    expect(plan.shortfallBillion).toBeCloseTo(85.81, 1);
    expect(plan.packsRequired).toBe(2);
    expect(plan.achievedPitchRate).toBeCloseTo(0.4036, 3);
  });

  it('is satisfied by two packs', () => {
    const plan = pitchPlan({
      yeasts: [{ ...liquidPack, packs: 2 }],
      volumeL: 20,
      og: 1.05,
    });
    expect(plan.shortfallBillion).toBeLessThan(0);
    expect(plan.achievedPitchRate).toBeGreaterThan(plan.targetPitchRate);
  });

  it('needs twice as many cells for a lager', () => {
    const ale = pitchPlan({ yeasts: [liquidPack], volumeL: 20, og: 1.05 });
    const lager = pitchPlan({
      yeasts: [{ ...liquidPack, type: 'lager' }],
      volumeL: 20,
      og: 1.05,
    });
    expect(lager.cellsNeededBillion).toBeCloseTo(ale.cellsNeededBillion * 2, 9);
    expect(lager.packsRequired).toBeGreaterThan(ale.packsRequired);
  });

  it('discounts an old pack by its viability', () => {
    const plan = pitchPlan({
      yeasts: [{ ...liquidPack, manufactureDate: new Date('2026-01-01T00:00:00Z') }],
      volumeL: 20,
      og: 1.05,
      pitchDate: new Date('2026-03-02T00:00:00Z'),
    });
    // 60 days → 0.79² = 0.6241 viability
    expect(plan.viability).toBeCloseTo(0.6241, 3);
    expect(plan.cellsAvailableBillion).toBeCloseTo(62.41, 1);
    expect(plan.packsRequired).toBe(3);
  });

  it('counts dry sachets from grams × cells per gram', () => {
    const plan = pitchPlan({
      yeasts: [
        {
          name: 'US-05',
          type: 'ale',
          form: 'dry',
          attenuationMinPercent: 78,
          attenuationMaxPercent: 82,
          gramsPerPack: 11.5,
          cellsPerGramBillion: 6,
        },
      ],
      volumeL: 20,
      og: 1.05,
    });
    // 11.5 g × 6 bn = 69 bn per sachet
    expect(plan.cellsAvailableBillion).toBeCloseTo(69, 9);
    expect(plan.notes.join(' ')).toMatch(/11.5 g × 6 bn cells\/g/);
  });

  it('honours a pitch-rate override', () => {
    const plan = pitchPlan({ yeasts: [liquidPack], volumeL: 20, og: 1.05, pitchRate: 1.0 });
    expect(plan.targetPitchRate).toBe(1.0);
    expect(plan.cellsNeededBillion).toBeCloseTo(20 * sgToPlato(1.05), 6);
  });

  it('documents the assumptions it made', () => {
    const { cellsPerPackBillion: _omitted, ...noCellCount } = liquidPack;
    const plan = pitchPlan({ yeasts: [noCellCount], volumeL: 20, og: 1.05 });
    expect(plan.notes.join(' ')).toMatch(/assumed 100 bn cells per liquid pack/);
    expect(plan.notes.join(' ')).toMatch(/no manufacture date/);
    expect(plan.notes.join(' ')).toMatch(/Pitch rate defaulted/);
  });

  it('sums a blend of two strains', () => {
    const plan = pitchPlan({
      yeasts: [liquidPack, { ...liquidPack, name: 'Brett', type: 'brett' }],
      volumeL: 20,
      og: 1.05,
    });
    expect(plan.cellsAvailableBillion).toBeCloseTo(200, 9);
  });

  it('reports the packs and the pitch as the same number without a starter', () => {
    const plan = pitchPlan({ yeasts: [liquidPack], volumeL: 20, og: 1.05 });
    expect(plan.starters).toEqual([]);
    expect(plan.cellsFromPacksBillion).toBeCloseTo(plan.cellsAvailableBillion, 9);
  });
});

describe('a pitch with a starter saved on the row', () => {
  /** The same arithmetic as the plan, computed directly from `starter-growth`'s exports. */
  const growOneStep = (cells: number, volumeL: number) =>
    starterGrowth(cells, starterDmeGrams(volumeL)).finalCellsBillion;

  it('pitches what comes out of the flask, not what is in the pack', () => {
    const plan = pitchPlan({
      yeasts: [{ ...liquidPack, starter: { stepVolumesL: [2], method: 'stir-plate' } }],
      volumeL: 20,
      og: 1.05,
    });
    expect(plan.cellsFromPacksBillion).toBeCloseTo(100, 9);
    expect(plan.cellsAvailableBillion).toBeCloseTo(growOneStep(100, 2), 6);
    expect(plan.shortfallBillion).toBeLessThan(0);
    expect(plan.starters).toHaveLength(1);
    expect(plan.starters[0]?.fromPacksBillion).toBeCloseTo(100, 9);
  });

  it('seeds each step with the whole of the step before it', () => {
    const plan = pitchPlan({
      yeasts: [{ ...liquidPack, starter: { stepVolumesL: [1, 3], method: 'stir-plate' } }],
      volumeL: 20,
      og: 1.05,
    });
    const first = growOneStep(100, 1);
    expect(plan.starters[0]?.steps[0]?.finalCellsBillion).toBeCloseTo(first, 6);
    // Chill, decant the spent wort and pitch the slurry. Step two starts from
    // all of step one's yield, not from the pack again.
    expect(plan.cellsAvailableBillion).toBeCloseTo(growOneStep(first, 3), 6);
  });

  it('leaves a pitch short when the starter is too small to close the gap', () => {
    // A saved starter has to be able to come out too small. A boolean
    // "starter planned" flag would hide the shortfall the pitch check is there
    // to catch.
    const plan = pitchPlan({
      yeasts: [
        {
          ...liquidPack,
          type: 'lager',
          // A litre without a stir plate: the model's flat 0.4 bn/g band adds
          // 40 bn cells to a lager that wants three times that much more.
          starter: { stepVolumesL: [1], method: 'still' },
        },
      ],
      volumeL: 20,
      og: 1.05,
    });
    expect(plan.shortfallBillion).toBeGreaterThan(0);
    expect(plan.achievedPitchRate).toBeLessThan(plan.targetPitchRate);
    // The starter's cells are still counted, so it beats no starter at all.
    expect(plan.cellsAvailableBillion).toBeGreaterThan(plan.cellsFromPacksBillion);
  });

  it('names the model and its error bar in the note', () => {
    const plan = pitchPlan({
      yeasts: [{ ...liquidPack, starter: { stepVolumesL: [2], method: 'stir-plate' } }],
      volumeL: 20,
      og: 1.05,
    });
    expect(plan.notes.join(' ')).toMatch(/2 L stir-plate starter is planned/);
    expect(plan.notes.join(' ')).toMatch(/Braukaiser/);
    expect(plan.notes.join(' ')).toMatch(/±15 %/);
  });

  it('refuses one on dry yeast, and says why', () => {
    const dry: YeastSelection = {
      name: 'US-05',
      type: 'ale',
      form: 'dry',
      attenuationMinPercent: 78,
      attenuationMaxPercent: 82,
      gramsPerPack: 11.5,
      cellsPerGramBillion: 6,
      starter: { stepVolumesL: [2], method: 'stir-plate' },
    };
    const plan = pitchPlan({ yeasts: [dry], volumeL: 20, og: 1.05 });
    // 11.5 g × 6 bn, the same as with no starter on the row.
    expect(plan.cellsAvailableBillion).toBeCloseTo(69, 9);
    expect(plan.cellsFromPacksBillion).toBeCloseTo(69, 9);
    expect(plan.starters).toEqual([]);
    expect(plan.notes.join(' ')).toMatch(/starter on this row is ignored/);
    expect(plan.notes.join(' ')).toMatch(/sterols/);
  });

  it('shows the starter in the explanation rather than hiding it in a total', () => {
    const explanation = pitchPlanExplained({
      yeasts: [{ ...liquidPack, starter: { stepVolumesL: [1, 2], method: 'shaken' } }],
      volumeL: 20,
      og: 1.05,
    });
    expect(explanation.inputs.starterSteps).toBe('1 L then 2 L');
    expect(explanation.inputs.starterMethod).toBe('shaken');
    expect(explanation.inputs.cellsFromPacksBillion).toBeCloseTo(100, 6);
    expect(explanation.inputs.cellsAvailableBillion).not.toBe(
      explanation.inputs.cellsFromPacksBillion,
    );
  });

  it('grows a row the same way `growStarter` does on its own', () => {
    const starter = { stepVolumesL: [1.5], method: 'still' } as const;
    const plan = pitchPlan({
      yeasts: [{ ...liquidPack, starter }],
      volumeL: 20,
      og: 1.05,
    });
    const grown = growStarter(liquidPack.name, starter, 100);
    expect(plan.starters[0]).toEqual(grown);
    expect(plan.cellsAvailableBillion).toBeCloseTo(grown.finalCellsBillion, 9);
  });
});

describe('attenuationRange', () => {
  it('passes the published range through for the UI', () => {
    expect(attenuationRange(liquidPack)).toEqual({ minPercent: 73, maxPercent: 77 });
  });
});

describe('best-by dates', () => {
  it('counts a liquid pack as made six months before its best-by', () => {
    expect(SHELF_LIFE_MONTHS.liquid).toBe(6);
    // The pack a brewer posted: made 2019-07-02, best by 2020-01-02.
    expect(manufactureDateFromBestBy('2020-01-02', 'liquid')).toBe('2019-07-02');
  });

  it('counts a dry packet as made three years before', () => {
    expect(manufactureDateFromBestBy('2029-03-15', 'dry')).toBe('2026-03-15');
  });

  it('lands on the last day of a shorter month rather than spilling into the next', () => {
    expect(manufactureDateFromBestBy('2026-08-31', 'liquid')).toBe('2026-02-28');
    expect(bestByFromManufactureDate('2027-08-31', 'liquid')).toBe('2028-02-29');
  });

  it('goes both ways, so switching the field between them loses nothing', () => {
    expect(bestByFromManufactureDate('2019-07-02', 'liquid')).toBe('2020-01-02');
  });

  it('reads nothing into a date it cannot parse', () => {
    expect(manufactureDateFromBestBy('', 'liquid')).toBeNull();
    expect(manufactureDateFromBestBy('2026-13-01', 'liquid')).toBeNull();
    expect(manufactureDateFromBestBy('2026-02-30', 'liquid')).toBeNull();
  });
});

describe('White Labs packs', () => {
  it('knows one by its catalog name or its WLP number, and nothing else', () => {
    expect(isWhiteLabsPack('White Labs California Ale Yeast®')).toBe(true);
    expect(isWhiteLabsPack('WLP001')).toBe(true);
    expect(isWhiteLabsPack('wlp-830 German Lager')).toBe(true);
    expect(isWhiteLabsPack('Wyeast 1056 American Ale')).toBe(false);
    expect(isWhiteLabsPack('Imperial A07 Flagship')).toBe(false);
  });

  it('decays a liquid White Labs pack on White Labs’ own curve', () => {
    expect(packRetentionPer30Days('liquid', 'WLP001')).toBe(PUREPITCH_RETENTION_PER_30_DAYS);
    expect(packRetentionPer30Days('liquid', 'Wyeast 1056')).toBe(
      VIABILITY_RETENTION_PER_30_DAYS.liquid,
    );
    // A dry White Labs strain keeps the dry curve, which is gentler still.
    expect(packRetentionPer30Days('dry', 'White Labs WLP001 Dry')).toBe(
      VIABILITY_RETENTION_PER_30_DAYS.dry,
    );
  });

  it('lands on White Labs’ published 72 % at six months, and never above their table', () => {
    const at = (months: number) =>
      viabilityFraction(months * 30, { retentionPer30Days: PUREPITCH_RETENTION_PER_30_DAYS });
    expect(at(6)).toBeCloseTo(0.716, 2);
    // Their published figures, month by month. The constant errs low, toward a
    // bigger starter, so it never claims cells the pack doesn't have.
    const published = [0.9921, 0.9805, 0.9026, 0.8428, 0.7935, 0.7159];
    published.forEach((figure, index) => {
      expect(at(index + 1)).toBeLessThanOrEqual(figure + 0.005);
    });
  });
});
