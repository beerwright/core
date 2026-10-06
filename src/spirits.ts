/**
 * Proofing a spirit down and sweetening it in one calculation.
 *
 * This is the arithmetic for making an amaro: a jar of high-proof macerate, a
 * target strength and a target sweetness. Each half changes the other's
 * answer, so there's one function here instead of two. Water dilutes the
 * alcohol, and so does sugar: dissolved sucrose takes up volume, which lowers
 * the strength and its own concentration. Proofing to 30 % and then
 * sweetening to 150 g/L ends up at 27.4 % and 137 g/L, and people usually
 * don't expect the second number.
 *
 * So we solve for the **final volume** first, not the water. Alcohol is
 * conserved, so the volume follows from the strength alone. The sugar is
 * weighed against that volume, the space it takes comes out of it, and the
 * water is whatever's left.
 *
 * ## The sugar's own volume is counted here, unlike in `must.ts`
 *
 * `must.ts`'s `sugarToGravity` doesn't count it, and that's correct there: a
 * mead maker fixes the volume and asks for the sugar, so the space the honey
 * takes is something to leave room for in the fermenter. An amaro maker fixes
 * the strength and the sweetness and solves for the volume, so the sugar's
 * volume is part of the unknown. The chemistry is the same; the question is
 * different.
 *
 * ## Where the coefficient comes from
 *
 * It isn't looked up. `units/gravity.ts` already has the ASBC polynomial fit
 * of the Plato table, which is the density of a sucrose solution at a known
 * mass fraction, and the volume a dissolved gram occupies follows directly
 * from it (see {@link dissolvedSugarVolumeLPerKg}). That's the source this
 * module cites, and it lets the explanation show its working.
 *
 * Units are litres, kilograms, percent by volume, and grams per litre for the
 * sugar, which is the usual way to state a liqueur's sweetness.
 */

import { WATER_DENSITY_AT_REFERENCE_KG_PER_L } from './corrections';
import type { Explanation } from './explain';
import { explain } from './explain';
import { ASBC_METHODS } from './sources';
import type { Litres, Percent } from './types';
import { platoToSg } from './units/gravity';

// ---------------------------------------------------------------------------
// The volume a dissolved gram of sugar takes up
// ---------------------------------------------------------------------------

/**
 * The concentration we evaluate the relation at when there's no sugar.
 *
 * The quotient below is a difference of two volumes divided by the sugar in
 * them, which is 0/0 at zero sugar. The limit is finite (0.6144 L/kg, the
 * volume a gram of sucrose adds at infinite dilution), so we evaluate the fit
 * a hundredth of a degree above zero. That matches the limit to more decimal
 * places than anything downstream uses.
 */
const INFINITELY_DILUTE_BRIX = 0.01;

/**
 * Litres of volume a kilogram of dissolved sucrose takes up, at a given °Bx.
 *
 * ```
 * L/kg = [ 100 / (SG(°Bx) × ρ_water) − (100 − °Bx) / ρ_water ] / °Bx
 * ```
 *
 * Take a hundred grams of solution. Its volume is its mass over its density.
 * The water in it is `100 − °Bx` grams, which on its own would occupy its mass
 * over the density of water. The difference is the volume due to the sugar.
 * Dividing by the grams of sugar gives the volume per gram, which is the same
 * number as litres per kilogram.
 *
 * Nothing is looked up. `SG(°Bx)` is {@link platoToSg}, the ASBC fit this
 * package uses for every gravity, and `ρ_water` is the reference density from
 * `corrections.ts`. The results (0.6162 at 10 °Bx, 0.6180 at 20, 0.6197 at
 * 30, 0.6215 at 40, 0.6249 at 60) match the figures quoted in the beverage
 * literature. We derive them so the package can show its working.
 *
 * ## It rises with concentration, so it takes an argument
 *
 * A gram of sugar in a thin solution fits into the spaces between water
 * molecules. In a heavy syrup there are fewer spaces, so it takes up more
 * volume. The spread is only 1.4 % across the usable range, so the answer is
 * always close to 0.62, but computing it at the actual concentration costs
 * one line and means no number in this file is copied from elsewhere.
 *
 * ## Beyond the brewing range
 *
 * The Plato fit is quoted for 1.000–1.130 SG, and a 60 °Bx syrup is 1.29. It's
 * still within a few parts per thousand of published sucrose tables, which is
 * much smaller than the couple of per cent error from assuming volumes add
 * (see {@link proofAndSweeten}).
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function dissolvedSugarVolumeLPerKg(brix: number): number {
  const p = brix > 0 ? brix : INFINITELY_DILUTE_BRIX;
  const rho = WATER_DENSITY_AT_REFERENCE_KG_PER_L;
  const solutionVolume = 100 / (platoToSg(p) * rho);
  const waterVolume = (100 - p) / rho;
  return (solutionVolume - waterVolume) / p;
}

/**
 * Kilograms of sucrose in a litre of syrup at a given °Bx.
 *
 * A litre weighs `SG(°Bx) × ρ_water` kilograms, and °Bx percent of that mass
 * is sugar. The rest is water, which is why a syrup needs less added water to
 * reach the same target.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function syrupSugarKgPerL(brix: number): number {
  return (brix / 100) * platoToSg(brix) * WATER_DENSITY_AT_REFERENCE_KG_PER_L;
}

/**
 * Converts grams of sugar per litre to the °Bx of the solution.
 *
 * °Bx is grams per hundred grams and a liqueur's sweetness is in grams per
 * litre, so the two differ by the density, which itself depends on the
 * concentration we're solving for. We find the fixed point of
 * {@link syrupSugarKgPerL}, starting from the answer for a density of one. It
 * converges in a few passes because density changes much more slowly than
 * concentration.
 *
 * {@link proofAndSweeten} uses this to evaluate the sugar's volume at the
 * drink's final concentration instead of at a fixed one.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function sugarConcentrationToBrix(gramsPerLitre: number): number {
  if (gramsPerLitre <= 0) return 0;
  let brix = gramsPerLitre / 10;
  for (let pass = 0; pass < 24; pass += 1) {
    const next = gramsPerLitre / (10 * platoToSg(brix) * WATER_DENSITY_AT_REFERENCE_KG_PER_L);
    if (Math.abs(next - brix) < 1e-12) return next;
    brix = next;
  }
  return brix;
}

// ---------------------------------------------------------------------------
// Proofing and sweetening
// ---------------------------------------------------------------------------

/**
 * The form the sugar is added in.
 *
 * Dry sugar, or a syrup the maker has measured. A syrup brings its own water,
 * and "2:1" means different things in different bars, so we take the strength
 * in °Bx. A refractometer reads °Bx directly, and it converts to sugar and
 * water through the same Plato relation as the sugar volume.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export type Sweetener =
  | {
      /** Dry sugar. */
      readonly kind: 'sugar';
    }
  | {
      /** A syrup of measured strength. */
      readonly kind: 'syrup';
      /** The syrup's strength, in °Bx. */
      readonly brix: number;
    };

/**
 * Input to {@link proofAndSweeten}.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface ProofAndSweetenInput {
  /** Volume in the jar, litres. */
  readonly volumeL: Litres;
  /** Current strength, % ABV. */
  readonly abvPercent: Percent;
  /** Target strength, % ABV. */
  readonly targetAbvPercent: Percent;
  /** Target sweetness, grams of sugar per litre of finished drink. */
  readonly targetSugarGL: number;
  /** Dry sugar, or a syrup at a measured °Bx. */
  readonly sweetener: Sweetener;
}

/**
 * Result of {@link proofAndSweeten}.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface ProofAndSweetenResult {
  /** Water to add, litres. */
  readonly waterL: Litres;
  /** Sugar to add, kilograms. For a syrup, this is the sugar in it. */
  readonly sugarKg: number;
  /** Syrup to measure out, litres. Zero when the sweetener is dry sugar. */
  readonly syrupL: Litres;
  /** Final volume, litres. */
  readonly finalVolumeL: Litres;
  /** Final strength, % ABV. */
  readonly finalAbvPercent: Percent;
  /** The sugar in the finished drink, grams per litre. */
  readonly finalSugarGL: number;
}

/**
 * What to add to a jar of macerate to reach a target strength and
 * sweetness, or `null` when that isn't possible.
 *
 * ```
 * final_L      = spirit_L × ABV / target ABV      (alcohol is conserved)
 * sugar_kg     = target g/L × final_L / 1000
 * sugar_room_L = sugar_kg × L/kg at the final concentration
 * water_L      = final_L − spirit_L − sugar_room_L − the syrup's own water
 * ```
 *
 * The first line does most of the work. Water and sugar add no alcohol, so
 * the alcohol in the jar and the target strength fix the final volume before
 * anything else. The rest is accounting within that volume. Proofing first
 * and sweetening second solves these in the wrong order and falls short on
 * both targets.
 *
 * ## Limitations
 *
 * We treat volumes as additive, which they aren't. Ethanol and water contract
 * by a couple of per cent when mixed at these strengths, and the sucrose
 * relation was measured in water, not spirit. So the predicted final volume
 * runs a little high. We don't model it; the explanation tells the maker to
 * add slightly less water and top up to volume by measuring. Modelling the
 * contraction would need a table, and the note is nearly as useful.
 *
 * ## When it returns `null`
 *
 * **A target at or above the current strength.** Water can't make a spirit
 * stronger. The formula wouldn't catch this (it returns a final volume
 * smaller than the spirit already in the jar, and negative water), so we
 * check for it.
 *
 * **A sugar target that doesn't fit.** Past some sweetness the sugar alone
 * takes more volume than the target strength leaves, so the two targets are
 * incompatible. We return `null` instead of a negative volume of water.
 *
 * A jar with no volume, no alcohol, or a zero target also returns `null`,
 * since the calculation would divide by zero.
 *
 * @category Blending, mead and spirits
 * @group Start here
 */
export function proofAndSweeten(input: ProofAndSweetenInput): ProofAndSweetenResult | null {
  const { volumeL, abvPercent, targetAbvPercent, targetSugarGL, sweetener } = input;
  if (!(volumeL > 0) || !(abvPercent > 0) || !(targetAbvPercent > 0)) return null;
  if (!(targetSugarGL >= 0)) return null;
  if (targetAbvPercent >= abvPercent) return null;

  const finalVolumeL = (volumeL * abvPercent) / targetAbvPercent;
  const sugarKg = (targetSugarGL * finalVolumeL) / 1000;
  const sugarRoomL = sugarKg * dissolvedSugarVolumeLPerKg(sugarConcentrationToBrix(targetSugarGL));

  let syrupL = 0;
  let syrupWaterL = 0;
  if (sweetener.kind === 'syrup' && sugarKg > 0) {
    if (!(sweetener.brix > 0)) return null;
    syrupL = sugarKg / syrupSugarKgPerL(sweetener.brix);
    // The syrup's own water: its volume minus the volume its sugar takes up
    // at the syrup's concentration, not the drink's. This is why
    // dissolvedSugarVolumeLPerKg takes a concentration argument.
    syrupWaterL = syrupL - sugarKg * dissolvedSugarVolumeLPerKg(sweetener.brix);
  }

  const waterL = finalVolumeL - volumeL - sugarRoomL - syrupWaterL;
  if (waterL < 0) return null;

  return {
    waterL,
    sugarKg,
    syrupL,
    finalVolumeL,
    // Computed from the result instead of copied from the input, so these
    // reflect what the drink actually comes out at.
    finalAbvPercent: (volumeL * abvPercent) / finalVolumeL,
    finalSugarGL: (sugarKg * 1000) / finalVolumeL,
  };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/**
 * The water to add with its breakdown, or `null` when {@link proofAndSweeten}
 * returns `null`.
 *
 * The water is the main value because it's what the maker pours. The sugar,
 * the syrup and the final volume go in the explanation's inputs. Like the
 * Pearson square's explanation, this one can be `null` when there's no result
 * to explain.
 *
 * @category Blending, mead and spirits
 * @group Explanations
 */
export function proofAndSweetenExplained(input: ProofAndSweetenInput): Explanation | null {
  const result = proofAndSweeten(input);
  if (result === null) return null;
  const finalBrix = sugarConcentrationToBrix(input.targetSugarGL);
  const sugarRoomL = result.sugarKg * dissolvedSugarVolumeLPerKg(finalBrix);
  return explain(result.waterL, {
    label: 'Water to proof down and sweeten',
    formula: 'proof-and-sweeten',
    expression:
      'water_L = final_L − spirit_L − sugar room − the syrup’s own water, with final_L = spirit_L × ABV / target ABV',
    inputs: {
      volumeL: round(input.volumeL, 3),
      abvPercent: round(input.abvPercent, 2),
      targetAbvPercent: round(input.targetAbvPercent, 2),
      targetSugarGL: round(input.targetSugarGL, 1),
      sweetener:
        input.sweetener.kind === 'syrup' ? `syrup at ${input.sweetener.brix} °Bx` : 'sugar',
      finalVolumeL: round(result.finalVolumeL, 3),
      sugarKg: round(result.sugarKg, 3),
      finalBrix: round(finalBrix, 2),
      sugarVolumeLPerKg: round(dissolvedSugarVolumeLPerKg(finalBrix), 4),
      sugarRoomL: round(sugarRoomL, 3),
      syrupL: round(result.syrupL, 3),
    },
    unit: 'L',
    notes: [
      'Alcohol is conserved, so the strength wanted fixes the final volume before anything else is known. Proofing and then sweetening solves the same two lines in the wrong order.',
      `Dissolved sucrose takes room: ${round(dissolvedSugarVolumeLPerKg(finalBrix), 4)} L per kilogram at ${round(finalBrix, 1)} °Bx, computed from the Plato fit.`,
      'Volumes are treated as adding up, though in the jar they do not quite. Spirit and water contract a little when mixed, and this sugar figure was measured in water, not spirit. Add the water a shade short and top up to volume by measuring.',
      ...(input.sweetener.kind === 'syrup'
        ? ['The syrup brings water of its own, which comes off the water to add.']
        : []),
    ],
    family: 'spirits',
    sources: [ASBC_METHODS],
  });
}
