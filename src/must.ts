/**
 * Building a must, and the yeast nutrients to ferment it.
 *
 * A mead, cider or wine needs two numbers first: how much honey or sugar gets
 * to the target gravity, and how much nitrogen the yeast needs to ferment it.
 * Neither is a beer calculation (a beer's extract comes from the mash, and
 * wort already has its own nitrogen), so they're here and not in `gravity.ts`
 * or `yeast.ts`.
 *
 * Units are kilograms, litres and SG. TOSNA is published in gallons and Brix,
 * so `nutrientSchedule` converts to those internally and reports them in its
 * explanation, so a brewer can check the working against the published page.
 */

import { sugarToTargetGravity } from './corrections';
import { POINTS_PER_KG_PER_L_PER_PPG } from './defaults';
import type { Explanation } from './explain';
import { explain } from './explain';
import { MOUTELA_TOSNA, PALMER_HOW_TO_BREW, SCHRAMM_COMPLEAT_MEADMAKER_2003 } from './sources';
import type { Litres, SpecificGravity } from './types';
import { sgToBrix, sgToGravityPoints } from './units/gravity';
import { litresToGallons } from './units/volume';

// ---------------------------------------------------------------------------
// Sugar to a gravity
// ---------------------------------------------------------------------------

/**
 * The sugar being dissolved into the must.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export type MustSugar = 'honey' | 'sucrose' | 'dextrose';

/**
 * Display label for each sugar.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const MUST_SUGAR_LABELS: Readonly<Record<MustSugar, string>> = {
  honey: 'Honey',
  sucrose: 'Sucrose (table sugar)',
  dextrose: 'Dextrose (corn sugar)',
};

/**
 * Yield in points per pound per US gallon.
 *
 * Sucrose and dextrose are Palmer's extract-potential figures, which most
 * homebrewing calculators use. Honey is Schramm's 35. It's lower than either
 * because honey is 15–18 % water by mass, so a kilogram of honey holds only
 * about four fifths of a kilogram of sugar.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const MUST_SUGAR_PPG: Readonly<Record<MustSugar, number>> = {
  honey: 35,
  sucrose: 46.2,
  dextrose: 42,
};

/**
 * The same yields in points·litres per kilogram, the unit the rest of the
 * package uses.
 *
 * `points·L/kg = PPG × 8.345404` ({@link POINTS_PER_KG_PER_L_PER_PPG}), the
 * same conversion `gravity.ts` uses for malts. Deriving them instead of
 * hard-coding three more decimals keeps the two in agreement.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const MUST_SUGAR_POINTS_L_PER_KG: Readonly<Record<MustSugar, number>> = {
  honey: MUST_SUGAR_PPG.honey * POINTS_PER_KG_PER_L_PER_PPG,
  sucrose: MUST_SUGAR_PPG.sucrose * POINTS_PER_KG_PER_L_PER_PPG,
  dextrose: MUST_SUGAR_PPG.dextrose * POINTS_PER_KG_PER_L_PER_PPG,
};

/**
 * Input to {@link sugarToGravity}.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface SugarToGravityInput {
  /** Current gravity of the liquid, SG. Water is 1.000; a juice is whatever it reads. */
  readonly currentSg: SpecificGravity;
  /** Target gravity, SG. */
  readonly targetSg: SpecificGravity;
  /** Volume of liquid, litres. */
  readonly volumeL: Litres;
  /** The sugar being added. */
  readonly sugar: MustSugar;
}

/**
 * Result of {@link sugarToGravity}.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface SugarToGravityResult {
  /** Sugar to add, kilograms. */
  readonly massKg: number;
}

/**
 * Honey, sucrose or dextrose to bring a liquid up to a gravity.
 *
 * ```
 * kg = (target_points − current_points) × volume_L / yield_points·L/kg
 * ```
 *
 * This calls `sugarToTargetGravity` in `corrections.ts`, which conserves
 * extract (the same rule as "my pre-boil is low, how much DME?"), with the
 * yield table above as the divisor.
 *
 * ## One calculation, three uses
 *
 * Building a honey must from water, chaptalising a thin juice, and
 * backsweetening a stabilised drink are the same calculation. The function
 * doesn't need to know which one it's doing: `currentSg` says whether the
 * brewer is starting from water or from something that already has sugar.
 *
 * ## The sugar's own volume is not counted
 *
 * The answer is the mass that reaches the target *in the volume given*, but
 * dissolving it increases the volume by about 0.7 L per kilogram of honey.
 * Including that would mean solving for a volume that depends on the answer.
 * A mead maker filling a carboy wants to know how much honey to add and then
 * leave room for it. The explanation has a note about this.
 *
 * `spirits.ts`'s `proofAndSweeten` does count the sugar's volume, because an
 * amaro maker fixes the strength and the sweetness and solves for the volume,
 * so the sugar's volume is part of the unknown. The two functions answer
 * different questions with the same chemistry.
 *
 * A target at or below the current gravity returns zero, because adding sugar
 * can't lower a gravity. For diluting, use `dilutionToTargetGravity` in
 * `corrections.ts`.
 *
 * @category Blending, mead and spirits
 * @group Start here
 */
export function sugarToGravity(input: SugarToGravityInput): SugarToGravityResult {
  if (input.volumeL <= 0) return { massKg: 0 };
  return {
    massKg: sugarToTargetGravity(
      input.volumeL,
      input.currentSg,
      input.targetSg,
      MUST_SUGAR_POINTS_L_PER_KG[input.sugar],
    ),
  };
}

// ---------------------------------------------------------------------------
// Nutrients
// ---------------------------------------------------------------------------

/**
 * The strain's nitrogen demand, in TOSNA's three bands.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export type NutrientDemand = 'low' | 'medium' | 'high';

/**
 * Display label for each band.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const NUTRIENT_DEMAND_LABELS: Readonly<Record<NutrientDemand, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * TOSNA's nitrogen requirement factors, verbatim from the published page:
 * "Low = 0.75, Medium = 0.90, High = 1.25".
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const TOSNA_NITROGEN_FACTORS: Readonly<Record<NutrientDemand, number>> = {
  low: 0.75,
  medium: 0.9,
  high: 1.25,
};

/**
 * The divisor in TOSNA's published formula, which turns a nitrogen target in
 * ppm into grams of Fermaid-O per US gallon.
 *
 * We keep it as the single number the page prints, and don't split it into a
 * YAN contribution per gram, **because the page doesn't give one**. The
 * divisor implies a Fermaid-O YAN figure in mg/L per g/L, but TOSNA never
 * states it, and deriving one ourselves would be an uncited coefficient,
 * which `sources.ts` doesn't allow.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const TOSNA_GRAMS_PER_GALLON_PER_PPM = 50;

/**
 * How many additions TOSNA splits the total into.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const TOSNA_ADDITIONS = 4;

/**
 * When each addition goes in, in the published page's wording.
 *
 * None of the four is at pitch. TOSNA adds nothing at pitch: the first
 * addition is at 24 hours, and the fourth is at the sugar break, not a fixed
 * hour.
 *
 * @category Blending, mead and spirits
 * @group Constants and defaults
 */
export const TOSNA_ADDITION_LABELS: readonly string[] = [
  '24 hours after pitching',
  '48 hours after pitching',
  '72 hours after pitching',
  'At the 1/3 sugar break, or day 7',
];

/**
 * Input to {@link nutrientSchedule}.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface NutrientScheduleInput {
  /** Volume of must, litres. */
  readonly volumeL: Litres;
  /** The must's starting gravity, SG. TOSNA is published in Brix, so we convert. */
  readonly originalSg: SpecificGravity;
  /** The strain's nitrogen demand. */
  readonly demand: NutrientDemand;
}

/**
 * One of the four additions.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface NutrientAddition {
  /** When it goes in. @see TOSNA_ADDITION_LABELS */
  readonly label: string;
  /** Fermaid-O for this addition, grams. */
  readonly grams: number;
}

/**
 * Result of {@link nutrientSchedule}.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface NutrientScheduleResult {
  /** Fermaid-O over the whole ferment, grams. */
  readonly fermaidOGrams: number;
  /** The four additions, in the order they happen. */
  readonly additions: readonly NutrientAddition[];
}

/**
 * Fermaid-O for a must, split into TOSNA's four additions.
 *
 * Honey has around 30 ppm of nitrogen, against the 150–200 ppm a healthy
 * fermentation needs, which is why a mead fermented without nutrient can take
 * a year to lose its sulphur. TOSNA (Sergio Moutela's Tailored Organic
 * Staggered Nutrient Addition) sizes the dose from the must's sugar and the
 * strain's demand, and staggers it so the nitrogen arrives while the yeast
 * can still take it up.
 *
 * The formula as published at
 * <https://www.meadmaderight.com/nutrient-additions>:
 *
 * ```
 * (((Brix × 10) × N requirement factor) / 50) × batch size in gallons
 *   = total grams of Fermaid-O
 * ```
 *
 * with the factors 0.75 / 0.90 / 1.25 for low, medium and high demand, and the
 * total split four ways.
 *
 * ## What comes from the page
 *
 * Every coefficient here is from the page: the ×10, the three factors, the
 * ÷50, the four additions and their timings. The page doesn't state
 * Fermaid-O's YAN contribution in mg/L per g/L, so we don't compute one (see
 * {@link TOSNA_GRAMS_PER_GALLON_PER_PPM}). We treat `Brix × 10 × factor` as
 * the nitrogen target in ppm because that's what it is dimensionally, and the
 * page's guidance for it is 150–200 ppm.
 *
 * ## Brix from gravity
 *
 * The input is SG, like everything else in this package, and a mead maker
 * reads a hydrometer. {@link sgToBrix} does the conversion, and the Brix is
 * reported in the explanation so the result can be checked against the
 * published calculator using the same number.
 *
 * A must with no volume, or at or below 1.000, needs no nutrient: the result
 * is zero grams across four zero additions, not a negative dose.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function nutrientSchedule(input: NutrientScheduleInput): NutrientScheduleResult {
  const brix = sgToBrix(input.originalSg);
  const factor = TOSNA_NITROGEN_FACTORS[input.demand];
  const nitrogenTargetPpm = brix * 10 * factor;
  const gallons = litresToGallons(input.volumeL);
  const total =
    input.volumeL > 0 && brix > 0
      ? (nitrogenTargetPpm / TOSNA_GRAMS_PER_GALLON_PER_PPM) * gallons
      : 0;
  const perAddition = total / TOSNA_ADDITIONS;
  return {
    fermaidOGrams: total,
    additions: TOSNA_ADDITION_LABELS.map((label) => ({ label, grams: perAddition })),
  };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/**
 * The sugar addition with its breakdown. @see sugarToGravity
 *
 * @category Blending, mead and spirits
 * @group Explanations
 */
export function sugarToGravityExplained(input: SugarToGravityInput): Explanation {
  const result = sugarToGravity(input);
  const deficit = sgToGravityPoints(input.targetSg) - sgToGravityPoints(input.currentSg);
  return explain(result.massKg, {
    label: 'Sugar to reach a gravity',
    formula: 'extract-conservation',
    expression: 'kg = (target points − current points) × volume_L / yield in points·L/kg',
    inputs: {
      currentSg: round(input.currentSg, 4),
      targetSg: round(input.targetSg, 4),
      volumeL: round(input.volumeL),
      sugar: input.sugar,
      pointsToAdd: round(Math.max(0, deficit), 1),
      yieldPpg: MUST_SUGAR_PPG[input.sugar],
      yieldPointsLPerKg: round(MUST_SUGAR_POINTS_L_PER_KG[input.sugar], 2),
    },
    unit: 'kg',
    notes: [
      `Dosed as ${MUST_SUGAR_LABELS[input.sugar].toLowerCase()}, at ${MUST_SUGAR_PPG[input.sugar]} points per pound per US gallon.`,
      'The sugar’s own volume is not counted. A kilogram of honey adds about 0.7 L, so leave room for it in the fermenter.',
      'The same arithmetic serves a honey must, a chaptalized juice and a stabilized drink being backsweetened.',
      ...(deficit <= 0
        ? ['The target is at or below the current gravity, so nothing needs adding.']
        : []),
    ],
    family: 'cellar',
    // Honey's yield is Schramm's and the two refined sugars' are Palmer's, so
    // we cite whichever applies instead of listing both.
    sources: [input.sugar === 'honey' ? SCHRAMM_COMPLEAT_MEADMAKER_2003 : PALMER_HOW_TO_BREW],
  });
}

/**
 * The nutrient schedule with its breakdown. @see nutrientSchedule
 *
 * @category Blending, mead and spirits
 * @group Explanations
 */
export function nutrientScheduleExplained(input: NutrientScheduleInput): Explanation {
  const result = nutrientSchedule(input);
  const brix = sgToBrix(input.originalSg);
  const factor = TOSNA_NITROGEN_FACTORS[input.demand];
  return explain(result.fermaidOGrams, {
    label: 'Fermaid-O for the ferment',
    formula: 'tosna-3',
    expression:
      'g = (((Brix × 10) × N requirement factor) / 50) × batch size in gallons, split four ways',
    inputs: {
      volumeL: round(input.volumeL),
      originalSg: round(input.originalSg, 4),
      originalBrix: round(brix),
      demand: input.demand,
      nitrogenFactor: factor,
      nitrogenTargetPpm: round(brix * 10 * factor),
      volumeGallons: round(litresToGallons(input.volumeL)),
      gramsPerAddition: round(result.fermaidOGrams / TOSNA_ADDITIONS),
    },
    unit: 'g',
    notes: [
      `Split into ${TOSNA_ADDITIONS} equal additions: 24, 48 and 72 hours after pitching, and at the 1/3 sugar break of fermentation or day 7, whichever comes first.`,
      'Honey carries about 30 ppm of nitrogen of its own, against the 150–200 ppm the published protocol says a healthy fermentation wants.',
      'The ÷ 50 is the published divisor, grams of Fermaid-O per US gallon per ppm of nitrogen. TOSNA does not state Fermaid-O’s YAN per gram, so neither does this.',
      'Organic nitrogen only. Fermaid-K and DAP are a different protocol, and this does not dose them.',
    ],
    family: 'cellar',
    sources: [MOUTELA_TOSNA],
  });
}
