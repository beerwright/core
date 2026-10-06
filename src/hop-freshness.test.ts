/**
 * Tests for the hop-ageing curve, checked against the article it comes from.
 *
 * `hop-freshness.ts` implements one published model, so the important tests
 * are the ones that reproduce the publication's own arithmetic. Garetz's
 * worked example is here in full, both the freezer and the poly bag, along
 * with the one rate constant and the one temperature factor the article
 * prints. Between them they pin every coefficient in the module.
 *
 * Source: Mark Garetz, "Hop Storage", *Brewing Techniques* 2(1), 1994, at
 * `morebeer.com/blogs/articles/hop-storage`, read 2026-09-01.
 */

import { describe, expect, it } from 'vitest';
import {
  agedAlphaAcidPercent,
  DEFAULT_ALPHA_LOST_SIX_MONTHS,
  FRESH_STORAGE_INDEX,
  HOP_STORAGE_FACTORS,
  type HopStorage,
  harvestDateForCropYear,
  hopAlphaRemaining,
  hopAlphaRemainingFromDates,
  hopAlphaRemainingSinceHarvest,
  hopDecayRateConstant,
  hopTemperatureFactor,
  storageIndexFromRemaining,
} from './hop-freshness';

/** The article's example: Cascade, 50 % lost, 37 days. */
const CASCADE_LOST = 0.5;
const EXAMPLE_DAYS = 37;
const EXAMPLE_MONTHS = EXAMPLE_DAYS / 30;

describe('the rate constant', () => {
  it("reproduces the one value the article's Table II prints", () => {
    // "a percent lost of 50% gives the value for k as 0.00385"
    expect(hopDecayRateConstant(0.5)).toBeCloseTo(0.00385, 5);
  });

  it('is ln 2 over 180 days at half lost, which is what makes that true', () => {
    // Half gone in 180 days is a half-life of 180 days. Every other value in
    // the table follows from the same algebra.
    expect(hopDecayRateConstant(0.5)).toBeCloseTo(Math.LN2 / 180, 12);
  });

  it('rises with the loss, and is zero for a hop that loses nothing', () => {
    expect(hopDecayRateConstant(0.15)).toBeLessThan(hopDecayRateConstant(0.55));
    expect(hopDecayRateConstant(0)).toBe(0);
    expect(hopDecayRateConstant(-1)).toBe(0);
    expect(hopDecayRateConstant(Number.NaN)).toBe(0);
  });

  it('stays finite for a variety that loses everything', () => {
    // A "100 % lost" figure would need an infinite rate. We return a very fast
    // curve so `Infinity` doesn't reach a recipe's IBU.
    expect(Number.isFinite(hopDecayRateConstant(1))).toBe(true);
    expect(hopDecayRateConstant(1)).toBeGreaterThan(hopDecayRateConstant(0.95));
  });
});

describe('the temperature factor', () => {
  it('is 1 at the 20 °C the loss figures are measured at', () => {
    expect(hopTemperatureFactor(20)).toBe(1);
  });

  it('halves for every 15 °C drop, which is the rule the article states', () => {
    expect(hopTemperatureFactor(5)).toBeCloseTo(0.5, 12);
    expect(hopTemperatureFactor(-10)).toBeCloseTo(0.25, 12);
  });

  it("reproduces the 0.228 the article's Table III prints for a home freezer", () => {
    // The example says "~10 °F". Garetz's table is in whole degrees Celsius,
    // and the −12 °C row gives 0.228. A literal 10 °F is −12.22 °C and gives
    // 0.2256, so his 0.228 comes from the −12 row.
    expect(hopTemperatureFactor(-12)).toBeCloseTo(0.228, 3);
    expect(hopTemperatureFactor(-12.22)).toBeCloseTo(0.2256, 4);
  });

  it('agrees with the exponential form other implementations use', () => {
    // `0.39685026… · e^(0.04620981…·T)` is the same curve. The exponent is
    // ln 2 / 15 and the prefactor is 2^(−4/3). The two forms look nothing
    // alike, so this test stops anyone "fixing" ours to match theirs.
    for (const t of [-20, -12, 0, 4, 15, 20, 25]) {
      expect(hopTemperatureFactor(t)).toBeCloseTo(
        0.396_850_262_992_049_84 * Math.exp(0.046_209_812_037_329_68 * t),
        10,
      );
    }
  });

  it('does not pretend to know what a broken sensor means', () => {
    expect(hopTemperatureFactor(Number.NaN)).toBe(1);
  });
});

describe('the storage factors', () => {
  it("keeps Garetz's three and marks the fourth as not his", () => {
    // 1.0 loose is the baseline the loss figures are measured under, and 0.5 is
    // the value the article's example uses. 0.05 is `alchemyoverlord`'s
    // addition for modern professional packaging. See the module header.
    expect(HOP_STORAGE_FACTORS.loose).toBe(1);
    expect(HOP_STORAGE_FACTORS.wrapped).toBe(0.75);
    expect(HOP_STORAGE_FACTORS.vacuum).toBe(0.5);
    expect(HOP_STORAGE_FACTORS['nitrogen-flushed']).toBe(0.05);
  });
});

describe("Garetz's worked example, both halves", () => {
  const cascade = (over: Partial<HopStorage>): HopStorage => ({
    alphaLostSixMonths: CASCADE_LOST,
    months: EXAMPLE_MONTHS,
    storageC: -12,
    packaging: 'vacuum',
    ...over,
  });

  it('ages 6.4 % Cascade to 6.3 % in a freezer, in barrier packaging', () => {
    // "future alpha = 6.4*1/e(0.00385*0.228*0.5*37) … which gives us 6.3%"
    expect(agedAlphaAcidPercent(6.4, cascade({}))).toBeCloseTo(6.3, 1);
    expect(agedAlphaAcidPercent(6.4, cascade({}))).toBeCloseTo(6.297, 2);
  });

  it('ages the same hop to 5.6 % in a poly bag at room temperature', () => {
    // "future alpha = 6.4*1/e(0.00385*1*1*37) … which equals 5.6% alpha"
    const roomTemperature = cascade({ storageC: 20, packaging: 'loose' });
    expect(agedAlphaAcidPercent(6.4, roomTemperature)).toBeCloseTo(5.6, 1);
    expect(agedAlphaAcidPercent(6.4, roomTemperature)).toBeCloseTo(5.55, 2);
  });
});

describe('the remaining fraction', () => {
  const base: HopStorage = {
    alphaLostSixMonths: 0.5,
    months: 6,
    storageC: 20,
    packaging: 'loose',
  };

  it('is the variety figure itself at six months, loose, at 20 °C', () => {
    // This is what "50 % lost in six months at 20 °C with no barrier
    // packaging" means. If this drifts, the model no longer matches the
    // figure it's given.
    expect(hopAlphaRemaining(base)).toBeCloseTo(0.5, 6);
    expect(hopAlphaRemaining({ ...base, alphaLostSixMonths: 0.15 })).toBeCloseTo(0.85, 6);
    expect(hopAlphaRemaining({ ...base, alphaLostSixMonths: 0.38 })).toBeCloseTo(0.62, 6);
  });

  it('is 1 for a hop that has been stored no time at all', () => {
    expect(hopAlphaRemaining({ ...base, months: 0 })).toBe(1);
    expect(hopAlphaRemaining({ ...base, months: -3 })).toBe(1);
  });

  it('never leaves 0…1, however long the hop sits', () => {
    const forgotten = hopAlphaRemaining({ ...base, months: 600 });
    expect(forgotten).toBeGreaterThanOrEqual(0);
    expect(forgotten).toBeLessThan(0.001);
  });

  it('rewards colder storage and better packaging, in that order of size', () => {
    const loose = hopAlphaRemaining(base);
    const wrapped = hopAlphaRemaining({ ...base, packaging: 'wrapped' });
    const vacuum = hopAlphaRemaining({ ...base, packaging: 'vacuum' });
    const flushed = hopAlphaRemaining({ ...base, packaging: 'nitrogen-flushed' });
    expect(loose).toBeLessThan(wrapped);
    expect(wrapped).toBeLessThan(vacuum);
    expect(vacuum).toBeLessThan(flushed);

    // After a year, a freezer and a foil pack together keep the hop worth
    // brewing with. Without them it isn't.
    const year: HopStorage = { ...base, months: 12 };
    expect(hopAlphaRemaining(year)).toBeCloseTo(0.25, 2);
    expect(
      hopAlphaRemaining({ ...year, storageC: -18, packaging: 'nitrogen-flushed' }),
    ).toBeGreaterThan(0.98);
  });

  it('holds an alpha of zero at zero rather than producing a negative one', () => {
    expect(agedAlphaAcidPercent(0, base)).toBe(0);
    expect(agedAlphaAcidPercent(Number.NaN, base)).toBe(0);
  });
});

describe('the default loss figure', () => {
  it("is the mean of Garetz's own table, and can be re-derived from it", () => {
    const TABLE_I = [
      50, 37, 32, 17, 49, 45, 40, 37, 15, 45, 45, 40, 25, 46, 50, 55, 45, 20, 25, 15, 44, 50, 50,
      35, 37, 42, 42, 37,
    ];
    expect(TABLE_I).toHaveLength(28);
    const mean = TABLE_I.reduce((total, value) => total + value, 0) / TABLE_I.length / 100;
    expect(DEFAULT_ALPHA_LOST_SIX_MONTHS).toBeCloseTo(mean, 2);
  });
});

describe('the other HSI', () => {
  it('reads 0.25 for a hop that has lost nothing', () => {
    expect(storageIndexFromRemaining(1)).toBe(FRESH_STORAGE_INDEX);
    expect(storageIndexFromRemaining(1.5)).toBe(FRESH_STORAGE_INDEX);
  });

  it("inverts Nickerson's relation", () => {
    // freshness = 1 − 1.10·log10(HSI × 4), so a round trip through both should
    // come back where it started.
    for (const remaining of [0.95, 0.8, 0.62, 0.5]) {
      const hsi = storageIndexFromRemaining(remaining);
      expect(1 - 1.1 * Math.log10(hsi * 4)).toBeCloseTo(remaining, 10);
    }
  });

  it('climbs as the hop ages, which is the direction the ratio runs', () => {
    expect(storageIndexFromRemaining(0.5)).toBeGreaterThan(storageIndexFromRemaining(0.9));
  });
});

/**
 * The two periods a bought hop has been through.
 *
 * A hop starts losing alpha at harvest, not when it's bought. In between it
 * sat in a merchant's cold store, which is very different from a brewer's
 * cupboard. Applying the brewer's conditions to the whole span badly
 * overstates the loss for anyone who doesn't keep hops in a freezer.
 */
describe('a hop that was harvested before it was bought', () => {
  const CASCADE = { alphaLostSixMonths: 0.5, packaging: 'wrapped' as const, storageC: 20 };

  /**
   * With nothing known about the time before purchase, this must give the same
   * answer as the single-period model.
   */
  it('is today’s single-segment answer when the pre-purchase span is zero', () => {
    const single = hopAlphaRemaining({ ...CASCADE, months: 8 });
    const composed = hopAlphaRemainingSinceHarvest({
      ...CASCADE,
      monthsSincePurchase: 8,
      monthsInTrade: 0,
    });
    expect(composed).toBeCloseTo(single, 12);
  });

  /** Two spans under the same conditions equal one span of their sum. */
  it('composes to one span when both eras are the same conditions', () => {
    const whole = hopAlphaRemaining({ ...CASCADE, months: 12 });
    const parts = hopAlphaRemainingSinceHarvest({
      ...CASCADE,
      monthsSincePurchase: 5,
      monthsInTrade: 7,
      tradeStorage: { storageC: 20, packaging: 'wrapped' },
    });
    expect(parts).toBeCloseTo(whole, 12);
  });

  /**
   * The same hop, a year in trade before it reached a cupboard, shouldn't be
   * charged cupboard conditions for that year.
   */
  it('charges the cold store, not the cupboard, for the years before purchase', () => {
    const asIfMine = hopAlphaRemaining({ ...CASCADE, months: 18 });
    const honest = hopAlphaRemainingSinceHarvest({
      ...CASCADE,
      monthsSincePurchase: 6,
      monthsInTrade: 12,
    });
    expect(honest).toBeGreaterThan(asIfMine);
    // ...but it's still older than a hop bought the month it was picked.
    expect(honest).toBeLessThan(hopAlphaRemaining({ ...CASCADE, months: 6 }));
  });

  it('never leaves the unit interval', () => {
    for (const monthsInTrade of [0, 1, 60, 600]) {
      for (const monthsSincePurchase of [0, 1, 60, 600]) {
        const r = hopAlphaRemainingSinceHarvest({
          ...CASCADE,
          monthsSincePurchase,
          monthsInTrade,
        });
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }
    }
  });
});

/**
 * Which month a crop year means.
 *
 * A year alone is ±6 months and the curve counts days, so the year has to
 * become a date. The hemisphere decides which, and the hop's origin tells us
 * the hemisphere.
 */
describe('the harvest a crop year names', () => {
  it('picks September in the north and March in the south', () => {
    expect(harvestDateForCropYear(2025, 'Germany')).toBe('2025-09-15');
    expect(harvestDateForCropYear(2025, 'United States')).toBe('2025-09-15');
    expect(harvestDateForCropYear(2025, 'New Zealand')).toBe('2025-03-15');
    expect(harvestDateForCropYear(2025, 'Australia')).toBe('2025-03-15');
  });

  /** A brewer's own hop may have free text as its origin, and a lot may have none. */
  it('falls back to the northern harvest when the origin says nothing', () => {
    expect(harvestDateForCropYear(2025, null)).toBe('2025-09-15');
    expect(harvestDateForCropYear(2025, "Dad's allotment")).toBe('2025-09-15');
  });
});

/**
 * The dates entry point, mirroring `viabilityFromManufactureDate`.
 *
 * Callers have dates, not months. The conversion lives here so every caller
 * agrees on what "14 months" means.
 */
describe('ageing a hop from the dates on its lot', () => {
  const KEPT = { alphaLostSixMonths: 0.5, storageC: 20, packaging: 'wrapped' as const };
  const asOf = new Date('2026-09-08T00:00:00Z');

  it('knows nothing and takes nothing away', () => {
    expect(
      hopAlphaRemainingFromDates({ ...KEPT, harvestedAt: null, purchasedAt: null, asOf }),
    ).toBe(1);
  });

  it('runs a single era from the purchase when the crop is unknown', () => {
    const fromDates = hopAlphaRemainingFromDates({
      ...KEPT,
      harvestedAt: null,
      purchasedAt: new Date('2026-03-08T00:00:00Z'),
      asOf,
    });
    expect(fromDates).toBeCloseTo(hopAlphaRemaining({ ...KEPT, months: 184 / 30 }), 6);
  });

  /**
   * A harvest with no purchase can't be split, so the brewer's own conditions
   * apply to the whole span. That overstates the loss, which is the direction
   * this module leans, because the mistake to avoid is telling a brewer their
   * hops are fine when they aren't.
   */
  it('charges the whole span to the brewer when the purchase is unknown', () => {
    const harvestOnly = hopAlphaRemainingFromDates({
      ...KEPT,
      harvestedAt: new Date('2025-09-15T00:00:00Z'),
      purchasedAt: null,
      asOf,
    });
    const bothEras = hopAlphaRemainingFromDates({
      ...KEPT,
      harvestedAt: new Date('2025-09-15T00:00:00Z'),
      purchasedAt: new Date('2026-06-08T00:00:00Z'),
      asOf,
    });
    expect(harvestOnly).toBeLessThan(bothEras);
  });

  /** A lot bought before it was picked is bad data. It mustn't produce a negative period. */
  it('survives a purchase date earlier than the harvest', () => {
    const r = hopAlphaRemainingFromDates({
      ...KEPT,
      harvestedAt: new Date('2026-09-15T00:00:00Z'),
      purchasedAt: new Date('2025-01-01T00:00:00Z'),
      asOf,
    });
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });

  it('takes nothing away for a hop bought and picked today', () => {
    expect(
      hopAlphaRemainingFromDates({ ...KEPT, harvestedAt: asOf, purchasedAt: asOf, asOf }),
    ).toBe(1);
  });
});
