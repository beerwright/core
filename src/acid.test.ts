import { describe, expect, it } from 'vitest';
import { ACID_EQUIVALENT_WEIGHTS, acidAdjustment, acidAdjustmentExplained } from './acid';

describe('acidAdjustment', () => {
  // 19 L from 4.5 to 6 g/L as tartaric is 1.5 g/L. Tartaric is dosed one for
  // one because TA is reported as tartaric, so the answer is 28.5 g.
  const MUST = { volumeL: 19, currentTaGL: 4.5, targetTaGL: 6 } as const;

  it('doses tartaric one for one against the titration', () => {
    expect(acidAdjustment({ ...MUST, acid: 'tartaric' }).grams).toBeCloseTo(28.5, 9);
  });

  it('needs less of an acid with a lower equivalent weight', () => {
    const tartaric = acidAdjustment({ ...MUST, acid: 'tartaric' }).grams;
    const malic = acidAdjustment({ ...MUST, acid: 'malic' }).grams;
    const citric = acidAdjustment({ ...MUST, acid: 'citric' }).grams;
    expect(malic).toBeCloseTo(tartaric * (67 / 75), 9);
    expect(citric).toBeCloseTo(tartaric * (64 / 75), 9);
    expect(citric).toBeLessThan(malic);
    expect(malic).toBeLessThan(tartaric);
  });

  it('derives its equivalent weights from molecular weight over protons', () => {
    expect(ACID_EQUIVALENT_WEIGHTS.tartaric).toBeCloseTo(150.09 / 2, 1);
    expect(ACID_EQUIVALENT_WEIGHTS.malic).toBeCloseTo(134.09 / 2, 1);
    expect(ACID_EQUIVALENT_WEIGHTS.citric).toBeCloseTo(192.12 / 3, 1);
  });

  it('answers zero rather than a negative dose when the target is lower', () => {
    expect(acidAdjustment({ ...MUST, targetTaGL: 3, acid: 'tartaric' }).grams).toBe(0);
    expect(acidAdjustment({ ...MUST, targetTaGL: 4.5, acid: 'tartaric' }).grams).toBe(0);
  });

  it('adds nothing to a volume of nothing', () => {
    expect(acidAdjustment({ ...MUST, volumeL: 0, acid: 'tartaric' }).grams).toBe(0);
  });
});

describe('acidAdjustmentExplained', () => {
  const explanation = acidAdjustmentExplained({
    volumeL: 19,
    currentTaGL: 4.5,
    targetTaGL: 6,
    acid: 'tartaric',
  });

  it('files itself under the cellar, citing Iland', () => {
    expect(explanation.family).toBe('cellar');
    expect(explanation.sources?.[0]?.author).toContain('Iland');
  });

  it('reports the dose per litre as well as the total', () => {
    expect(explanation.inputs.doseGramsPerLitre).toBeCloseTo(1.5, 2);
    expect(explanation.value).toBeCloseTo(28.5, 6);
  });

  it('says why a lower target is zero rather than a removal', () => {
    const lowering = acidAdjustmentExplained({
      volumeL: 19,
      currentTaGL: 6,
      targetTaGL: 4.5,
      acid: 'tartaric',
    });
    expect(lowering.value).toBe(0);
    expect(lowering.notes?.join(' ')).toContain('deacidification');
  });
});
