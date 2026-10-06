/**
 * Golden reference recipes with hand-verified expected vitals.
 *
 * Every expected number below was worked out longhand from the published
 * formulas, without looking at the engine source. The working is written out
 * so a reviewer can check the arithmetic with a calculator instead of trusting
 * the engine. Where a figure is a rounded intermediate, the tolerance in the
 * test allows for it.
 *
 * Shared constants used throughout:
 * - max sucrose yield         46.214 PPG
 * - PPG → points·L/kg         × 8.345404
 * - 1 kg                      = 2.2046226 lb
 * - 1 L                       = 0.26417205 US gal
 * - Plato from SG             −616.868 + 1111.14·SG − 630.272·SG² + 135.997·SG³
 */

import type { EquipmentProfile, RecipeInput } from '../types';

/**
 * The equipment profile both reference recipes use.
 *
 * The numbers are round so the waterfall arithmetic is easy to check by hand.
 */
export const REFERENCE_EQUIPMENT: EquipmentProfile = {
  name: 'Reference 20 L system',
  spargeType: 'batch',
  mashTunDeadspaceL: 0,
  mashTunLossL: 0,
  grainAbsorptionLPerKg: 1.0,
  mashThicknessLPerKg: 3.0,
  boilOffRateLPerHour: 3.0,
  boilShrinkagePercent: 4,
  kettleDeadspaceL: 1.0,
  hopAbsorptionMlPerG: 6,
  dryHopAbsorptionMlPerG: 6,
  chillerLossL: 0,
  fermenterTrubLossL: 1.0,
  topUpKettleL: 0,
  topUpFermenterL: 0,
  mashEfficiencyPercent: 75,
  brewhouseEfficiencyPercent: 70,
  mashTunThermalMassLEquivalent: 0,
  mashTunInitialTempC: 20,
  mashStandingLossCPerHour: 2,
  decoctionBoilOffLPerHour: 1.5,
};

// ===========================================================================
// Reference recipe A — all-grain American Pale Ale
// ===========================================================================

/**
 * A plain all-grain pale ale: two malts, three kettle hops, one dry hop.
 * Exercises mash efficiency, the full volume waterfall, Tinseth with a
 * whirlpool addition, Morey colour and the ABV pair.
 */
export const REFERENCE_RECIPE_A: RecipeInput = {
  name: 'Reference American Pale Ale',
  batchVolumeL: 20,
  batchVolumeBasis: 'fermenter',
  boilTimeMinutes: 60,
  fermentables: [
    {
      name: 'Pale Ale Malt',
      amountKg: 4.5,
      class: 'grain',
      use: 'mash',
      extractFineGrindDryBasisPercent: 80.0,
      moisturePercent: 4.0,
      colorLovibond: 3.0,
    },
    {
      name: 'Crystal 60',
      amountKg: 0.4,
      class: 'steeping-grain',
      use: 'mash',
      extractFineGrindDryBasisPercent: 74.0,
      moisturePercent: 4.0,
      colorLovibond: 60,
    },
  ],
  hops: [
    {
      name: 'Centennial',
      amountKg: 0.02,
      alphaAcidPercent: 9.5,
      form: 'pellet',
      use: 'boil',
      timeMinutes: 60,
    },
    {
      name: 'Cascade',
      amountKg: 0.03,
      alphaAcidPercent: 6.0,
      form: 'pellet',
      use: 'boil',
      timeMinutes: 15,
    },
    {
      name: 'Cascade (whirlpool)',
      amountKg: 0.04,
      alphaAcidPercent: 6.0,
      form: 'pellet',
      use: 'whirlpool',
      timeMinutes: 20,
      whirlpoolTempC: 80,
    },
    {
      name: 'Citra (dry hop)',
      amountKg: 0.05,
      alphaAcidPercent: 12.0,
      form: 'pellet',
      use: 'dry-hop',
      timeMinutes: 0,
      dryHopDays: 4,
    },
  ],
  yeasts: [
    {
      name: 'US-05',
      type: 'ale',
      form: 'dry',
      attenuationMinPercent: 78,
      attenuationMaxPercent: 82,
    },
  ],
  mashSteps: [{ name: 'Saccharification', type: 'infusion', targetTempC: 66.7, timeMinutes: 60 }],
  grainTemperatureC: 20,
};

/**
 * Hand-computed vitals for {@link REFERENCE_RECIPE_A}.
 *
 * ## Volumes (backwards from 20 L into the fermenter)
 *
 * ```
 * kettle hops        = 20 + 30 + 40 g              = 0.090 kg
 * hop absorption     = 0.090 kg × 6 L/kg           = 0.540 L
 * dry-hop absorption = 0.050 kg × 6 L/kg           = 0.300 L
 * packaged           = 20 − 1.0 trub − 0.300       = 18.700 L
 * post-boil (20 °C)  = 20 + 1.0 deadspace + 0.540  = 21.540 L
 * post-boil (hot)    = 21.540 / 0.96               = 22.4375 L
 * boil-off           = 3.0 L/h × 1 h               = 3.000 L
 * pre-boil           = 22.4375 + 3.000             = 25.4375 L
 * grain absorption   = 4.9 kg × 1.0 L/kg           = 4.900 L
 * total water        = 25.4375 + 4.900             = 30.3375 L
 * strike             = 3.0 L/kg × 4.9 kg           = 14.700 L
 * sparge             = 30.3375 − 14.700            = 15.6375 L
 * ```
 *
 * ## Yields
 *
 * ```
 * Pale:    (80.0/100) × (1 − 0.04) × 46.214 = 35.4924 PPG → × 8.345404 = 296.198 pt·L/kg
 * Crystal: (74.0/100) × (1 − 0.04) × 46.214 = 32.8304 PPG → × 8.345404 = 273.983 pt·L/kg
 * theoretical max = 4.5 × 296.198 + 0.4 × 273.983 = 1332.89 + 109.59 = 1442.48 pt·L
 * delivered at 75 % mash efficiency               = 1081.86 pt·L
 * ```
 *
 * ## Gravity
 *
 * ```
 * pre-boil SG = 1 + 1081.86 / 25.4375 / 1000 = 1.04253
 * OG          = 1 + 1081.86 / 21.540  / 1000 = 1.05023
 * brewhouse%  = 100 × 50.23 × 20 / 1442.48   = 69.64 %
 * ```
 *
 * ## Final gravity (80 % apparent attenuation, midpoint of 78–82)
 *
 * ```
 * OE = Plato(1.05023) = 12.4412 °P
 * AE = 12.4412 × 0.20 =  2.4882 °P
 * FG = SG(2.4882 °P)  =  1.00971
 * ```
 *
 * ## ABV
 *
 * ```
 * simple   = (1.05023 − 1.00971) × 131.25                             = 5.317 %
 * advanced = 76.08 × 0.040516 / (1.775 − 1.05023) × (1.00971 / 0.794) = 5.408 %
 * ```
 *
 * ## Bitterness (Tinseth, post-boil gravity 1.05023, volume 21.540 L, pellets ×1.10)
 *
 * ```
 * bigness = 1.65 × 0.000125^0.05023             = 1.05063
 * 60 min: btf = (1 − e^−2.4)/4.15   = 0.219104
 *         mg/L = 0.095 × 0.020 kg × 1e6 / 21.54 = 88.208
 *         IBU = 1.05063 × 0.219104 × 1.10 × 88.208 = 22.336
 * 15 min: btf = (1 − e^−0.6)/4.15   = 0.108720
 *         mg/L = 0.060 × 0.030 kg × 1e6 / 21.54 = 83.566
 *         IBU = 1.05063 × 0.108720 × 1.10 × 83.566 = 10.500
 * whirlpool 20 min from 80 °C, k = 0.015/min, ambient 20 °C:
 *         t_eff = ∫ r(T(τ)) dτ = 1.6396 effective boil-minutes
 *         btf(1.6396) = (1 − e^−0.065584)/4.15 = 0.015291
 *         mg/L = 0.060 × 0.040 kg × 1e6 / 21.54 = 111.421
 *         IBU = 1.05063 × 0.015291 × 1.10 × 111.421 = 1.970
 * dry hop: 0 by definition
 * total = 22.336 + 10.500 + 1.970 = 34.805 IBU
 * BU:GU = 34.805 / 50.23 = 0.693
 * ```
 *
 * ## Colour (Morey, post-boil volume)
 *
 * ```
 * MCU = (4.5 × 2.2046226 × 3.0 + 0.4 × 2.2046226 × 60) / (21.540 × 0.26417205)
 *     = (29.762 + 52.911) / 5.690 = 14.529
 * SRM = 1.4922 × 14.529^0.6859 = 9.354
 * EBC = 9.354 × 1.97 = 18.428
 * ```
 *
 * ## Calories
 *
 * ```
 * RE   = 0.1808 × 12.4412 + 0.8192 × Plato(1.00971) = 4.2877 °P
 * ABW  = (12.4412 − 4.2877) / (2.0665 − 0.010665 × 12.4412) = 4.2163 % w/w
 * kcal/12 oz = (6.9 × 4.2163 + 4.0 × (4.2877 − 0.1)) × 1.00971 × 3.55 = 164.33
 * ```
 *
 * ## Strike temperature (3.0 L/kg, grain at 20 °C, target 66.7 °C)
 *
 * ```
 * T_w = 66.7 + (0.4 / 3.0) × (66.7 − 20) = 66.7 + 6.227 = 72.93 °C
 * ```
 */
export const REFERENCE_A_EXPECTED = {
  strikeWaterL: 14.7,
  spargeWaterL: 15.6375,
  totalWaterL: 30.3375,
  preBoilVolumeL: 25.4375,
  postBoilVolumeL: 21.54,
  volumeIntoFermenterL: 20,
  packagedVolumeL: 18.7,
  palePpg: 35.4924,
  crystalPpg: 32.8304,
  maxPointLitres: 1442.48,
  preBoilGravity: 1.04253,
  og: 1.05023,
  brewhouseEfficiencyPercent: 69.638,
  originalExtractPlato: 12.4412,
  fg: 1.00971,
  abvSimple: 5.317,
  abvAdvanced: 5.408,
  ibuByAddition: [22.336, 10.5, 1.97, 0],
  ibu: 34.805,
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: BU:GU ratio 34.805 / 50.23, not ln(2).
  buGu: 0.693,
  mcu: 14.529,
  srm: 9.354,
  ebc: 18.428,
  realExtractPlato: 4.2877,
  caloriesPer12UsFlOz: 164.33,
  strikeTemperatureC: 72.93,
} as const;

// ===========================================================================
// Reference recipe B — extract milk stout
// ===========================================================================

/**
 * An extract recipe with steeped specialty grains, lactose and a first-wort
 * hop. Exercises the 100 %-efficiency path, the partial steep efficiency, a
 * non-fermentable's effect on FG, and first-wort hopping.
 */
export const REFERENCE_RECIPE_B: RecipeInput = {
  name: 'Reference Extract Milk Stout',
  batchVolumeL: 20,
  batchVolumeBasis: 'fermenter',
  boilTimeMinutes: 60,
  fermentables: [
    {
      name: 'Light DME',
      amountKg: 3.0,
      class: 'dry-extract',
      use: 'boil',
      ppg: 44,
      colorLovibond: 8,
    },
    {
      name: 'Crystal 120',
      amountKg: 0.5,
      class: 'steeping-grain',
      use: 'steep',
      extractFineGrindDryBasisPercent: 70,
      moisturePercent: 4,
      colorLovibond: 120,
    },
    {
      name: 'Roasted Barley',
      amountKg: 0.3,
      class: 'steeping-grain',
      use: 'steep',
      extractFineGrindDryBasisPercent: 65,
      moisturePercent: 4,
      colorLovibond: 300,
    },
    {
      name: 'Lactose',
      amountKg: 0.5,
      class: 'non-fermentable',
      use: 'boil',
      ppg: 35,
      colorLovibond: 0,
    },
  ],
  hops: [
    {
      name: 'Magnum',
      amountKg: 0.02,
      alphaAcidPercent: 12.0,
      form: 'pellet',
      use: 'first-wort',
      timeMinutes: 0,
    },
  ],
  yeasts: [
    {
      name: 'Nottingham',
      type: 'ale',
      form: 'dry',
      attenuationMinPercent: 70,
      attenuationMaxPercent: 74,
    },
  ],
};

/**
 * Hand-computed vitals for {@link REFERENCE_RECIPE_B}.
 *
 * ## Volumes
 *
 * ```
 * kettle hops        = 20 g → 0.120 L absorption
 * post-boil (20 °C)  = 20 + 1.0 + 0.120        = 21.120 L
 * post-boil (hot)    = 21.120 / 0.96           = 22.000 L
 * pre-boil           = 22.000 + 3.000          = 25.000 L
 * steeped grain      = 0.5 + 0.3               = 0.800 kg → 0.800 L absorption
 * total water        = 25.000 + 0.800          = 25.800 L
 * strike             = 3.0 × 0.8               =  2.400 L
 * sparge             = 25.800 − 2.400          = 23.400 L
 * packaged           = 20 − 1.0 trub           = 19.000 L
 * ```
 *
 * ## Yields and extract
 *
 * ```
 * DME       44 PPG (given)            × 8.345404 = 367.198 pt·L/kg
 * Crystal   0.70 × 0.96 × 46.214 = 31.0558 PPG   = 259.155 pt·L/kg
 * Roast     0.65 × 0.96 × 46.214 = 28.8375 PPG   = 240.644 pt·L/kg
 * Lactose   35 PPG (given)                       = 292.089 pt·L/kg
 *
 * DME     3.0 kg × 367.198 × 100 % = 1101.59 pt·L   (boil stage)
 * Crystal 0.5 kg × 259.155 ×  50 % =   64.79 pt·L   (pre-boil stage)
 * Roast   0.3 kg × 240.644 ×  50 % =   36.10 pt·L   (pre-boil stage)
 * Lactose 0.5 kg × 292.089 × 100 % =  146.04 pt·L   (boil stage)
 * ```
 *
 * ## Gravity
 *
 * ```
 * pre-boil SG = 1 + (64.79 + 36.10) / 25.000 / 1000 = 1.00404
 *   (the extract and lactose haven't gone in yet, so this is the steep runnings)
 * OG          = 1 + 1348.52 / 21.120 / 1000         = 1.06385
 * ```
 *
 * ## Final gravity (the main thing this fixture tests)
 *
 * Yeast attenuation is the 70–74 % midpoint, 72 %. Lactose attenuates 0 %.
 *
 * ```
 * net ADF = (1101.59 + 64.79 + 36.10) × 0.72 + 146.04 × 0
 *           ─────────────────────────────────────────────  = 64.20 %
 *                          1348.52
 * OE = Plato(1.06385) = 15.6372 °P
 * AE = 15.6372 × (1 − 0.6420) = 5.5983 °P
 * FG = SG(5.5983 °P) = 1.02207
 * ```
 *
 * The milk stout finishes at 1.022 instead of the 1.018 a naive 72 %
 * attenuation would give, because the lactose doesn't ferment and the
 * attenuation is weighted by each fermentable's share of the extract.
 *
 * ```
 * ABV (advanced) = 76.08 × 0.04178 / (1.775 − 1.06385) × (1.02207 / 0.794) = 5.753 %
 * ```
 *
 * ## Bitterness (first-wort hop: full 60 min boil × 1.10 FWH × 1.10 pellet)
 *
 * ```
 * bigness = 1.65 × 0.000125^0.06385 = 0.92954
 * mg/L    = 0.12 × 0.020 kg × 1e6 / 21.120 = 113.636
 * IBU     = 0.92954 × 0.219104 × 1.10 × 1.10 × 113.636 = 28.004
 * ```
 *
 * ## Colour (Morey)
 *
 * ```
 * MCU = (3.0×2.2046×8 + 0.5×2.2046×120 + 0.3×2.2046×300 + 0) / (21.120 × 0.264172)
 *     = (52.911 + 132.277 + 198.416) / 5.579 = 68.755
 * SRM = 1.4922 × 68.755^0.6859 = 27.167
 * ```
 */
export const REFERENCE_B_EXPECTED = {
  strikeWaterL: 2.4,
  spargeWaterL: 23.4,
  preBoilVolumeL: 25.0,
  postBoilVolumeL: 21.12,
  packagedVolumeL: 19.0,
  preBoilGravity: 1.00404,
  og: 1.06385,
  netApparentAttenuationPercent: 64.2,
  originalExtractPlato: 15.6372,
  fg: 1.02207,
  abvAdvanced: 5.753,
  ibu: 28.004,
  mcu: 68.755,
  srm: 27.167,
} as const;
