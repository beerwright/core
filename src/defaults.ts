/**
 * Engine defaults.
 *
 * Every default in this file is a judgement call, and callers can override
 * every one of them. Each constant documents where its value comes from.
 */

import { DEFAULT_MASH_PH_OPTIONS, resolveMashPhOptions } from './mashPh';
import type {
  CalculationOptions,
  EquipmentProfile,
  EquipmentProfileInput,
  FermentableClass,
  HopForm,
  Percent,
  ResolvedCalculationOptions,
} from './types';

/**
 * Maximum theoretical yield of pure sucrose, in points per pound per US gallon.
 *
 * One pound of sucrose dissolved to one US gallon gives 1.04621 SG; this is the
 * ceiling every malt's yield is expressed against.
 * Source: Palmer, *How to Brew*, 4th ed., appendix on extract potential.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MAX_SUCROSE_PPG = 46.214;

/**
 * Conversion between the two yield units: `points·L/kg = PPG × 8.345404`.
 *
 * Derived exactly: 1 lb/US gal = 0.45359237 kg / 3.785411784 L = 0.11982643 kg/L,
 * and 1 / 0.11982643 = 8.345404.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const POINTS_PER_KG_PER_L_PER_PPG = 8.345404;

/**
 * Volume occupied by grain itself, **litres per kilogram**.
 *
 * 1 lb of crushed malt displaces ~0.08 US gal, i.e. 0.6676 L/kg. Used only to
 * check that the mash fits in the tun.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const GRAIN_DISPLACEMENT_L_PER_KG = 0.6676;

/**
 * Ratio of grain's specific heat to water's, dimensionless.
 *
 * Grain ≈ 1.67 kJ/kg·K, water 4.186 kJ/kg·K → 0.40. This is the "0.2" in
 * Palmer's imperial strike formula once quarts-per-pound is converted to
 * litres-per-kilogram (0.2 × 2.08635 = 0.4173); we use the physical ratio.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const GRAIN_SPECIFIC_HEAT_RATIO = 0.4;

/**
 * How fast a resting mash loses temperature, **°C per hour**.
 *
 * 2 °C/h suits a lidded, insulated cooler tun. That's the usual vessel for a
 * decoction mash, and it holds heat well enough that the tun needs no heat
 * source. A direct-fired kettle sitting off the flame is nearer 4, and a rig
 * with active temperature control is 0. Callers pass those in themselves.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_MASH_STANDING_LOSS_C_PER_HOUR = 2;

/**
 * Evaporation from a decoction pot at a rolling boil, **litres per hour**.
 *
 * This is a rate and not a fraction of the pull. With a fraction, the
 * evaporation depends on the pull size, which depends on the evaporation, and
 * the whole volume waterfall becomes a fixed point that has to be iterated. A
 * pot at a given vigour evaporates at a roughly fixed rate whatever is in it,
 * so the rate model is more accurate and isn't circular: `e` is known before
 * the pull is sized. 1.5 L/h suits the 8–12 L pot a decoction is usually
 * boiled in, well under the 3 L/h of a full kettle.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_DECOCTION_BOIL_OFF_L_PER_HOUR = 1.5;

/**
 * Default whirlpool/hop-stand temperature, °C, when an addition does not state one.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_WHIRLPOOL_TEMP_C = 80;

/**
 * Default cooling rate constant `k` for the mIBU stand model, **per minute**.
 *
 * The wort is modelled as decaying exponentially towards ambient,
 * `T(t) = T_ambient + (T₀ − T_ambient)·e^(−kt)`. At `k = 0.015` a stand
 * starting at 80 °C is still at 64 °C after 20 minutes — about 1.2 °C/min
 * initially, which matches a covered ~20 L kettle left to whirlpool.
 *
 * For systems that cool differently:
 * - immersion chiller running through the stand: 0.05–0.10;
 * - actively temperature-held whirlpool: use the `fixed-temperature` model,
 *   which is the `k → 0` limit of this one.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_WHIRLPOOL_COOLING_RATE_PER_MIN = 0.015;

/**
 * Default target carbonation, volumes of CO₂ (mid-range for most ale styles).
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_CARBONATION_VOLUMES = 2.4;

/**
 * Default grain temperature at dough-in, °C (room temperature).
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_GRAIN_TEMP_C = 20;

/**
 * Default moisture content by fermentable class, **% of as-is mass**.
 *
 * Malt is specified at 4 % (typical maltster figure), DME is near-anhydrous,
 * LME is ~20 % water by definition, and sugars/lactose are sold dry.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_MOISTURE_PERCENT_BY_CLASS: Readonly<Record<FermentableClass, Percent>> = {
  grain: 4,
  'steeping-grain': 4,
  'dry-extract': 2,
  'liquid-extract': 20,
  sugar: 0,
  'non-fermentable': 0,
};

/**
 * Default hop-form utilisation multipliers.
 *
 * - `whole` / `plug` = 1.0 — the baseline every published utilisation table was
 *   measured against.
 * - `pellet` = 1.10 — the widely used +10 % for the increased surface area of
 *   milled, pelletised cones (Tinseth's own note; BeerSmith and Brewer's Friend
 *   use the same figure).
 * - `co2-extract` = 1.0 — pure resin already in solution, so the surface-area
 *   reason for pellet's +10 % doesn't apply to it.
 * - `iso-extract` = 1.0 — here so the record covers every form. It's never
 *   read, because a pre-isomerised extract skips the utilisation model
 *   (`ibu.ts`).
 * - `aroma-extract` = 1.0 — has no effect, because these products have no
 *   alpha acid and multiplying zero changes nothing.
 * - `cryo` = 1.10 — a judgement call. Cryo/lupulin powder is a concentrated
 *   pellet, and its extra bitterness is already in its (roughly doubled)
 *   stated alpha-acid percentage. A second potency multiplier here would count
 *   it twice, so cryo uses the pellet figure.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_HOP_FORM_MULTIPLIERS: Readonly<Record<HopForm, number>> = {
  whole: 1.0,
  plug: 1.0,
  pellet: 1.1,
  cryo: 1.1,
  'co2-extract': 1.0,
  'iso-extract': 1.0,
  'aroma-extract': 1.0,
};

/**
 * Fraction of a pre-isomerised extract's iso-alpha that reaches the glass.
 *
 * 0.95 is the figure the makers of these products quote for a kettle dose.
 * Dosing after fermentation recovers more, and callers override this for it.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_ISO_EXTRACT_RECOVERY = 0.95;

/**
 * First-wort-hop utilisation bonus, as a multiplier on a full-boil addition.
 *
 * FWH is modelled as a boil addition for the entire boil, times 1.10. This is
 * the convention BeerSmith and Brewer's Friend use, itself derived from the
 * 1995 *Brauwelt* trials that reported ~10 % more measured bitterness from
 * first-wort hopping than from an equivalent 60-minute addition.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_FIRST_WORT_MULTIPLIER = 1.1;

/**
 * Default efficiency applied to steeped (unmashed) grain, **%**.
 *
 * Steeping crystal and roasted malts in a grain bag recovers roughly half of
 * their laboratory extract; 50 % is the conventional figure used by extract
 * recipe calculators.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_STEEP_EFFICIENCY_PERCENT = 50;

/**
 * Reference mash temperature for the attenuation heuristic, °C (152 °F).
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MASH_TEMP_ATTENUATION_REFERENCE_C = 66.7;

/**
 * Attenuation shift per °C away from {@link MASH_TEMP_ATTENUATION_REFERENCE_C},
 * in **percentage points**, cooler mashes attenuating more.
 *
 * This is a heuristic, not a published formula. 1.2 points/°C (≈0.67 points/°F)
 * reproduces the commonly cited "mash at 149 °F for a dry beer, 156 °F for a
 * full one" rule of thumb. It's applied whenever the engine can read a mash
 * temperature from the recipe, and clamped by
 * {@link MASH_TEMP_ATTENUATION_MAX_SHIFT}.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MASH_TEMP_ATTENUATION_POINTS_PER_C = 1.2;

/**
 * Maximum attenuation shift the mash-temperature heuristic may apply, percentage points.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MASH_TEMP_ATTENUATION_MAX_SHIFT = 8;

/**
 * Coolest rest that counts as saccharification, °C.
 *
 * Below this the amylases don't work on starch. Acid rests (~35 °C),
 * protein/ferulic rests (45–53 °C) and dough-in stands convert nothing, so
 * including them would pull the effective temperature down and predict a beer
 * much drier than it finishes. 55 °C is the bottom of beta-amylase's useful
 * range.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MASH_SACCHARIFICATION_MIN_C = 55;

/**
 * Warmest rest that counts as saccharification, °C.
 *
 * Above this both amylases denature within minutes. A mash-out at 76–78 °C
 * locks in the fermentability already reached without adding to it, so it's
 * left out of the effective temperature.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MASH_SACCHARIFICATION_MAX_C = 75;

/**
 * The default equipment profile: a 20 L batch on a typical all-in-one system.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_EQUIPMENT_PROFILE: EquipmentProfile = {
  name: 'Default',
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
  mashStandingLossCPerHour: DEFAULT_MASH_STANDING_LOSS_C_PER_HOUR,
  decoctionBoilOffLPerHour: DEFAULT_DECOCTION_BOIL_OFF_L_PER_HOUR,
};

/**
 * Fill a partial equipment profile from {@link DEFAULT_EQUIPMENT_PROFILE}.
 *
 * @category Recipe
 * @group Calculations
 */
export function resolveEquipmentProfile(input: EquipmentProfileInput = {}): EquipmentProfile {
  const d = DEFAULT_EQUIPMENT_PROFILE;
  const hopAbsorption = input.hopAbsorptionMlPerG ?? d.hopAbsorptionMlPerG;
  return {
    name: input.name ?? d.name,
    spargeType: input.spargeType ?? d.spargeType,
    mashTunDeadspaceL: input.mashTunDeadspaceL ?? d.mashTunDeadspaceL,
    mashTunLossL: input.mashTunLossL ?? d.mashTunLossL,
    grainAbsorptionLPerKg: input.grainAbsorptionLPerKg ?? d.grainAbsorptionLPerKg,
    mashThicknessLPerKg: input.mashThicknessLPerKg ?? d.mashThicknessLPerKg,
    boilOffRateLPerHour: input.boilOffRateLPerHour ?? d.boilOffRateLPerHour,
    boilShrinkagePercent: input.boilShrinkagePercent ?? d.boilShrinkagePercent,
    kettleDeadspaceL: input.kettleDeadspaceL ?? d.kettleDeadspaceL,
    hopAbsorptionMlPerG: hopAbsorption,
    // A profile that sets kettle hop absorption but not the dry-hop figure means
    // "the same"; only fall back to the global default when neither is given.
    dryHopAbsorptionMlPerG: input.dryHopAbsorptionMlPerG ?? hopAbsorption,
    chillerLossL: input.chillerLossL ?? d.chillerLossL,
    fermenterTrubLossL: input.fermenterTrubLossL ?? d.fermenterTrubLossL,
    topUpKettleL: input.topUpKettleL ?? d.topUpKettleL,
    topUpFermenterL: input.topUpFermenterL ?? d.topUpFermenterL,
    mashEfficiencyPercent: input.mashEfficiencyPercent ?? d.mashEfficiencyPercent,
    brewhouseEfficiencyPercent: input.brewhouseEfficiencyPercent ?? d.brewhouseEfficiencyPercent,
    mashTunThermalMassLEquivalent:
      input.mashTunThermalMassLEquivalent ?? d.mashTunThermalMassLEquivalent,
    mashTunInitialTempC: input.mashTunInitialTempC ?? d.mashTunInitialTempC,
    mashStandingLossCPerHour: input.mashStandingLossCPerHour ?? d.mashStandingLossCPerHour,
    decoctionBoilOffLPerHour: input.decoctionBoilOffLPerHour ?? d.decoctionBoilOffLPerHour,
    ...(input.kettleVolumeL !== undefined ? { kettleVolumeL: input.kettleVolumeL } : {}),
    ...(input.mashTunVolumeL !== undefined ? { mashTunVolumeL: input.mashTunVolumeL } : {}),
    ...(input.fermenterVolumeL !== undefined ? { fermenterVolumeL: input.fermenterVolumeL } : {}),
    ...(input.decoctionPotVolumeL !== undefined
      ? { decoctionPotVolumeL: input.decoctionPotVolumeL }
      : {}),
  };
}

/**
 * The default calculation options, spelled out.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_CALCULATION_OPTIONS: ResolvedCalculationOptions = {
  ibuFormula: 'tinseth',
  colorFormula: 'morey',
  abvFormula: 'advanced',
  whirlpool: {
    model: 'mibu',
    ambientTempC: 20,
    coolingRateConstantPerMin: DEFAULT_WHIRLPOOL_COOLING_RATE_PER_MIN,
    integrationStepMinutes: 0.05,
    includePostBoilIsomerisationForBoilHops: false,
  },
  mashPh: { ...DEFAULT_MASH_PH_OPTIONS },
  hopFormMultipliers: { ...DEFAULT_HOP_FORM_MULTIPLIERS },
  firstWortMultiplier: DEFAULT_FIRST_WORT_MULTIPLIER,
  isoExtractRecovery: DEFAULT_ISO_EXTRACT_RECOVERY,
  utilizationMultiplier: 1,
  elevationM: 0,
  ibuVolumeBasis: 'post-boil',
  bitternessGravityBasis: 'post-boil',
  colorVolumeBasis: 'post-boil',
  steepEfficiencyPercent: DEFAULT_STEEP_EFFICIENCY_PERCENT,
  attenuationOverridePercent: undefined,
  maxSucrosePpg: MAX_SUCROSE_PPG,
};

/**
 * Fill partial calculation options from {@link DEFAULT_CALCULATION_OPTIONS}.
 *
 * @category Recipe
 * @group Calculations
 */
export function resolveCalculationOptions(
  options: CalculationOptions = {},
): ResolvedCalculationOptions {
  const d = DEFAULT_CALCULATION_OPTIONS;
  const w = options.whirlpool ?? {};
  return {
    ibuFormula: options.ibuFormula ?? d.ibuFormula,
    colorFormula: options.colorFormula ?? d.colorFormula,
    abvFormula: options.abvFormula ?? d.abvFormula,
    whirlpool: {
      model: w.model ?? d.whirlpool.model,
      ambientTempC: w.ambientTempC ?? d.whirlpool.ambientTempC,
      coolingRateConstantPerMin:
        w.coolingRateConstantPerMin ?? d.whirlpool.coolingRateConstantPerMin,
      integrationStepMinutes: w.integrationStepMinutes ?? d.whirlpool.integrationStepMinutes,
      includePostBoilIsomerisationForBoilHops:
        w.includePostBoilIsomerisationForBoilHops ??
        d.whirlpool.includePostBoilIsomerisationForBoilHops,
    },
    mashPh: resolveMashPhOptions(options.mashPh),
    hopFormMultipliers: { ...d.hopFormMultipliers, ...options.hopFormMultipliers },
    firstWortMultiplier: options.firstWortMultiplier ?? d.firstWortMultiplier,
    isoExtractRecovery: options.isoExtractRecovery ?? d.isoExtractRecovery,
    utilizationMultiplier: options.utilizationMultiplier ?? d.utilizationMultiplier,
    elevationM: options.elevationM ?? d.elevationM,
    ibuVolumeBasis: options.ibuVolumeBasis ?? d.ibuVolumeBasis,
    bitternessGravityBasis: options.bitternessGravityBasis ?? d.bitternessGravityBasis,
    colorVolumeBasis: options.colorVolumeBasis ?? d.colorVolumeBasis,
    steepEfficiencyPercent: options.steepEfficiencyPercent ?? d.steepEfficiencyPercent,
    attenuationOverridePercent: options.attenuationOverridePercent,
    maxSucrosePpg: options.maxSucrosePpg ?? d.maxSucrosePpg,
  };
}
