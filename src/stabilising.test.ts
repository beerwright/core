import { describe, expect, it } from 'vitest';
import {
  CIDER_SULFITE_PH_CEILING,
  KMS_SO2_FRACTION,
  POTASSIUM_SORBATE_SORBIC_FRACTION,
  SO2_PKA,
  sorbateDose,
  sorbateDoseExplained,
  sorbicAcidForAbv,
  sulfiteDose,
  sulfiteDoseExplained,
} from './stabilising';

describe('sulfiteDose', () => {
  // A 19 L cider at pH 3.4 held at 0.8 mg/L molecular: free SO₂ is
  // 0.8 × (1 + 10^1.59) = 31.9 mg/L, which is 0.607 g of SO₂ over 19 L and
  // 1.05 g of potassium metabisulfite at 57.6 %.
  const CIDER = { volumeL: 19, ph: 3.4 } as const;

  it('works the free SO₂ back from the molecular target and the pH', () => {
    const { freeSo2MgL, metabisulfiteGrams } = sulfiteDose(CIDER);
    expect(freeSo2MgL).toBeCloseTo(0.8 * (1 + 10 ** (3.4 - SO2_PKA)), 9);
    expect(freeSo2MgL).toBeCloseTo(31.92, 2);
    expect(metabisulfiteGrams).toBeCloseTo((31.92 * 19) / 1000 / KMS_SO2_FRACTION, 2);
    expect(metabisulfiteGrams).toBeCloseTo(1.053, 3);
  });

  it('asks for roughly ten times as much free SO₂ for each unit of pH', () => {
    const low = sulfiteDose({ ...CIDER, ph: 3 }).freeSo2MgL;
    const high = sulfiteDose({ ...CIDER, ph: 4 }).freeSo2MgL;
    expect(high / low).toBeGreaterThan(9);
    expect(high / low).toBeLessThan(10);
  });

  it('doses only the shortfall against free SO₂ the brewer already measured', () => {
    const full = sulfiteDose(CIDER).metabisulfiteGrams;
    const topped = sulfiteDose({ ...CIDER, currentFreeSo2MgL: 16 }).metabisulfiteGrams;
    expect(topped).toBeLessThan(full);
    expect(topped).toBeCloseTo(((31.92 - 16) * 19) / 1000 / KMS_SO2_FRACTION, 2);
  });

  it('adds nothing when the free SO₂ already there meets the target', () => {
    expect(sulfiteDose({ ...CIDER, currentFreeSo2MgL: 60 }).metabisulfiteGrams).toBe(0);
  });

  it('adds nothing to a volume of nothing, but still reports the free SO₂ wanted', () => {
    const none = sulfiteDose({ ...CIDER, volumeL: 0 });
    expect(none.metabisulfiteGrams).toBe(0);
    expect(none.freeSo2MgL).toBeGreaterThan(0);
  });

  it('takes a molecular target other than the convention', () => {
    expect(sulfiteDose({ ...CIDER, targetMolecularSo2MgL: 0.5 }).freeSo2MgL).toBeCloseTo(
      sulfiteDose(CIDER).freeSo2MgL * (0.5 / 0.8),
      9,
    );
  });
});

describe('sulfiteDoseExplained', () => {
  it('files itself under the cellar with both sources', () => {
    const explanation = sulfiteDoseExplained({ volumeL: 19, ph: 3.4 });
    expect(explanation.family).toBe('cellar');
    expect(explanation.sources?.map((s) => s.author).join(' ')).toContain('Boulton');
    expect(explanation.sources?.map((s) => s.author).join(' ')).toContain('Lea');
  });

  it('warns a cider above 3.8 that sulfite alone will not do it', () => {
    const high = sulfiteDoseExplained({ volumeL: 19, ph: CIDER_SULFITE_PH_CEILING + 0.1 });
    expect(high.notes?.join(' ')).toContain('acidified first');
    const fine = sulfiteDoseExplained({ volumeL: 19, ph: 3.4 });
    expect(fine.notes?.join(' ')).not.toContain('acidified first');
  });
});

describe('sorbicAcidForAbv', () => {
  it('reads Peynaud’s rows exactly', () => {
    expect(sorbicAcidForAbv(10)).toBe(150);
    expect(sorbicAcidForAbv(11)).toBe(125);
    expect(sorbicAcidForAbv(12)).toBe(100);
    expect(sorbicAcidForAbv(13)).toBe(75);
    expect(sorbicAcidForAbv(14)).toBe(50);
  });

  it('interpolates between them', () => {
    expect(sorbicAcidForAbv(11.5)).toBeCloseTo(112.5, 9);
    expect(sorbicAcidForAbv(12.4)).toBeCloseTo(90, 9);
  });

  it('holds flat outside the table rather than extrapolating past it', () => {
    expect(sorbicAcidForAbv(6)).toBe(150);
    expect(sorbicAcidForAbv(0)).toBe(150);
    expect(sorbicAcidForAbv(18)).toBe(50);
  });
});

describe('sorbateDose', () => {
  it('weighs the salt for 19 L at 12 %', () => {
    const { sorbicAcidMgL, potassiumSorbateGrams } = sorbateDose({ volumeL: 19, abvPercent: 12 });
    expect(sorbicAcidMgL).toBe(100);
    expect(potassiumSorbateGrams).toBeCloseTo(
      (100 * 19) / 1000 / POTASSIUM_SORBATE_SORBIC_FRACTION,
      9,
    );
    expect(potassiumSorbateGrams).toBeCloseTo(2.5435, 3);
  });

  it('weighs more salt than the acid figure asks for, because it is a salt', () => {
    const { sorbicAcidMgL, potassiumSorbateGrams } = sorbateDose({ volumeL: 19, abvPercent: 12 });
    expect(potassiumSorbateGrams).toBeGreaterThan((sorbicAcidMgL * 19) / 1000);
  });

  it('needs less as the alcohol rises', () => {
    const weak = sorbateDose({ volumeL: 19, abvPercent: 10 }).potassiumSorbateGrams;
    const strong = sorbateDose({ volumeL: 19, abvPercent: 14 }).potassiumSorbateGrams;
    expect(strong).toBeLessThan(weak);
  });

  it('adds nothing to a volume of nothing', () => {
    expect(sorbateDose({ volumeL: 0, abvPercent: 12 }).potassiumSorbateGrams).toBe(0);
  });
});

describe('sorbateDoseExplained', () => {
  const explanation = sorbateDoseExplained({ volumeL: 19, abvPercent: 12 });

  it('files itself under the cellar, citing Peynaud', () => {
    expect(explanation.family).toBe('cellar');
    expect(explanation.sources?.[0]?.author).toContain('Peynaud');
  });

  it('carries the three warnings that matter more than the grams', () => {
    const notes = explanation.notes?.join(' ') ?? '';
    expect(notes).toContain('alongside sulfite');
    expect(notes).toContain('malolactic');
    expect(notes).toContain('300');
    expect(notes).toContain('200');
  });
});
