/**
 * Golden water fixtures with hand-verified arithmetic.
 *
 * Every expected number here was worked out by hand from the published
 * chemistry, without reference to the engine source. The working is written
 * out so anyone can check it with a calculator.
 *
 * Shared constants:
 * - equivalent weight of CaCO₃  50.043 g/eq  (100.086 / 2)
 * - equivalent weight of HCO₃⁻  61.016 g/eq
 * - alkalinity ⇄ bicarbonate    ×1.21927 / ×0.820162
 * - Ca hardness as CaCO₃        Ca ppm × 2.4973  (100.086 / 40.078)
 * - Mg hardness as CaCO₃        Mg ppm × 4.1179  (100.086 / 24.305)
 * - Kolbach RA                  Alk − Ca hardness/3.5 − Mg hardness/7
 *                               ≡ Alk − Ca ppm/1.4021 − Mg ppm/1.7003
 */

import type { WaterProfile } from '../types';

/** A published city water profile with its hand-computed derived figures. */
export interface WaterFixture {
  readonly profile: WaterProfile;
  /** Total alkalinity as CaCO₃, ppm, computed longhand. */
  readonly alkalinityPpm: number;
  /** Kolbach residual alkalinity, ppm as CaCO₃, computed longhand. */
  readonly residualAlkalinityPpm: number;
  /** The arithmetic, written out. */
  readonly working: string;
}

/**
 * Classic brewing waters, as published in Palmer & Kaminski, *Water* (2013)
 * appendix A and reproduced by almost every brewing calculator.
 *
 * These are historical or typical analyses, not current utility reports. We
 * use them because they're the numbers the references work from, so they can
 * be checked.
 */
export const PILSEN: WaterFixture = {
  profile: {
    name: 'Pilsen',
    calciumPpm: 7,
    magnesiumPpm: 2,
    sodiumPpm: 2,
    chloridePpm: 5,
    sulfatePpm: 5,
    bicarbonatePpm: 15,
  },
  alkalinityPpm: 12.302,
  residualAlkalinityPpm: 6.131,
  working: [
    'Alk  = 15 × 0.820162 = 12.302',
    'Ca hardness = 7 × 2.4973 = 17.481 → /3.5 = 4.995',
    'Mg hardness = 2 × 4.1179 = 8.236 → /7 = 1.177',
    'RA   = 12.302 − 4.995 − 1.177 = 6.131',
  ].join('; '),
};

export const DUBLIN: WaterFixture = {
  profile: {
    name: 'Dublin',
    calciumPpm: 118,
    magnesiumPpm: 4,
    sodiumPpm: 12,
    chloridePpm: 19,
    sulfatePpm: 54,
    bicarbonatePpm: 319,
  },
  alkalinityPpm: 261.632,
  residualAlkalinityPpm: 175.085,
  working: [
    'Alk  = 319 × 0.820162 = 261.63',
    'Ca hardness = 118 × 2.4973 = 294.68 → /3.5 = 84.19',
    'Mg hardness = 4 × 4.1179 = 16.47 → /7 = 2.35',
    'RA   = 261.63 − 84.19 − 2.35 = 175.09',
    'Dublin’s famously high RA is why it suits stout: only a dark, acidic grist balances it.',
  ].join('; '),
};

export const BURTON_ON_TRENT: WaterFixture = {
  profile: {
    name: 'Burton on Trent',
    calciumPpm: 295,
    magnesiumPpm: 45,
    sodiumPpm: 55,
    chloridePpm: 25,
    sulfatePpm: 725,
    bicarbonatePpm: 300,
  },
  alkalinityPpm: 246.049,
  residualAlkalinityPpm: 9.091,
  working: [
    'Alk  = 300 × 0.820162 = 246.05',
    'Ca hardness = 295 × 2.4973 = 736.70 → /3.5 = 210.49',
    'Mg hardness = 45 × 4.1179 = 185.31 → /7 = 26.47',
    'RA   = 246.05 − 210.49 − 26.47 = 9.09',
    'Enormous alkalinity, almost entirely canceled by the calcium — which is the point.',
  ].join('; '),
};

export const MUNICH: WaterFixture = {
  profile: {
    name: 'Munich',
    calciumPpm: 76,
    magnesiumPpm: 18,
    sodiumPpm: 2,
    chloridePpm: 2,
    sulfatePpm: 10,
    bicarbonatePpm: 200,
  },
  alkalinityPpm: 164.032,
  residualAlkalinityPpm: 99.217,
  working: [
    'Alk  = 200 × 0.820162 = 164.03',
    'Ca hardness = 76 × 2.4973 = 189.79 → /3.5 = 54.23',
    'Mg hardness = 18 × 4.1179 = 74.12 → /7 = 10.59',
    'RA   = 164.03 − 54.23 − 10.59 = 99.22',
  ].join('; '),
};

/** Reverse-osmosis or distilled water, with every ion at zero. */
export const RO: WaterFixture = {
  profile: {
    name: 'RO',
    calciumPpm: 0,
    magnesiumPpm: 0,
    sodiumPpm: 0,
    chloridePpm: 0,
    sulfatePpm: 0,
    bicarbonatePpm: 0,
  },
  alkalinityPpm: 0,
  residualAlkalinityPpm: 0,
  working: 'Everything is zero, so everything derived from it is zero.',
};

/** All the city fixtures, for table-driven tests. */
export const WATER_FIXTURES: readonly WaterFixture[] = [
  PILSEN,
  DUBLIN,
  BURTON_ON_TRENT,
  MUNICH,
  RO,
];

/**
 * Per-gram-per-litre ion yields for every salt, worked out by hand from molar
 * masses. The per-US-gallon column is what Palmer's *How to Brew* and Martin's
 * Bru'n Water publish, and it's `ppm per g/L ÷ 3.785411784`.
 *
 * ```
 * gypsum      CaSO₄·2H₂O  M = 40.078 + 96.056 + 2×18.015 = 172.164
 *   Ca  1000 × 40.078 / 172.164 = 232.79   → 61.50 per g/gal
 *   SO₄ 1000 × 96.056 / 172.164 = 557.94   → 147.39
 * CaCl₂·2H₂O              M = 40.078 + 70.906 + 36.030 = 147.014
 *   Ca  1000 × 40.078 / 147.014 = 272.61   → 72.01
 *   Cl  1000 × 70.906 / 147.014 = 482.31   → 127.41
 * CaCl₂ (anhydrous)       M = 40.078 + 70.906 = 110.984
 *   Ca  1000 × 40.078 / 110.984 = 361.11   → 95.40
 *   Cl  1000 × 70.906 / 110.984 = 638.89   → 168.78
 * Epsom       MgSO₄·7H₂O  M = 24.305 + 96.056 + 126.105 = 246.466
 *   Mg  1000 × 24.305 / 246.466 = 98.61    → 26.05
 *   SO₄ 1000 × 96.056 / 246.466 = 389.73   → 102.96
 * NaCl                    M = 22.98977 + 35.453 = 58.443
 *   Na  1000 × 22.98977 / 58.443 = 393.37  → 103.92
 *   Cl  1000 × 35.453 / 58.443 = 606.63    → 160.25
 * MgCl₂·6H₂O              M = 24.305 + 70.906 + 108.090 = 203.301
 *   Mg  1000 × 24.305 / 203.301 = 119.55   → 31.58
 *   Cl  1000 × 70.906 / 203.301 = 348.77   → 92.14
 * NaHCO₃                  M = 22.98977 + 61.016 = 84.006
 *   Na   1000 × 22.98977 / 84.006 = 273.67 → 72.30
 *   HCO₃ 1000 × 61.016 / 84.006 = 726.33   → 191.88
 * CaCO₃                   M = 100.086
 *   Ca   1000 × 40.078 / 100.086 = 400.44  → 105.78
 *   HCO₃ 1000 × 2 × 61.016 / 100.086 = 1219.26 → 322.09
 * Ca(OH)₂                 M = 40.078 + 34.014 = 74.092
 *   Ca   1000 × 40.078 / 74.092 = 540.92   → 142.90
 *   HCO₃ equivalent 1000 × 2 × 61.016 / 74.092 = 1647.05 → 435.10
 * ```
 */
export const SALT_YIELD_FIXTURES: readonly {
  readonly salt: string;
  readonly ppmPerGramPerLitre: Readonly<Record<string, number>>;
  readonly ppmPerGramPerUsGallon: Readonly<Record<string, number>>;
}[] = [
  {
    salt: 'gypsum',
    ppmPerGramPerLitre: { calcium: 232.79, sulfate: 557.94 },
    ppmPerGramPerUsGallon: { calcium: 61.5, sulfate: 147.4 },
  },
  {
    salt: 'calcium-chloride-dihydrate',
    ppmPerGramPerLitre: { calcium: 272.61, chloride: 482.31 },
    ppmPerGramPerUsGallon: { calcium: 72.0, chloride: 127.4 },
  },
  {
    salt: 'calcium-chloride-anhydrous',
    ppmPerGramPerLitre: { calcium: 361.11, chloride: 638.89 },
    ppmPerGramPerUsGallon: { calcium: 95.4, chloride: 168.8 },
  },
  {
    salt: 'epsom-salt',
    ppmPerGramPerLitre: { magnesium: 98.61, sulfate: 389.73 },
    ppmPerGramPerUsGallon: { magnesium: 26.1, sulfate: 103.0 },
  },
  {
    salt: 'table-salt',
    ppmPerGramPerLitre: { sodium: 393.37, chloride: 606.63 },
    ppmPerGramPerUsGallon: { sodium: 103.9, chloride: 160.3 },
  },
  {
    salt: 'magnesium-chloride',
    ppmPerGramPerLitre: { magnesium: 119.55, chloride: 348.77 },
    ppmPerGramPerUsGallon: { magnesium: 31.6, chloride: 92.1 },
  },
  {
    salt: 'baking-soda',
    ppmPerGramPerLitre: { sodium: 273.67, bicarbonate: 726.33 },
    ppmPerGramPerUsGallon: { sodium: 72.3, bicarbonate: 191.9 },
  },
  {
    salt: 'chalk',
    ppmPerGramPerLitre: { calcium: 400.44, bicarbonate: 1219.26 },
    ppmPerGramPerUsGallon: { calcium: 105.8, bicarbonate: 322.1 },
  },
  {
    salt: 'slaked-lime',
    ppmPerGramPerLitre: { calcium: 540.92, bicarbonate: 1647.05 },
    ppmPerGramPerUsGallon: { calcium: 142.9, bicarbonate: 435.1 },
  },
];

/**
 * Acid strengths, worked out by hand.
 *
 * ```
 * mmol per mL = density (g/mL) × w/w fraction × 1000 / M (g/mol)
 *
 * lactic 88 %      1.209 × 0.88 × 1000 / 90.078  = 11.811
 * lactic 80 %      1.186 × 0.80 × 1000 / 90.078  = 10.534
 * phosphoric 85 %  1.685 × 0.85 × 1000 / 97.995  = 14.616
 * phosphoric 75 %  1.579 × 0.75 × 1000 / 97.995  = 12.084
 * phosphoric 10 %  1.053 × 0.10 × 1000 / 97.995  = 1.0745
 * hydrochloric 31 % 1.1543 × 0.31 × 1000 / 36.458 = 9.815
 * sulfuric 35 %    1.2599 × 0.35 × 1000 / 98.079 = 4.4961
 * acetic 5 %       1.0055 × 0.05 × 1000 / 60.052 = 0.8372
 * citric solid     1000 / 210.139 (monohydrate)  = 4.7588 mmol/g
 * ```
 *
 * The equivalents each one delivers at pH 5.40 come from the pKa speciation:
 *
 * ```
 * f(pH) = Σ j·10^(j·pH − Σ pKa) / Σ 10^(j·pH − Σ pKa)
 *
 * lactic        pKa 3.86                → 1/(1 + 10^(3.86−5.40))       = 0.9720
 * phosphoric    pKa 2.148/7.198/12.319  → 1.0151
 * citric        pKa 3.128/4.761/6.396   → 1.9015
 * acetic        pKa 4.756               → 1/(1 + 10^(4.756−5.40))      = 0.8150
 * hydrochloric  strong                  → 1.0000
 * sulfuric      pKa −3 / 1.99           → 1.9996
 * ```
 */
export const ACID_STRENGTH_FIXTURES: readonly {
  readonly acid: string;
  readonly concentrationPercent: number;
  readonly mmolPerMl: number;
  readonly protonsAtPh54: number;
  readonly mEqPerMlAtPh54: number;
}[] = [
  {
    acid: 'lactic',
    concentrationPercent: 88,
    mmolPerMl: 11.811,
    protonsAtPh54: 0.972,
    mEqPerMlAtPh54: 11.48,
  },
  {
    acid: 'lactic',
    concentrationPercent: 80,
    mmolPerMl: 10.534,
    protonsAtPh54: 0.972,
    mEqPerMlAtPh54: 10.24,
  },
  {
    acid: 'phosphoric',
    concentrationPercent: 85,
    mmolPerMl: 14.616,
    protonsAtPh54: 1.0151,
    mEqPerMlAtPh54: 14.84,
  },
  {
    acid: 'phosphoric',
    concentrationPercent: 75,
    mmolPerMl: 12.084,
    protonsAtPh54: 1.0151,
    mEqPerMlAtPh54: 12.27,
  },
  {
    acid: 'phosphoric',
    concentrationPercent: 10,
    mmolPerMl: 1.0745,
    protonsAtPh54: 1.0151,
    mEqPerMlAtPh54: 1.091,
  },
  {
    acid: 'hydrochloric',
    concentrationPercent: 31,
    mmolPerMl: 9.815,
    protonsAtPh54: 1,
    mEqPerMlAtPh54: 9.815,
  },
  {
    acid: 'sulfuric',
    concentrationPercent: 35,
    mmolPerMl: 4.4961,
    protonsAtPh54: 1.9996,
    mEqPerMlAtPh54: 8.99,
  },
  {
    acid: 'acetic',
    concentrationPercent: 5,
    mmolPerMl: 0.8372,
    protonsAtPh54: 0.815,
    mEqPerMlAtPh54: 0.682,
  },
];
