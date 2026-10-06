/**
 * Mash pH, using a charge-balance model along the lines of Troester (Kaiser).
 *
 * ## The model
 *
 * We treat the mash as a titration. Each malt, mashed in distilled water,
 * settles at its own DI pH. Moving it away from that pH takes acid (or base) in
 * proportion to its buffering capacity, in mEq per kilogram per pH unit. The
 * water brings alkalinity (base) and calcium/magnesium, which release protons
 * when they precipitate malt phosphate (Kolbach's effect). Added acids bring
 * protons, and how many depends on the pH they end up at. The mash pH is the
 * pH where all of that balances:
 *
 * ```
 * Σᵢ Bᵢ · mᵢ · (pH_DI,ᵢ − pH)   =   A_acids(pH) + A_water(pH)
 * └── acid the grist absorbs ──┘     └── acid the brewer and the water supply ──┘
 * ```
 *
 * The left-hand side falls with pH and the right-hand side rises with it, so
 * the balance has one root, which we find by bisection.
 *
 * ## Differences from a lookup table
 *
 * 1. Acid strength is computed from each acid's pKa list. The equivalents it
 *    delivers are evaluated at the current pH from the Henderson–Hasselbalch
 *    speciation. At pH 5.4 phosphoric acid gives 1.015 eq/mol, because its
 *    second proton (pKa 7.20) has started to come off, and citric acid gives
 *    1.90 eq/mol. Hard-coded values of 1 and 3 would be wrong as soon as the
 *    target pH moved.
 * 2. Alkalinity is measured to the pH 4.3 end point, but a mash only gets to
 *    about 5.4, where about 10 % of the carbonate is still bicarbonate and
 *    hasn't consumed any acid. The default {@link AlkalinityModel} accounts
 *    for that.
 * 3. Mash thickness comes from the volumes. The water's contribution scales
 *    with litres in the tun and the grist's with kilograms, so thickness falls
 *    out of the arithmetic without a separate factor.
 *
 * ## Sources
 *
 * - Troester, K., "Understanding Mash pH" and "A general approach to brewing
 *   water" (braukaiser.com, 2009–2012): the DI-pH and buffering-capacity model,
 *   and the published malt measurements the class defaults are rounded from.
 * - Riffe, D. M., *MpH* mash pH spreadsheet: the same charge-balance idea,
 *   expressed as malt acidity at a reference pH.
 * - Kolbach, P. (1953): residual alkalinity, applied here as the Ca/3.5 and
 *   Mg/7 proton release (see `./water`).
 * - Bates, R. G. & Pinching, G. D. and the CRC Handbook: the pKa values.
 * - Palmer & Kaminski, *Water* (2013): acid strength tables we cross-check the
 *   computed values against.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import {
  HARNED_DAVIS_1943,
  KOLBACH_1953,
  PALMER_KAMINSKI_WATER_2013,
  TROESTER_BREWING_WATER,
  TROESTER_MASH_PH,
} from './sources';
import type {
  AcidAddition,
  AcidId,
  FermentableAddition,
  Kilograms,
  Litres,
  MaltPhClass,
  MashPhOptions,
  Percent,
  SaltId,
  WaterProfile,
} from './types';
import {
  alkalinityMEqPerLitre,
  alkalinityPpm,
  CACO3_EQUIVALENT_WEIGHT,
  ionMEqPerLitre,
  KOLBACH_CALCIUM_DIVISOR,
  KOLBACH_MAGNESIUM_DIVISOR,
  MOLAR_MASS_G_PER_MOL,
  residualAlkalinityPpm,
  SALT_DEFINITIONS,
  saltIonPpmPerGramPerLitre,
} from './water';

// ---------------------------------------------------------------------------
// Acid–base speciation
// ---------------------------------------------------------------------------

/**
 * Mean number of protons an acid has donated at a given pH.
 *
 * For an acid `HₙA` with stepwise dissociation constants `K₁…Kₙ`, the relative
 * abundance of the species that has lost `j` protons is
 *
 * ```
 * Rⱼ = (Π_{k≤j} K_k) / [H⁺]ʲ      →      log₁₀ Rⱼ = j·pH − Σ_{k≤j} pKa_k
 * ```
 *
 * and the mean protons donated is the abundance-weighted mean of `j`:
 *
 * ```
 * f(pH) = Σ j·Rⱼ / Σ Rⱼ
 * ```
 *
 * This is Henderson–Hasselbalch generalised to a polyprotic acid. It gives the
 * number of equivalents one mole of the acid delivers at this pH, which is what
 * the charge balance needs. We work in the exponent domain and subtract the
 * max so that strong acids (pKa ≪ 0) and very high pH can't overflow.
 *
 * Sanity checks, all covered by tests:
 * - lactic (pKa 3.86) at pH 5.40 → 0.9722
 * - phosphoric (2.148 / 7.198 / 12.32) at pH 5.40 → 1.0151
 * - citric (3.128 / 4.761 / 6.396) at pH 5.40 → 1.9015
 * - hydrochloric (strong) → 1.0000 at every brewing pH
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function protonsDonatedPerMolecule(pKa: readonly number[], ph: number): number {
  const logs: number[] = [0];
  let cumulative = 0;
  for (const k of pKa) {
    cumulative += k;
    logs.push(logs.length * ph - cumulative);
  }
  let max = Number.NEGATIVE_INFINITY;
  for (const l of logs) if (l > max) max = l;
  let numerator = 0;
  let denominator = 0;
  for (let j = 0; j < logs.length; j += 1) {
    const weight = 10 ** ((logs[j] ?? 0) - max);
    numerator += j * weight;
    denominator += weight;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Milliequivalents of acid delivered per millimole of a substance at `pH`.
 *
 * `protonsAlreadyRemoved` is how many protons the substance arrives without:
 * 0 for a free acid, 1 for bicarbonate (NaHCO₃), 2 for carbonate (CaCO₃). The
 * result is negative for a base, so the charge balance can treat a base as acid
 * with the sign flipped, with no separate code path.
 *
 * ```
 * mEq/mmol = f(pH) − protonsAlreadyRemoved
 * ```
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function equivalentsPerMillimole(
  pKa: readonly number[],
  ph: number,
  protonsAlreadyRemoved = 0,
): number {
  return protonsDonatedPerMolecule(pKa, ph) - protonsAlreadyRemoved;
}

/**
 * Carbonic acid dissociation constants at 25 °C: `pKa₁ = 6.35`, `pKa₂ = 10.33`.
 * Source: Harned & Davis (1943) / CRC Handbook.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const CARBONIC_PKA: readonly number[] = [6.35, 10.33];

/**
 * Ion product of water, `pKw = 14.00` at 25 °C.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const PKW = 14;

/**
 * Mean protons donated by the carbonate system at a pH, `α₁ + 2α₂`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function carbonateProtonsDonated(ph: number): number {
  return protonsDonatedPerMolecule(CARBONIC_PKA, ph);
}

/**
 * Total carbonate `C_T` (mmol/L) implied by an alkalinity and a pH.
 *
 * From `Alk = C_T·(α₁ + 2α₂)`:
 *
 * ```
 * C_T = Alk / f_carbonic(pH)
 * ```
 *
 * The strict definition of alkalinity also includes `+ [OH⁻] − [H⁺]`. We drop
 * those terms. Across the pH 6–8.5 range of brewing water they never exceed
 * 3 × 10⁻⁴ mEq/L, three to four orders of magnitude below any real alkalinity.
 * Keeping them would give a water reported as "alkalinity 0 at pH 7.5" (which
 * is what RO water is) a non-zero carbonate content, and a mash pH slightly off
 * its grist's DI pH. We'd rather zero alkalinity give exactly zero.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function totalCarbonateMMolPerLitre(alkalinityMEqPerL: number, waterPh: number): number {
  const f = carbonateProtonsDonated(waterPh);
  if (f <= 0) return 0;
  return alkalinityMEqPerL / f;
}

/**
 * Alkalinity (mEq/L) that a carbonate system of `C_T` still has left at `pH`.
 * `Alk(pH) = C_T·f(pH)`, on the same convention as
 * {@link totalCarbonateMMolPerLitre}.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function alkalinityAtPh(totalCarbonateMMol: number, ph: number): number {
  return totalCarbonateMMol * carbonateProtonsDonated(ph);
}

// ---------------------------------------------------------------------------
// Acid catalog
// ---------------------------------------------------------------------------

/**
 * A density measurement: `% w/w` → `g/mL` at 20 °C.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export interface DensityPoint {
  /** Strength of the solution, % w/w. */
  readonly concentrationPercent: Percent;
  /** Density of the solution at that strength, g/mL. */
  readonly densityGPerMl: number;
}

/**
 * The data we hold for one acid.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export interface AcidDefinition {
  /** The acid's id, which is also its key in {@link ACID_DEFINITIONS}. */
  readonly id: AcidId;
  /** Display name. */
  readonly label: string;
  /** Chemical formula. */
  readonly formula: string;
  /** Stepwise pKa values, weakest proton last. A strong proton is given a large negative value. */
  readonly pKa: readonly number[];
  /** Molar mass of the acid itself, g/mol. */
  readonly molarMassGPerMol: number;
  /** Molar mass of the solid as sold, g/mol. For a hydrate this includes the water. */
  readonly solidMolarMassGPerMol?: number;
  /** Default strength when the addition does not state one, % w/w. */
  readonly defaultConcentrationPercent: Percent;
  /** Strengths commonly sold, % w/w. */
  readonly commonConcentrationsPercent: readonly Percent[];
  /** Density of the solution at 20 °C, interpolated between these points. */
  readonly densityTable: readonly DensityPoint[];
  /** True if the acid is normally weighed as a solid, false if it's measured by volume. */
  readonly usuallySolid: boolean;
  /** Practical notes on using the acid, as sentences for display. */
  readonly notes?: readonly string[];
}

/**
 * The acid table.
 *
 * pKa values are the standard 25 °C thermodynamic constants (CRC Handbook,
 * 97th ed.). Densities are 20 °C solution densities from the CRC and Perry's
 * tables, given at the strengths brewers buy and linearly interpolated between
 * them. Inside the tabulated range the interpolation error is well under
 * 0.5 %, which is much smaller than the ±1 % strength tolerance on a bottle of
 * "88 %" lactic acid.
 *
 * As a cross-check, 88 % w/w lactic acid at 1.209 g/mL is
 * `1209 × 0.88 / 90.078 = 11.81 mmol/mL`, and at mash pH 5.4 it delivers
 * `11.81 × 0.9722 = 11.48 mEq/mL`. Bru'n Water and Palmer & Kaminski publish
 * ~11.8 mEq/mL.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const ACID_DEFINITIONS: Readonly<Record<AcidId, AcidDefinition>> = {
  lactic: {
    id: 'lactic',
    label: 'Lactic acid',
    formula: 'C₃H₆O₃',
    pKa: [3.86],
    molarMassGPerMol: MOLAR_MASS_G_PER_MOL.lacticAcid,
    defaultConcentrationPercent: 88,
    commonConcentrationsPercent: [80, 85, 88],
    densityTable: [
      { concentrationPercent: 0, densityGPerMl: 0.9982 },
      { concentrationPercent: 20, densityGPerMl: 1.045 },
      { concentrationPercent: 40, densityGPerMl: 1.092 },
      { concentrationPercent: 60, densityGPerMl: 1.14 },
      { concentrationPercent: 80, densityGPerMl: 1.186 },
      { concentrationPercent: 88, densityGPerMl: 1.209 },
      { concentrationPercent: 100, densityGPerMl: 1.224 },
    ],
    usuallySolid: false,
    notes: [
      'Flavor threshold in finished beer is around 400 ppm lactic acid; a ' +
        'normal mash dose is an order of magnitude below that.',
    ],
  },
  phosphoric: {
    id: 'phosphoric',
    label: 'Phosphoric acid',
    formula: 'H₃PO₄',
    // pKa₁ 2.148, pKa₂ 7.198, pKa₃ 12.319 (CRC).
    pKa: [2.148, 7.198, 12.319],
    molarMassGPerMol: 97.995,
    defaultConcentrationPercent: 85,
    commonConcentrationsPercent: [10, 75, 85],
    densityTable: [
      { concentrationPercent: 0, densityGPerMl: 0.9982 },
      { concentrationPercent: 10, densityGPerMl: 1.053 },
      { concentrationPercent: 25, densityGPerMl: 1.148 },
      { concentrationPercent: 50, densityGPerMl: 1.335 },
      { concentrationPercent: 75, densityGPerMl: 1.579 },
      { concentrationPercent: 85, densityGPerMl: 1.685 },
    ],
    usuallySolid: false,
    notes: [
      'Flavor-neutral at mash doses, which is why commercial breweries prefer it.',
      'The second proton starts to matter above pH ~6, and the model accounts for it.',
    ],
  },
  citric: {
    id: 'citric',
    label: 'Citric acid',
    formula: 'C₆H₈O₇',
    // pKa₁ 3.128, pKa₂ 4.761, pKa₃ 6.396 (CRC).
    pKa: [3.128, 4.761, 6.396],
    molarMassGPerMol: 192.124,
    /** Sold as the monohydrate, 192.124 + 18.015. */
    solidMolarMassGPerMol: 210.139,
    defaultConcentrationPercent: 100,
    commonConcentrationsPercent: [50, 100],
    densityTable: [
      { concentrationPercent: 0, densityGPerMl: 0.9982 },
      { concentrationPercent: 25, densityGPerMl: 1.104 },
      { concentrationPercent: 50, densityGPerMl: 1.24 },
    ],
    usuallySolid: true,
    notes: [
      'Weighed as the monohydrate (210.14 g/mol), so a gram carries 4.76 mmol ' +
        'of acid, not 5.21.',
      'Two of its three protons are already gone at mash pH, so it is a much ' +
        'stronger acidifier per mole than lactic.',
      'Leaves a citrus note; usually reserved for fruit beers.',
    ],
  },
  acetic: {
    id: 'acetic',
    label: 'Acetic acid',
    formula: 'CH₃COOH',
    pKa: [4.756],
    molarMassGPerMol: 60.052,
    defaultConcentrationPercent: 5,
    commonConcentrationsPercent: [5, 100],
    densityTable: [
      { concentrationPercent: 0, densityGPerMl: 0.9982 },
      { concentrationPercent: 5, densityGPerMl: 1.0055 },
      { concentrationPercent: 50, densityGPerMl: 1.0575 },
      { concentrationPercent: 80, densityGPerMl: 1.0697 },
      { concentrationPercent: 100, densityGPerMl: 1.0491 },
    ],
    usuallySolid: false,
    notes: [
      'Density peaks near 80 % w/w and falls again toward glacial, so the density ' +
        'table rises and then falls.',
      'Tastes of vinegar well below the dose most grists need. Use it as a last resort.',
    ],
  },
  hydrochloric: {
    id: 'hydrochloric',
    label: 'Hydrochloric acid (muriatic)',
    formula: 'HCl',
    // Strong: pKa ≈ −6. Any value below about −2 is numerically "fully dissociated".
    pKa: [-6],
    molarMassGPerMol: 36.458,
    defaultConcentrationPercent: 31,
    commonConcentrationsPercent: [10, 31, 37],
    densityTable: [
      { concentrationPercent: 0, densityGPerMl: 0.9982 },
      { concentrationPercent: 10, densityGPerMl: 1.0474 },
      { concentrationPercent: 20, densityGPerMl: 1.098 },
      { concentrationPercent: 31, densityGPerMl: 1.1543 },
      { concentrationPercent: 37, densityGPerMl: 1.1837 },
    ],
    usuallySolid: false,
    notes: ['Every mole adds a mole of chloride: 1 mL of 31 % adds ~350 mg of Cl⁻.'],
  },
  sulfuric: {
    id: 'sulfuric',
    label: 'Sulfuric acid',
    formula: 'H₂SO₄',
    // First proton strong, second pKa 1.99.
    pKa: [-3, 1.99],
    molarMassGPerMol: 98.079,
    defaultConcentrationPercent: 35,
    commonConcentrationsPercent: [10, 35, 96],
    densityTable: [
      { concentrationPercent: 0, densityGPerMl: 0.9982 },
      { concentrationPercent: 10, densityGPerMl: 1.0661 },
      { concentrationPercent: 35, densityGPerMl: 1.2599 },
      { concentrationPercent: 50, densityGPerMl: 1.3951 },
      { concentrationPercent: 96, densityGPerMl: 1.8355 },
    ],
    usuallySolid: false,
    notes: [
      'Both protons are gone at mash pH, so it delivers ~2 eq/mol — twice ' +
        'lactic per mole, and a mole of sulfate with it.',
    ],
  },
};

/**
 * Density of an acid solution at a given strength, g/mL. Linear interpolation, clamped at the ends.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidSolutionDensity(acid: AcidId, concentrationPercent: Percent): number {
  const table = ACID_DEFINITIONS[acid].densityTable;
  const first = table[0];
  const last = table[table.length - 1];
  if (!first || !last) return 1;
  if (concentrationPercent <= first.concentrationPercent) return first.densityGPerMl;
  if (concentrationPercent >= last.concentrationPercent) return last.densityGPerMl;
  for (let i = 1; i < table.length; i += 1) {
    const lo = table[i - 1];
    const hi = table[i];
    if (!lo || !hi) continue;
    if (concentrationPercent <= hi.concentrationPercent) {
      const span = hi.concentrationPercent - lo.concentrationPercent;
      const t = span === 0 ? 0 : (concentrationPercent - lo.concentrationPercent) / span;
      return lo.densityGPerMl + t * (hi.densityGPerMl - lo.densityGPerMl);
    }
  }
  return last.densityGPerMl;
}

/**
 * Millimoles of acid in 1 mL of solution.
 * `mmol/mL = density (g/mL) × strength / 100 / M (g/mol) × 1000`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidMillimolesPerMillilitre(acid: AcidId, concentrationPercent: Percent): number {
  const def = ACID_DEFINITIONS[acid];
  const density = acidSolutionDensity(acid, concentrationPercent);
  return (density * (concentrationPercent / 100) * 1000) / def.molarMassGPerMol;
}

/**
 * Millimoles of acid in 1 g of solid.
 *
 * Uses the molar mass of the solid as sold, which for citric acid is the monohydrate.
 * `concentrationPercent` is read as purity.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidMillimolesPerGram(acid: AcidId, concentrationPercent: Percent): number {
  const def = ACID_DEFINITIONS[acid];
  const mass = def.solidMolarMassGPerMol ?? def.molarMassGPerMol;
  return ((concentrationPercent / 100) * 1000) / mass;
}

/**
 * Resolved strength for an addition: its own, or the acid's default.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidConcentrationPercent(addition: AcidAddition): Percent {
  return (
    addition.concentrationPercent ?? ACID_DEFINITIONS[addition.acid].defaultConcentrationPercent
  );
}

/**
 * Millimoles of acid in one addition, whichever way it was measured.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidMillimoles(addition: AcidAddition): number {
  const strength = acidConcentrationPercent(addition);
  if (addition.grams !== undefined) {
    return addition.grams * acidMillimolesPerGram(addition.acid, strength);
  }
  return (addition.millilitres ?? 0) * acidMillimolesPerMillilitre(addition.acid, strength);
}

/**
 * Milliequivalents an addition delivers at a given pH.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidMilliequivalentsAtPh(addition: AcidAddition, ph: number): number {
  return (
    acidMillimoles(addition) * protonsDonatedPerMolecule(ACID_DEFINITIONS[addition.acid].pKa, ph)
  );
}

/**
 * Milliequivalents per millilitre (or per gram, for a solid) at a given pH. This is the figure brewers quote.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidStrengthMEqPerUnit(
  acid: AcidId,
  ph: number,
  concentrationPercent?: Percent,
): number {
  const def = ACID_DEFINITIONS[acid];
  const strength = concentrationPercent ?? def.defaultConcentrationPercent;
  const mmol = def.usuallySolid
    ? acidMillimolesPerGram(acid, strength)
    : acidMillimolesPerMillilitre(acid, strength);
  return mmol * protonsDonatedPerMolecule(def.pKa, ph);
}

// ---------------------------------------------------------------------------
// Alkaline additions
// ---------------------------------------------------------------------------

/** Salts that raise pH, and the acid-base identity each one carries. */
const ALKALI_SPECIATION: Partial<
  Record<SaltId, { readonly pKa: readonly number[]; readonly protonsRemoved: number }>
> = {
  'baking-soda': { pKa: CARBONIC_PKA, protonsRemoved: 1 },
  chalk: { pKa: CARBONIC_PKA, protonsRemoved: 2 },
  // Ca(OH)₂ delivers hydroxide. We treat it as the fully stripped end of the
  // water equilibrium, so it absorbs 2 protons per mole at any brewing pH.
  'slaked-lime': { pKa: [PKW], protonsRemoved: 2 },
};

/**
 * Milliequivalents of base one gram of an alkaline salt delivers at `pH`.
 *
 * Positive for a base. Zero for the pH-neutral salts (gypsum, calcium chloride,
 * Epsom, table salt, magnesium chloride). Those only change mash pH through
 * Kolbach's calcium/magnesium term, which the charge balance handles separately.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function alkaliBaseMEqPerGramAtPh(salt: SaltId, ph: number): number {
  const speciation = ALKALI_SPECIATION[salt];
  if (!speciation) return 0;
  const def = SALT_DEFINITIONS[salt];
  const mmolPerGram = 1000 / def.molarMassGPerMol;
  return -mmolPerGram * equivalentsPerMillimole(speciation.pKa, ph, speciation.protonsRemoved);
}

// ---------------------------------------------------------------------------
// Malt titration defaults
// ---------------------------------------------------------------------------

/**
 * DI pH and buffering capacity for one malt class.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface MaltPhDefaults {
  /** pH of a distilled-water mash, pH units. */
  readonly distilledWaterPh: number;
  /** Buffering capacity, mEq per kg per pH unit. */
  readonly bufferingCapacityMEqPerKgPerPh: number;
}

/**
 * Class defaults for the malt titration curve.
 *
 * These round Troester's published per-product measurements to a class. They're
 * a starting point, and a malt with measured data overrides them through
 * {@link FermentablePhProperties}. Crystal is a function of colour (see
 * {@link crystalMaltPhDefaults}) because a 10 °L caramel malt and a 150 °L
 * Special B behave very differently in a titration.
 *
 * | Class | DI pH | Buffering (mEq/kg/pH) | Basis |
 * | --- | --- | --- | --- |
 * | base | 5.72 | 41 | Troester's pilsner/pale-ale measurements, 5.70–5.80 / 38–45 |
 * | munich-vienna | 5.54 | 46 | Troester's Munich measurements — kilning drops DI pH ~0.2 |
 * | wheat-other | 5.95 | 33 | Troester's wheat-malt measurement; adjuncts are near-neutral and weakly buffered |
 * | crystal | f(°L) | f(°L) | see {@link crystalMaltPhDefaults} |
 * | roasted | 4.68 | 100 | Troester's chocolate/roast-barley range, 4.5–4.8 / 85–110 |
 * | acidulated | 5.72 / 41 + 3 % lactic | base malt carrying lactic acid |
 * | none | — | 0 | sugars and extracts: no titratable grist |
 *
 * Calibration: two common rules of thumb fall out of this table, and the tests
 * assert both. We care more about these than about any single decimal place.
 *
 * - 1 % acidulated malt in the grist lowers mash pH by about 0.1. Here,
 *   3 % lactic × 10 g/kg = 0.3 g/kg = 3.33 mmol/kg → 3.24 mEq/kg at pH 5.4,
 *   over 41 mEq/(kg·pH) → 0.079 pH.
 * - A millilitre of 88 % lactic acid per kilogram of grist moves pH about
 *   0.28. Here, 11.48 mEq / 41 mEq per pH = 0.28 pH.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const MALT_PH_DEFAULTS: Readonly<Record<MaltPhClass, MaltPhDefaults>> = {
  base: { distilledWaterPh: 5.72, bufferingCapacityMEqPerKgPerPh: 41 },
  'munich-vienna': { distilledWaterPh: 5.54, bufferingCapacityMEqPerKgPerPh: 46 },
  'wheat-other': { distilledWaterPh: 5.95, bufferingCapacityMEqPerKgPerPh: 33 },
  // Placeholder. Crystal is resolved by colour and this entry is never read.
  crystal: { distilledWaterPh: 5.0, bufferingCapacityMEqPerKgPerPh: 65 },
  roasted: { distilledWaterPh: 4.68, bufferingCapacityMEqPerKgPerPh: 100 },
  acidulated: { distilledWaterPh: 5.72, bufferingCapacityMEqPerKgPerPh: 41 },
  none: { distilledWaterPh: 5.72, bufferingCapacityMEqPerKgPerPh: 0 },
};

/**
 * Lower clamp on the crystal DI-pH fit, around Special B.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const CRYSTAL_DI_PH_MIN = 4.4;
/**
 * Upper clamp on the crystal DI-pH fit, around dextrin/carapils malts.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const CRYSTAL_DI_PH_MAX = 5.6;
/**
 * Upper clamp on the crystal buffering fit.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const CRYSTAL_BUFFERING_MAX = 100;

/**
 * Crystal malt DI pH and buffering as a function of colour.
 *
 * ```
 * pH_DI = clamp(5.42 − 0.00727 × °L, 4.4, 5.6)
 * B     = clamp(45 + 0.35 × °L, 45, 100)
 * ```
 *
 * A straight line through Troester's caramel-malt measurements: ~5.35 at 10 °L
 * and ~4.55 at 120 °L for the DI pH, with buffering rising from base-malt
 * levels towards the roasted figure as the malt darkens. It's fitted to a
 * handful of points, which is why it's clamped and why per-product values
 * override it.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function crystalMaltPhDefaults(colorLovibond: number): MaltPhDefaults {
  return {
    distilledWaterPh: clamp(5.42 - 0.00727 * colorLovibond, CRYSTAL_DI_PH_MIN, CRYSTAL_DI_PH_MAX),
    bufferingCapacityMEqPerKgPerPh: clamp(45 + 0.35 * colorLovibond, 45, CRYSTAL_BUFFERING_MAX),
  };
}

/**
 * Default lactic acid content of acidulated malt, % by mass.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_ACIDULATED_MALT_PERCENT_LACTIC = 3;

const ACIDULATED_PATTERN = /acid(ulated)?\s*malt|sauermalz|s[äa]uremalz/i;
const ROASTED_PATTERN =
  /roast|black\s*malt|black\s*patent|chocolate|carafa|patent|midnight|blackprinz|coffee\s*malt|de-?husked/i;
const CRYSTAL_PATTERN = /crystal|caramel|cara[a-z]*|special\s*b|honey\s*malt|melanoid/i;
const MUNICH_PATTERN =
  /munich|münchner|vienna|wiener|aromatic|biscuit|victory|amber\s*malt|brown\s*malt/i;
const WHEAT_OTHER_PATTERN =
  /wheat|weizen|rye|roggen|oat|hafer|spelt|flaked|torrified|raw\s|corn|maize|rice|barley\b(?!.*roast)/i;

/**
 * Work out which titration curve a fermentable follows.
 *
 * Precedence: an explicit `ph.maltClass` wins. Otherwise the fermentable class
 * rules out anything that isn't grain, then the name is matched against the
 * malt families (most specific first), and finally colour decides. The name
 * matching is a heuristic on free text. A fermentable with known titration
 * data should set `ph.maltClass`, so this only has to handle custom malts that
 * have nothing but a name and a colour.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function inferMaltPhClass(fermentable: FermentableAddition): MaltPhClass {
  const explicit = fermentable.ph?.maltClass;
  if (explicit) return explicit;
  if (fermentable.class !== 'grain' && fermentable.class !== 'steeping-grain') return 'none';

  const name = fermentable.name;
  if (ACIDULATED_PATTERN.test(name)) return 'acidulated';
  if (ROASTED_PATTERN.test(name)) return 'roasted';
  if (CRYSTAL_PATTERN.test(name)) return 'crystal';
  if (MUNICH_PATTERN.test(name)) return 'munich-vienna';
  if (WHEAT_OTHER_PATTERN.test(name)) return 'wheat-other';

  // Fall back to colour, which is the only other thing we have.
  if (fermentable.colorLovibond >= 150) return 'roasted';
  if (fermentable.colorLovibond >= 15 || fermentable.class === 'steeping-grain') return 'crystal';
  return 'base';
}

/**
 * The titration curve used for one fermentable.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface MaltTitration {
  /** Position of the fermentable in the grist that was passed in. */
  readonly index: number;
  /** The fermentable's name. */
  readonly name: string;
  /** Amount of the fermentable, kilograms. */
  readonly amountKg: Kilograms;
  /** The titration class the fermentable was sorted into. */
  readonly maltClass: MaltPhClass;
  /** pH of this malt mashed in distilled water. */
  readonly distilledWaterPh: number;
  /** Buffering capacity, mEq per kg per pH unit. */
  readonly bufferingCapacityMEqPerKgPerPh: number;
  /** Total buffering this addition brings, mEq per pH unit. */
  readonly bufferingMEqPerPh: number;
  /** Lactic acid carried by acidulated malt, mmol. */
  readonly lacticAcidMMol: number;
  /** True when the values came from the catalog rather than the class defaults. */
  readonly fromPublishedData: boolean;
}

/**
 * Resolve the DI pH, buffering capacity and any carried lactic acid for a grist.
 *
 * Per-product values on `fermentable.ph` override the class defaults field by
 * field, so a malt with only a published DI pH still gets the class buffering.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function resolveMaltTitrations(
  grist: readonly FermentableAddition[],
  options: { readonly acidulatedMaltPercentLactic?: Percent } = {},
): readonly MaltTitration[] {
  const acidulatedPercent =
    options.acidulatedMaltPercentLactic ?? DEFAULT_ACIDULATED_MALT_PERCENT_LACTIC;

  return grist.map((f, index) => {
    const maltClass = inferMaltPhClass(f);
    const base =
      maltClass === 'crystal'
        ? crystalMaltPhDefaults(f.colorLovibond)
        : MALT_PH_DEFAULTS[maltClass];
    const distilledWaterPh = f.ph?.distilledWaterPh ?? base.distilledWaterPh;
    const bufferingCapacityMEqPerKgPerPh =
      f.ph?.bufferingCapacityMEqPerKgPerPh ?? base.bufferingCapacityMEqPerKgPerPh;
    const lacticPercent =
      maltClass === 'acidulated'
        ? (f.ph?.acidContentPercentLactic ?? acidulatedPercent)
        : (f.ph?.acidContentPercentLactic ?? 0);
    const lacticGrams = f.amountKg * 1000 * (lacticPercent / 100);
    return {
      index,
      name: f.name,
      amountKg: f.amountKg,
      maltClass,
      distilledWaterPh,
      bufferingCapacityMEqPerKgPerPh,
      bufferingMEqPerPh: bufferingCapacityMEqPerKgPerPh * f.amountKg,
      lacticAcidMMol: (lacticGrams * 1000) / MOLAR_MASS_G_PER_MOL.lacticAcid,
      fromPublishedData:
        f.ph?.distilledWaterPh !== undefined && f.ph?.bufferingCapacityMEqPerKgPerPh !== undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// The charge balance
// ---------------------------------------------------------------------------

/**
 * Resolved mash-pH options with every default filled in.
 *
 * @category Water and mash pH
 * @group Results
 */
export type ResolvedMashPhOptions = Required<MashPhOptions>;

/**
 * Defaults for the mash-pH model.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_MASH_PH_OPTIONS: ResolvedMashPhOptions = {
  alkalinityModel: 'titrated-to-mash-ph',
  assumedSourceWaterPh: 7.5,
  convergenceTolerancePh: 1e-6,
  maxIterations: 100,
  acidulatedMaltPercentLactic: DEFAULT_ACIDULATED_MALT_PERCENT_LACTIC,
};

/**
 * Fill partial mash-pH options from {@link DEFAULT_MASH_PH_OPTIONS}.
 *
 * @internal
 * @category Water and mash pH
 */
export function resolveMashPhOptions(options: MashPhOptions = {}): ResolvedMashPhOptions {
  const d = DEFAULT_MASH_PH_OPTIONS;
  return {
    alkalinityModel: options.alkalinityModel ?? d.alkalinityModel,
    assumedSourceWaterPh: options.assumedSourceWaterPh ?? d.assumedSourceWaterPh,
    convergenceTolerancePh: options.convergenceTolerancePh ?? d.convergenceTolerancePh,
    maxIterations: options.maxIterations ?? d.maxIterations,
    acidulatedMaltPercentLactic:
      options.acidulatedMaltPercentLactic ?? d.acidulatedMaltPercentLactic,
  };
}

/**
 * Input to {@link predictMashPh}.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface MashPhInput {
  /** The grist. Only mashed and steeped grain buffers; sugars and extracts do not. */
  readonly grist: readonly FermentableAddition[];
  /**
   * The water in the mash tun, after dilution and after all mineral salts.
   * Bicarbonate from baking soda, chalk or slaked lime goes here and not in
   * `acidAdditions`, otherwise it gets counted twice.
   */
  readonly water: WaterProfile;
  /** Mash water volume, litres. */
  readonly mashVolumeL: Litres;
  /** Acids dosed into the mash. Acidulated malt is read off the grist instead. */
  readonly acidAdditions?: readonly AcidAddition[];
  /** Model settings. Missing fields fall back to {@link DEFAULT_MASH_PH_OPTIONS}. */
  readonly options?: MashPhOptions;
}

/**
 * Where the acid in the mash came from, in mEq at the predicted pH.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface MashPhContributions {
  /** Acid the grist soaks up moving from its weighted DI pH to the answer. Always ≥ 0 below DI pH. */
  readonly maltBufferMEq: number;
  /** Base the water's alkalinity supplies. Negative = base. */
  readonly waterAlkalinityMEq: number;
  /** Protons released by calcium precipitating malt phosphate (Kolbach). */
  readonly calciumMEq: number;
  /** Protons released by magnesium (Kolbach, half as effective as calcium). */
  readonly magnesiumMEq: number;
  /** Acid from bottled acids dosed into the mash. */
  readonly addedAcidMEq: number;
  /** Acid from acidulated malt in the grist. */
  readonly acidulatedMaltMEq: number;
}

/**
 * Everything {@link predictMashPh} returns.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface MashPhResult {
  /** Predicted mash pH at 25 °C (the temperature a pH meter is calibrated at). */
  readonly ph: number;
  /** Grist-only, distilled-water pH: the buffering-weighted mean of the malts' DI pH. */
  readonly distilledWaterPh: number;
  /** Total grist buffering, mEq per pH unit. */
  readonly totalBufferingMEqPerPh: number;
  /** Mash thickness, litres per kilogram of grain. */
  readonly thicknessLPerKg: number;
  /** Residual alkalinity of the mash water, ppm as CaCO₃. */
  readonly residualAlkalinityPpm: number;
  /** Alkalinity titrated in the mash, mEq, after the carbonate speciation correction. */
  readonly effectiveAlkalinityMEq: number;
  /** Where the acid in the mash came from, term by term, at the predicted pH. */
  readonly contributions: MashPhContributions;
  /** The titration curve used for each fermentable, in grist order. */
  readonly titrations: readonly MaltTitration[];
  /** Bisection iterations used. */
  readonly iterations: number;
  /** How the pH was worked out, for display. */
  readonly explain: Explanation;
  /** Problems worth telling the brewer about, as sentences. */
  readonly warnings: readonly string[];
}

/** Lower bound of the bisection bracket. */
const PH_SEARCH_MIN = 3;
/** Upper bound of the bisection bracket. */
const PH_SEARCH_MAX = 9;

interface BalanceContext {
  readonly titrations: readonly MaltTitration[];
  readonly totalBufferingMEqPerPh: number;
  readonly weightedDiPh: number;
  readonly mashVolumeL: Litres;
  readonly calciumMEqPerL: number;
  readonly magnesiumMEqPerL: number;
  readonly alkalinityMEqPerL: number;
  readonly totalCarbonateMMol: number;
  readonly waterPh: number;
  readonly alkalinityModel: 'titrated-to-mash-ph' | 'full-alkalinity';
  readonly acidAdditions: readonly AcidAddition[];
  readonly acidulatedLacticMMol: number;
}

/** Base the water supplies, mEq (positive number = base). */
function waterBaseMEq(ctx: BalanceContext, ph: number): number {
  if (ctx.alkalinityModel === 'full-alkalinity') {
    return ctx.alkalinityMEqPerL * ctx.mashVolumeL;
  }
  const remaining = alkalinityAtPh(ctx.totalCarbonateMMol, ph);
  return (ctx.alkalinityMEqPerL - remaining) * ctx.mashVolumeL;
}

/** Acid supplied by everything that is not the grist buffer, mEq. */
function suppliedAcidMEq(ctx: BalanceContext, ph: number): number {
  const kolbach =
    (ctx.calciumMEqPerL / KOLBACH_CALCIUM_DIVISOR +
      ctx.magnesiumMEqPerL / KOLBACH_MAGNESIUM_DIVISOR) *
    ctx.mashVolumeL;
  let acids = 0;
  for (const addition of ctx.acidAdditions) {
    acids += acidMilliequivalentsAtPh(addition, ph);
  }
  const acidMalt =
    ctx.acidulatedLacticMMol * protonsDonatedPerMolecule(ACID_DEFINITIONS.lactic.pKa, ph);
  return kolbach + acids + acidMalt - waterBaseMEq(ctx, ph);
}

/**
 * The residual of the charge balance at a trial pH.
 * Strictly decreasing in pH, so bisection converges from any bracket.
 */
function balanceResidual(ctx: BalanceContext, ph: number): number {
  const absorbed = ctx.totalBufferingMEqPerPh * (ctx.weightedDiPh - ph);
  return absorbed - suppliedAcidMEq(ctx, ph);
}

/**
 * Predict mash pH.
 *
 * Solves the charge balance by bisection on [3, 9]. That's safe because the
 * residual is strictly monotone: the grist term falls linearly with pH, every
 * acid term rises with it (more dissociation), and the water term supplies less
 * base. It converges to `options.convergenceTolerancePh` (default 1e-6 pH),
 * which a 6-unit bracket reaches in 23 halvings. The iteration cap is 100.
 *
 * Returns `NaN` with a warning when the grist has no buffering at all (an
 * all-extract recipe). Mash pH isn't defined there, and returning 5.4 would be
 * wrong.
 *
 * @category Water and mash pH
 * @group Start here
 */
export function predictMashPh(input: MashPhInput): MashPhResult {
  const options = resolveMashPhOptions(input.options);
  const warnings: string[] = [];

  const titrations = resolveMaltTitrations(input.grist, {
    acidulatedMaltPercentLactic: options.acidulatedMaltPercentLactic,
  });
  const totalBufferingMEqPerPh = titrations.reduce((sum, t) => sum + t.bufferingMEqPerPh, 0);
  const grainKg = titrations
    .filter((t) => t.bufferingCapacityMEqPerKgPerPh > 0)
    .reduce((sum, t) => sum + t.amountKg, 0);
  const weightedDiPh =
    totalBufferingMEqPerPh > 0
      ? titrations.reduce((sum, t) => sum + t.distilledWaterPh * t.bufferingMEqPerPh, 0) /
        totalBufferingMEqPerPh
      : Number.NaN;
  const acidulatedLacticMMol = titrations.reduce((sum, t) => sum + t.lacticAcidMMol, 0);

  const waterPh = input.water.ph ?? options.assumedSourceWaterPh;
  const alkMEqPerL = alkalinityMEqPerLitre(input.water);
  const ctx: BalanceContext = {
    titrations,
    totalBufferingMEqPerPh,
    weightedDiPh,
    mashVolumeL: input.mashVolumeL,
    calciumMEqPerL: ionMEqPerLitre(input.water, 'calcium'),
    magnesiumMEqPerL: ionMEqPerLitre(input.water, 'magnesium'),
    alkalinityMEqPerL: alkMEqPerL,
    totalCarbonateMMol: totalCarbonateMMolPerLitre(alkMEqPerL, waterPh),
    waterPh,
    alkalinityModel: options.alkalinityModel,
    acidAdditions: (input.acidAdditions ?? []).filter((a) => (a.target ?? 'mash') !== 'sparge'),
    acidulatedLacticMMol,
  };

  const thicknessLPerKg = grainKg > 0 ? input.mashVolumeL / grainKg : Number.NaN;

  if (!(totalBufferingMEqPerPh > 0)) {
    warnings.push(
      'No mashed grain in this recipe: mash pH is undefined, not 5.4. Extract worts arrive at ' +
        'whatever pH the maltster left them at.',
    );
    return emptyResult({
      titrations,
      totalBufferingMEqPerPh,
      thicknessLPerKg,
      water: input.water,
      warnings,
    });
  }

  // --- Bisection ----------------------------------------------------------
  let lo = PH_SEARCH_MIN;
  let hi = PH_SEARCH_MAX;
  let iterations = 0;
  let mid = (lo + hi) / 2;
  for (; iterations < options.maxIterations; iterations += 1) {
    mid = (lo + hi) / 2;
    const residual = balanceResidual(ctx, mid);
    if (residual > 0) lo = mid;
    else hi = mid;
    if (hi - lo < options.convergenceTolerancePh) break;
  }
  const ph = (lo + hi) / 2;

  // --- Report the terms at the answer -------------------------------------
  const waterBase = waterBaseMEq(ctx, ph);
  const contributions: MashPhContributions = {
    maltBufferMEq: totalBufferingMEqPerPh * (weightedDiPh - ph),
    waterAlkalinityMEq: -waterBase,
    calciumMEq: (ctx.calciumMEqPerL / KOLBACH_CALCIUM_DIVISOR) * input.mashVolumeL,
    magnesiumMEq: (ctx.magnesiumMEqPerL / KOLBACH_MAGNESIUM_DIVISOR) * input.mashVolumeL,
    addedAcidMEq: ctx.acidAdditions.reduce((sum, a) => sum + acidMilliequivalentsAtPh(a, ph), 0),
    acidulatedMaltMEq:
      acidulatedLacticMMol * protonsDonatedPerMolecule(ACID_DEFINITIONS.lactic.pKa, ph),
  };

  if (ph < 5.2) {
    warnings.push(
      `Predicted mash pH ${ph.toFixed(2)} is below 5.2: expect thin body, poor extract and a ` +
        'sharp, acidic finish.',
    );
  } else if (ph > 5.6) {
    warnings.push(
      `Predicted mash pH ${ph.toFixed(2)} is above 5.6: expect harsh tannin extraction, dull ` +
        'bitterness and hazy beer.',
    );
  }
  if (input.water.ph === undefined && alkMEqPerL > 0.2) {
    warnings.push(
      `Source water pH was not given; ${options.assumedSourceWaterPh} was assumed for the ` +
        'carbonate speciation. The prediction moves by under 0.01 pH across the 7.0–8.3 range.',
    );
  }

  const explanation = explain(ph, {
    label: 'Mash pH',
    formula: 'charge-balance-troester',
    expression: 'Σ Bᵢ·mᵢ·(pH_DI,ᵢ − pH) = acid_added(pH) + Ca/3.5 + Mg/7 − alkalinity(pH)',
    inputs: {
      gristDistilledWaterPh: roundTo(weightedDiPh, 3),
      totalBufferingMEqPerPh: roundTo(totalBufferingMEqPerPh, 1),
      mashVolumeL: roundTo(input.mashVolumeL, 2),
      thicknessLPerKg: roundTo(thicknessLPerKg, 2),
      alkalinityPpmAsCaCO3: roundTo(alkalinityPpm(input.water), 1),
      residualAlkalinityPpm: roundTo(residualAlkalinityPpm(input.water), 1),
      effectiveAlkalinityMEq: roundTo(waterBase, 2),
      calciumMEq: roundTo(contributions.calciumMEq, 2),
      magnesiumMEq: roundTo(contributions.magnesiumMEq, 2),
      addedAcidMEq: roundTo(contributions.addedAcidMEq, 2),
      acidulatedMaltMEq: roundTo(contributions.acidulatedMaltMEq, 2),
      alkalinityModel: options.alkalinityModel,
      iterations,
    },
    unit: 'pH',
    notes: [
      `Grist alone in distilled water would sit at pH ${weightedDiPh.toFixed(2)}.`,
      `Converged to ±${options.convergenceTolerancePh} pH in ${iterations} bisection steps.`,
      ...(options.alkalinityModel === 'titrated-to-mash-ph' && alkMEqPerL > 0
        ? [
            `${((waterBase / (alkMEqPerL * input.mashVolumeL)) * 100).toFixed(0)} % of the measured ` +
              'alkalinity is titrated between the water pH and the mash pH; the rest is still ' +
              'bicarbonate at mash pH and consumes no acid.',
          ]
        : []),
    ],
    family: 'mash-ph',
    sources: [TROESTER_MASH_PH, TROESTER_BREWING_WATER, KOLBACH_1953, HARNED_DAVIS_1943],
  });

  return {
    ph,
    distilledWaterPh: weightedDiPh,
    totalBufferingMEqPerPh,
    thicknessLPerKg,
    residualAlkalinityPpm: residualAlkalinityPpm(input.water),
    effectiveAlkalinityMEq: waterBase,
    contributions,
    titrations,
    iterations,
    explain: explanation,
    warnings,
  };
}

function emptyResult(args: {
  titrations: readonly MaltTitration[];
  totalBufferingMEqPerPh: number;
  thicknessLPerKg: number;
  water: WaterProfile;
  warnings: readonly string[];
}): MashPhResult {
  return {
    ph: Number.NaN,
    distilledWaterPh: Number.NaN,
    totalBufferingMEqPerPh: args.totalBufferingMEqPerPh,
    thicknessLPerKg: args.thicknessLPerKg,
    residualAlkalinityPpm: residualAlkalinityPpm(args.water),
    effectiveAlkalinityMEq: 0,
    contributions: {
      maltBufferMEq: 0,
      waterAlkalinityMEq: 0,
      calciumMEq: 0,
      magnesiumMEq: 0,
      addedAcidMEq: 0,
      acidulatedMaltMEq: 0,
    },
    titrations: args.titrations,
    iterations: 0,
    explain: explain(Number.NaN, {
      label: 'Mash pH',
      formula: 'charge-balance-troester',
      expression: 'Σ Bᵢ·mᵢ·(pH_DI,ᵢ − pH) = acid_added(pH) + Ca/3.5 + Mg/7 − alkalinity(pH)',
      inputs: { totalBufferingMEqPerPh: 0 },
      unit: 'pH',
      notes: ['Undefined without mashed grain, so it shows as “—” instead of a number.'],
      family: 'mash-ph',
      sources: [TROESTER_MASH_PH],
    }),
    warnings: args.warnings,
  };
}

// ---------------------------------------------------------------------------
// Solving for a target
// ---------------------------------------------------------------------------

/**
 * What to dose with when solving for a target pH.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type MashPhAgent =
  | {
      /** Dose an acid. */
      readonly kind: 'acid';
      /** Which acid. */
      readonly acid: AcidId;
      /** Strength, % w/w. Defaults to the acid's own default. */
      readonly concentrationPercent?: Percent;
      /** Force a solid dose (grams) even for an acid normally sold as a liquid. */
      readonly asSolid?: boolean;
    }
  | {
      /** Dose an alkaline salt. */
      readonly kind: 'alkali';
      /** Which salt. It should be one that raises pH: baking soda, chalk or slaked lime. */
      readonly salt: SaltId;
    };

/**
 * Result of {@link solveAdditionsForTargetPh}.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface MashPhSolution {
  /** Amount to add, in {@link unit}. Zero when the target is already met. */
  readonly amount: number;
  /** `'mL'` for a liquid acid, `'g'` for a solid acid or an alkaline salt. */
  readonly unit: 'mL' | 'g';
  /** pH the dose lands on. */
  readonly achievedPh: number;
  /** pH with no dose at all. */
  readonly baselinePh: number;
  /** The pH that was asked for. */
  readonly targetPh: number;
  /** True when the target cannot be reached with this agent inside the search bound. */
  readonly unreachable: boolean;
  /** Bisection steps the dose search used. */
  readonly iterations: number;
  /** How the dose was worked out, for display. */
  readonly explain: Explanation;
  /** Problems worth telling the brewer about, as sentences. */
  readonly warnings: readonly string[];
}

/** First bracket the dose search tries: 0.2 mL (or g) per litre of mash water. */
const INITIAL_DOSE_PER_LITRE = 0.2;

/**
 * Hard ceiling on the dose search, per litre of mash water.
 *
 * 100 mL/L is far too much lactic acid, but 5 % vinegar needs an order of
 * magnitude more volume than any concentrated acid. The bracket doubles up from
 * {@link INITIAL_DOSE_PER_LITRE} until the target is crossed, so the usual case
 * costs three or four extra evaluations. The ceiling is there to stop an
 * impossible target from looping forever.
 */
const MAX_DOSE_PER_LITRE = 100;

/**
 * Solve for the dose of one acid or alkali that hits a target mash pH.
 *
 * We bisect on the dose and re-run {@link predictMashPh} at each step, so the
 * answer is self-consistent: feed the returned amount back into `predictMashPh`
 * and you get the target. We prefer that to a faster method. The inner solve is
 * a 23-step bisection on a closed-form expression, so a full outer solve is
 * ~50 inner solves and still runs in well under a millisecond.
 *
 * Converges to `convergenceTolerancePh` (default 1e-6 pH) or `maxIterations`,
 * whichever comes first. The upper bracket starts at `INITIAL_DOSE_PER_LITRE`
 * (0.2 mL or g per liter of mash water) and doubles until the target is crossed
 * or the `MAX_DOSE_PER_LITRE` ceiling (100 per liter) is hit. A target beyond
 * the ceiling is reported as `unreachable` instead of being clamped.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function solveAdditionsForTargetPh(input: {
  readonly targetPh: number;
  readonly agent: MashPhAgent;
  readonly grist: readonly FermentableAddition[];
  readonly water: WaterProfile;
  readonly mashVolumeL: Litres;
  /** Acids already in the mash, on top of which the solve happens. */
  readonly existingAcidAdditions?: readonly AcidAddition[];
  readonly options?: MashPhOptions;
}): MashPhSolution {
  const options = resolveMashPhOptions(input.options);
  const warnings: string[] = [];
  const existing = input.existingAcidAdditions ?? [];

  const phAt = (amount: number): number =>
    predictMashPh({
      grist: input.grist,
      water: applyAgentToWater(input.water, input.agent, amount, input.mashVolumeL),
      mashVolumeL: input.mashVolumeL,
      acidAdditions: agentAcidAdditions(input.agent, amount, existing),
      options,
    }).ph;

  const unit: 'mL' | 'g' = agentUnit(input.agent);
  const baselinePh = phAt(0);

  if (Number.isNaN(baselinePh)) {
    return {
      amount: 0,
      unit,
      achievedPh: Number.NaN,
      baselinePh,
      targetPh: input.targetPh,
      unreachable: true,
      iterations: 0,
      explain: solutionExplanation(0, unit, input.targetPh, Number.NaN, baselinePh, 0, input.agent),
      warnings: ['Mash pH is undefined without mashed grain, so there is nothing to solve for.'],
    };
  }

  const lowering = input.agent.kind === 'acid';
  const alreadyThere = lowering ? baselinePh <= input.targetPh : baselinePh >= input.targetPh;
  if (alreadyThere) {
    warnings.push(
      `Mash pH is already ${baselinePh.toFixed(2)}: no ${lowering ? 'acid' : 'alkali'} needed.`,
    );
    return {
      amount: 0,
      unit,
      achievedPh: baselinePh,
      baselinePh,
      targetPh: input.targetPh,
      unreachable: false,
      iterations: 0,
      explain: solutionExplanation(0, unit, input.targetPh, baselinePh, baselinePh, 0, input.agent),
      warnings,
    };
  }

  // Grow the bracket until the target is crossed. Weak acids (5 % vinegar) need
  // a hundred times the volume of a concentrated one, so a fixed cap would mark
  // ordinary answers as unreachable.
  const volumeL = Math.max(input.mashVolumeL, 1);
  const ceiling = MAX_DOSE_PER_LITRE * volumeL;
  let maxDose = INITIAL_DOSE_PER_LITRE * volumeL;
  let phAtMax = phAt(maxDose);
  while ((lowering ? phAtMax > input.targetPh : phAtMax < input.targetPh) && maxDose < ceiling) {
    maxDose = Math.min(maxDose * 2, ceiling);
    phAtMax = phAt(maxDose);
  }
  const reachable = lowering ? phAtMax <= input.targetPh : phAtMax >= input.targetPh;
  if (!reachable) {
    warnings.push(
      `Target pH ${input.targetPh.toFixed(2)} is out of reach: even ${maxDose.toFixed(0)} ${unit} ` +
        `only gets to ${phAtMax.toFixed(2)}.`,
    );
    return {
      amount: maxDose,
      unit,
      achievedPh: phAtMax,
      baselinePh,
      targetPh: input.targetPh,
      unreachable: true,
      iterations: 0,
      explain: solutionExplanation(
        maxDose,
        unit,
        input.targetPh,
        phAtMax,
        baselinePh,
        0,
        input.agent,
      ),
      warnings,
    };
  }

  let lo = 0;
  let hi = maxDose;
  let iterations = 0;
  let mid = 0;
  for (; iterations < options.maxIterations; iterations += 1) {
    mid = (lo + hi) / 2;
    const ph = phAt(mid);
    // More agent always moves pH in the agent's direction, so the bracket is safe.
    if (lowering ? ph > input.targetPh : ph < input.targetPh) lo = mid;
    else hi = mid;
    if (Math.abs(ph - input.targetPh) < options.convergenceTolerancePh) break;
  }
  const amount = mid;
  const achievedPh = phAt(amount);

  if (input.agent.kind === 'alkali' && SALT_DEFINITIONS[input.agent.salt].poorlySoluble) {
    warnings.push(
      `${SALT_DEFINITIONS[input.agent.salt].label} will not fully dissolve: the real mash pH will ` +
        'land below this prediction.',
    );
  }

  return {
    amount,
    unit,
    achievedPh,
    baselinePh,
    targetPh: input.targetPh,
    unreachable: false,
    iterations,
    explain: solutionExplanation(
      amount,
      unit,
      input.targetPh,
      achievedPh,
      baselinePh,
      iterations,
      input.agent,
    ),
    warnings,
  };
}

function agentUnit(agent: MashPhAgent): 'mL' | 'g' {
  if (agent.kind === 'alkali') return 'g';
  if (agent.asSolid) return 'g';
  return ACID_DEFINITIONS[agent.acid].usuallySolid ? 'g' : 'mL';
}

function agentAcidAdditions(
  agent: MashPhAgent,
  amount: number,
  existing: readonly AcidAddition[],
): readonly AcidAddition[] {
  if (agent.kind !== 'acid') return existing;
  const solid = agent.asSolid ?? ACID_DEFINITIONS[agent.acid].usuallySolid;
  const addition: AcidAddition = {
    acid: agent.acid,
    ...(solid ? { grams: amount } : { millilitres: amount }),
    ...(agent.concentrationPercent !== undefined
      ? { concentrationPercent: agent.concentrationPercent }
      : {}),
    target: 'mash',
  };
  return [...existing, addition];
}

function applyAgentToWater(
  water: WaterProfile,
  agent: MashPhAgent,
  amount: number,
  volumeL: Litres,
): WaterProfile {
  if (agent.kind !== 'alkali' || amount === 0 || volumeL <= 0) return water;
  const perGramPerLitre = saltIonPpmPerGramPerLitre(agent.salt);
  const factor = amount / volumeL;
  return {
    ...water,
    calciumPpm: water.calciumPpm + perGramPerLitre.calcium * factor,
    magnesiumPpm: water.magnesiumPpm + perGramPerLitre.magnesium * factor,
    sodiumPpm: water.sodiumPpm + perGramPerLitre.sodium * factor,
    chloridePpm: water.chloridePpm + perGramPerLitre.chloride * factor,
    sulfatePpm: water.sulfatePpm + perGramPerLitre.sulfate * factor,
    bicarbonatePpm: water.bicarbonatePpm + perGramPerLitre.bicarbonate * factor,
  };
}

function solutionExplanation(
  amount: number,
  unit: 'mL' | 'g',
  targetPh: number,
  achievedPh: number,
  baselinePh: number,
  iterations: number,
  agent: MashPhAgent,
): Explanation {
  const label =
    agent.kind === 'acid' ? ACID_DEFINITIONS[agent.acid].label : SALT_DEFINITIONS[agent.salt].label;
  return explain(amount, {
    label: `${label} to reach pH ${targetPh.toFixed(2)}`,
    formula: 'mash-ph-dose-bisection',
    expression: 'solve amount such that predictMashPh(grist, water, amount) = target',
    inputs: {
      agent: label,
      ...(agent.kind === 'acid'
        ? {
            concentrationPercent:
              agent.concentrationPercent ??
              ACID_DEFINITIONS[agent.acid].defaultConcentrationPercent,
          }
        : {}),
      baselinePh: roundTo(baselinePh, 3),
      targetPh,
      achievedPh: roundTo(achievedPh, 3),
      iterations,
    },
    unit,
    family: 'mash-ph',
    sources: [TROESTER_MASH_PH, PALMER_KAMINSKI_WATER_2013],
  });
}

// ---------------------------------------------------------------------------
// Sparge water acidification
// ---------------------------------------------------------------------------

/**
 * Result of {@link acidifyWater}.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface WaterAcidificationResult {
  /** Acid needed, mEq. */
  readonly milliequivalents: number;
  /** Millilitres of the acid solution. Absent for an acid dosed as a solid. */
  readonly millilitres?: number;
  /** Grams, for a solid acid. */
  readonly grams?: number;
  /** pH of the water before the acid, measured or assumed. */
  readonly sourcePh: number;
  /** pH the acid brings the water to. */
  readonly targetPh: number;
  /** Alkalinity of the water before the acid, ppm as CaCO₃. */
  readonly alkalinityPpmAsCaCO3: number;
  /** Volume of water treated, liters. */
  readonly volumeL: Litres;
  /** How the dose was worked out, for display. */
  readonly explain: Explanation;
  /** Problems worth telling the brewer about, as sentences. */
  readonly warnings: readonly string[];
}

/**
 * Default target pH for sparge water: the low end of the useful 5.5–6.0 range.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_SPARGE_TARGET_PH = 5.5;

/**
 * Acid needed to bring water (typically sparge water) to a target pH.
 *
 * Straight carbonate titration, no malt involved:
 *
 * ```
 * acid (mEq/L) = Alk(pH_source) − Alk(pH_target)
 *              = C_T·[f(pH_source) − f(pH_target)]
 * ```
 *
 * with `C_T` back-calculated from the measured alkalinity and the water's pH,
 * and `f` the carbonate speciation from {@link carbonateProtonsDonated}; the
 * `[H⁺]` and `[OH⁻]` terms are dropped, as in {@link totalCarbonateMMolPerLitre}. The
 * acid's own equivalents are then evaluated at the target pH, so a phosphoric
 * dose isn't costed as one equivalent per mole.
 *
 * Sparge water above about pH 6 strips tannins and silicates out of the husks
 * as the grain bed's own acidity washes away. Below 5.2 there's nothing more to
 * gain and the runnings start to taste sharp.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function acidifyWater(input: {
  readonly profile: WaterProfile;
  readonly volumeL: Litres;
  readonly targetPh?: number;
  readonly acid?: AcidId;
  readonly concentrationPercent?: Percent;
  readonly assumedSourceWaterPh?: number;
}): WaterAcidificationResult {
  const targetPh = input.targetPh ?? DEFAULT_SPARGE_TARGET_PH;
  const acid = input.acid ?? 'lactic';
  const def = ACID_DEFINITIONS[acid];
  const strength = input.concentrationPercent ?? def.defaultConcentrationPercent;
  const sourcePh =
    input.profile.ph ?? input.assumedSourceWaterPh ?? DEFAULT_MASH_PH_OPTIONS.assumedSourceWaterPh;

  const alkMEqPerL = alkalinityMEqPerLitre(input.profile);
  const totalCarbonate = totalCarbonateMMolPerLitre(alkMEqPerL, sourcePh);
  const remaining = alkalinityAtPh(totalCarbonate, targetPh);
  const milliequivalents = Math.max(0, (alkMEqPerL - remaining) * input.volumeL);

  const eqPerMMol = protonsDonatedPerMolecule(def.pKa, targetPh);
  const solid = def.usuallySolid;
  const perUnit = solid
    ? acidMillimolesPerGram(acid, strength) * eqPerMMol
    : acidMillimolesPerMillilitre(acid, strength) * eqPerMMol;
  const amount = perUnit > 0 ? milliequivalents / perUnit : 0;

  const warnings: string[] = [];
  if (targetPh < 5.2) {
    warnings.push(
      `Sparge target pH ${targetPh.toFixed(2)} is lower than it needs to be; 5.5–6.0 is the ` +
        'useful range and over-acidified runnings taste sharp.',
    );
  }
  if (input.profile.ph === undefined && alkMEqPerL > 0.2) {
    warnings.push(
      `Source water pH was not given; ${sourcePh} was assumed for the carbonate speciation.`,
    );
  }

  const explanation = explain(amount, {
    label: `${def.label} to bring water to pH ${targetPh.toFixed(2)}`,
    formula: 'carbonate-titration',
    expression:
      'acid mEq = V × [Alk(pH_source) − Alk(pH_target)];  amount = mEq / (mmol/unit × f(pH))',
    inputs: {
      volumeL: roundTo(input.volumeL, 2),
      alkalinityPpmAsCaCO3: roundTo(alkalinityPpm(input.profile), 1),
      sourcePh: roundTo(sourcePh, 2),
      targetPh,
      totalCarbonateMMolPerL: roundTo(totalCarbonate, 3),
      acidMEq: roundTo(milliequivalents, 2),
      protonsPerMolecule: roundTo(eqPerMMol, 4),
      concentrationPercent: strength,
    },
    unit: solid ? 'g' : 'mL',
    family: 'mash-ph',
    sources: [HARNED_DAVIS_1943, PALMER_KAMINSKI_WATER_2013],
  });

  return {
    milliequivalents,
    ...(solid ? { grams: amount } : { millilitres: amount }),
    sourcePh,
    targetPh,
    alkalinityPpmAsCaCO3: alkalinityPpm(input.profile),
    volumeL: input.volumeL,
    explain: explanation,
    warnings,
  };
}

/**
 * Alkalinity in mEq for a volume of water.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function alkalinityMEq(profile: WaterProfile, volumeL: Litres): number {
  return alkalinityMEqPerLitre(profile) * volumeL;
}

/**
 * Residual alkalinity in mEq for a volume of water.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function residualAlkalinityMEq(profile: WaterProfile, volumeL: Litres): number {
  return (residualAlkalinityPpm(profile) / CACO3_EQUIVALENT_WEIGHT) * volumeL;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, dp: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(dp)) : value;
}
