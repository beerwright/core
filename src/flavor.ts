/**
 * Flavor wheels: three wheels of 0–5 scores describing how a recipe should
 * taste, and how close that is to a style's ranges.
 *
 * These are rough estimates and should be shown to people as estimates. The
 * module doesn't look anything up. Callers pass in each ingredient's scores,
 * the same way the IBU code takes an alpha acid instead of a hop name.
 */

import type { HopUse } from './types';

/**
 * The three wheels, in display order.
 *
 * @category Flavor
 * @group Constants and defaults
 */
export const FLAVOR_WHEELS = ['hop', 'malt', 'fermentation'] as const;
/**
 * One of the three wheels.
 *
 * @category Flavor
 * @group Inputs
 */
export type FlavorWheel = (typeof FLAVOR_WHEELS)[number];

/**
 * The axes on each wheel, in display order.
 *
 * @category Flavor
 * @group Constants and defaults
 */
export const FLAVOR_AXES = {
  /** Axes on the hop wheel. */
  hop: [
    'citrus',
    'tropical',
    'stoneFruit',
    'berry',
    'floral',
    'herbal',
    'spice',
    'grassy',
    'resinPine',
    'earthy',
  ],
  /** Axes on the malt wheel. */
  malt: [
    'grainy',
    'bready',
    'toasty',
    'caramel',
    'darkFruit',
    'chocolate',
    'roast',
    'nutty',
    'sweet',
    'smoke',
  ],
  /** Axes on the fermentation wheel. */
  fermentation: ['clean', 'fruity', 'banana', 'clove', 'pepper', 'sulfur', 'tart', 'funk'],
} as const;

/**
 * An axis on the hop wheel.
 *
 * @category Flavor
 * @group Inputs
 */
export type HopAxis = (typeof FLAVOR_AXES.hop)[number];
/**
 * An axis on the malt wheel.
 *
 * @category Flavor
 * @group Inputs
 */
export type MaltAxis = (typeof FLAVOR_AXES.malt)[number];
/**
 * An axis on the fermentation wheel.
 *
 * @category Flavor
 * @group Inputs
 */
export type FermentationAxis = (typeof FLAVOR_AXES.fermentation)[number];
/**
 * The axes of wheel `W`.
 *
 * @category Flavor
 * @group Inputs
 */
export type AxisOf<W extends FlavorWheel> = (typeof FLAVOR_AXES)[W][number];

/**
 * An ingredient's scores, 0–5. A missing axis counts as 0.
 *
 * @category Flavor
 * @group Inputs
 */
export type AxisScores<W extends FlavorWheel> = Partial<Record<AxisOf<W>, number>>;

/**
 * A recipe's three wheels, every axis present.
 *
 * @category Flavor
 * @group Inputs
 */
export type WheelValues = { [W in FlavorWheel]: Record<AxisOf<W>, number> };

/**
 * Display names for the wheels.
 *
 * @category Flavor
 * @group Constants and defaults
 */
export const FLAVOR_WHEEL_LABELS: Readonly<Record<FlavorWheel, string>> = {
  hop: 'Hops',
  malt: 'Malt',
  fermentation: 'Fermentation',
};

/**
 * Display names for every axis, by wheel.
 *
 * @category Flavor
 * @group Constants and defaults
 */
export const FLAVOR_AXIS_LABELS: {
  readonly [W in FlavorWheel]: Readonly<Record<AxisOf<W>, string>>;
} = {
  hop: {
    citrus: 'Citrus',
    tropical: 'Tropical',
    stoneFruit: 'Stone fruit',
    berry: 'Berry',
    floral: 'Floral',
    herbal: 'Herbal',
    spice: 'Spice',
    grassy: 'Grassy',
    resinPine: 'Resin/pine',
    earthy: 'Earthy/woody',
  },
  malt: {
    grainy: 'Grainy',
    bready: 'Bready/biscuit',
    toasty: 'Toasty',
    caramel: 'Caramel',
    darkFruit: 'Dark fruit',
    chocolate: 'Chocolate',
    roast: 'Coffee/roast',
    nutty: 'Nutty',
    sweet: 'Sweet/honey',
    smoke: 'Smoke',
  },
  fermentation: {
    clean: 'Clean',
    fruity: 'Fruity esters',
    banana: 'Banana',
    clove: 'Clove',
    pepper: 'Pepper/spice',
    sulfur: 'Sulfur',
    tart: 'Tart',
    funk: 'Funk',
  },
};

/**
 * An inclusive `[low, high]` on the 0–5 scale.
 *
 * @category Flavor
 * @group Inputs
 */
export type FlavorBand = readonly [number, number];

/**
 * A style's flavor ranges. An axis that's left out counts as "not
 * characteristic", `[0, 1]`. `weights` sum to 1.
 *
 * @category Flavor
 * @group Inputs
 */
export interface StyleFlavorBands {
  /** Bands for the hop axes the style describes. */
  readonly hop: Partial<Record<HopAxis, FlavorBand>>;
  /** Bands for the malt axes the style describes. */
  readonly malt: Partial<Record<MaltAxis, FlavorBand>>;
  /** Bands for the fermentation axes the style describes. */
  readonly fermentation: Partial<Record<FermentationAxis, FlavorBand>>;
  /** How much each wheel counts toward the overall fit, as fractions that sum to 1. */
  readonly weights: Readonly<Record<FlavorWheel, number>>;
  /** Where the reading came from, e.g. `BJCP 2021 aroma and flavor, read 2026-10`. */
  readonly basis: string;
}

/**
 * The band for an axis a style leaves out: `[0, 1]`, not characteristic.
 *
 * @category Flavor
 * @group Constants and defaults
 */
export const UNCHARACTERISTIC: FlavorBand = [0, 1];

/**
 * A style's band for one axis, or `UNCHARACTERISTIC` if the style leaves it out.
 *
 * @category Flavor
 * @group Calculations
 */
export function bandFor<W extends FlavorWheel>(
  bands: StyleFlavorBands,
  wheel: W,
  axis: AxisOf<W>,
): FlavorBand {
  const authored = (bands[wheel] as Partial<Record<string, FlavorBand>>)[axis];
  return authored ?? UNCHARACTERISTIC;
}

/**
 * An axis that falls outside its band.
 *
 * @category Flavor
 * @group Results
 */
export interface FlavorMiss {
  /** The wheel the axis is on. */
  readonly wheel: FlavorWheel;
  /** The axis that missed, one of that wheel's {@link FLAVOR_AXES}. */
  readonly axis: string;
  /** The recipe's value, one decimal. */
  readonly value: number;
  /** The style's band for the axis, on the 0–5 scale. */
  readonly band: FlavorBand;
  /** Distance to the nearer edge of the band, one decimal. */
  readonly cost: number;
}

/**
 * How close a recipe's wheels are to a style's bands. The result of {@link flavorFit}.
 *
 * @category Flavor
 * @group Results
 */
export interface FlavorFit {
  /** 0–100, rounded to a whole number. */
  readonly overall: number;
  /** Each wheel's own score, 0–100, rounded to a whole number. */
  readonly wheels: Readonly<Record<FlavorWheel, number>>;
  /** Sorted by cost, largest first. */
  readonly misses: readonly FlavorMiss[];
}

/**
 * How fast a wheel's score falls as the total distance outside its bands grows.
 *
 * The score is `100·exp(-cost / 3)`, so one axis a whole point out scores 72
 * and two points out scores 51. It never goes negative and never reaches
 * zero, which suits an estimate.
 */
const FIT_FALLOFF = 3;

/**
 * The most the overall score can be above the worst wheel.
 *
 * This stops one badly-off wheel being averaged away by the others. A Double
 * IPA's hops don't fit a light lager however clean its malt and yeast are. A
 * beer that fits every wheel reasonably well isn't affected, because its
 * weighted mean is already within 30 of its worst wheel.
 *
 * @category Flavor
 * @group Constants and defaults
 */
export const FIT_WORST_WHEEL_LEAD = 30;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Scores how close a recipe's wheels are to a style's bands. Each axis outside
 * its band costs its distance to the nearer edge, a wheel scores
 * `100·exp(-total / FIT_FALLOFF)`, and the overall is the style-weighted mean,
 * capped at `FIT_WORST_WHEEL_LEAD` above the worst wheel.
 *
 * @category Flavor
 * @group Start here
 */
export function flavorFit(values: WheelValues, bands: StyleFlavorBands): FlavorFit {
  const misses: FlavorMiss[] = [];
  const wheels = {} as Record<FlavorWheel, number>;
  for (const wheel of FLAVOR_WHEELS) {
    let total = 0;
    for (const axis of FLAVOR_AXES[wheel]) {
      const value = (values[wheel] as Record<string, number>)[axis] ?? 0;
      const band = bandFor(bands, wheel, axis as AxisOf<typeof wheel>);
      const cost = value < band[0] ? band[0] - value : value > band[1] ? value - band[1] : 0;
      if (cost > 0.05) {
        total += cost;
        misses.push({ wheel, axis, value: round1(value), band, cost: round1(cost) });
      }
    }
    wheels[wheel] = Math.round(100 * Math.exp(-total / FIT_FALLOFF));
  }
  const weightedMean = FLAVOR_WHEELS.reduce(
    (sum, wheel) => sum + bands.weights[wheel] * wheels[wheel],
    0,
  );
  const worstWheel = Math.min(...FLAVOR_WHEELS.map((wheel) => wheels[wheel]));
  const overall = Math.round(Math.min(weightedMean, worstWheel + FIT_WORST_WHEEL_LEAD));
  misses.sort((a, b) => b.cost - a.cost);
  return { overall, wheels, misses };
}

/**
 * The parts of a hop addition the flavor wheels use.
 *
 * @category Flavor
 * @group Inputs
 */
export interface FlavorHop {
  /** The hop's name, used to report what contributed to each axis. */
  readonly name: string;
  /** Amount, in kilograms. */
  readonly amountKg: number;
  /** How the hop is used. */
  readonly use: HopUse;
  /** Boil time, in minutes. Only boil additions read it. */
  readonly timeMinutes: number;
  /** Whirlpool stand temperature, in °C. Only whirlpool additions read it, and it defaults to 80. */
  readonly whirlpoolTempC?: number;
  /** The hop's 0–5 scores, or `null` when it has none. */
  readonly scores: AxisScores<'hop'> | null;
}
/**
 * The parts of a fermentable the flavor wheels use.
 *
 * @category Flavor
 * @group Inputs
 */
export interface FlavorMalt {
  /** The fermentable's name, used to report what contributed to each axis. */
  readonly name: string;
  /** Amount, in kilograms. */
  readonly amountKg: number;
  /** A multiplier on this malt's scores for how strongly it flavors the beer. */
  readonly potency: number;
  /** The fermentable's 0–5 scores, or `null` when it has none. */
  readonly scores: AxisScores<'malt'> | null;
}
/**
 * The parts of a yeast the flavor wheels use.
 *
 * @category Flavor
 * @group Inputs
 */
export interface FlavorYeast {
  /** The yeast's name, used to report what contributed to each axis. */
  readonly name: string;
  /** The strain's 0–5 scores, or `null` when it has none. */
  readonly scores: AxisScores<'fermentation'> | null;
  /** The strain's published fermentation range, in °C, or `null` when unknown. */
  readonly rangeC: {
    /** Bottom of the range, in °C. */
    readonly min: number;
    /** Top of the range, in °C. */
    readonly max: number;
  } | null;
}
/**
 * The parts of a recipe the flavor wheels use.
 *
 * @category Flavor
 * @group Inputs
 */
export interface FlavorInput {
  /** Batch volume the hop amounts are spread over, in liters. */
  readonly volumeL: number;
  /** The recipe's hop additions. */
  readonly hops: readonly FlavorHop[];
  /** The recipe's fermentables. */
  readonly malts: readonly FlavorMalt[];
  /** The recipe's yeasts. */
  readonly yeasts: readonly FlavorYeast[];
  /** Primary fermentation temperature in °C, or null if it isn't set. */
  readonly fermentTempC: number | null;
}
/**
 * One ingredient's share of an axis.
 *
 * @category Flavor
 * @group Results
 */
export interface FlavorContribution {
  /** The ingredient's name. */
  readonly name: string;
  /** Its share of the axis, as a fraction from 0 to 1. */
  readonly share: number;
}
/**
 * A recipe's three wheels and which ingredients contributed to each axis.
 *
 * @category Flavor
 * @group Results
 */
export interface FlavorProfile {
  /** The recipe's score on every axis, 0–5, one decimal. */
  readonly values: WheelValues;
  /** For each wheel and axis, the contributing ingredients, largest first. Shares sum to 1. */
  readonly causes: {
    /** Contributors to each hop axis. */
    readonly hop: Partial<Record<HopAxis, readonly FlavorContribution[]>>;
    /** Contributors to each malt axis. */
    readonly malt: Partial<Record<MaltAxis, readonly FlavorContribution[]>>;
    /** The strain behind each fermentation axis. */
    readonly fermentation: Partial<Record<FermentationAxis, readonly FlavorContribution[]>>;
  };
  /** Ingredient names with no scores at all. */
  readonly unscored: readonly string[];
}

/**
 * How much of a hop's aroma survives, given how it's used.
 *
 * Dry hop and keg keep all of it. Whirlpool depends on temperature: 1 at
 * 70 °C or below, falling linearly to 0.4 at 100 °C, because the oils boil off
 * faster the hotter the stand. Boil additions decay with time,
 * `0.8·exp(-t/15)`, so ten minutes keeps about 40 % and sixty keeps under 2 %.
 * First wort is 0.05.
 *
 * @category Flavor
 * @group Calculations
 */
export function hopUseFactor(
  hop: Pick<FlavorHop, 'use' | 'timeMinutes' | 'whirlpoolTempC'>,
): number {
  switch (hop.use) {
    case 'dry-hop':
    case 'keg':
      return 1;
    case 'whirlpool': {
      const t = hop.whirlpoolTempC ?? 80;
      return Math.min(1, Math.max(0.4, 1 - ((t - 70) / 30) * 0.6));
    }
    case 'boil':
      return 0.8 * Math.exp(-Math.max(0, hop.timeMinutes) / 15);
    case 'first-wort':
      return 0.05;
  }
}

/**
 * Maps a raw sum to 0–5 with one saturating curve per wheel: `5·(1 − exp(−raw/k))`.
 *
 * Hop raw is grams per liter × score × use factor, so at `hop: 12` a Pils with
 * 1.5 g/L of Saaz (floral 4) in an 80 °C whirlpool reads floral about 1.7,
 * 5 g/L of a score-4 dry hop reads about 4, and a hazy IPA's 15 g/L reads 5.
 * Malt raw is grist share × score × potency.
 *
 * The k constants are a first calibration, tuned by hand against six made-up
 * recipes: a Pils, a Weissbier, a dry stout, a West Coast IPA, a NEIPA and a
 * saison. They haven't been checked against real medal-winning recipes yet.
 *
 * @category Flavor
 * @group Constants and defaults
 */
export const FLAVOR_CURVE: Readonly<Record<'hop' | 'malt', number>> = { hop: 12, malt: 2 };

const saturate = (raw: number, k: number) => (raw <= 0 ? 0 : 5 * (1 - Math.exp(-raw / k)));

/** Where a temperature sits in a strain's range: 0 at the bottom, 1 at the top, clamped to [-0.5, 1.5]. */
function rangePosition(tempC: number | null, range: FlavorYeast['rangeC']): number {
  if (tempC === null || range === null || range.max <= range.min) return 0.5;
  return Math.min(1.5, Math.max(-0.5, (tempC - range.min) / (range.max - range.min)));
}

const ESTERY = new Set<FermentationAxis>(['fruity', 'banana', 'clove', 'pepper']);

function emptyWheels(): WheelValues {
  const wheel = <W extends FlavorWheel>(w: W) =>
    Object.fromEntries(FLAVOR_AXES[w].map((axis) => [axis, 0])) as Record<AxisOf<W>, number>;
  return { hop: wheel('hop'), malt: wheel('malt'), fermentation: wheel('fermentation') };
}

/** Sums raw scores and contributions for one wheel, then saturates them. */
function sumWheel<W extends 'hop' | 'malt'>(
  wheel: W,
  items: readonly {
    readonly name: string;
    readonly weight: number;
    readonly scores: AxisScores<W> | null;
  }[],
  out: WheelValues,
  causes: Record<string, Record<string, FlavorContribution[]>>,
): void {
  const raw: Record<string, number> = {};
  const by: Record<string, Map<string, number>> = {};
  for (const item of items) {
    if (item.scores === null || item.weight <= 0) continue;
    for (const [axis, score] of Object.entries(item.scores) as [string, number][]) {
      const add = item.weight * score;
      if (add <= 0) continue;
      raw[axis] = (raw[axis] ?? 0) + add;
      const names = by[axis] ?? new Map<string, number>();
      by[axis] = names;
      names.set(item.name, (names.get(item.name) ?? 0) + add);
    }
  }
  const target = out[wheel] as Record<string, number>;
  const wheelCauses: Record<string, FlavorContribution[]> = {};
  for (const [axis, total] of Object.entries(raw)) {
    target[axis] = round1(saturate(total, FLAVOR_CURVE[wheel]));
    wheelCauses[axis] = [...(by[axis] ?? new Map())]
      .map(([name, part]) => ({ name, share: part / total }))
      .sort((a, b) => b.share - a.share);
  }
  causes[wheel] = wheelCauses;
}

/**
 * Works out a recipe's three wheels.
 *
 * Hops sum per liter, weighted by their use factor. Malts sum by grist share
 * times potency. Both go through `FLAVOR_CURVE`. Yeasts don't sum. Each axis
 * takes the strongest strain, adjusted by where the fermentation temperature
 * falls in that strain's range.
 *
 * @category Flavor
 * @group Start here
 */
export function flavorProfile(input: FlavorInput): FlavorProfile {
  const values = emptyWheels();
  const causes: Record<string, Record<string, FlavorContribution[]>> = {};
  const unscored = [
    ...input.hops.filter((h) => h.scores === null),
    ...input.malts.filter((m) => m.scores === null),
    ...input.yeasts.filter((y) => y.scores === null),
  ].map((item) => item.name);

  const perLiter = input.volumeL > 0 ? 1000 / input.volumeL : 0;
  sumWheel(
    'hop',
    input.hops.map((h) => ({
      name: h.name,
      scores: h.scores,
      weight: h.amountKg * perLiter * hopUseFactor(h),
    })),
    values,
    causes,
  );

  const grist = input.malts.reduce((sum, m) => sum + m.amountKg, 0);
  sumWheel(
    'malt',
    input.malts.map((m) => ({
      name: m.name,
      scores: m.scores,
      weight: grist > 0 ? (m.amountKg / grist) * m.potency : 0,
    })),
    values,
    causes,
  );

  const fermentCauses: Record<string, FlavorContribution[]> = {};
  for (const yeast of input.yeasts) {
    if (yeast.scores === null) continue;
    const p = rangePosition(input.fermentTempC, yeast.rangeC);
    for (const [axis, score] of Object.entries(yeast.scores) as [FermentationAxis, number][]) {
      const tilt = ESTERY.has(axis) ? 0.6 + 0.8 * p : axis === 'clean' ? 1.4 - 0.8 * p : 1;
      const value = round1(Math.min(5, Math.max(0, score * tilt)));
      if (value > values.fermentation[axis]) {
        values.fermentation[axis] = value;
        fermentCauses[axis] = [{ name: yeast.name, share: 1 }];
      }
    }
  }
  causes.fermentation = fermentCauses;

  return { values, causes: causes as unknown as FlavorProfile['causes'], unscored };
}
