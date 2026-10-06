/**
 * Beer colour.
 *
 * Malt Colour Units → SRM through a selectable fit, plus EBC conversion and an
 * sRGB mapping for a colour swatch to show beside the number.
 *
 * The inverse, {@link gristSharesForTargetSrm}, is here too. Sizing a grist's
 * colour malts to a target SRM uses every fit in this file, and `gravity.ts`
 * shouldn't need to know which malt is a crystal. The gravity equivalent,
 * {@link gristKgForTargetOg}, is in `gravity.ts` with the extract maths.
 */

import type { Source } from './explain';
import type { GristShare } from './gravity';
import { inferMaltPhClass } from './mashPh';
import { DANIELS_DESIGNING_1996, MOREY_1999, MOSHER_COMPANION_1994 } from './sources';
import type {
  ColorFormula,
  FermentableAddition,
  Kilograms,
  Litres,
  Lovibond,
  MaltPhClass,
  Percent,
  Srm,
} from './types';
import { kgToPounds } from './units/mass';
import { litresToGallons } from './units/volume';

/**
 * Malt Colour Units for a grist.
 *
 * ```
 * MCU = Σ (weight_lb × colour_°L) / volume_gal
 * ```
 *
 * The definition is in US customary units because every published SRM fit was
 * regressed against it, so we convert the kg/L inputs here and nowhere else.
 *
 * Colour is set in the kettle, so the volume passed in is normally the
 * post-boil volume (`CalculationOptions.colorVolumeBasis`).
 *
 * @category Color
 * @group Calculations
 */
export function maltColorUnits(
  fermentables: readonly FermentableAddition[],
  volumeL: Litres,
): number {
  if (volumeL <= 0) return 0;
  const gallons = litresToGallons(volumeL);
  let sum = 0;
  for (const f of fermentables) {
    sum += kgToPounds(f.amountKg) * f.colorLovibond;
  }
  return sum / gallons;
}

/**
 * Morey's fit, the engine default.
 *
 * `SRM = 1.4922 × MCU^0.6859`
 *
 * Dan Morey (1999) fitted it to the Daniels and Mosher data plus Noonan's
 * tables. It behaves best of the three across the whole range, which is why
 * nearly every modern calculator defaults to it.
 *
 * @category Color
 * @group Calculations
 */
export function moreySrm(mcu: number): Srm {
  if (mcu <= 0) return 0;
  return 1.4922 * mcu ** 0.6859;
}

/**
 * Daniels' fit: `SRM = 0.2 × MCU + 8.4`.
 *
 * From Ray Daniels, *Designing Great Beers*. It's a straight line regressed
 * over roughly MCU 7–50, and it's wrong for pale beers because it can't return
 * less than 8.4 SRM. We clamp to Morey below the crossover so a pale lager
 * doesn't come out amber.
 *
 * @category Color
 * @group Calculations
 */
export function danielsSrm(mcu: number): Srm {
  if (mcu <= 0) return 0;
  const linear = 0.2 * mcu + 8.4;
  const morey = moreySrm(mcu);
  return morey < linear && mcu < 10 ? morey : linear;
}

/**
 * Mosher's fit: `SRM = 0.3 × MCU + 4.7`.
 *
 * From Randy Mosher, *The Brewer's Companion*. It was regressed on commercial
 * beers, so it has a floor too (4.7 SRM), and we clamp it the same way as
 * {@link danielsSrm}.
 *
 * @category Color
 * @group Calculations
 */
export function mosherSrm(mcu: number): Srm {
  if (mcu <= 0) return 0;
  const linear = 0.3 * mcu + 4.7;
  const morey = moreySrm(mcu);
  return morey < linear && mcu < 7 ? morey : linear;
}

/**
 * Run whichever MCU → SRM fit the options select.
 *
 * @category Color
 * @group Calculations
 */
export function srmFromMcu(mcu: number, formula: ColorFormula = 'morey'): Srm {
  switch (formula) {
    case 'daniels':
      return danielsSrm(mcu);
    case 'mosher':
      return mosherSrm(mcu);
    default:
      return moreySrm(mcu);
  }
}

/**
 * The citation key each colour fit reports in its explanation.
 *
 * @internal
 * @category Color
 */
export const COLOR_FORMULA_NAMES: Readonly<Record<ColorFormula, string>> = {
  morey: 'morey-1999',
  daniels: 'daniels-1996',
  mosher: 'mosher-1994',
};

/**
 * The formula each colour fit applies, written out for the explanation.
 *
 * @internal
 * @category Color
 */
export const COLOR_FORMULA_EXPRESSIONS: Readonly<Record<ColorFormula, string>> = {
  morey: 'SRM = 1.4922 × MCU^0.6859',
  daniels: 'SRM = 0.2 × MCU + 8.4',
  mosher: 'SRM = 0.3 × MCU + 4.7',
};

/**
 * Where each colour fit comes from, for the explanation's citation.
 *
 * @internal
 * @category Color
 */
export const COLOR_FORMULA_SOURCES: Readonly<Record<ColorFormula, readonly Source[]>> = {
  morey: [MOREY_1999],
  daniels: [DANIELS_DESIGNING_1996, MOREY_1999],
  mosher: [MOSHER_COMPANION_1994, MOREY_1999],
};

/**
 * SRM → EBC. The conversion is defined as `EBC = SRM × 1.97`.
 *
 * @category Color
 * @group Calculations
 */
export function srmToEbc(srm: Srm): number {
  return srm * 1.97;
}

/**
 * EBC → SRM.
 *
 * @category Color
 * @group Calculations
 */
export function ebcToSrm(ebc: number): Srm {
  return ebc / 1.97;
}

/**
 * Degrees Lovibond → SRM (Daniels): `SRM = 1.3546 × °L − 0.76`.
 *
 * @category Color
 * @group Calculations
 */
export function lovibondToSrm(lovibond: Lovibond): Srm {
  return 1.3546 * lovibond - 0.76;
}

/**
 * SRM → degrees Lovibond, the inverse of {@link lovibondToSrm}.
 *
 * @category Color
 * @group Calculations
 */
export function srmToLovibond(srm: Srm): Lovibond {
  return (srm + 0.76) / 1.3546;
}

/**
 * sRGB hex swatch for each integer SRM from 1 to 40.
 *
 * This is the widely reproduced SRM colour chart: Dave Ekhardt's rendering of
 * the standard beer-colour reference photographs, used by the BJCP colour guide
 * and by most homebrew calculators. {@link srmToHex} interpolates linearly in
 * sRGB between entries. It's an approximate swatch, not a colorimetric
 * transform.
 *
 * @category Color
 * @group Constants and defaults
 */
export const SRM_HEX_TABLE: readonly string[] = [
  '#FFE699', // 1
  '#FFD878', // 2
  '#FFCA5A', // 3
  '#FFBF42', // 4
  '#FBB123', // 5
  '#F8A600', // 6
  '#F39C00', // 7
  '#EA8F00', // 8
  '#E58500', // 9
  '#DE7C00', // 10
  '#D77200', // 11
  '#CF6900', // 12
  '#CB6200', // 13
  '#C35900', // 14
  '#BB5100', // 15
  '#B54C00', // 16
  '#B04500', // 17
  '#A63E00', // 18
  '#A13700', // 19
  '#9B3200', // 20
  '#952D00', // 21
  '#8E2900', // 22
  '#882300', // 23
  '#821E00', // 24
  '#7B1A00', // 25
  '#771900', // 26
  '#701400', // 27
  '#6A0E00', // 28
  '#660D00', // 29
  '#5E0B00', // 30
  '#5A0A02', // 31
  '#600903', // 32
  '#520907', // 33
  '#4C0505', // 34
  '#470606', // 35
  '#440607', // 36
  '#3F0708', // 37
  '#3B0607', // 38
  '#3A070B', // 39
  '#36080A', // 40
];

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1).toUpperCase()}`;
}

/**
 * Approximate sRGB hex for an SRM value, for a beer-colour swatch.
 *
 * Linear interpolation between the integer entries of {@link SRM_HEX_TABLE}.
 * Below SRM 1 it fades towards near-white (`#FFF9E6`, roughly the colour of
 * water in a glass). Above SRM 40 it clamps to the darkest entry, which already
 * looks black.
 *
 * @category Color
 * @group Start here
 */
export function srmToHex(srm: Srm): string {
  const table = SRM_HEX_TABLE;
  const first = table[0] ?? '#FFE699';
  const last = table[table.length - 1] ?? '#36080A';
  if (!Number.isFinite(srm) || srm <= 0) return '#FFF9E6';
  if (srm < 1) {
    const [r, g, b] = hexToRgb(first);
    const [wr, wg, wb] = hexToRgb('#FFF9E6');
    const t = srm;
    return rgbToHex(wr + (r - wr) * t, wg + (g - wg) * t, wb + (b - wb) * t);
  }
  if (srm >= table.length) return last;
  const lowIndex = Math.floor(srm) - 1;
  const low = table[lowIndex] ?? first;
  const high = table[lowIndex + 1] ?? last;
  const t = srm - Math.floor(srm);
  const [r1, g1, b1] = hexToRgb(low);
  const [r2, g2, b2] = hexToRgb(high);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/**
 * Everything the colour module produces for a recipe.
 *
 * @category Color
 * @group Results
 */
export interface ColorResult {
  /** Malt color units, from {@link maltColorUnits}. */
  readonly mcu: number;
  /** Color in SRM, from the selected fit. */
  readonly srm: Srm;
  /** The same color in EBC. */
  readonly ebc: number;
  /** Approximate sRGB swatch, `#RRGGBB`. */
  readonly hex: string;
  /** The MCU to SRM fit that produced {@link srm}. */
  readonly formula: ColorFormula;
}

/**
 * Colour of a grist in a given volume of wort.
 *
 * @category Color
 * @group Start here
 */
export function calculateColor(
  fermentables: readonly FermentableAddition[],
  volumeL: Litres,
  formula: ColorFormula = 'morey',
): ColorResult {
  const mcu = maltColorUnits(fermentables, volumeL);
  const srm = srmFromMcu(mcu, formula);
  return { mcu, srm, ebc: srmToEbc(srm), hex: srmToHex(srm), formula };
}

/**
 * The classes whose shares the colour solver scales. These are the malts a
 * brewer reaches for when a beer is the wrong colour.
 *
 * We reuse `MaltPhClass` because the mash-pH model already sorts a grist into
 * base, kilned, crystal and roast, and a second classification of the same
 * malts would be one more thing to keep in step.
 */
const COLOUR_MALT_CLASSES: readonly MaltPhClass[] = ['crystal', 'roasted'];

/**
 * The classes that give or take the difference: the base and kilned malts.
 *
 * Wheat and other adjuncts, acidulated malt, sugars and extracts don't move.
 * They're in a recipe for reasons unrelated to colour (a 50 % wheat beer is
 * 50 % wheat whatever shade it is), so the solver doesn't trade them for
 * crystal.
 */
const ABSORBING_MALT_CLASSES: readonly MaltPhClass[] = ['base', 'munich-vienna'];

/**
 * The largest share of the grist the solver will give to colour malt: half.
 *
 * This is a design limit, not an arithmetic one. Crystal and roast bring
 * unfermentable sugar and astringency along with colour, and a bill that's
 * more than half of either is a different beer. Past this point the brewer
 * needs a darker malt, not more of a pale one, and the solver returns
 * `unreachable`.
 */
const MAX_COLOUR_MALT_FRACTION = 0.5;

/**
 * Why a grist could not be aimed at a colour.
 *
 * @category Color
 * @group Results
 */
export type TargetSrmRefusal =
  /** The bill has no crystal or roasted malt to size. */
  | 'no-colour-malt'
  /** No share of colour malt inside the half-grist limit lands on that colour. */
  | 'unreachable';

/**
 * New shares for a grist aimed at a colour, or why it could not be.
 *
 * @category Color
 * @group Results
 */
export type TargetSrmSolution =
  | {
      /** The solve succeeded. */
      readonly ok: true;
      /** One share per input row, in the order they were given, **percent**. */
      readonly percentsOfGrist: readonly Percent[];
    }
  | {
      /** The solve was refused. */
      readonly ok: false;
      /** Why the grist couldn't be aimed at the color. */
      readonly reason: TargetSrmRefusal;
    };

/** Share-weighted MCU of one candidate set of shares. */
function mcuForShares(
  grist: readonly GristShare[],
  percents: readonly number[],
  totalKg: Kilograms,
  colorVolumeL: Litres,
): number {
  const additions: FermentableAddition[] = grist.map((row, index) => ({
    ...row.fermentable,
    amountKg: (totalKg * (percents[index] ?? 0)) / 100,
  }));
  return maltColorUnits(additions, colorVolumeL);
}

/**
 * The shares that put a grist on a target colour, or the reason it can't be done.
 *
 * Every crystal and roasted row is scaled by one factor, so their ratio to each
 * other (a recipe decision, not a colour one) stays the same. The base and
 * kilned rows give or take the difference in proportion to their own shares.
 * The shares still add up to the same total as before, which a grist stated in
 * percentages needs, and nothing else in the bill changes.
 *
 * MCU is linear in mass and every fit in this file is monotonic in MCU, so the
 * colour is monotonic in that one factor and bisection finds it. There's no
 * closed form because {@link danielsSrm} and {@link mosherSrm} are piecewise,
 * and we want the same solver to be exact for all three fits.
 *
 * ## Refusals
 *
 * `no-colour-malt` when the bill has no crystal or roast in it. We don't invent
 * an addition, because which malt and how dark is up to the recipe.
 *
 * `unreachable` when no factor inside `MAX_COLOUR_MALT_FRACTION` (half the
 * grist) reaches the colour. It's also returned for bills with no base or kilned malt, since
 * there's nothing to trade against and the shares can't move.
 *
 * ## Limits
 *
 * It keeps the total mass fixed, so moving share from base malt to crystal
 * changes the gravity a little, because crystal and roast yield less extract
 * than base. A caller that also has a target OG can follow this with
 * {@link gristKgForTargetOg}.
 *
 * @category Color
 * @group Calculations
 */
export function gristSharesForTargetSrm(
  grist: readonly GristShare[],
  totalKg: Kilograms,
  colorVolumeL: Litres,
  targetSrm: Srm,
  formula: ColorFormula = 'morey',
): TargetSrmSolution {
  const percents = grist.map((row) =>
    Number.isFinite(row.percentOfGrist) && row.percentOfGrist > 0 ? row.percentOfGrist : 0,
  );
  const classes = grist.map((row) => inferMaltPhClass(row.fermentable));
  const isColour = classes.map((maltClass) => COLOUR_MALT_CLASSES.includes(maltClass));
  const isAbsorbing = classes.map((maltClass) => ABSORBING_MALT_CLASSES.includes(maltClass));

  const sumWhere = (flags: readonly boolean[]) =>
    percents.reduce((sum, percent, index) => (flags[index] === true ? sum + percent : sum), 0);
  const colourShare = sumWhere(isColour);
  const absorbingShare = sumWhere(isAbsorbing);
  if (colourShare <= 0) return { ok: false, reason: 'no-colour-malt' };

  const total = percents.reduce((sum, percent) => sum + percent, 0);
  if (absorbingShare <= 0) return { ok: false, reason: 'unreachable' };
  if (!Number.isFinite(targetSrm) || targetSrm < 0) return { ok: false, reason: 'unreachable' };
  if (!Number.isFinite(totalKg) || totalKg <= 0) return { ok: false, reason: 'unreachable' };
  if (!Number.isFinite(colorVolumeL) || colorVolumeL <= 0)
    return { ok: false, reason: 'unreachable' };

  /** Shares at a given scaling of the colour malts. */
  const sharesAt = (factor: number): number[] => {
    const taken = colourShare * (factor - 1);
    const absorbFactor = 1 - taken / absorbingShare;
    return percents.map((percent, index) => {
      if (isColour[index] === true) return percent * factor;
      if (isAbsorbing[index] === true) return Math.max(0, percent * absorbFactor);
      return percent;
    });
  };
  const srmAt = (factor: number): Srm =>
    srmFromMcu(mcuForShares(grist, sharesAt(factor), totalKg, colorVolumeL), formula);

  // Two ceilings, and the lower one wins: the colour malts can't go past half
  // the grist, and they can't take more share from the base malts than the
  // base malts have.
  const maxFactor = Math.max(
    0,
    Math.min(1 + absorbingShare / colourShare, (total * MAX_COLOUR_MALT_FRACTION) / colourShare),
  );
  let low = 0;
  let high = maxFactor;
  const srmLow = srmAt(low);
  const srmHigh = srmAt(high);
  const rising = srmHigh >= srmLow;
  const within = rising
    ? targetSrm >= srmLow && targetSrm <= srmHigh
    : targetSrm >= srmHigh && targetSrm <= srmLow;
  if (!within) return { ok: false, reason: 'unreachable' };

  for (let step = 0; step < 200 && high - low > 1e-12; step += 1) {
    const mid = (low + high) / 2;
    if (rising === srmAt(mid) < targetSrm) low = mid;
    else high = mid;
  }
  return { ok: true, percentsOfGrist: sharesAt((low + high) / 2) };
}
