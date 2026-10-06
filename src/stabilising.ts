/**
 * Sulfite and sorbate, for stabilising a cider, wine or mead.
 *
 * Beer doesn't usually need either dose, and they do different jobs. Sulfite
 * is the antioxidant and antimicrobial, and how well it works depends on the
 * pH of the drink. Sorbate stops a stabilised drink refermenting when it's
 * sweetened, and how much is needed depends on the alcohol already there.
 *
 * Canonical units: litres, mg/L, grams, % ABV.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import {
  BOULTON_WINEMAKING_1996,
  LEA_CRAFT_CIDER_2008,
  PEYNAUD_KNOWING_WINE_1984,
} from './sources';
import type { Litres, Percent } from './types';

// ---------------------------------------------------------------------------
// Sulfite
// ---------------------------------------------------------------------------

/**
 * First dissociation constant of sulfurous acid, as pKa.
 *
 * `SO₂·H₂O ⇌ HSO₃⁻ + H⁺`, pKa 1.81 at cellar temperature (Boulton, Singleton,
 * Bisson & Kunkee). This is why a sulfite dose depends on pH: only the
 * undissociated molecular SO₂ is antimicrobial, and the fraction of free SO₂
 * that's molecular falls by a factor of ten for every unit of pH.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const SO2_PKA = 1.81;

/**
 * Molecular SO₂ to hold a still wine or cider at, mg/L.
 *
 * 0.8 mg/L is the usual winemaking figure. It's high enough to hold off
 * *Brettanomyces* and spoilage lactic bacteria, and low enough that you can't
 * smell it. It's only a default: a sweet wine going into bottle is often taken
 * higher, and a dry red kept under CO₂ lower.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const DEFAULT_MOLECULAR_SO2_MG_L = 0.8;

/**
 * SO₂ released by potassium metabisulfite, as a fraction of its mass.
 *
 * `K₂S₂O₅ → 2 SO₂`: 128.13 g of SO₂ out of 222.31 g of salt, which is 57.6 %.
 * The molar masses are here so the figure can be checked.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const KMS_SO2_FRACTION = 0.576;

/**
 * The pH above which sulfite alone isn't enough for a cider.
 *
 * At pH 3.8 the free SO₂ needed for 0.8 mg/L molecular is over 100 mg/L, which
 * is more than most brewers will add and close to legal limits. Lea's advice
 * for a cider that high is to acidify first. Above this pH the explanation
 * adds a note saying so.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const CIDER_SULFITE_PH_CEILING = 3.8;

/**
 * Input to {@link sulfiteDose}.
 *
 * @category Packaging
 * @group Inputs
 */
export interface SulfiteDoseInput {
  /** Volume to treat, litres. */
  readonly volumeL: Litres;
  /** The drink's pH, which determines the dose. */
  readonly ph: number;
  /** Molecular SO₂ to hold, mg/L. @see DEFAULT_MOLECULAR_SO2_MG_L */
  readonly targetMolecularSo2MgL?: number;
  /** Free SO₂ already in the drink, mg/L, from the brewer's own measurement. */
  readonly currentFreeSo2MgL?: number;
}

/**
 * Result of {@link sulfiteDose}.
 *
 * @category Packaging
 * @group Results
 */
export interface SulfiteDoseResult {
  /** Free SO₂ the drink has to hold to reach the molecular target, mg/L. */
  readonly freeSo2MgL: number;
  /** Potassium metabisulfite to add, grams. */
  readonly metabisulfiteGrams: number;
}

/**
 * Potassium metabisulfite for a molecular SO₂ target at a given pH.
 *
 * ```
 * free SO₂ = molecular target × (1 + 10^(pH − 1.81))
 * g KMS    = (free SO₂ − free SO₂ already there) × volume_L / 1000 / 0.576
 * ```
 *
 * The bracket is the Henderson–Hasselbalch ratio of bisulfite to molecular SO₂
 * as a multiplier: about 16 at pH 3.0, 40 at pH 3.4, and 99 at pH 3.8. It
 * changes sixfold over four tenths of a pH unit, so a dose given without a pH
 * is meaningless.
 *
 * ## Current free SO₂ comes from the brewer
 *
 * `currentFreeSo2MgL` is the brewer's own measurement, from an
 * aeration-oxidation rig, a Ripper titration or a test strip. We don't
 * estimate it from a previous addition, because free SO₂ binds to
 * acetaldehyde and anthocyanins at a rate you can't compute from the dose, so
 * any estimate would be a guess. If it's left out it's zero, which doses the
 * drink as if it had never been sulfited.
 *
 * ## Above pH 3.8, sulfite isn't enough on its own
 *
 * A cider much over {@link CIDER_SULFITE_PH_CEILING} needs more free SO₂ than
 * is practical or, in some places, legal. Lea's advice is to acidify first and
 * sulfite afterwards, and the explanation adds a note saying so instead of
 * just returning a large number.
 *
 * A drink already holding more free SO₂ than the target needs is dosed at zero,
 * not at a negative weight.
 *
 * @category Packaging
 * @group Calculations
 */
export function sulfiteDose(input: SulfiteDoseInput): SulfiteDoseResult {
  const target = input.targetMolecularSo2MgL ?? DEFAULT_MOLECULAR_SO2_MG_L;
  const freeSo2MgL = target * (1 + 10 ** (input.ph - SO2_PKA));
  const shortfall = freeSo2MgL - (input.currentFreeSo2MgL ?? 0);
  if (shortfall <= 0 || input.volumeL <= 0) return { freeSo2MgL, metabisulfiteGrams: 0 };
  return {
    freeSo2MgL,
    metabisulfiteGrams: (shortfall * input.volumeL) / 1000 / KMS_SO2_FRACTION,
  };
}

// ---------------------------------------------------------------------------
// Sorbate
// ---------------------------------------------------------------------------

/**
 * Sorbic acid needed by alcohol content, mg/L, from Peynaud's table.
 *
 * The more alcohol there is, the less sorbic acid it takes to suppress yeast,
 * because both inhibit it. Between rows the dose is interpolated linearly.
 * Below 10 % it's the first row's 150, and at 14 % and above it's the last
 * row's 50. The table stops there, and extrapolating past it would be our
 * own numbers, not Peynaud's.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const SORBIC_ACID_BY_ABV: readonly (readonly [Percent, number])[] = [
  [10, 150],
  [11, 125],
  [12, 100],
  [13, 75],
  [14, 50],
];

/**
 * Sorbic acid in potassium sorbate, as a fraction of its mass.
 *
 * 112.13 g of sorbic acid per 150.22 g of the potassium salt, 74.7 %. So the
 * weight of salt to add is always a little more than the sorbic acid figure.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const POTASSIUM_SORBATE_SORBIC_FRACTION = 0.747;

/**
 * The legal ceiling on sorbic acid, mg/L.
 *
 * The US (TTB) allows 300 mg/L and the EU 200 mg/L. Peynaud's table tops out
 * at 150, so it never gets close. They're included so a brewer who doubles a
 * dose "to be sure" can see where the limit is.
 *
 * @category Packaging
 * @group Constants and defaults
 */
export const SORBIC_ACID_LIMIT_MG_L: {
  /** The US (TTB) limit, in mg/L. */
  readonly ttb: 300;
  /** The EU limit, in mg/L. */
  readonly eu: 200;
} = { ttb: 300, eu: 200 };

/**
 * Input to {@link sorbateDose}.
 *
 * @category Packaging
 * @group Inputs
 */
export interface SorbateDoseInput {
  /** Volume to treat, litres. */
  readonly volumeL: Litres;
  /** The drink's alcohol, % ABV. */
  readonly abvPercent: Percent;
}

/**
 * Result of {@link sorbateDose}.
 *
 * @category Packaging
 * @group Results
 */
export interface SorbateDoseResult {
  /** Sorbic acid the drink needs, mg/L. */
  readonly sorbicAcidMgL: number;
  /** Potassium sorbate to add, grams. */
  readonly potassiumSorbateGrams: number;
}

/**
 * Potassium sorbate for a drink about to be sweetened.
 *
 * Reads {@link SORBIC_ACID_BY_ABV} at the drink's alcohol, interpolating between
 * rows, and converts to the potassium salt at
 * {@link POTASSIUM_SORBATE_SORBIC_FRACTION}.
 *
 * ## Three caveats
 *
 * **It doesn't work without sulfite.** Sorbate stops yeast budding but does
 * nothing to bacteria, so a drink with sorbate and no SO₂ is open to lactic
 * bacteria.
 *
 * **It must never go into a drink that may still go through malolactic
 * fermentation.** Lactic bacteria metabolise sorbic acid to 2-ethoxyhexa-3,5-
 * diene, which smells of crushed geranium leaves and can't be removed from the
 * wine afterwards.
 *
 * **It doesn't stop an active fermentation.** It prevents a new population
 * from establishing, so it's for backsweetening, not for stopping a ferment.
 *
 * All three are notes on the explanation, because they matter more than the
 * grams.
 *
 * @category Packaging
 * @group Calculations
 */
export function sorbateDose(input: SorbateDoseInput): SorbateDoseResult {
  const sorbicAcidMgL = sorbicAcidForAbv(input.abvPercent);
  if (input.volumeL <= 0) return { sorbicAcidMgL, potassiumSorbateGrams: 0 };
  return {
    sorbicAcidMgL,
    potassiumSorbateGrams:
      (sorbicAcidMgL * input.volumeL) / 1000 / POTASSIUM_SORBATE_SORBIC_FRACTION,
  };
}

/**
 * Sorbic acid from Peynaud's table at a given ABV, mg/L.
 *
 * Flat outside the table's ends, linear between its rows. See
 * {@link SORBIC_ACID_BY_ABV}.
 *
 * @category Packaging
 * @group Calculations
 */
export function sorbicAcidForAbv(abvPercent: Percent): number {
  const first = SORBIC_ACID_BY_ABV[0];
  const last = SORBIC_ACID_BY_ABV[SORBIC_ACID_BY_ABV.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (abvPercent <= first[0]) return first[1];
  if (abvPercent >= last[0]) return last[1];
  for (let i = 1; i < SORBIC_ACID_BY_ABV.length; i += 1) {
    const upper = SORBIC_ACID_BY_ABV[i];
    const lower = SORBIC_ACID_BY_ABV[i - 1];
    if (upper === undefined || lower === undefined) continue;
    if (abvPercent <= upper[0]) {
      const span = upper[0] - lower[0];
      const fraction = span === 0 ? 0 : (abvPercent - lower[0]) / span;
      return lower[1] + fraction * (upper[1] - lower[1]);
    }
  }
  return last[1];
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

/**
 * The sulfite dose with its breakdown. @see sulfiteDose
 *
 * @category Packaging
 * @group Explanations
 */
export function sulfiteDoseExplained(input: SulfiteDoseInput): Explanation {
  const result = sulfiteDose(input);
  const target = input.targetMolecularSo2MgL ?? DEFAULT_MOLECULAR_SO2_MG_L;
  const current = input.currentFreeSo2MgL ?? 0;
  return explain(result.metabisulfiteGrams, {
    label: 'Potassium metabisulfite',
    formula: 'molecular-so2-at-ph',
    expression: 'free SO₂ = molecular target × (1 + 10^(pH − 1.81)); g = ΔSO₂ × V / 1000 / 0.576',
    inputs: {
      volumeL: round(input.volumeL),
      ph: round(input.ph, 2),
      targetMolecularSo2MgL: round(target, 2),
      currentFreeSo2MgL: round(current, 1),
      freeSo2MgL: round(result.freeSo2MgL, 1),
      molecularFraction: round(1 / (1 + 10 ** (input.ph - SO2_PKA)), 4),
      metabisulfiteSo2Percent: round(KMS_SO2_FRACTION * 100, 1),
    },
    unit: 'g',
    notes: [
      'Only the molecular SO₂ does the work, and the fraction of free SO₂ that is molecular falls tenfold for every unit of pH.',
      'The free SO₂ already present is the figure you measured. Nothing here estimates it from an earlier addition, because binding cannot be computed from the dose.',
      ...(input.ph > CIDER_SULFITE_PH_CEILING
        ? [
            `At pH ${round(input.ph, 2)} sulfite alone is not enough: a cider above ${CIDER_SULFITE_PH_CEILING} should be acidified first.`,
          ]
        : []),
      ...(result.metabisulfiteGrams === 0
        ? ['The free SO₂ already there meets the target, so the dose is zero.']
        : []),
    ],
    family: 'cellar',
    sources: [BOULTON_WINEMAKING_1996, LEA_CRAFT_CIDER_2008],
  });
}

/**
 * The sorbate dose with its breakdown. @see sorbateDose
 *
 * @category Packaging
 * @group Explanations
 */
export function sorbateDoseExplained(input: SorbateDoseInput): Explanation {
  const result = sorbateDose(input);
  return explain(result.potassiumSorbateGrams, {
    label: 'Potassium sorbate',
    formula: 'peynaud-sorbic-by-alcohol',
    expression: 'g = sorbic acid mg/L (from the alcohol) × V / 1000 / 0.747',
    inputs: {
      volumeL: round(input.volumeL),
      abvPercent: round(input.abvPercent, 1),
      sorbicAcidMgL: round(result.sorbicAcidMgL, 1),
      sorbateSorbicPercent: round(POTASSIUM_SORBATE_SORBIC_FRACTION * 100, 1),
    },
    unit: 'g',
    notes: [
      'Peynaud’s table runs 150 mg/L of sorbic acid up to 10 % alcohol, then 125, 100, 75 and 50 at 11, 12, 13 and 14 %. Between rows it is interpolated; outside them it is held flat.',
      'Only alongside sulfite. Sorbate stops yeast budding and does nothing to bacteria.',
      'Never on a drink that may still go through malolactic fermentation: the lactics turn sorbic acid into the geranium note, which cannot be undone.',
      `The legal ceiling on sorbic acid is ${SORBIC_ACID_LIMIT_MG_L.ttb} mg/L in the US (TTB) and ${SORBIC_ACID_LIMIT_MG_L.eu} mg/L in the EU.`,
    ],
    family: 'cellar',
    sources: [PEYNAUD_KNOWING_WINE_1984],
  });
}
