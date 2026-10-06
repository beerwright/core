import { describe, expect, it } from 'vitest';
import {
  calculateColor,
  danielsSrm,
  ebcToSrm,
  gristSharesForTargetSrm,
  lovibondToSrm,
  maltColorUnits,
  moreySrm,
  mosherSrm,
  SRM_HEX_TABLE,
  srmFromMcu,
  srmToEbc,
  srmToHex,
  srmToLovibond,
} from './color';
import type { GristShare } from './gravity';
import type { FermentableAddition } from './types';

const fermentable = (amountKg: number, colorLovibond: number): FermentableAddition => ({
  name: 'Test',
  amountKg,
  class: 'grain',
  use: 'mash',
  ppg: 37,
  colorLovibond,
});

describe('maltColorUnits', () => {
  it('is Σ(lb × °L) / gallons', () => {
    // 4.5 kg = 9.92080 lb at 3 °L, in 21.54 L = 5.68998 gal
    // → 29.7624 / 5.68998 = 5.2306
    expect(maltColorUnits([fermentable(4.5, 3)], 21.54)).toBeCloseTo(5.2306, 3);
  });

  it('reproduces the reference pale-ale grist', () => {
    // (4.5 lb-equiv × 3 + 0.4 lb-equiv × 60) / 5.68998 gal = 14.529
    expect(maltColorUnits([fermentable(4.5, 3), fermentable(0.4, 60)], 21.54)).toBeCloseTo(
      14.529,
      2,
    );
  });

  it('is zero for an empty grist or zero volume', () => {
    expect(maltColorUnits([], 20)).toBe(0);
    expect(maltColorUnits([fermentable(4.5, 3)], 0)).toBe(0);
  });

  it('halves when the volume doubles', () => {
    const grist = [fermentable(4.5, 3)];
    expect(maltColorUnits(grist, 40)).toBeCloseTo(maltColorUnits(grist, 20) / 2, 9);
  });
});

/**
 * Morey golden values: `SRM = 1.4922 × MCU^0.6859`, computed longhand.
 *
 * ```
 * MCU  10 → 1.4922 × 10^0.6859  = 1.4922 × 4.85176 = 7.2398
 * MCU  20 → 1.4922 × 20^0.6859  = 1.4922 × 7.80506 = 11.6467
 * MCU  50 → 1.4922 × 50^0.6859  = 1.4922 × 14.6327 = 21.8349
 * MCU 100 → 1.4922 × 100^0.6859 = 1.4922 × 23.5397 = 35.1259
 * ```
 * Tolerance: 0.001 SRM.
 */
describe('Morey', () => {
  it.each([
    [1, 1.4922],
    [5, 4.5004],
    [10, 7.2398],
    [20, 11.6467],
    [50, 21.8349],
    [100, 35.1259],
  ])('MCU %f → %f SRM', (mcu, srm) => {
    expect(moreySrm(mcu)).toBeCloseTo(srm, 3);
  });

  it('returns 1.4922 at MCU 1, where the power term is exactly 1', () => {
    expect(moreySrm(1)).toBeCloseTo(1.4922, 9);
  });

  it('is zero for an empty grist', () => {
    expect(moreySrm(0)).toBe(0);
  });

  it('is monotonic', () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let mcu = 0.5; mcu < 200; mcu += 0.5) {
      const srm = moreySrm(mcu);
      expect(srm).toBeGreaterThan(previous);
      previous = srm;
    }
  });
});

describe('Daniels and Mosher', () => {
  it('follows the published straight lines in their valid range', () => {
    expect(danielsSrm(20)).toBeCloseTo(0.2 * 20 + 8.4, 9);
    expect(danielsSrm(50)).toBeCloseTo(0.2 * 50 + 8.4, 9);
    expect(mosherSrm(20)).toBeCloseTo(0.3 * 20 + 4.7, 9);
    expect(mosherSrm(50)).toBeCloseTo(0.3 * 50 + 4.7, 9);
  });

  it('does not report a pale beer as amber below its regression floor', () => {
    // A straight application of Daniels would return 8.6 SRM for a pilsner.
    expect(danielsSrm(1)).toBeLessThan(3);
    expect(mosherSrm(1)).toBeLessThan(3);
  });

  it('is zero for an empty grist', () => {
    expect(danielsSrm(0)).toBe(0);
    expect(mosherSrm(0)).toBe(0);
  });
});

describe('srmFromMcu selection', () => {
  it('defaults to Morey', () => {
    expect(srmFromMcu(20)).toBe(moreySrm(20));
  });

  it('honours the selection', () => {
    expect(srmFromMcu(20, 'daniels')).toBe(danielsSrm(20));
    expect(srmFromMcu(20, 'mosher')).toBe(mosherSrm(20));
  });
});

describe('unit conversions', () => {
  it('converts SRM to EBC with the defined 1.97 factor', () => {
    expect(srmToEbc(10)).toBeCloseTo(19.7, 9);
  });

  it('round trips EBC', () => {
    expect(ebcToSrm(srmToEbc(12.34))).toBeCloseTo(12.34, 9);
  });

  it('round trips Lovibond', () => {
    expect(srmToLovibond(lovibondToSrm(40))).toBeCloseTo(40, 9);
  });

  it('makes Lovibond and SRM nearly equal at pale colours', () => {
    expect(lovibondToSrm(2)).toBeCloseTo(1.949, 3);
  });
});

describe('srmToHex', () => {
  it('returns the table entry exactly at integer SRM', () => {
    expect(srmToHex(1)).toBe('#FFE699');
    expect(srmToHex(10)).toBe('#DE7C00');
    expect(srmToHex(40)).toBe('#36080A');
  });

  it('interpolates between table entries', () => {
    const hex = srmToHex(10.5);
    expect(hex).not.toBe(srmToHex(10));
    expect(hex).not.toBe(srmToHex(11));
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('clamps above the table', () => {
    expect(srmToHex(60)).toBe('#36080A');
    expect(srmToHex(400)).toBe('#36080A');
  });

  it('fades to near-white below SRM 1', () => {
    expect(srmToHex(0)).toBe('#FFF9E6');
    expect(srmToHex(-5)).toBe('#FFF9E6');
    expect(srmToHex(0.5)).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('always returns a well-formed hex colour', () => {
    for (let srm = 0; srm <= 45; srm += 0.25) {
      expect(srmToHex(srm)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('gets darker as SRM rises', () => {
    const luminance = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
    };
    expect(luminance(srmToHex(3))).toBeGreaterThan(luminance(srmToHex(12)));
    expect(luminance(srmToHex(12))).toBeGreaterThan(luminance(srmToHex(35)));
  });

  it('has a 40-entry table', () => {
    expect(SRM_HEX_TABLE).toHaveLength(40);
  });
});

describe('calculateColor', () => {
  it('bundles MCU, SRM, EBC and the swatch', () => {
    const result = calculateColor([fermentable(4.5, 3), fermentable(0.4, 60)], 21.54);
    expect(result.mcu).toBeCloseTo(14.529, 2);
    expect(result.srm).toBeCloseTo(9.354, 2);
    expect(result.ebc).toBeCloseTo(9.354 * 1.97, 2);
    expect(result.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(result.formula).toBe('morey');
  });
});

const malt = (name: string, colorLovibond: number): FermentableAddition => ({
  name,
  amountKg: 0,
  class: 'grain',
  use: 'mash',
  ppg: 37,
  colorLovibond,
});

const PALE = malt('Pale Ale Malt', 3);
const CRYSTAL_60 = malt('Crystal 60', 60);
const CHOCOLATE = malt('Chocolate Malt', 400);
const DEXTROSE: FermentableAddition = {
  name: 'Dextrose',
  amountKg: 0,
  class: 'sugar',
  use: 'boil',
  ppg: 46,
  colorLovibond: 0,
};

const share = (percentOfGrist: number, fermentable: FermentableAddition): GristShare => ({
  percentOfGrist,
  fermentable,
});

/** The SRM `calculateColor` returns for a solved set of shares. */
const srmOf = (grist: readonly GristShare[], percents: readonly number[], totalKg: number) =>
  calculateColor(
    grist.map((row, index) => ({
      ...row.fermentable,
      amountKg: (totalKg * (percents[index] ?? 0)) / 100,
    })),
    21.54,
  ).srm;

describe('gristSharesForTargetSrm', () => {
  it('sizes a single crystal malt so the engine reads the target back', () => {
    const grist = [share(90, PALE), share(10, CRYSTAL_60)];
    const solution = gristSharesForTargetSrm(grist, 5, 21.54, 14);
    expect(solution.ok).toBe(true);
    if (!solution.ok) return;
    expect(srmOf(grist, solution.percentsOfGrist, 5)).toBeCloseTo(14, 6);
    expect(solution.percentsOfGrist.reduce((sum, p) => sum + p, 0)).toBeCloseTo(100, 9);
  });

  it('scales down from an overshoot as readily as up', () => {
    const grist = [share(70, PALE), share(30, CRYSTAL_60)];
    const solution = gristSharesForTargetSrm(grist, 5, 21.54, 8);
    expect(solution.ok).toBe(true);
    if (!solution.ok) return;
    expect(srmOf(grist, solution.percentsOfGrist, 5)).toBeCloseTo(8, 6);
    expect(solution.percentsOfGrist[1]).toBeLessThan(30);
    expect(solution.percentsOfGrist[0]).toBeGreaterThan(70);
  });

  it('keeps two colour malts in their ratio and leaves the sugar alone', () => {
    const grist = [share(80, PALE), share(8, CRYSTAL_60), share(4, CHOCOLATE), share(8, DEXTROSE)];
    const solution = gristSharesForTargetSrm(grist, 5, 21.54, 30);
    expect(solution.ok).toBe(true);
    if (!solution.ok) return;
    const [pale, crystal, chocolate, sugar] = solution.percentsOfGrist;
    expect((crystal ?? 0) / (chocolate ?? 1)).toBeCloseTo(2, 9);
    expect(sugar).toBeCloseTo(8, 9);
    expect(pale).toBeLessThan(80);
    expect(srmOf(grist, solution.percentsOfGrist, 5)).toBeCloseTo(30, 6);
  });

  it('leaves a bill that is already on its target alone', () => {
    const grist = [share(90, PALE), share(10, CRYSTAL_60)];
    const current = srmOf(grist, [90, 10], 5);
    const solution = gristSharesForTargetSrm(grist, 5, 21.54, current);
    expect(solution.ok).toBe(true);
    if (!solution.ok) return;
    expect(solution.percentsOfGrist[0]).toBeCloseTo(90, 6);
    expect(solution.percentsOfGrist[1]).toBeCloseTo(10, 6);
  });

  it('refuses a grist with no crystal or roasted malt', () => {
    const grist = [share(92, PALE), share(8, DEXTROSE)];
    expect(gristSharesForTargetSrm(grist, 5, 21.54, 14)).toEqual({
      ok: false,
      reason: 'no-colour-malt',
    });
  });

  it('refuses a target the colour malts cannot reach inside half the grist', () => {
    const grist = [share(95, PALE), share(5, CRYSTAL_60)];
    expect(gristSharesForTargetSrm(grist, 5, 21.54, 60)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('never puts more than half the grist in colour malt', () => {
    const grist = [share(95, PALE), share(5, CHOCOLATE)];
    const solution = gristSharesForTargetSrm(grist, 5, 21.54, 40);
    if (!solution.ok) return;
    expect(solution.percentsOfGrist[1] ?? 0).toBeLessThanOrEqual(50.000001);
  });

  it('follows the formula it is handed', () => {
    const grist = [share(90, PALE), share(10, CRYSTAL_60)];
    const morey = gristSharesForTargetSrm(grist, 5, 21.54, 14, 'morey');
    const mosher = gristSharesForTargetSrm(grist, 5, 21.54, 14, 'mosher');
    expect(morey.ok && mosher.ok).toBe(true);
    if (!morey.ok || !mosher.ok) return;
    expect(morey.percentsOfGrist[1]).not.toBeCloseTo(mosher.percentsOfGrist[1] ?? 0, 3);
  });
});
