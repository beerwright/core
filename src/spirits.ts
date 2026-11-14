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
 *
 * ## Mixing strengths
 *
 * {@link mixSpirits} is the other calculation here, and it does count the
 * contraction. It mixes any number of spirits and waters by mass, using the
 * OIML density formula for ethanol and water, so the strength and volume it
 * gives are what a hydrometer and a measuring jug would read. It has no
 * sugar in it.
 */

import { WATER_DENSITY_AT_REFERENCE_KG_PER_L } from './corrections';
import type { Explanation } from './explain';
import { explain } from './explain';
import { ASBC_METHODS, OIML_R22_1975 } from './sources';
import type { Celsius, Kilograms, Litres, Percent } from './types';
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
 * incompatible. We return `null` instead of a negative volume of water. A
 * thin syrup can do the same with a sugar target that dry sugar would meet,
 * because the syrup's own water uses up the room.
 *
 * **A syrup at 100 °Bx or more.** That is dry sugar, or a typing mistake.
 * Past 100 the syrup would have less than no water in it, and the sum would
 * hand some of it back as water to add.
 *
 * {@link proofAndSweetenRefusal} says which of these it was.
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
    if (!(sweetener.brix > 0 && sweetener.brix < 100)) return null;
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

/**
 * A sentence saying why {@link proofAndSweeten} returned `null`, or `null` if
 * it didn't, or if the jar isn't described yet.
 *
 * The function returns `null` for several different reasons and a caller
 * showing the result needs to say which. The sentences are here so every
 * caller explains the same refusal the same way. An empty jar, a jar with no
 * alcohol, a zero target or a syrup with no strength gets no sentence,
 * because that is a form somebody is still filling in.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function proofAndSweetenRefusal(input: ProofAndSweetenInput): string | null {
  if (proofAndSweeten(input) !== null) return null;
  const { volumeL, abvPercent, targetAbvPercent, targetSugarGL, sweetener } = input;
  if (!(volumeL > 0) || !(abvPercent > 0) || !(targetAbvPercent > 0)) return null;
  if (!(targetSugarGL >= 0)) return null;
  if (targetAbvPercent >= abvPercent) {
    return 'You cannot reach a strength higher than what is already in the jar by adding water. Lower the target, or start with something stronger.';
  }
  if (sweetener.kind === 'syrup') {
    if (!(sweetener.brix > 0)) return null;
    if (sweetener.brix >= 100) {
      return 'A syrup has to be under 100 °Bx, because at 100 it would be dry sugar. Check the syrup’s strength, or switch to sugar.';
    }
    if (proofAndSweeten({ ...input, sweetener: { kind: 'sugar' } }) !== null) {
      return 'That syrup brings more water than the target strength leaves room for. Use a stronger syrup or dry sugar, or aim for a lower strength.';
    }
  }
  return 'That much sugar does not fit in the volume that strength allows. Aim for less sugar, or a lower strength.';
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

// ---------------------------------------------------------------------------
// Ethanol and water
// ---------------------------------------------------------------------------

// The OIML R 22 coefficients, as printed in the standard and in EU Regulation
// 2870/2000 Annex I. `A` is the strength term at 20 °C, `B` is pure water's
// temperature term, and `C[i]` is the cross term for (t − 20)^(i+1).
const OIML_A = [
  9.9820123e2, -1.929769495e2, 3.891238958e2, -1.668103923e3, 1.352215441e4, -8.829278388e4,
  3.062874042e5, -6.138381234e5, 7.470172998e5, -5.478461354e5, 2.234460334e5, -3.903285426e4,
] as const;

const OIML_B = [
  -2.0618513e-1, -5.2682542e-3, 3.6130013e-5, -3.8957702e-7, 7.169354e-9, -9.9739231e-11,
] as const;

const OIML_C: readonly (readonly number[])[] = [
  [
    1.693443461530087e-1, -1.046914743455169e1, 7.196353469546523e1, -7.047478054272792e2,
    3.924090430035045e3, -1.210164659068747e4, 2.248646550400788e4, -2.605562982188164e4,
    1.852373922069467e4, -7.420201433430137e3, 1.285617841998974e3,
  ],
  [
    -1.19301300505701e-2, 2.517399633803461e-1, -2.170575700536993, 1.353034988843029e1,
    -5.029988758547014e1, 1.09635566657757e2, -1.422753946421155e2, 1.08043594285623e2,
    -4.414153236817392e1, 7.442971530188783,
  ],
  [
    -6.802995733503803e-4, 1.876837790289664e-2, -2.002561813734156e-1, 1.02299296671922,
    -2.895696483903638, 4.810060584300675, -4.672147440794683, 2.458043105903461,
    -5.411227621436812e-1,
  ],
  [4.075376675622027e-6, -8.76305857347111e-6, 6.515031360099368e-6, -1.51578483698721e-6],
  [-2.788074354782409e-8, 1.345612883493354e-8],
];

/** The lowest temperature the OIML formula is fitted for, °C. */
export const OIML_MIN_TEMP_C = -20;

/** The highest temperature the OIML formula is fitted for, °C. */
export const OIML_MAX_TEMP_C = 40;

/**
 * Density of an ethanol and water mixture, kilograms per litre.
 *
 * ```
 * ρ = Σ A_k p^(k−1) + Σ B_k (t − 20)^k + Σ Σ C_ik p^k (t − 20)^i
 * ```
 *
 * `p` is the mass fraction of ethanol, from 0 to 1, and `t` the temperature
 * in °C. This is the polynomial from OIML R 22, the International
 * Alcoholometric Tables, which is what printed spirit tables and
 * alcoholmeters are built from. It is fitted from −20 to 40 °C. It gives
 * 0.99820 for water and 0.78924 for ethanol at 20 °C.
 *
 * Sugar or anything else dissolved in the liquid is outside it.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function ethanolWaterDensityKgPerL(massFraction: number, tempC: Celsius): number {
  const p = massFraction;
  const dt = tempC - 20;
  let rho = 0;
  OIML_A.forEach((a, k) => {
    rho += a * p ** k;
  });
  OIML_B.forEach((b, k) => {
    rho += b * dt ** (k + 1);
  });
  OIML_C.forEach((row, i) => {
    row.forEach((c, k) => {
      rho += c * p ** (k + 1) * dt ** (i + 1);
    });
  });
  // The formula is in kg/m³.
  return rho / 1000;
}

/** Pure ethanol at 20 °C, kg/L. */
const ETHANOL_DENSITY_20C_KG_PER_L = ethanolWaterDensityKgPerL(1, 20);

/**
 * Converts a mass fraction of ethanol to % ABV.
 *
 * ABV is defined at 20 °C: the volume the ethanol would take up on its own at
 * 20 °C, as a percentage of the mixture's volume at 20 °C. A litre of the
 * mixture holds `ρ(p) × p` kilograms of ethanol, and that over the density of
 * pure ethanol is its volume.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function massFractionToAbv(massFraction: number): Percent {
  return (
    (100 * massFraction * ethanolWaterDensityKgPerL(massFraction, 20)) /
    ETHANOL_DENSITY_20C_KG_PER_L
  );
}

/**
 * Converts % ABV to the mass fraction of ethanol, from 0 to 1.
 *
 * The inverse of {@link massFractionToAbv}, found by bisection. The relation
 * rises steadily from 0 to 100 % so bisection always converges, and 60 halvings
 * is well past the precision of a double.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function abvToMassFraction(abvPercent: Percent): number {
  if (abvPercent <= 0) return 0;
  if (abvPercent >= 100) return 1;
  let low = 0;
  let high = 1;
  for (let pass = 0; pass < 60; pass += 1) {
    const mid = (low + high) / 2;
    if (massFractionToAbv(mid) < abvPercent) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

// ---------------------------------------------------------------------------
// Mixing strengths
// ---------------------------------------------------------------------------

/**
 * One liquid going into {@link mixSpirits}.
 *
 * @category Blending, mead and spirits
 * @group Inputs
 */
export interface SpiritMixComponent {
  /**
   * How much, in {@link unit}. Negative takes the liquid out, which is how a
   * distiller works out what is left in the boiler after running some off.
   */
  readonly amount: number;
  /** Litres or kilograms. */
  readonly unit: 'L' | 'kg';
  /**
   * The temperature the litres were measured at, °C. Ignored for kilograms.
   * Its strength is always at 20 °C, because that is what ABV means.
   */
  readonly tempC: Celsius;
  /** Strength, % ABV at 20 °C. */
  readonly abvPercent: Percent;
}

/**
 * Result of {@link mixSpirits}.
 *
 * @category Blending, mead and spirits
 * @group Results
 */
export interface SpiritMixResult {
  /** Strength of the mix, % ABV at 20 °C. */
  readonly abvPercent: Percent;
  /** Volume of the mix at 20 °C, litres. */
  readonly volumeL: Litres;
  /** Mass of the mix, kilograms. */
  readonly massKg: Kilograms;
  /** The ethanol in the mix, as litres of pure ethanol at 20 °C. */
  readonly pureAlcoholL: Litres;
  /**
   * What the volumes would add up to at 20 °C if nothing contracted. The
   * difference from {@link volumeL} is the contraction alone, with the
   * temperature already taken out.
   */
  readonly additiveVolumeL: Litres;
}

/**
 * The strength and volume of several spirits and waters mixed together, or
 * `null` when the mix is impossible.
 *
 * ```
 * m_i     = V_i × ρ(p_i, t_i)        (or the kilograms as given)
 * p_mix   = Σ m_i p_i / Σ m_i
 * ABV_mix = massFractionToAbv(p_mix)
 * V_mix   = Σ m_i / ρ(p_mix, 20 °C)
 * ```
 *
 * Mass and the mass of ethanol both add up when liquids are mixed, but
 * volume does not. So each liquid is turned into a mass with
 * {@link ethanolWaterDensityKgPerL} at its own strength and temperature, the
 * masses are added, and the result is turned back into a strength and a volume
 * at 20 °C. The contraction falls out of the density formula.
 *
 * A litre of 96 % and a litre of water at 20 °C come out as 1.94 L at 49.5 %.
 * Adding the volumes would say 2 L at 48 %.
 *
 * ## When it returns `null`
 *
 * With no liquids, a strength outside 0–100 %, or a temperature outside the
 * formula's −20 to 40 °C. And when negative amounts take out more than is
 * there: if the total mass isn't above zero, or the alcohol left is less than
 * none or more than all of it. {@link mixSpiritsRefusal} says which.
 *
 * @category Blending, mead and spirits
 * @group Start here
 */
export function mixSpirits(components: readonly SpiritMixComponent[]): SpiritMixResult | null {
  if (components.length === 0) return null;
  let massKg = 0;
  let ethanolKg = 0;
  let additiveVolumeL = 0;
  for (const { amount, unit, tempC, abvPercent } of components) {
    if (!Number.isFinite(amount) || !(abvPercent >= 0 && abvPercent <= 100)) return null;
    if (unit === 'L' && !(tempC >= OIML_MIN_TEMP_C && tempC <= OIML_MAX_TEMP_C)) return null;
    const p = abvToMassFraction(abvPercent);
    const mass = unit === 'kg' ? amount : amount * ethanolWaterDensityKgPerL(p, tempC);
    massKg += mass;
    ethanolKg += mass * p;
    additiveVolumeL += mass / ethanolWaterDensityKgPerL(p, 20);
  }
  if (!(massKg > 0)) return null;
  const p = ethanolKg / massKg;
  // A small tolerance either side, so that a mix that rounds to exactly 0 or
  // 100 % isn't refused over floating-point dust.
  if (p < -1e-12 || p > 1 + 1e-12) return null;
  const fraction = Math.min(1, Math.max(0, p));
  return {
    abvPercent: massFractionToAbv(fraction),
    volumeL: massKg / ethanolWaterDensityKgPerL(fraction, 20),
    massKg,
    pureAlcoholL: Math.max(0, ethanolKg) / ETHANOL_DENSITY_20C_KG_PER_L,
    additiveVolumeL,
  };
}

/**
 * A sentence saying why {@link mixSpirits} returned `null`, or `null` if it
 * didn't, or if there is nothing in the mix yet.
 *
 * A strength or a temperature outside what the formula covers is checked
 * first, because either one stops the sum before the amounts are looked at.
 * After that the only way to get no answer from real numbers is a negative
 * amount that takes out more than went in. No liquids, or amounts that are
 * all zero, get no sentence.
 *
 * @category Blending, mead and spirits
 * @group Calculations
 */
export function mixSpiritsRefusal(components: readonly SpiritMixComponent[]): string | null {
  if (mixSpirits(components) !== null) return null;
  if (components.some(({ abvPercent }) => !(abvPercent >= 0 && abvPercent <= 100))) {
    return 'A strength has to be between 0 and 100 %. Check those rows.';
  }
  const outOfRange = ({ unit, tempC }: SpiritMixComponent) =>
    unit === 'L' && !(tempC >= OIML_MIN_TEMP_C && tempC <= OIML_MAX_TEMP_C);
  if (components.some(outOfRange)) {
    return 'We can only correct a volume measured between −20 and 40 °C. Check those temperatures, or weigh the liquid instead.';
  }
  if (components.some(({ amount }) => amount < 0)) {
    return 'Your negative amounts take out more than you put in, so there is nothing left for us to work out. Check those rows.';
  }
  return null;
}

/**
 * The strength of a mix with its breakdown, or `null` when {@link mixSpirits}
 * returns `null`.
 *
 * The strength is the main value. The volume, the mass and the contraction go
 * in the inputs, with one row per liquid.
 *
 * @category Blending, mead and spirits
 * @group Explanations
 */
export function mixSpiritsExplained(components: readonly SpiritMixComponent[]): Explanation | null {
  const result = mixSpirits(components);
  if (result === null) return null;
  const liquids = Object.fromEntries(
    components.map((component, index) => [
      `liquid${index + 1}`,
      component.unit === 'kg'
        ? `${round(component.amount, 3)} kg at ${round(component.abvPercent, 1)} %`
        : `${round(component.amount, 3)} L at ${round(component.tempC, 1)} °C, ${round(component.abvPercent, 1)} %`,
    ]),
  );
  return explain(result.abvPercent, {
    label: 'Strength of the mix',
    formula: 'oiml-r22-mix',
    expression:
      'ABV = 100 × p × ρ(p, 20 °C) / ρ(ethanol, 20 °C), with p = Σ ethanol mass / Σ mass and ρ from OIML R 22',
    inputs: {
      ...liquids,
      massKg: round(result.massKg, 3),
      ethanolMassFraction: round(abvToMassFraction(result.abvPercent), 4),
      volumeL: round(result.volumeL, 3),
      additiveVolumeL: round(result.additiveVolumeL, 3),
      contractionL: round(result.additiveVolumeL - result.volumeL, 3),
      pureAlcoholL: round(result.pureAlcoholL, 3),
    },
    unit: '%',
    notes: [
      'When you mix liquids, their weights and the alcohol in them add up, but their volumes do not. So we weigh each liquid with the OIML density formula, add the weights and the alcohol, and turn the total back into a strength and a volume at 20 °C.',
      'We take strengths as % ABV at 20 °C. If you measured in liters, we correct the volume from the temperature you measured at. If you weighed, we don’t need a temperature.',
      'The formula covers spirit and water only. Sugar in a liqueur makes it heavier, and we don’t count that.',
    ],
    family: 'spirits',
    sources: [OIML_R22_1975],
  });
}
