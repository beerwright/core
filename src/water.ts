/**
 * Water ion accounting.
 *
 * The six ions brewers track are Ca²⁺, Mg²⁺, Na⁺, Cl⁻, SO₄²⁻ and HCO₃⁻. All of
 * them are stored in ppm (mg/L), the unit water reports and brewing water
 * profiles use.
 *
 * This module does the bookkeeping: profiles in, profiles out. Mash pH is in
 * `./mashPh`, and solving for a target profile is in `./waterSolver`.
 *
 * ## Why the salt table is computed
 *
 * The ppm-per-gram figures below are derived from molar masses when the module
 * loads instead of being copied from a published table. That keeps the hydrate
 * stoichiometry explicit and testable. `CaCl₂·2H₂O` and anhydrous `CaCl₂` are
 * different salts with a 1.325× difference in calcium per gram, and using one
 * table for both is a common and hard-to-spot mistake in homebrew water
 * treatment. We model the two separately, by name.
 *
 * ## Sources
 *
 * - Molar masses: IUPAC standard atomic weights (2021).
 * - Alkalinity ⇄ bicarbonate: `1 mEq = 50.043 mg CaCO₃ = 61.016 mg HCO₃⁻`, the
 *   standard water-chemistry equivalence (Standard Methods 2320).
 * - Kolbach residual alkalinity: Kolbach, P., "Der Einfluß des Brauwassers auf
 *   den pH-Wert der Würze und des Bieres", *Monatsschrift für Brauerei* 6 (1953).
 * - Sulfate:chloride descriptive bands: Palmer & Kaminski, *Water* (2013), and
 *   Martin's Bru'n Water documentation.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import { KOLBACH_1953, PALMER_KAMINSKI_WATER_2013 } from './sources';
import type { Fraction, Litres, SaltAddition, SaltId, WaterIon, WaterProfile } from './types';

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

/**
 * Standard atomic/molecular masses, g/mol (IUPAC 2021).
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const MOLAR_MASS_G_PER_MOL = {
  /** Ca²⁺. */
  calcium: 40.078,
  /** Mg²⁺. */
  magnesium: 24.305,
  /** Na⁺. */
  sodium: 22.98977,
  /** Cl⁻. */
  chloride: 35.453,
  /** SO₄²⁻ = 32.06 + 4 × 15.999. */
  sulfate: 96.056,
  /** HCO₃⁻ = 1.008 + 12.011 + 3 × 15.999. */
  bicarbonate: 61.016,
  /** CO₃²⁻. */
  carbonate: 60.008,
  /** OH⁻. */
  hydroxide: 17.007,
  /** CaCO₃, the reference substance alkalinity and hardness are reported against. */
  calciumCarbonate: 100.086,
  /** H₂O, for hydrate stoichiometry. */
  water: 18.015,
  /** Lactic acid, C₃H₆O₃. The acidulated-malt model in `./mashPh` uses it. */
  lacticAcid: 90.078,
} as const;

/**
 * SO₄²⁻ ppm per ppm of SO₄-S (sulfate reported as elemental sulfur).
 *
 * US lab reports, including Ward Labs, print sulfate this way, which is about
 * a third of the SO₄²⁻ figure brewing calculations use. Brewers usually
 * multiply by 3. The exact ratio from these molar masses is
 * `96.056 / 32.06 ≈ 2.996`, and deriving it here means report importers
 * convert with the same sulfate mass the rest of the engine uses.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const SULFATE_FROM_SULFUR: number = MOLAR_MASS_G_PER_MOL.sulfate / 32.06;

/**
 * The six ions the engine accounts for.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const WATER_IONS: readonly WaterIon[] = [
  'calcium',
  'magnesium',
  'sodium',
  'chloride',
  'sulfate',
  'bicarbonate',
];

/**
 * Ionic charge, signed. Used for the cation/anion balance check.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const ION_CHARGE: Readonly<Record<WaterIon, number>> = {
  calcium: 2,
  magnesium: 2,
  sodium: 1,
  chloride: -1,
  sulfate: -2,
  bicarbonate: -1,
};

/**
 * Equivalent weight `M / |z|`, g/eq. Dividing ppm by this gives mEq/L.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const EQUIVALENT_WEIGHT_G_PER_EQ: Readonly<Record<WaterIon, number>> = {
  calcium: MOLAR_MASS_G_PER_MOL.calcium / 2,
  magnesium: MOLAR_MASS_G_PER_MOL.magnesium / 2,
  sodium: MOLAR_MASS_G_PER_MOL.sodium,
  chloride: MOLAR_MASS_G_PER_MOL.chloride,
  sulfate: MOLAR_MASS_G_PER_MOL.sulfate / 2,
  bicarbonate: MOLAR_MASS_G_PER_MOL.bicarbonate,
};

/**
 * Equivalent weight of CaCO₃ in g/eq: `100.086 / 2 = 50.043`.
 *
 * Alkalinity and hardness are both reported "as CaCO₃", which means "the mass
 * of CaCO₃ that would carry the same number of equivalents".
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const CACO3_EQUIVALENT_WEIGHT = MOLAR_MASS_G_PER_MOL.calciumCarbonate / 2;

/**
 * ppm HCO₃⁻ per ppm alkalinity-as-CaCO₃: `61.016 / 50.043 = 1.21927`.
 *
 * This is exact only when all of the alkalinity is bicarbonate, which holds
 * below about pH 8.3, so for almost every brewing water. Above that, carbonate
 * starts to matter and the two entry forms give different answers.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const BICARBONATE_PER_ALKALINITY =
  MOLAR_MASS_G_PER_MOL.bicarbonate / CACO3_EQUIVALENT_WEIGHT;

/**
 * ppm alkalinity-as-CaCO₃ per ppm HCO₃⁻: `50.043 / 61.016 = 0.820162`.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const ALKALINITY_PER_BICARBONATE = 1 / BICARBONATE_PER_ALKALINITY;

/**
 * Alkalinity (as CaCO₃, ppm) from a bicarbonate reading (ppm).
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function alkalinityFromBicarbonate(bicarbonatePpm: number): number {
  return bicarbonatePpm * ALKALINITY_PER_BICARBONATE;
}

/**
 * Bicarbonate (ppm) from an alkalinity-as-CaCO₃ reading (ppm).
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function bicarbonateFromAlkalinity(alkalinityPpm: number): number {
  return alkalinityPpm * BICARBONATE_PER_ALKALINITY;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * A profile with every ion at zero, for reverse-osmosis or distilled water.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const RO_WATER: WaterProfile = {
  name: 'RO / distilled',
  calciumPpm: 0,
  magnesiumPpm: 0,
  sodiumPpm: 0,
  chloridePpm: 0,
  sulfatePpm: 0,
  bicarbonatePpm: 0,
};

/** Field name on {@link WaterProfile} for each ion. */
const ION_FIELD = {
  calcium: 'calciumPpm',
  magnesium: 'magnesiumPpm',
  sodium: 'sodiumPpm',
  chloride: 'chloridePpm',
  sulfate: 'sulfatePpm',
  bicarbonate: 'bicarbonatePpm',
} as const satisfies Record<WaterIon, keyof WaterProfile>;

/**
 * Display labels for the ions, used in tables and explanations.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const ION_LABELS: Readonly<Record<WaterIon, string>> = {
  calcium: 'Ca²⁺',
  magnesium: 'Mg²⁺',
  sodium: 'Na⁺',
  chloride: 'Cl⁻',
  sulfate: 'SO₄²⁻',
  bicarbonate: 'HCO₃⁻',
};

/**
 * Read one ion out of a profile, ppm.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function ionPpm(profile: WaterProfile, ion: WaterIon): number {
  return profile[ION_FIELD[ion]];
}

/**
 * A profile as a plain ion → ppm record.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type IonAmounts = Readonly<Record<WaterIon, number>>;

/**
 * Pull the six ions out of a profile as a record.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function toIonAmounts(profile: WaterProfile): IonAmounts {
  return {
    calcium: profile.calciumPpm,
    magnesium: profile.magnesiumPpm,
    sodium: profile.sodiumPpm,
    chloride: profile.chloridePpm,
    sulfate: profile.sulfatePpm,
    bicarbonate: profile.bicarbonatePpm,
  };
}

/**
 * Build a profile from an ion record.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function fromIonAmounts(ions: IonAmounts, name?: string, ph?: number): WaterProfile {
  return {
    ...(name !== undefined ? { name } : {}),
    calciumPpm: ions.calcium,
    magnesiumPpm: ions.magnesium,
    sodiumPpm: ions.sodium,
    chloridePpm: ions.chloride,
    sulfatePpm: ions.sulfate,
    bicarbonatePpm: ions.bicarbonate,
    ...(ph !== undefined ? { ph } : {}),
  };
}

// ---------------------------------------------------------------------------
// Provenance: which ions the report printed
// ---------------------------------------------------------------------------

/**
 * Whether `ion` was actually measured or is a stand-in zero.
 *
 * @see WaterProfile.unmeasured for why an unmeasured ion still carries a value.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function isMeasured(profile: WaterProfile, ion: WaterIon): boolean {
  return profile.unmeasured === undefined || !profile.unmeasured.includes(ion);
}

/**
 * The unmeasured ions of a profile, in {@link WATER_IONS} order.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function unmeasuredIons(profile: WaterProfile): readonly WaterIon[] {
  return WATER_IONS.filter((ion) => !isMeasured(profile, ion));
}

/**
 * The union of several profiles' unmeasured ions, in {@link WATER_IONS} order.
 *
 * It's the union and not the intersection because if one water in a blend
 * never had its sulfate measured, the blend's sulfate isn't known either.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function unmeasuredUnion(...profiles: readonly WaterProfile[]): readonly WaterIon[] {
  return WATER_IONS.filter((ion) => profiles.some((profile) => !isMeasured(profile, ion)));
}

/**
 * A copy of `profile` carrying `ions` as never measured.
 *
 * When nothing is unmeasured the key is omitted instead of set to `[]`, so a
 * fully measured profile is identical to one that never had the field. Golden
 * fixtures and deep-equality tests depend on that.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function withUnmeasured(profile: WaterProfile, ions: readonly WaterIon[]): WaterProfile {
  if (ions.length === 0) {
    if (profile.unmeasured === undefined) return profile;
    const { unmeasured: _dropped, ...rest } = profile;
    return rest;
  }
  return { ...profile, unmeasured: ions };
}

/**
 * Partially specified water, with alkalinity in any of the entry forms.
 *
 * Water reports differ. US utilities usually publish "total alkalinity as
 * CaCO₃", European ones usually publish bicarbonate, and German reports often
 * give *Karbonathärte* in °dH. We accept all of them so nobody has to convert
 * by hand.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface WaterProfileInput {
  /** A name for the profile. */
  readonly name?: string;
  /** Calcium, ppm. Defaults to 0. */
  readonly calciumPpm?: number;
  /** Magnesium, ppm. Defaults to 0. */
  readonly magnesiumPpm?: number;
  /** Sodium, ppm. Defaults to 0. */
  readonly sodiumPpm?: number;
  /** Chloride, ppm. Defaults to 0. */
  readonly chloridePpm?: number;
  /** Sulfate as SO₄²⁻, ppm. Defaults to 0. */
  readonly sulfatePpm?: number;
  /** Bicarbonate, ppm. Wins over the two alkalinity forms when given. */
  readonly bicarbonatePpm?: number;
  /** Total alkalinity as CaCO₃, ppm. */
  readonly alkalinityPpmAsCaCO3?: number;
  /** Carbonate hardness in German degrees (°dH). 1 °dH = 17.848 ppm CaCO₃. */
  readonly carbonateHardnessDh?: number;
  /** Measured water pH. */
  readonly ph?: number;
}

/**
 * ppm CaCO₃ per German degree of hardness: 10 mg/L CaO per °dH, and
 * `CaO → CaCO₃` scales by `100.086 / 56.077 = 1.7848`.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const PPM_CACO3_PER_DH = 17.848;

/**
 * Normalise any of the three alkalinity entry forms into a {@link WaterProfile}.
 *
 * Precedence, most explicit first: `bicarbonatePpm`, `alkalinityPpmAsCaCO3`,
 * `carbonateHardnessDh`. Missing ions default to zero, which is a reasonable
 * assumption for a brewing salt ion that isn't on the water report.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function waterProfile(input: WaterProfileInput = {}): WaterProfile {
  const bicarbonatePpm =
    input.bicarbonatePpm ??
    (input.alkalinityPpmAsCaCO3 !== undefined
      ? bicarbonateFromAlkalinity(input.alkalinityPpmAsCaCO3)
      : input.carbonateHardnessDh !== undefined
        ? bicarbonateFromAlkalinity(input.carbonateHardnessDh * PPM_CACO3_PER_DH)
        : 0);
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    calciumPpm: input.calciumPpm ?? 0,
    magnesiumPpm: input.magnesiumPpm ?? 0,
    sodiumPpm: input.sodiumPpm ?? 0,
    chloridePpm: input.chloridePpm ?? 0,
    sulfatePpm: input.sulfatePpm ?? 0,
    bicarbonatePpm,
    ...(input.ph !== undefined ? { ph: input.ph } : {}),
  };
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

/**
 * One ion's concentration in mEq/L: `ppm / equivalent weight`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function ionMEqPerLitre(profile: WaterProfile, ion: WaterIon): number {
  return ionPpm(profile, ion) / EQUIVALENT_WEIGHT_G_PER_EQ[ion];
}

/**
 * Every ion in mEq/L.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function ionMEqPerLitreAll(profile: WaterProfile): IonAmounts {
  return {
    calcium: ionMEqPerLitre(profile, 'calcium'),
    magnesium: ionMEqPerLitre(profile, 'magnesium'),
    sodium: ionMEqPerLitre(profile, 'sodium'),
    chloride: ionMEqPerLitre(profile, 'chloride'),
    sulfate: ionMEqPerLitre(profile, 'sulfate'),
    bicarbonate: ionMEqPerLitre(profile, 'bicarbonate'),
  };
}

/**
 * Total alkalinity as CaCO₃, ppm.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function alkalinityPpm(profile: WaterProfile): number {
  return alkalinityFromBicarbonate(profile.bicarbonatePpm);
}

/**
 * Total alkalinity, mEq/L.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function alkalinityMEqPerLitre(profile: WaterProfile): number {
  return profile.bicarbonatePpm / EQUIVALENT_WEIGHT_G_PER_EQ.bicarbonate;
}

/**
 * Calcium hardness as CaCO₃, ppm: `Ca × 100.086 / 40.078 = Ca × 2.497`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function calciumHardnessPpm(profile: WaterProfile): number {
  return (
    profile.calciumPpm * (MOLAR_MASS_G_PER_MOL.calciumCarbonate / MOLAR_MASS_G_PER_MOL.calcium)
  );
}

/**
 * Magnesium hardness as CaCO₃, ppm: `Mg × 100.086 / 24.305 = Mg × 4.118`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function magnesiumHardnessPpm(profile: WaterProfile): number {
  return (
    profile.magnesiumPpm * (MOLAR_MASS_G_PER_MOL.calciumCarbonate / MOLAR_MASS_G_PER_MOL.magnesium)
  );
}

/**
 * Total hardness as CaCO₃, ppm.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function totalHardnessPpm(profile: WaterProfile): number {
  return calciumHardnessPpm(profile) + magnesiumHardnessPpm(profile);
}

/**
 * Kolbach's calcium coefficient: calcium offsets `1/3.5` of its own hardness
 * worth of alkalinity, because Ca²⁺ precipitates malt phosphate and frees a
 * proton in doing so.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const KOLBACH_CALCIUM_DIVISOR = 3.5;

/**
 * Kolbach's magnesium coefficient. Magnesium is half as effective as calcium.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const KOLBACH_MAGNESIUM_DIVISOR = 7;

/**
 * Residual alkalinity (Kolbach 1953), ppm as CaCO₃.
 *
 * ```
 * RA = Alkalinity − (calcium hardness / 3.5) − (magnesium hardness / 7)
 * ```
 *
 * **Watch the units.** Kolbach's `/3.5` and `/7` divide the *hardness*, which
 * is Ca and Mg expressed as CaCO₃ (or as mEq/L). They don't divide the
 * elemental ppm printed on a water report. Plugging elemental ppm in directly
 * (`Alk − Ca_ppm/3.5 − Mg_ppm/7`) understates the mineral offset by 2.5× and
 * is a common transcription error. In elemental ppm the same formula is:
 *
 * ```
 * RA = Alkalinity − Ca_ppm / 1.4 − Mg_ppm / 1.7
 * ```
 *
 * because `2.497 / 3.5 = 1 / 1.402` and `4.118 / 7 = 1 / 1.700`. The expression
 * below is equivalent to both, and the tests check it against the published RA
 * of Dublin (≈175) and Pilsen (≈6).
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function residualAlkalinityPpm(profile: WaterProfile): number {
  return (
    alkalinityPpm(profile) -
    calciumHardnessPpm(profile) / KOLBACH_CALCIUM_DIVISOR -
    magnesiumHardnessPpm(profile) / KOLBACH_MAGNESIUM_DIVISOR
  );
}

/**
 * Residual alkalinity in mEq/L, the form the mash-pH charge balance uses.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function residualAlkalinityMEqPerLitre(profile: WaterProfile): number {
  return residualAlkalinityPpm(profile) / CACO3_EQUIVALENT_WEIGHT;
}

/**
 * Residual alkalinity with its breakdown.
 *
 * @category Water and mash pH
 * @group Explanations
 */
export function residualAlkalinityExplained(profile: WaterProfile): Explanation {
  const ra = residualAlkalinityPpm(profile);
  return explain(ra, {
    label: 'Residual alkalinity',
    formula: 'kolbach-1953',
    expression: 'RA = Alk − Ca hardness / 3.5 − Mg hardness / 7  (all as CaCO₃)',
    inputs: {
      alkalinityPpmAsCaCO3: round(alkalinityPpm(profile), 1),
      bicarbonatePpm: round(profile.bicarbonatePpm, 1),
      calciumPpm: round(profile.calciumPpm, 1),
      calciumHardnessPpm: round(calciumHardnessPpm(profile), 1),
      magnesiumPpm: round(profile.magnesiumPpm, 1),
      magnesiumHardnessPpm: round(magnesiumHardnessPpm(profile), 1),
    },
    unit: 'ppm as CaCO₃',
    notes: [
      'In elemental ppm the same formula is RA = Alk − Ca/1.4 − Mg/1.7.',
      `${round(ra / CACO3_EQUIVALENT_WEIGHT, 2)} mEq/L.`,
    ],
    family: 'water',
    sources: [KOLBACH_1953, PALMER_KAMINSKI_WATER_2013],
  });
}

/**
 * Cation/anion charge balance error, %.
 *
 * A real water analysis balances, so `Σ cations (mEq/L) ≈ Σ anions (mEq/L)`.
 * An error above ~5 % usually means a typo, a missing ion (nitrate, potassium,
 * silica) or an alkalinity entered in the wrong unit, and the brewer should
 * know before a pH prediction is built on it.
 *
 * ```
 * error% = 100 × (cations − anions) / (cations + anions)
 * ```
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function chargeBalanceErrorPercent(profile: WaterProfile): number {
  const meq = ionMEqPerLitreAll(profile);
  const cations = meq.calcium + meq.magnesium + meq.sodium;
  const anions = meq.chloride + meq.sulfate + meq.bicarbonate;
  const total = cations + anions;
  if (total === 0) return 0;
  return (100 * (cations - anions)) / total;
}

/**
 * Sulfate-to-chloride mass ratio.
 *
 * `Infinity` when there is no chloride at all, and `NaN` when there is no ratio
 * to give (neither ion present, or either one never measured). To tell these
 * cases apart, callers should use {@link sulfateChlorideBalance} instead of
 * checking `Number.isFinite`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function sulfateChlorideRatio(profile: WaterProfile): number {
  // With either ion unmeasured there's no ratio. Computing one anyway would
  // band "SO₄ 45, Cl (not printed)" as "very hoppy".
  if (!isMeasured(profile, 'sulfate') || !isMeasured(profile, 'chloride')) return Number.NaN;
  if (profile.chloridePpm === 0)
    return profile.sulfatePpm === 0 ? Number.NaN : Number.POSITIVE_INFINITY;
  return profile.sulfatePpm / profile.chloridePpm;
}

/**
 * Descriptive band for the sulfate:chloride ratio.
 *
 * @category Water and mash pH
 * @group Results
 */
export type SulfateChlorideBalance =
  | 'too-malty'
  | 'malty'
  | 'balanced'
  | 'hoppy'
  | 'very-hoppy'
  /** One of the two ions was never measured, so there is no ratio to band. */
  | 'unmeasured'
  /** Both were measured, but there is too little of them for the ratio to mean anything. */
  | 'indeterminate';

/**
 * The minimum combined SO₄ + Cl, ppm, for the ratio to say anything about
 * flavour.
 *
 * Below this there isn't enough of either ion to taste, and the ratio is
 * noise. Pilsen's 5 ppm against 5 ppm comes out at 1.00, "balanced", but
 * Pilsen water tastes of neither.
 *
 * The threshold is on the combined total and not 50 ppm of each. Reading
 * Palmer's caveat per ion would suppress the band for Burton on Trent, with
 * 725 ppm sulfate against 25 ppm chloride, which is about the most
 * sulfate-dominated water in brewing. The ratio stops meaning anything when
 * there's too little of both ions. A large imbalance between them is what the
 * ratio is there to show.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const SULFATE_CHLORIDE_MEANINGFUL_PPM = 50;

/**
 * The standard descriptive bands for SO₄:Cl.
 *
 * Cut points follow Palmer & Kaminski, *Water* (2013) ch. 4 and Martin's
 * Bru'n Water notes. They're a flavour heuristic and not a measurement, so
 * this returns no band in two cases: an ion that wasn't measured
 * (`unmeasured`), and water with almost none of either ion
 * (`indeterminate`, see {@link SULFATE_CHLORIDE_MEANINGFUL_PPM}). Zero
 * chloride falls in the second case. Its infinite ratio comes from dividing by
 * zero and doesn't mean the water is extremely hoppy.
 *
 * | Ratio | Band |
 * | --- | --- |
 * | < 0.5 | too malty |
 * | 0.5 – 1.0 | malty |
 * | 1.0 – 2.0 | balanced |
 * | 2.0 – 4.0 | hoppy / bitter |
 * | ≥ 4.0 | very hoppy, risks harshness |
 *
 * It takes the profile instead of the ratio because both of those checks need
 * the ppm values and the unmeasured list, and the ratio carries neither.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function sulfateChlorideBalance(profile: WaterProfile): SulfateChlorideBalance {
  if (!isMeasured(profile, 'sulfate') || !isMeasured(profile, 'chloride')) return 'unmeasured';
  if (profile.sulfatePpm + profile.chloridePpm < SULFATE_CHLORIDE_MEANINGFUL_PPM)
    return 'indeterminate';
  const ratio = sulfateChlorideRatio(profile);
  if (!Number.isFinite(ratio)) return 'indeterminate';
  if (ratio < 0.5) return 'too-malty';
  if (ratio < 1) return 'malty';
  if (ratio < 2) return 'balanced';
  if (ratio < 4) return 'hoppy';
  return 'very-hoppy';
}

/**
 * Display labels for the balance bands.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const SULFATE_CHLORIDE_LABELS: Readonly<Record<SulfateChlorideBalance, string>> = {
  'too-malty': 'Too malty / minerally flat',
  malty: 'Malty',
  balanced: 'Balanced',
  hoppy: 'Hoppy / bitter',
  'very-hoppy': 'Very hoppy — can turn harsh',
  unmeasured: 'Not measured',
  indeterminate: 'Too little sulfate or chloride to judge',
};

/**
 * The ratio we use for each band when a brewer picks the band by name.
 *
 * A band is a range, and a brewer who says "hoppy" hasn't said 2.1 or 3.9, so
 * we use the midpoint: 0.75 for malty (0.5–1), 1.5 for balanced (1–2), 3 for
 * hoppy (2–4). `very-hoppy` has no upper bound above 4, so it uses 5, one step
 * past the boundary.
 *
 * Every value falls inside the band it names, so {@link sulfateChlorideBalance}
 * on any of them returns the same key. The cut points and the flavour claims
 * behind them come from {@link PALMER_KAMINSKI_WATER_2013}.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const SULFATE_CHLORIDE_BAND_TARGETS: Readonly<
  Record<'malty' | 'balanced' | 'hoppy' | 'very-hoppy', number>
> = {
  malty: 0.75,
  balanced: 1.5,
  hoppy: 3,
  'very-hoppy': 5,
};

/**
 * The calcium floor, ppm, that a new water rule starts with.
 *
 * {@link PALMER_KAMINSKI_WATER_2013} gives 50–150 ppm as the working range for
 * brewing calcium, and this is the low end. It's enough for mash pH,
 * flocculation and clarity without using up salt on an ion the brewer didn't
 * ask about. It's set above the 40 ppm in {@link ION_ADVISORY_RANGE_PPM}
 * because 40 is where a shortage starts to cause problems, and a default
 * shouldn't start right at that edge.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_CALCIUM_FLOOR_PPM = 50;

/**
 * Sulfate:chloride with its breakdown.
 *
 * @category Water and mash pH
 * @group Explanations
 */
export function sulfateChlorideExplained(profile: WaterProfile): Explanation {
  const ratio = sulfateChlorideRatio(profile);
  const band = sulfateChlorideBalance(profile);
  const missing = unmeasuredIons(profile).filter((ion) => ion === 'sulfate' || ion === 'chloride');
  return explain(Number.isFinite(ratio) ? ratio : 0, {
    label: 'Sulfate : chloride ratio',
    formula: 'sulfate-chloride-ratio',
    expression: 'ratio = SO₄ ppm / Cl ppm',
    inputs: {
      sulfatePpm: round(profile.sulfatePpm, 1),
      chloridePpm: round(profile.chloridePpm, 1),
      balance: band,
    },
    unit: 'ratio',
    notes: [
      SULFATE_CHLORIDE_LABELS[band],
      ...(band === 'unmeasured'
        ? [
            `The analysis does not print ${missing.map((ion) => ION_LABELS[ion]).join(' or ')}, ` +
              'so there is no ratio to report.',
          ]
        : []),
      ...(band === 'indeterminate'
        ? [
            `Sulfate and chloride together come to under ${SULFATE_CHLORIDE_MEANINGFUL_PPM} ppm: ` +
              'too little of either to carry a flavor, whatever they divide to.',
          ]
        : []),
    ],
    family: 'water',
    sources: [PALMER_KAMINSKI_WATER_2013],
  });
}

// ---------------------------------------------------------------------------
// Profile algebra
// ---------------------------------------------------------------------------

/**
 * Multiply every ion by `factor`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function scaleProfile(profile: WaterProfile, factor: number): WaterProfile {
  const out: Record<WaterIon, number> = { ...toIonAmounts(profile) };
  for (const ion of WATER_IONS) out[ion] *= factor;
  return withUnmeasured(fromIonAmounts(out, profile.name, profile.ph), unmeasuredIons(profile));
}

/**
 * Ion-by-ion sum of two profiles. The pH of the result is left undefined.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function addProfiles(a: WaterProfile, b: WaterProfile): WaterProfile {
  const x = toIonAmounts(a);
  const y = toIonAmounts(b);
  const out = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) out[ion] = x[ion] + y[ion];
  return withUnmeasured(fromIonAmounts(out), unmeasuredUnion(a, b));
}

/**
 * Ion-by-ion difference `a − b`, e.g. "how far is my water from the target?".
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function profileDelta(a: WaterProfile, b: WaterProfile): IonAmounts {
  const x = toIonAmounts(a);
  const y = toIonAmounts(b);
  const out = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) out[ion] = x[ion] - y[ion];
  return out;
}

/**
 * Blend with RO/distilled water.
 *
 * `dilutionFraction` is the share of the finished volume that's RO, so 0.5
 * means half-and-half and halves every ion. You can pass a different dilutant,
 * such as a second tap or softened water.
 *
 * ```
 * ion = source × (1 − f) + dilutant × f
 * ```
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function diluteProfile(
  source: WaterProfile,
  dilutionFraction: Fraction,
  dilutant: WaterProfile = RO_WATER,
): WaterProfile {
  const f = clamp(dilutionFraction, 0, 1);
  const s = toIonAmounts(source);
  const d = toIonAmounts(dilutant);
  const out = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) out[ion] = s[ion] * (1 - f) + d[ion] * f;
  // At f = 1 none of the source is left, so its unmeasured ions don't carry
  // over. Pure RO is fully known no matter what it replaced.
  return withUnmeasured(
    fromIonAmounts(out, source.name, source.ph),
    f >= 1 ? unmeasuredIons(dilutant) : unmeasuredUnion(source, dilutant),
  );
}

/**
 * One component of a blend.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface BlendPart {
  /** The water. */
  readonly profile: WaterProfile;
  /** How much of it goes into the blend, liters. */
  readonly volumeL: Litres;
}

/**
 * Volume-weighted blend of any number of waters.
 *
 * Ions are conservative on mixing, so this is a straight weighted mean. pH
 * isn't conservative (it's the log of an activity), so it's dropped from the
 * result. Averaging it would give a plausible-looking wrong number.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function blendProfiles(parts: readonly BlendPart[]): WaterProfile {
  const totalVolume = parts.reduce((sum, p) => sum + p.volumeL, 0);
  const out = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) out[ion] = 0;
  if (totalVolume <= 0) return fromIonAmounts(out);
  // Only parts with some volume count toward the unmeasured list. A zero-litre
  // sparge with unmeasured sulfate doesn't end up in the kettle.
  const contributing = parts.filter((part) => part.volumeL > 0).map((part) => part.profile);
  for (const part of parts) {
    const ions = toIonAmounts(part.profile);
    for (const ion of WATER_IONS) out[ion] += (ions[ion] * part.volumeL) / totalVolume;
  }
  return withUnmeasured(fromIonAmounts(out), unmeasuredUnion(...contributing));
}

// ---------------------------------------------------------------------------
// Salts
// ---------------------------------------------------------------------------

/**
 * Moles of each ion released per mole of salt.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export type SaltStoichiometry = Partial<Record<WaterIon, number>>;

/**
 * Everything the engine knows about one brewing salt.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export interface SaltDefinition {
  /** The salt's id, which is also its key in {@link SALT_DEFINITIONS}. */
  readonly id: SaltId;
  /** Display name. It includes the hydrate state because that changes the yield per gram. */
  readonly label: string;
  /** Chemical formula as written on the bag. */
  readonly formula: string;
  /** Formula mass including waters of hydration, g/mol. */
  readonly molarMassGPerMol: number;
  /** Moles of ion per mole of salt. */
  readonly stoichiometry: SaltStoichiometry;
  /**
   * Equivalents of alkalinity per mole (0 for the neutral salts).
   * Baking soda 1, chalk 2, slaked lime 2.
   */
  readonly alkalinityEqPerMol: number;
  /** True for the salts that raise pH. The solver excludes these by default. */
  readonly isAlkaline: boolean;
  /** True when the salt does not reliably dissolve at brewing concentrations. */
  readonly poorlySoluble: boolean;
  /** Practical notes on using the salt, as sentences for display. */
  readonly notes?: readonly string[];
}

const M = MOLAR_MASS_G_PER_MOL;

/**
 * The brewing salt table.
 *
 * Formula masses are summed from {@link MOLAR_MASS_G_PER_MOL}, including
 * waters of hydration, and {@link saltIonPpmPerGramPerLitre} derives the
 * per-gram ion yields from them. None of the values are copied from a table.
 *
 * Two entries need a note:
 *
 * - Calcium chloride comes in two forms, and homebrew suppliers label them
 *   inconsistently. The dihydrate (the usual damp, clumping "calcium chloride"
 *   in a jar) yields 272.6 ppm Ca per g/L, and the anhydrous prills yield
 *   361.1 ppm, which is 32 % more calcium and chloride per gram. Picking the
 *   wrong one gives no visible error, so the form is part of the salt's id.
 * - Chalk is modelled as dissolving completely by `CaCO₃ + CO₂ + H₂O → Ca²⁺ +
 *   2 HCO₃⁻`, which makes "1 g/L of chalk = 1000 ppm alkalinity as CaCO₃"
 *   consistent with the definition of alkalinity. Some older calculators use
 *   one bicarbonate per chalk, which halves its alkalinity. In a real mash tun
 *   chalk barely dissolves. See {@link SaltAddition.dissolvedFraction} and the
 *   warning {@link applySalts} raises.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const SALT_DEFINITIONS: Readonly<Record<SaltId, SaltDefinition>> = {
  gypsum: {
    id: 'gypsum',
    label: 'Gypsum (calcium sulfate dihydrate)',
    formula: 'CaSO₄·2H₂O',
    molarMassGPerMol: M.calcium + M.sulfate + 2 * M.water,
    stoichiometry: { calcium: 1, sulfate: 1 },
    alkalinityEqPerMol: 0,
    isAlkaline: false,
    poorlySoluble: false,
    notes: ['Adds the sulfate that accentuates hop bitterness.'],
  },
  'calcium-chloride-dihydrate': {
    id: 'calcium-chloride-dihydrate',
    label: 'Calcium chloride (dihydrate)',
    formula: 'CaCl₂·2H₂O',
    molarMassGPerMol: M.calcium + 2 * M.chloride + 2 * M.water,
    stoichiometry: { calcium: 1, chloride: 2 },
    alkalinityEqPerMol: 0,
    isAlkaline: false,
    poorlySoluble: false,
    notes: [
      'The usual homebrew form: hygroscopic flakes that clump in the jar.',
      'Yields 32 % less calcium per gram than the anhydrous form.',
    ],
  },
  'calcium-chloride-anhydrous': {
    id: 'calcium-chloride-anhydrous',
    label: 'Calcium chloride (anhydrous)',
    formula: 'CaCl₂',
    molarMassGPerMol: M.calcium + 2 * M.chloride,
    stoichiometry: { calcium: 1, chloride: 2 },
    alkalinityEqPerMol: 0,
    isAlkaline: false,
    poorlySoluble: false,
    notes: [
      'Free-flowing prills. Absorbs water from the air, so an old jar behaves ' +
        'somewhere between the two forms.',
    ],
  },
  'epsom-salt': {
    id: 'epsom-salt',
    label: 'Epsom salt (magnesium sulfate heptahydrate)',
    formula: 'MgSO₄·7H₂O',
    molarMassGPerMol: M.magnesium + M.sulfate + 7 * M.water,
    stoichiometry: { magnesium: 1, sulfate: 1 },
    alkalinityEqPerMol: 0,
    isAlkaline: false,
    poorlySoluble: false,
    notes: ['Seven waters of hydration make it a weak source of magnesium by mass.'],
  },
  'table-salt': {
    id: 'table-salt',
    label: 'Table / canning salt (sodium chloride)',
    formula: 'NaCl',
    molarMassGPerMol: M.sodium + M.chloride,
    stoichiometry: { sodium: 1, chloride: 1 },
    alkalinityEqPerMol: 0,
    isAlkaline: false,
    poorlySoluble: false,
    notes: ['Use non-iodized, anti-caking-agent-free salt.'],
  },
  'magnesium-chloride': {
    id: 'magnesium-chloride',
    label: 'Magnesium chloride (hexahydrate)',
    formula: 'MgCl₂·6H₂O',
    molarMassGPerMol: M.magnesium + 2 * M.chloride + 6 * M.water,
    stoichiometry: { magnesium: 1, chloride: 2 },
    alkalinityEqPerMol: 0,
    isAlkaline: false,
    poorlySoluble: false,
    notes: ['Magnesium without the sulfate, when Epsom would push SO₄ too high.'],
  },
  'baking-soda': {
    id: 'baking-soda',
    label: 'Baking soda (sodium bicarbonate)',
    formula: 'NaHCO₃',
    molarMassGPerMol: M.sodium + M.bicarbonate,
    stoichiometry: { sodium: 1, bicarbonate: 1 },
    alkalinityEqPerMol: 1,
    isAlkaline: true,
    poorlySoluble: false,
    notes: [
      'Dissolves readily, which makes it the practical way to add alkalinity, at the cost of sodium.',
    ],
  },
  chalk: {
    id: 'chalk',
    label: 'Chalk (calcium carbonate)',
    formula: 'CaCO₃',
    molarMassGPerMol: M.calciumCarbonate,
    stoichiometry: { calcium: 1, bicarbonate: 2 },
    alkalinityEqPerMol: 2,
    isAlkaline: true,
    poorlySoluble: true,
    notes: [
      'Modeled as CaCO₃ + CO₂ + H₂O → Ca²⁺ + 2 HCO₃⁻, so 1 g/L = 1000 ppm ' +
        'alkalinity as CaCO₃ by definition.',
      'Solubility in still, uncarbonated water is a few tens of ppm: most of a ' +
        'chalk addition never dissolves, and the mash sees far less alkalinity ' +
        'than this arithmetic implies.',
    ],
  },
  'slaked-lime': {
    id: 'slaked-lime',
    label: 'Slaked lime (calcium hydroxide)',
    formula: 'Ca(OH)₂',
    molarMassGPerMol: M.calcium + 2 * M.hydroxide,
    // Hydroxide alkalinity, stored in the profile as its bicarbonate
    // equivalent so the whole engine works from one alkalinity number.
    stoichiometry: { calcium: 1, bicarbonate: 2 },
    alkalinityEqPerMol: 2,
    isAlkaline: true,
    poorlySoluble: false,
    notes: [
      'Adds hydroxide, not bicarbonate. The profile reports it as the ' +
        'bicarbonate equivalent (2 eq/mol) because that is the alkalinity the ' +
        'mash sees once it meets the wort’s carbonic acid.',
      'Very strong: a gram in 20 L adds 27 ppm Ca and 82 ppm bicarbonate ' +
        'equivalent. Weigh it, do not scoop it.',
    ],
  },
};

/**
 * Every salt id, in a stable order (used for deterministic solver tie-breaks).
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const SALT_IDS: readonly SaltId[] = [
  'gypsum',
  'calcium-chloride-dihydrate',
  'calcium-chloride-anhydrous',
  'epsom-salt',
  'table-salt',
  'magnesium-chloride',
  'baking-soda',
  'chalk',
  'slaked-lime',
];

/**
 * ppm of each ion added by dissolving 1 gram of the salt in 1 litre of water.
 *
 * ```
 * ppm = 1000 × n_ion × M_ion / M_salt
 * ```
 *
 * (1 g/L is 1000 mg/L; `1/M_salt` mol of salt releases `n_ion` mol of the ion,
 * each weighing `M_ion` g.) Divide by 3.785411784 to compare with the
 * per-US-gallon figures published by Palmer and Bru'n Water. Gypsum's 232.8
 * ppm Ca per g/L is their 61.5 ppm per g/gal.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function saltIonPpmPerGramPerLitre(salt: SaltId): IonAmounts {
  const def = SALT_DEFINITIONS[salt];
  const out = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) {
    const moles = def.stoichiometry[ion] ?? 0;
    out[ion] = (1000 * moles * MOLAR_MASS_G_PER_MOL[ion]) / def.molarMassGPerMol;
  }
  return out;
}

/**
 * Alkalinity as CaCO₃ added by 1 g of the salt in 1 L, ppm.
 * `1000 × eq/mol × 50.043 / M_salt`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function saltAlkalinityPpmPerGramPerLitre(salt: SaltId): number {
  const def = SALT_DEFINITIONS[salt];
  return (1000 * def.alkalinityEqPerMol * CACO3_EQUIVALENT_WEIGHT) / def.molarMassGPerMol;
}

/**
 * Milliequivalents of alkalinity per gram of salt: `1000 × eq/mol / M_salt`.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function saltAlkalinityMEqPerGram(salt: SaltId): number {
  const def = SALT_DEFINITIONS[salt];
  return (1000 * def.alkalinityEqPerMol) / def.molarMassGPerMol;
}

/**
 * Total ppm added to `volumeL` litres by a list of salt additions.
 *
 * Every addition in the list is counted, whatever its `target`, and each is
 * scaled by its `dissolvedFraction`. {@link applySalts} splits a schedule
 * between mash and sparge before calling this, dividing `'total'` additions
 * in proportion to the two volumes.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function ionsFromSalts(additions: readonly SaltAddition[], volumeL: Litres): IonAmounts {
  const out = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) out[ion] = 0;
  if (volumeL <= 0) return out;
  for (const addition of additions) {
    const grams = addition.grams * (addition.dissolvedFraction ?? 1);
    if (grams === 0) continue;
    const perGramPerLitre = saltIonPpmPerGramPerLitre(addition.salt);
    for (const ion of WATER_IONS) out[ion] += (perGramPerLitre[ion] * grams) / volumeL;
  }
  return out;
}

/**
 * Water volumes a salt schedule is dosed into.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface WaterVolumes {
  /** Mash/strike water, litres. */
  readonly mashVolumeL: Litres;
  /** Sparge water, litres. 0 for no-sparge and full-volume BIAB. */
  readonly spargeVolumeL: Litres;
}

/**
 * The mash, sparge and combined waters produced by a salt schedule.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface TreatedWater {
  /** Water in the mash tun. */
  readonly mash: WaterProfile;
  /** Sparge water. Equal to the source when nothing is dosed into it. */
  readonly sparge: WaterProfile;
  /** Volume-weighted combination, which is what ends up in the kettle. */
  readonly total: WaterProfile;
  /** Mash water volume, liters. */
  readonly mashVolumeL: Litres;
  /** Sparge water volume, liters. */
  readonly spargeVolumeL: Litres;
  /** Grams of each salt that landed in the mash and in the sparge. */
  readonly split: readonly SaltSplit[];
  /** Problems with the treated water worth telling the brewer about, as sentences. */
  readonly warnings: readonly string[];
}

/**
 * How one salt addition was divided between the two waters.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface SaltSplit {
  /** The salt. */
  readonly salt: SaltId;
  /** Grams in the addition as given. */
  readonly totalGrams: number;
  /** Grams that went into the mash water. */
  readonly mashGrams: number;
  /** Grams that went into the sparge water. */
  readonly spargeGrams: number;
}

/**
 * Apply a salt schedule to a source water.
 *
 * An addition targeted at `'total'` is split between mash and sparge in
 * proportion to their volumes. That's the "treat all your water the same"
 * approach, and it keeps both waters at the same profile. `'mash'` and
 * `'sparge'` put the whole dose in one vessel, which is the usual choice when
 * the sparge is acidified separately or left untreated.
 *
 * @category Water and mash pH
 * @group Start here
 */
export function applySalts(input: {
  readonly source: WaterProfile;
  readonly additions: readonly SaltAddition[];
  readonly volumes: WaterVolumes;
  /** Sparge water source, when it differs from the mash source. */
  readonly spargeSource?: WaterProfile;
}): TreatedWater {
  const { mashVolumeL, spargeVolumeL } = input.volumes;
  const totalVolumeL = mashVolumeL + spargeVolumeL;
  const mashShare = totalVolumeL > 0 ? mashVolumeL / totalVolumeL : 1;

  const split: SaltSplit[] = [];
  const mashAdditions: SaltAddition[] = [];
  const spargeAdditions: SaltAddition[] = [];

  for (const addition of input.additions) {
    const target = addition.target ?? 'total';
    const mashGrams =
      target === 'mash' ? addition.grams : target === 'sparge' ? 0 : addition.grams * mashShare;
    const spargeGrams = addition.grams - mashGrams;
    split.push({
      salt: addition.salt,
      totalGrams: addition.grams,
      mashGrams,
      spargeGrams,
    });
    if (mashGrams !== 0) mashAdditions.push({ ...addition, grams: mashGrams, target: 'mash' });
    if (spargeGrams !== 0)
      spargeAdditions.push({ ...addition, grams: spargeGrams, target: 'sparge' });
  }

  const spargeSource = input.spargeSource ?? input.source;
  // The treated waters keep the source's measured pH. Salts do change a water's
  // pH, but the only downstream use of it is the carbonate speciation in
  // `mashPh` (how much of the reported alkalinity is bicarbonate and how much
  // is carbonate), and that needs the measured figure. See
  // `totalCarbonateMMolPerLitre`.
  const mash = withPh(
    addProfiles(input.source, fromIonAmounts(ionsFromSalts(mashAdditions, mashVolumeL))),
    input.source.ph,
  );
  const sparge = withPh(
    addProfiles(spargeSource, fromIonAmounts(ionsFromSalts(spargeAdditions, spargeVolumeL))),
    spargeSource.ph,
  );
  const total = withPh(
    blendProfiles([
      { profile: mash, volumeL: mashVolumeL },
      { profile: sparge, volumeL: spargeVolumeL },
    ]),
    input.source.ph === spargeSource.ph ? input.source.ph : undefined,
  );

  const warnings: string[] = [];
  for (const addition of input.additions) {
    if (addition.grams <= 0) continue;
    const def = SALT_DEFINITIONS[addition.salt];
    if (def.poorlySoluble) {
      warnings.push(
        `${def.label} is only sparingly soluble: the ion figures above assume it all dissolves, ` +
          'which in a mash tun it will not. Prefer baking soda or slaked lime to add alkalinity.',
      );
    }
  }
  warnings.push(...waterProfileWarnings(total));

  return {
    mash,
    sparge,
    total,
    mashVolumeL,
    spargeVolumeL,
    split,
    warnings: dedupe(warnings),
  };
}

// ---------------------------------------------------------------------------
// Sanity checks
// ---------------------------------------------------------------------------

/**
 * Comfortable brewing ranges per ion, ppm.
 *
 * These are the flavour and process ranges from Palmer & Kaminski, *Water*
 * (2013). They aren't regulatory limits, and beer outside them is usually
 * still drinkable. They're here to catch a typo or a heavy salt dose before
 * brew day.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const ION_ADVISORY_RANGE_PPM: Readonly<
  Record<
    WaterIon,
    {
      /** Bottom of the comfortable range, ppm. */
      min: number;
      /** Top of the comfortable range, ppm. */
      max: number;
    }
  >
> = {
  /** Below ~40 ppm yeast flocculation and enzyme stability suffer. Above ~200 the beer tastes minerally. */
  calcium: { min: 40, max: 200 },
  /** A little is a yeast nutrient. Above ~40 ppm it's bitter and laxative. */
  magnesium: { min: 0, max: 40 },
  /** Rounds out the palate up to ~100 ppm. Above ~150, with sulfate, it's salty and harsh. */
  sodium: { min: 0, max: 150 },
  /** Accentuates malt sweetness. Above ~150 ppm the beer tastes flabby and can get briny. */
  chloride: { min: 0, max: 150 },
  /** Accentuates hop bitterness. Above ~350 ppm the bitterness gets harsh and drying. */
  sulfate: { min: 0, max: 350 },
  /** Alkalinity should suit the grist. High figures need dark malt or acid to offset them. */
  bicarbonate: { min: 0, max: 250 },
};

/**
 * Problems worth surfacing for a finished water profile.
 *
 * Checks that read an ion's value are skipped for unmeasured ions. A stand-in
 * zero says nothing about the water, and "Ca²⁺ is 0 ppm; at least 40 helps
 * mash pH" would be advice about a number the brewer never entered.
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function waterProfileWarnings(profile: WaterProfile): readonly string[] {
  const warnings: string[] = [];
  const measured = (ion: WaterIon): boolean => isMeasured(profile, ion);
  const missing = unmeasuredIons(profile);

  if (missing.length > 0) {
    warnings.push(
      `The analysis does not print ${listIons(missing)}. ` +
        `${missing.length === 1 ? 'It is' : 'They are'} carried as zero so the arithmetic can ` +
        'run, so every figure that leans on ' +
        `${missing.length === 1 ? 'it' : 'them'} is a lower bound.`,
    );
  }

  for (const ion of WATER_IONS) {
    if (!measured(ion)) continue;
    const range = ION_ADVISORY_RANGE_PPM[ion];
    const value = ionPpm(profile, ion);
    if (value > range.max) {
      warnings.push(
        `${ION_LABELS[ion]} is ${value.toFixed(0)} ppm, above the ${range.max} ppm comfortable maximum.`,
      );
    }
  }
  if (
    measured('calcium') &&
    profile.calciumPpm < ION_ADVISORY_RANGE_PPM.calcium.min &&
    profile.calciumPpm >= 0
  ) {
    warnings.push(
      `Ca²⁺ is ${profile.calciumPpm.toFixed(0)} ppm; at least ${ION_ADVISORY_RANGE_PPM.calcium.min} ppm ` +
        'helps mash pH, yeast flocculation and beer clarity.',
    );
  }
  if (
    measured('sodium') &&
    measured('sulfate') &&
    profile.sodiumPpm > 100 &&
    profile.sulfatePpm > 150
  ) {
    warnings.push('High sodium together with high sulfate is a reliably harsh, salty combination.');
  }
  const balance = chargeBalanceErrorPercent(profile);
  if (Math.abs(balance) > 5) {
    // With an ion missing, an imbalance is expected because the totals are
    // short by whatever wasn't printed. Telling the brewer to check for a typo
    // would send them looking for a mistake they didn't make. We still show
    // the gap, since its size is the best hint at how much of the missing ion
    // there is.
    warnings.push(
      missing.length > 0
        ? `Cations and anions differ by ${balance.toFixed(1)} %, which is expected with ` +
            `${listIons(missing)} unmeasured: the gap is roughly what the missing ` +
            `${missing.length === 1 ? 'reading covers' : 'readings cover'}.`
        : `Cations and anions differ by ${balance.toFixed(1)} %: check the report for a typo, a missing ` +
            'ion, or an alkalinity entered in the wrong unit.',
    );
  }
  return dedupe(warnings);
}

/** Formats ions as an English list: `Cl⁻`, `Cl⁻ and SO₄²⁻`, `Na⁺, Cl⁻ and SO₄²⁻`. */
function listIons(ions: readonly WaterIon[]): string {
  const labels = ions.map((ion) => ION_LABELS[ion]);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Attach a pH to a profile, omitting the key entirely when there is none. */
function withPh(profile: WaterProfile, ph: number | undefined): WaterProfile {
  return ph === undefined ? profile : { ...profile, ph };
}

function round(value: number, dp: number): number {
  return Number(value.toFixed(dp));
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
