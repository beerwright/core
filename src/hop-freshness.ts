/**
 * Alpha-acid decay in stored hops, so a year-old ounce of Cascade doesn't
 * compute like a fresh one.
 *
 * This module is the decay curve. Callers supply each variety's stability
 * figure. None of this is wired into {@link calculateRecipe}. The IBU
 * calculation reads `alphaAcidPercent` from the hop addition, and that field
 * is already the per-lot override, so ageing a hop means writing a new number
 * into it instead of adding a second field beside it.
 *
 * ## The model, and where every number in it comes from
 *
 * **Garetz.** Mark Garetz, "Hop Storage: How to Get — and Keep — Your Hops'
 * Optimum Value", *Brewing Techniques* vol. 2 no. 1 (1994), reprinted at
 * `morebeer.com/blogs/articles/hop-storage` and read there on 2026-09-01.
 * Brewfather's Hop Freshness tool and BeerSmith's Hop Age Tool both implement
 * it, so a brewer comparing our answer with theirs will get the same one. The
 * article states it as:
 *
 * ```
 * future alpha = A × 1/e^(k × TF × SF × Days)
 * ```
 *
 * - `A`: the alpha acid the hop was rated at when it was fresh.
 * - `k`: a rate constant per variety, derived from that variety's percent
 *   lost, the share of its alpha acids gone after six months at 20 °C with no
 *   protective packaging. See {@link hopDecayRateConstant}.
 * - `TF`: a temperature factor, 1 at 20 °C. See {@link hopTemperatureFactor}.
 * - `SF`: a storage factor for the packaging. See {@link HOP_STORAGE_FACTORS}.
 * - `Days`: days since the hop was that fresh.
 *
 * The tests are pinned to the article's worked example: 6.4 % alpha
 * Cascade (50 % lost), 37 days in a home freezer at about 10 °F in nitrogen-
 * flushed barrier packaging, giving *k* = 0.00385, *TF* = 0.228, *SF* = 0.5 and
 * an answer of 6.3 %. The same hop for the same 37 days at room temperature in a
 * poly bag comes to 5.6 %.
 *
 * ## Limits of the model
 *
 * The output has four decimal places, but it isn't that precise:
 *
 * - It's first-order kinetics fitted to six-month endpoints, not a model of
 *   the mechanism. Oxidation depends on oxygen getting in, and a bag's seal
 *   either holds or it doesn't. One puncture and `SF` is meaningless.
 * - The storage factors reflect 1994 packaging. Garetz's 0.5 for "vacuum
 *   sealed or inert-gas flushed" describes what a homebrewer could do thirty
 *   years ago. The 0.05 for a modern professionally nitrogen-flushed foil pack
 *   isn't his. It's the value the widely-used `alchemyoverlord` implementation
 *   adds for packaging the reference didn't cover. It makes decay twenty times
 *   slower, and we pass it on without having verified it.
 * - It says nothing about aroma. The oils decay too, on a different curve, and
 *   a year-old aroma hop can keep its bittering value after losing the aroma
 *   it was added for. Applied to a dry hop, this gives a number that's
 *   arithmetically right and useless.
 * - Percent lost is a varietal average over crop years, growing regions and
 *   whatever the broker's sample was. It doesn't describe a particular bale.
 *
 * ## Two things called HSI
 *
 * The trade uses "hop storage index" for two different quantities, and
 * homebrew software often mixes them up:
 *
 * 1. The spectrophotometric ratio: absorbance at 275 nm over 325 nm in an
 *    alkaline methanol extract (Nickerson & Likens). Fresh hops read about
 *    0.25, and the number climbs as they oxidise. It's a lab measurement of a
 *    sample.
 * 2. The share of alpha acids lost in six months at 20 °C. This is a
 *    published varietal property: Garetz's Table I, and the "Storage" row in
 *    the Hop Growers of America variety manuals (which give it the other way
 *    up, as percent remaining).
 *
 * This module uses the second, because the curve is defined against it and
 * brokers publish it per variety. {@link storageIndexFromRemaining} converts
 * it to the first, for anyone who has a lab number.
 *
 * That's why we call the input `alphaLostSixMonths` and not `hsi`, which is
 * what Brewfather and BeerSmith call it. Using their label would be easier for
 * someone switching over, but it would bring their ambiguity with it.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import {
  ALCHEMY_OVERLORD_HOP_STORAGE,
  GARETZ_HOP_STORAGE_1994,
  NICKERSON_LIKENS_HSI,
} from './sources';
import type { Celsius, Percent } from './types';
import { daysBetween } from './yeast';

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

/**
 * How a stored hop is kept, best-protected first.
 *
 * This is a tuple so callers can list the options in this order without
 * keeping a second copy of the list.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const HOP_PACKAGINGS = ['nitrogen-flushed', 'vacuum', 'wrapped', 'loose'] as const;

/**
 * How a stored hop is kept. Drives {@link HOP_STORAGE_FACTORS}.
 *
 * @category Hops
 * @group Inputs
 */
export type HopPackaging = (typeof HOP_PACKAGINGS)[number];

/**
 * Garetz's storage factors (his Table IV), plus one for packaging that came
 * after the reference.
 *
 * Each is a multiplier on the decay rate. 1 is the unprotected baseline the
 * percent-lost figures are measured under, and anything lower slows decay.
 *
 * - `loose` (1.0): in a bag, in air. This is the condition Table I uses.
 * - `wrapped` (0.75): a poly bag squeezed shut, or a jar in the cupboard. It
 *   slows air getting in but doesn't keep it out.
 * - `vacuum` (0.5): vacuum sealed or inert-gas flushed at home. Garetz's
 *   worked example uses this figure.
 * - `nitrogen-flushed` (0.05): an unopened, professionally packed foil pouch,
 *   which is how most homebrew hops are sold. This isn't Garetz's number.
 *   It's the one `alchemyoverlord`'s implementation adds for modern packaging,
 *   and it has the biggest effect of anything in the model. Once the pouch is
 *   opened the hop is `wrapped` at best.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const HOP_STORAGE_FACTORS: Readonly<Record<HopPackaging, number>> = {
  'nitrogen-flushed': 0.05,
  vacuum: 0.5,
  wrapped: 0.75,
  loose: 1,
};

// ---------------------------------------------------------------------------
// Where a hop is kept
// ---------------------------------------------------------------------------

/**
 * The places a brewer keeps hops, coldest first.
 *
 * A lot can record where it's kept, so these ids are stored data and every
 * caller has to agree on them. The temperature for each place lives here
 * because the model uses it.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const HOP_STORAGE_PLACES = ['freezer', 'fridge', 'cellar', 'room'] as const;

/**
 * A place a brewer keeps hops.
 *
 * @see HOP_STORAGE_PLACES
 * @category Hops
 * @group Inputs
 */
export type HopStoragePlace = (typeof HOP_STORAGE_PLACES)[number];

/**
 * The temperature of each place in °C, for {@link hopTemperatureFactor}.
 *
 * A domestic freezer is −18 and a fridge is 4 by regulation in most of the
 * world. The other two are the middle of a wide range and are the least
 * precise numbers in this module.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const HOP_STORAGE_PLACE_TEMPERATURES: Readonly<Record<HopStoragePlace, number>> = {
  freezer: -18,
  fridge: 4,
  cellar: 12,
  room: 20,
};

// ---------------------------------------------------------------------------
// The curve
// ---------------------------------------------------------------------------

/**
 * The interval percent-lost figures are quoted over, in days.
 *
 * We use 180. Garetz's "backup math" divides by 180 and his Table II of rate
 * constants is computed that way: 50 % lost gives 0.00385, which `ln 2 / 180`
 * reproduces and `ln 2 / 183` doesn't. The widely-copied `alchemyoverlord`
 * implementation uses 183. We follow the paper. The difference is 1.7 % of the
 * rate either way.
 */
const SIX_MONTHS_DAYS = 180;

/**
 * Days in a month. We use 30, not 30.4.
 *
 * Garetz's six months is 180 days, the divisor in his rate constant, so a
 * month has to be 30 days for the model to match its own definition. With
 * 30.4, a hop with a published 50 % six-month loss, entered as six months,
 * would come back 49.4 % remaining. A brewer typing "6 months" means the
 * number on the packet, not a calendar interval.
 */
const DAYS_PER_MONTH = 30;

/**
 * The temperature percent-lost figures are quoted at, °C.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const HOP_STORAGE_REFERENCE_C: Celsius = 20;

/**
 * The default share of alpha lost in six months, for a variety we have no figure
 * for.
 *
 * 0.38 is the mean of the twenty-eight varieties in Garetz's Table I, which
 * range from Galena and Perle at 15 % to Liberty at 55 %. Using the mean of published data instead of a round number
 * means anyone can re-derive it.
 *
 * It's a poor substitute for the real figure and should be shown as an
 * estimate. For varieties at either end of the range it's badly off. A Galena
 * aged as if it were average loses more than twice the alpha it would in
 * practice, so the brewer should enter the number from the broker's sheet.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const DEFAULT_ALPHA_LOST_SIX_MONTHS = 0.38;

/**
 * The rate constant `k`, from a variety's six-month loss.
 *
 * This is first-order decay fitted to one endpoint. If a fraction `L` is gone
 * after 180 days at the reference temperature with no packaging, then
 *
 * ```
 * 1 − L = e^(−k · 180)   ⟹   k = ln(1 / (1 − L)) / 180
 * ```
 *
 * Garetz publishes this as a lookup table (his Table II). The formula
 * reproduces it: 50 % lost gives 0.003851, and the table says 0.00385.
 *
 * @param alphaLostSixMonths - Fraction, not percent. Clamped to 0.99. A
 *   variety that lost all its alpha in six months would need an infinite rate,
 *   and we'd rather return a very fast curve than let `Infinity` reach a
 *   recipe's IBU.
 *
 * @category Hops
 * @group Calculations
 */
export function hopDecayRateConstant(alphaLostSixMonths: number): number {
  if (!Number.isFinite(alphaLostSixMonths) || alphaLostSixMonths <= 0) return 0;
  const lost = Math.min(alphaLostSixMonths, 0.99);
  return Math.log(1 / (1 - lost)) / SIX_MONTHS_DAYS;
}

/**
 * The temperature factor `TF`, from a storage temperature in °C.
 *
 * Garetz states the rule in words, *"the rate of deterioration is halved for
 * every 15 °C (27 °F) drop in temperature"*, and publishes it as a table. As
 * a formula:
 *
 * ```
 * TF = 2 ^ ((T − 20) / 15)
 * ```
 *
 * This is 1 at the 20 °C the percent-lost figures are quoted at, 0.5 at 5 °C,
 * and 0.226 at the −12 °C of a home freezer. The article's worked example uses
 * 0.228 there, read off its table. The exponential form some
 * implementations use, `0.39685 · e^(0.046210·T)`, is the same curve: 0.046210
 * is `ln 2 / 15` and 0.39685 is `2^(−4/3)`.
 *
 * @category Hops
 * @group Calculations
 */
export function hopTemperatureFactor(storageC: Celsius): number {
  if (!Number.isFinite(storageC)) return 1;
  return 2 ** ((storageC - HOP_STORAGE_REFERENCE_C) / 15);
}

/**
 * How a hop has been kept, and for how long.
 *
 * @category Hops
 * @group Inputs
 */
export interface HopStorage {
  /**
   * The variety's share of alpha lost in six months at 20 °C, unprotected, as a
   * fraction. See the module header on the two meanings of "HSI".
   */
  readonly alphaLostSixMonths: number;
  /** How long it has been stored, in months. */
  readonly months: number;
  /** The storage temperature, °C. */
  readonly storageC: Celsius;
  /** How it is packed. */
  readonly packaging: HopPackaging;
}

/**
 * The fraction of a hop's original alpha acids still there.
 *
 * This is 1 for a hop that hasn't been stored and falls from there. It's
 * clamped to 0–1. Multiply an alpha-acid percentage by it, or call
 * {@link agedAlphaAcidPercent}, which does that.
 *
 * @category Hops
 * @group Calculations
 */
export function hopAlphaRemaining(storage: HopStorage): number {
  const { alphaLostSixMonths, months, storageC, packaging } = storage;
  if (!Number.isFinite(months) || months <= 0) return 1;
  const k = hopDecayRateConstant(alphaLostSixMonths);
  if (k === 0) return 1;
  const days = months * DAYS_PER_MONTH;
  const factor = HOP_STORAGE_FACTORS[packaging] ?? HOP_STORAGE_FACTORS.loose;
  const remaining = 1 / Math.exp(k * hopTemperatureFactor(storageC) * factor * days);
  return Math.min(1, Math.max(0, remaining));
}

/**
 * Storage conditions for the time between harvest and purchase.
 *
 * This constant is ours, not Garetz's, and like the 0.05 packaging factor it's
 * an assumption that affects IBU. Garetz models one span under one set of
 * conditions, because in 1994 the question was how long the brewer had had
 * the hops. With a crop year we also know how long the hops were in the trade.
 * Using the brewer's own storage for that time would charge them eighteen
 * months at cupboard temperature for hops that spent it at 2 °C under nitrogen
 * in a merchant's cold store.
 *
 * The figures are typical conditions between harvest and a homebrew shop's
 * shelf: baled or packed under inert gas and held just above freezing. They're
 * conservative, since a real cold store is often colder, because the mistake
 * we most want to avoid is telling a brewer their hops are fine when they
 * aren't.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const TRADE_STORAGE: Readonly<{
  /** Storage temperature in the trade, °C. */
  storageC: Celsius;
  /** How the hops are packed in the trade. */
  packaging: HopPackaging;
}> = {
  storageC: 2,
  packaging: 'nitrogen-flushed',
};

/**
 * How a hop has been kept since it was picked, split into two periods.
 *
 * @see TRADE_STORAGE
 * @category Hops
 * @group Inputs
 */
export interface HopStorageSinceHarvest {
  /** @see HopStorage.alphaLostSixMonths */
  readonly alphaLostSixMonths: number;
  /** Months the brewer has had it. */
  readonly monthsSincePurchase: number;
  /** Months between harvest and purchase. `0` reduces this to one period. */
  readonly monthsInTrade: number;
  /** The brewer's own storage temperature, °C. */
  readonly storageC: Celsius;
  /** How the brewer keeps it. */
  readonly packaging: HopPackaging;
  /** Overrides {@link TRADE_STORAGE}. Only tests should need this. */
  readonly tradeStorage?: {
    /** Storage temperature in the trade, °C. */
    readonly storageC: Celsius;
    /** How the hops are packed in the trade. */
    readonly packaging: HopPackaging;
  };
}

/**
 * The fraction of alpha still there after both periods.
 *
 * First-order decay is memoryless, so the two spans combine by multiplying the
 * cold store's exponential by the cupboard's. That's why this doesn't need a
 * second model, and why `monthsInTrade: 0` returns the same answer as
 * {@link hopAlphaRemaining}. There's a test for that.
 *
 * @category Hops
 * @group Calculations
 */
export function hopAlphaRemainingSinceHarvest(storage: HopStorageSinceHarvest): number {
  const trade = storage.tradeStorage ?? TRADE_STORAGE;
  const inTrade = hopAlphaRemaining({
    alphaLostSixMonths: storage.alphaLostSixMonths,
    months: storage.monthsInTrade,
    storageC: trade.storageC,
    packaging: trade.packaging,
  });
  const sincePurchase = hopAlphaRemaining({
    alphaLostSixMonths: storage.alphaLostSixMonths,
    months: storage.monthsSincePurchase,
    storageC: storage.storageC,
    packaging: storage.packaging,
  });
  return Math.min(1, Math.max(0, inTrade * sincePurchase));
}

/**
 * What {@link hopAlphaRemainingFromDates} needs to know about a lot.
 *
 * @category Hops
 * @group Inputs
 */
export interface HopLotDates {
  /** @see HopStorage.alphaLostSixMonths */
  readonly alphaLostSixMonths: number;
  /** When it was picked, or `null` if the bag doesn't say. */
  readonly harvestedAt: Date | null;
  /** When the brewer bought it, or `null` if they didn't record it. */
  readonly purchasedAt: Date | null;
  /** The day being asked about. */
  readonly asOf: Date;
  /** The brewer's own storage temperature, °C. */
  readonly storageC: Celsius;
  /** How the brewer keeps it. */
  readonly packaging: HopPackaging;
}

/**
 * The fraction of alpha left on a lot, from the dates it carries.
 *
 * This is the counterpart of `viabilityFromManufactureDate`, for the same
 * reason. Callers have dates, and converting them to the model's units belongs
 * here so that every caller agrees on what "14 months" means.
 *
 * There are three cases, and the third is a judgement call:
 *
 * - Neither date: nothing is known, so nothing is taken away.
 * - Purchase only: one period under the brewer's conditions.
 * - Harvest but no purchase: the span can't be split, so the brewer's
 *   conditions are applied to all of it. That overstates the loss, which is
 *   the direction we lean everywhere in this module, because the mistake to
 *   avoid is telling a brewer their hops are fine when they aren't.
 *
 * @category Hops
 * @group Calculations
 */
export function hopAlphaRemainingFromDates(lot: HopLotDates): number {
  const { alphaLostSixMonths, harvestedAt, purchasedAt, asOf, storageC, packaging } = lot;
  const months = (from: Date) => daysBetween(from, asOf) / DAYS_PER_MONTH;

  if (harvestedAt === null && purchasedAt === null) return 1;
  if (harvestedAt === null && purchasedAt !== null) {
    return hopAlphaRemaining({
      alphaLostSixMonths,
      months: months(purchasedAt),
      storageC,
      packaging,
    });
  }
  if (harvestedAt !== null && purchasedAt === null) {
    return hopAlphaRemaining({
      alphaLostSixMonths,
      months: months(harvestedAt),
      storageC,
      packaging,
    });
  }

  // Both dates. `daysBetween` floors at zero, so a lot recorded as bought
  // before it was picked becomes a single period instead of getting negative
  // time.
  const monthsSincePurchase = months(purchasedAt as Date);
  const monthsInTrade = daysBetween(harvestedAt as Date, purchasedAt as Date) / DAYS_PER_MONTH;
  return hopAlphaRemainingSinceHarvest({
    alphaLostSixMonths,
    monthsSincePurchase,
    monthsInTrade,
    storageC,
    packaging,
  });
}

// ---------------------------------------------------------------------------
// Crop year
// ---------------------------------------------------------------------------

/**
 * Origins that harvest in the southern autumn, matched against the hop's
 * `origin` country string.
 *
 * New Zealand, Australia, South Africa and Argentina are the only significant
 * hop-growing countries in the southern hemisphere.
 */
const SOUTHERN_ORIGINS: readonly string[] = [
  'New Zealand',
  'Australia',
  'South Africa',
  'Argentina',
];

/** The middle of the northern harvest, and of the southern one. */
const NORTHERN_HARVEST_MONTH_DAY = '09-15';
const SOUTHERN_HARVEST_MONTH_DAY = '03-15';

/**
 * The date a crop year means, as an ISO day.
 *
 * We use the middle of the picking window, which is about three weeks wide,
 * because it's off by less than the start would be. The year comes from the
 * bag. The month and day are our assumption, so anything showing a figure
 * derived from this should say the date was assumed.
 *
 * `origin` is a country string. A brewer's own hop may have free text there,
 * and a lot may have nothing at all. Both fall back to the northern harvest,
 * which is where most of the world's hops grow.
 *
 * @category Hops
 * @group Calculations
 */
export function harvestDateForCropYear(cropYear: number, origin: string | null): string {
  const southern = origin !== null && SOUTHERN_ORIGINS.includes(origin);
  return `${cropYear}-${southern ? SOUTHERN_HARVEST_MONTH_DAY : NORTHERN_HARVEST_MONTH_DAY}`;
}

/**
 * An alpha-acid percentage aged by {@link hopAlphaRemaining}.
 *
 * This is separate from the fraction so the fraction can be tested on its
 * own, while callers get a function that turns 6.4 % into 5.6 %.
 *
 * @category Hops
 * @group Start here
 */
export function agedAlphaAcidPercent(alphaAcidPercent: Percent, storage: HopStorage): Percent {
  if (!Number.isFinite(alphaAcidPercent) || alphaAcidPercent <= 0) return 0;
  return alphaAcidPercent * hopAlphaRemaining(storage);
}

// ---------------------------------------------------------------------------
// The other HSI
// ---------------------------------------------------------------------------

/**
 * The lowest a spectrophotometric HSI goes: a fresh hop.
 *
 * Nickerson & Likens' ratio reads about 0.25 on hops straight off the kiln
 * and climbs from there. A calculated value below 0.25 is treated as fresh,
 * not as a measurement error.
 *
 * @category Hops
 * @group Constants and defaults
 */
export const FRESH_STORAGE_INDEX = 0.25;

/**
 * The spectrophotometric HSI a given remaining-alpha fraction corresponds to.
 *
 * This inverts Nickerson's relation,
 *
 * ```
 * remaining = 1.0 − 1.10 · log10(HSI × 4.0)
 * ```
 *
 * and therefore
 *
 * ```
 * HSI = 0.25 × 10 ^ ((1 − remaining) / 1.10)
 * ```
 *
 * A brewer who has had a lab measure their hops has an HSI and no
 * percent-lost figure, and this converts between them. The decay curve above
 * doesn't use it. See the module header on why the two are easy to confuse.
 *
 * @category Hops
 * @group Calculations
 */
export function storageIndexFromRemaining(remaining: number): number {
  if (!Number.isFinite(remaining) || remaining >= 1) return FRESH_STORAGE_INDEX;
  return FRESH_STORAGE_INDEX * 10 ** ((1 - remaining) / 1.1);
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

/**
 * An aged alpha-acid percentage with its breakdown.
 *
 * @category Hops
 * @group Explanations
 */
export function hopFreshnessExplained(alphaAcidPercent: Percent, storage: HopStorage): Explanation {
  const remaining = hopAlphaRemaining(storage);
  const aged = agedAlphaAcidPercent(alphaAcidPercent, storage);
  const round = (n: number, dp: number) => Number(n.toFixed(dp));
  return explain(aged, {
    label: 'Alpha acid after storage',
    formula: 'garetz-hop-storage',
    expression: 'future alpha = A × 1 / e^(k × TF × SF × days)',
    inputs: {
      freshAlphaAcidPercent: round(alphaAcidPercent, 2),
      alphaLostSixMonths: round(storage.alphaLostSixMonths, 3),
      months: storage.months,
      days: storage.months * 30,
      storageC: round(storage.storageC, 1),
      packaging: storage.packaging,
      rateConstantK: round(hopDecayRateConstant(storage.alphaLostSixMonths), 5),
      temperatureFactor: round(hopTemperatureFactor(storage.storageC), 4),
      storageFactor: HOP_STORAGE_FACTORS[storage.packaging],
      fractionRemaining: round(remaining, 4),
    },
    unit: '%',
    notes: [
      "Six months is 180 days here, which is the divisor in Garetz's own rate constants.",
      "The storage factor for a professionally nitrogen-flushed pouch is not Garetz's figure, and it is the single biggest lever in the model.",
      'Alpha acids decay, and so do the oils, on a different curve. This says nothing about aroma, so aging a dry hop with it gives a correct alpha figure that tells you nothing useful.',
      `Percent lost is a varietal average over crop years and regions, not this bale.`,
    ],
    family: 'freshness',
    sources: [GARETZ_HOP_STORAGE_1994, ALCHEMY_OVERLORD_HOP_STORAGE, NICKERSON_LIKENS_HSI],
  });
}
