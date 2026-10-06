/**
 * Volumes, strike temperature and infusions.
 *
 * The volume waterfall runs in both directions. Brewers plan from a target
 * batch size ("I want 20 L in the keg, how much water do I need?") and record
 * from what they measured ("I put 32 L in the tun, what should I have ended
 * up with?"). Both directions are supported here and are exact inverses of
 * each other.
 *
 * ```
 * strike + sparge
 *   − grain absorption − mash tun loss − decoction boil-off  (+ kettle top-up)
 * = pre-boil
 *   − boil-off
 * = post-boil (hot)
 *   − 4 % shrinkage
 * = post-boil (20 °C)
 *   − kettle deadspace − hop absorption − chiller loss  (+ fermenter top-up)
 * = into fermenter
 *   − trub loss − dry-hop absorption
 * = packaged
 * ```
 *
 * ## Deadspace isn't a loss
 *
 * `mashTunDeadspaceL` isn't in the waterfall above. It's the
 * Brewfather-compatible figure for the volume below a mash tun's outlet or
 * false bottom on a single-vessel rig. That liquid never leaves the kettle, so
 * it's still wort. Adding it to the water requirement would inflate strike
 * water by the under-basket volume, and on a no-sparge or BIAB profile all of
 * it would go into the strike. Wort the brewer actually loses to the tun is
 * `mashTunLossL`, which is the "mash tun loss" term in the code below.
 */

import { decoctionPull } from './decoction';
import {
  GRAIN_DISPLACEMENT_L_PER_KG,
  GRAIN_SPECIFIC_HEAT_RATIO,
  resolveEquipmentProfile,
} from './defaults';
import type {
  BatchVolumeBasis,
  Celsius,
  EquipmentProfile,
  EquipmentProfileInput,
  Kilograms,
  Litres,
  Minutes,
} from './types';

/**
 * Every stage of the volume waterfall, litres.
 *
 * @category Gravity and ABV
 * @group Results
 */
export interface VolumeWaterfall {
  /** Water into the mash tun. */
  readonly strikeWaterL: Litres;
  /** Water used to rinse the grain bed. Zero for no-sparge and BIAB. */
  readonly spargeWaterL: Litres;
  /** Strike + sparge. */
  readonly totalWaterL: Litres;
  /** Strike water plus the volume the grain itself occupies. Check this fits the tun. */
  readonly mashVolumeL: Litres;
  /** Water retained by the spent grain. */
  readonly grainAbsorptionL: Litres;
  /**
   * Volume below the mash tun outlet, which returns to the kettle.
   *
   * Reported for display only, and **excluded from every other number here**.
   * It costs no water and isn't part of {@link totalLossL}.
   */
  readonly mashTunDeadspaceL: Litres;
  /** Wort actually left behind in the mash tun. */
  readonly mashTunLossL: Litres;
  /** Water added straight to the kettle (extract and partial-boil brewing). */
  readonly topUpKettleL: Litres;
  /**
   * Water the decoction pots boil away, litres.
   *
   * A mash loss like any other (it leaves the tun and never reaches the
   * kettle), but infusion mashes don't have it, so it's zero for almost every
   * recipe. `./decoction` explains why it can be known before the pulls are
   * sized. That's what lets it be a plain term in the waterfall, with no need
   * to iterate.
   */
  readonly decoctionEvaporationL: Litres;
  /** Wort in the kettle when the boil starts, at boiling temperature. */
  readonly preBoilVolumeL: Litres;
  /** Water evaporated during the boil. */
  readonly boilOffL: Litres;
  /** Wort at the end of the boil, still hot. */
  readonly postBoilVolumeHotL: Litres;
  /** Volume lost to thermal contraction as the wort cools to 20 °C. */
  readonly shrinkageL: Litres;
  /** Wort at the end of the boil, corrected to 20 °C. The measurement basis. */
  readonly postBoilVolumeL: Litres;
  /** Wort left under the kettle pickup. */
  readonly kettleDeadspaceL: Litres;
  /** Wort retained by boil and whirlpool hops. */
  readonly kettleHopAbsorptionL: Litres;
  /** Wort left in the chiller and hoses. */
  readonly chillerLossL: Litres;
  /** Water added to the fermenter after transfer. */
  readonly topUpFermenterL: Litres;
  /** Chilled wort into the fermenter. */
  readonly volumeIntoFermenterL: Litres;
  /** Beer left on the yeast cake and trub. */
  readonly fermenterTrubLossL: Litres;
  /** Beer retained by dry hops. */
  readonly dryHopAbsorptionL: Litres;
  /** Finished beer into keg or bottles. */
  readonly packagedVolumeL: Litres;
  /** Total boil-off + shrinkage + every loss. */
  readonly totalLossL: Litres;
}

/**
 * The masses and times the waterfall depends on.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface VolumeInputs {
  /** Grain in the mash tun, kg. Extract and sugars do not absorb water. */
  readonly grainKg: Kilograms;
  /** Boil, first-wort and whirlpool hops, kg. */
  readonly kettleHopKg: Kilograms;
  /** Dry and keg hops, kg: everything the finished beer sits on. */
  readonly dryHopKg: Kilograms;
  /** Boil duration, minutes. */
  readonly boilTimeMinutes: Minutes;
  /** Mash thickness override, litres per kilogram. */
  readonly mashThicknessLPerKg?: number;
  /**
   * Water the decoctions boil away, litres. Defaults to 0.
   *
   * `decoction`'s {@link decoctionEvaporation} computes it from the schedule.
   */
  readonly decoctionEvaporationL?: Litres;
}

/**
 * True when the profile lauters without a separate sparge.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function isNoSparge(equipment: EquipmentProfile): boolean {
  return equipment.spargeType === 'no-sparge' || equipment.spargeType === 'biab-full-volume';
}

function losses(equipment: EquipmentProfile, inputs: VolumeInputs) {
  return {
    grainAbsorptionL: inputs.grainKg * equipment.grainAbsorptionLPerKg,
    // mL/g and L/kg are numerically identical, so no factor is needed.
    kettleHopAbsorptionL: inputs.kettleHopKg * equipment.hopAbsorptionMlPerG,
    dryHopAbsorptionL: inputs.dryHopKg * equipment.dryHopAbsorptionMlPerG,
    boilOffL: equipment.boilOffRateLPerHour * (inputs.boilTimeMinutes / 60),
    decoctionEvaporationL: Math.max(0, inputs.decoctionEvaporationL ?? 0),
  };
}

/**
 * Split a total water requirement into strike and sparge.
 *
 * Strike water is `mash thickness × grain`, and the sparge makes up the rest.
 * No-sparge and BIAB profiles mash in the full volume, so strike takes
 * everything. If the requested thickness would need more water than the batch
 * calls for, strike is capped at the total and the sparge goes to zero.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function splitStrikeAndSparge(
  totalWaterL: Litres,
  equipment: EquipmentProfile,
  inputs: VolumeInputs,
): {
  /** Water to mash in with, liters. */
  strikeWaterL: Litres;
  /** Water left for the sparge, liters. Zero for no-sparge and BIAB. */
  spargeWaterL: Litres;
} {
  if (isNoSparge(equipment) || inputs.grainKg <= 0) {
    return { strikeWaterL: Math.max(0, totalWaterL), spargeWaterL: 0 };
  }
  const thickness = inputs.mashThicknessLPerKg ?? equipment.mashThicknessLPerKg;
  const desiredStrike = thickness * inputs.grainKg;
  const strikeWaterL = Math.min(desiredStrike, Math.max(0, totalWaterL));
  return { strikeWaterL, spargeWaterL: Math.max(0, totalWaterL - strikeWaterL) };
}

function assemble(
  equipment: EquipmentProfile,
  inputs: VolumeInputs,
  stages: {
    strikeWaterL: Litres;
    spargeWaterL: Litres;
    preBoilVolumeL: Litres;
    postBoilVolumeHotL: Litres;
    postBoilVolumeL: Litres;
    volumeIntoFermenterL: Litres;
    packagedVolumeL: Litres;
  },
): VolumeWaterfall {
  const l = losses(equipment, inputs);
  const totalWaterL = stages.strikeWaterL + stages.spargeWaterL;
  const shrinkageL = stages.postBoilVolumeHotL - stages.postBoilVolumeL;
  return {
    strikeWaterL: stages.strikeWaterL,
    spargeWaterL: stages.spargeWaterL,
    totalWaterL,
    mashVolumeL: stages.strikeWaterL + inputs.grainKg * GRAIN_DISPLACEMENT_L_PER_KG,
    grainAbsorptionL: l.grainAbsorptionL,
    mashTunDeadspaceL: equipment.mashTunDeadspaceL,
    mashTunLossL: equipment.mashTunLossL,
    topUpKettleL: equipment.topUpKettleL,
    decoctionEvaporationL: l.decoctionEvaporationL,
    preBoilVolumeL: stages.preBoilVolumeL,
    boilOffL: l.boilOffL,
    postBoilVolumeHotL: stages.postBoilVolumeHotL,
    shrinkageL,
    postBoilVolumeL: stages.postBoilVolumeL,
    kettleDeadspaceL: equipment.kettleDeadspaceL,
    kettleHopAbsorptionL: l.kettleHopAbsorptionL,
    chillerLossL: equipment.chillerLossL,
    topUpFermenterL: equipment.topUpFermenterL,
    volumeIntoFermenterL: stages.volumeIntoFermenterL,
    fermenterTrubLossL: equipment.fermenterTrubLossL,
    dryHopAbsorptionL: l.dryHopAbsorptionL,
    packagedVolumeL: stages.packagedVolumeL,
    totalLossL:
      l.grainAbsorptionL +
      equipment.mashTunLossL +
      l.decoctionEvaporationL +
      l.boilOffL +
      shrinkageL +
      equipment.kettleDeadspaceL +
      l.kettleHopAbsorptionL +
      equipment.chillerLossL +
      equipment.fermenterTrubLossL +
      l.dryHopAbsorptionL,
  };
}

/**
 * Backwards: from a target batch volume to the water the brewer must measure out.
 *
 * This is the direction used when designing a recipe. `basis` says whether the
 * target is the volume into the fermenter (the usual meaning of "batch size")
 * or the finished packaged volume.
 *
 * @category Gravity and ABV
 * @group Start here
 */
export function planVolumes(
  targetVolumeL: Litres,
  basis: BatchVolumeBasis,
  equipmentInput: EquipmentProfileInput,
  inputs: VolumeInputs,
): VolumeWaterfall {
  const equipment = resolveEquipmentProfile(equipmentInput);
  const l = losses(equipment, inputs);
  const shrinkFactor = 1 - equipment.boilShrinkagePercent / 100;

  const packagedVolumeL =
    basis === 'packaged'
      ? targetVolumeL
      : targetVolumeL - equipment.fermenterTrubLossL - l.dryHopAbsorptionL;
  const volumeIntoFermenterL =
    basis === 'fermenter'
      ? targetVolumeL
      : targetVolumeL + equipment.fermenterTrubLossL + l.dryHopAbsorptionL;

  const postBoilVolumeL =
    volumeIntoFermenterL -
    equipment.topUpFermenterL +
    equipment.kettleDeadspaceL +
    l.kettleHopAbsorptionL +
    equipment.chillerLossL;
  const postBoilVolumeHotL = shrinkFactor > 0 ? postBoilVolumeL / shrinkFactor : postBoilVolumeL;
  const preBoilVolumeL = postBoilVolumeHotL + l.boilOffL;
  const totalWaterL =
    preBoilVolumeL -
    equipment.topUpKettleL +
    l.grainAbsorptionL +
    equipment.mashTunLossL +
    l.decoctionEvaporationL;

  const { strikeWaterL, spargeWaterL } = splitStrikeAndSparge(totalWaterL, equipment, inputs);

  return assemble(equipment, inputs, {
    strikeWaterL,
    spargeWaterL,
    preBoilVolumeL,
    postBoilVolumeHotL,
    postBoilVolumeL,
    volumeIntoFermenterL,
    packagedVolumeL,
  });
}

/**
 * Forwards: from the water actually measured out to what ends up in the keg.
 *
 * The exact inverse of {@link planVolumes}. Feed one the output of the other
 * and you get back where you started.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function projectVolumes(
  water: { readonly strikeWaterL: Litres; readonly spargeWaterL: Litres },
  equipmentInput: EquipmentProfileInput,
  inputs: VolumeInputs,
): VolumeWaterfall {
  const equipment = resolveEquipmentProfile(equipmentInput);
  const l = losses(equipment, inputs);
  const shrinkFactor = 1 - equipment.boilShrinkagePercent / 100;

  const totalWaterL = water.strikeWaterL + water.spargeWaterL;
  const preBoilVolumeL =
    totalWaterL -
    l.grainAbsorptionL -
    equipment.mashTunLossL -
    l.decoctionEvaporationL +
    equipment.topUpKettleL;
  const postBoilVolumeHotL = preBoilVolumeL - l.boilOffL;
  const postBoilVolumeL = postBoilVolumeHotL * shrinkFactor;
  const volumeIntoFermenterL =
    postBoilVolumeL -
    equipment.kettleDeadspaceL -
    l.kettleHopAbsorptionL -
    equipment.chillerLossL +
    equipment.topUpFermenterL;
  const packagedVolumeL = volumeIntoFermenterL - equipment.fermenterTrubLossL - l.dryHopAbsorptionL;

  return assemble(equipment, inputs, {
    strikeWaterL: water.strikeWaterL,
    spargeWaterL: water.spargeWaterL,
    preBoilVolumeL,
    postBoilVolumeHotL,
    postBoilVolumeL,
    volumeIntoFermenterL,
    packagedVolumeL,
  });
}

/**
 * Which volume problem a warning is about. See {@link volumeWarningEntries}.
 *
 * @category Gravity and ABV
 * @group Results
 */
export type VolumeWarningId =
  | 'negative-sparge'
  | 'no-packaged-volume'
  | 'kettle-capacity'
  | 'mash-tun-capacity';

/**
 * One volume warning, tagged so a caller can tell which is which.
 *
 * @category Gravity and ABV
 * @group Results
 */
export interface VolumeWarningEntry {
  /** Which problem this is. */
  readonly id: VolumeWarningId;
  /** The warning as a sentence for the brewer. */
  readonly message: string;
}

/**
 * Volume problems, each tagged with what it is about.
 *
 * {@link volumeWarnings} is this list without the tags, and it's what
 * `calculateRecipe` puts in its free-text `warnings`. The tags are for
 * `recipe-checks`, which reports the two capacity problems as typed findings
 * with their own wording. It also returns the strings those findings replace,
 * so anything showing both lists doesn't show the same problem twice.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function volumeWarningEntries(
  waterfall: VolumeWaterfall,
  equipmentInput: EquipmentProfileInput,
): readonly VolumeWarningEntry[] {
  const equipment = resolveEquipmentProfile(equipmentInput);
  const warnings: VolumeWarningEntry[] = [];
  if (waterfall.spargeWaterL < 0) {
    warnings.push({
      id: 'negative-sparge',
      message: 'Sparge volume is negative: the mash thickness needs more water than the batch.',
    });
  }
  if (waterfall.packagedVolumeL <= 0) {
    warnings.push({
      id: 'no-packaged-volume',
      message: 'Packaged volume is zero or negative: system losses exceed the batch size.',
    });
  }
  if (equipment.kettleVolumeL !== undefined && waterfall.preBoilVolumeL > equipment.kettleVolumeL) {
    warnings.push({
      id: 'kettle-capacity',
      message: `Pre-boil volume ${waterfall.preBoilVolumeL.toFixed(1)} L exceeds the kettle's ${equipment.kettleVolumeL} L.`,
    });
  }
  if (equipment.mashTunVolumeL !== undefined && waterfall.mashVolumeL > equipment.mashTunVolumeL) {
    warnings.push({
      id: 'mash-tun-capacity',
      message: `Mash volume ${waterfall.mashVolumeL.toFixed(1)} L exceeds the mash tun's ${equipment.mashTunVolumeL} L.`,
    });
  }
  return warnings;
}

/**
 * Problems found while planning volumes, as messages for the brewer.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function volumeWarnings(
  waterfall: VolumeWaterfall,
  equipmentInput: EquipmentProfileInput,
): string[] {
  return volumeWarningEntries(waterfall, equipmentInput).map((entry) => entry.message);
}

// ---------------------------------------------------------------------------
// Boil-off and shrinkage helpers
// ---------------------------------------------------------------------------

/**
 * Water evaporated in a boil, litres.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function boilOffVolume(rateLPerHour: number, boilTimeMinutes: Minutes): Litres {
  return rateLPerHour * (boilTimeMinutes / 60);
}

/**
 * Hot wort volume corrected to 20 °C.
 *
 * `V₂₀ = V_hot × (1 − shrinkage%/100)`. 4 % is the conventional figure for
 * boiling → room temperature.
 *
 * ## Relationship to `correctVolumeToReference`
 *
 * This is the planning version of the physics that `./corrections`'
 * `correctVolumeToReference` applies to a measurement. The two agree: water's
 * density ratio between 100 °C and 20 °C is 0.960088, so the physical figure is
 * 3.991 % against the 4 % used here, and `corrections.test.ts` checks they
 * stay within 0.01 percentage points.
 *
 * They're separate functions because they answer different questions. This
 * one takes a percentage from the equipment profile, so a brewer whose rig
 * consistently loses more between flame-out and the measuring jug can raise
 * it and the whole waterfall follows. The correction takes a measured
 * temperature, because a sight glass read at 85 °C needs the contraction for
 * 85 °C, not for boiling.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function applyBoilShrinkage(hotVolumeL: Litres, shrinkagePercent = 4): Litres {
  return hotVolumeL * (1 - shrinkagePercent / 100);
}

/**
 * The inverse of {@link applyBoilShrinkage}: what a cooled volume was when hot.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function removeBoilShrinkage(cooledVolumeL: Litres, shrinkagePercent = 4): Litres {
  const factor = 1 - shrinkagePercent / 100;
  return factor > 0 ? cooledVolumeL / factor : cooledVolumeL;
}

// ---------------------------------------------------------------------------
// Mash thermodynamics
// ---------------------------------------------------------------------------

/**
 * Input to {@link strikeWaterTemperature}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface StrikeTemperatureInput {
  /** Grain temperature at dough-in, °C. */
  readonly grainTempC: Celsius;
  /** Target mash rest temperature, °C. */
  readonly targetMashTempC: Celsius;
  /** Strike water, litres per kilogram of grain. */
  readonly mashThicknessLPerKg: number;
  /** Ratio of grain to water specific heat. Defaults to 0.4. */
  readonly grainSpecificHeatRatio?: number;
  /** Mash tun thermal mass as equivalent litres of water. Defaults to 0. */
  readonly tunThermalMassLEquivalent?: Litres;
  /** Mash tun temperature before dough-in, °C. Only used when the tun has mass. */
  readonly tunTempC?: Celsius;
  /** Grain mass, kg. Only needed when the tun has thermal mass. */
  readonly grainKg?: Kilograms;
}

/**
 * Strike water temperature, °C.
 *
 * From the energy balance `V(T_w − T₂) = c·G·(T₂ − T_g) + M·(T₂ − T_t)`:
 *
 * ```
 * T_w = T₂ + (c / r) × (T₂ − T_g) + M × (T₂ − T_t) / V
 * ```
 *
 * where `r` is litres of water per kilogram of grain, `c ≈ 0.4` is the ratio of
 * grain's specific heat to water's, and `M` is the tun's thermal mass expressed
 * as equivalent litres of water. This is Palmer's strike formula (*How to
 * Brew*, "Mashing") stated in SI: his imperial constant 0.2 is the same 0.4
 * once quarts-per-pound becomes litres-per-kilogram.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function strikeWaterTemperature(input: StrikeTemperatureInput): Celsius {
  const c = input.grainSpecificHeatRatio ?? GRAIN_SPECIFIC_HEAT_RATIO;
  const r = input.mashThicknessLPerKg;
  if (r <= 0) return input.targetMashTempC;
  let temp = input.targetMashTempC + (c / r) * (input.targetMashTempC - input.grainTempC);

  const tunMass = input.tunThermalMassLEquivalent ?? 0;
  if (tunMass > 0 && input.grainKg !== undefined && input.grainKg > 0) {
    const waterL = r * input.grainKg;
    const tunTempC = input.tunTempC ?? input.grainTempC;
    temp += (tunMass * (input.targetMashTempC - tunTempC)) / waterL;
  }
  return temp;
}

/**
 * Input to {@link infusionVolume}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface InfusionInput {
  /** Water already in the mash, litres. */
  readonly currentMashWaterL: Litres;
  /** Grain in the mash, kg. */
  readonly grainKg: Kilograms;
  /** Current rest temperature, °C. */
  readonly currentTempC: Celsius;
  /** Target rest temperature, °C. */
  readonly targetTempC: Celsius;
  /** Temperature of the water being added, °C. Usually near boiling. */
  readonly infusionTempC: Celsius;
  /** Ratio of grain to water specific heat. Defaults to 0.4. */
  readonly grainSpecificHeatRatio?: number;
}

/**
 * Volume of hot water needed to step the mash up, litres.
 *
 * ```
 * V_add = (T₂ − T₁) × (c·G + W) / (T_infusion − T₂)
 * ```
 *
 * Palmer's infusion equation in SI. Returns 0 when the mash is already at or
 * above target. It doesn't throw. Supplying water hotter than the target is
 * the caller's job.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function infusionVolume(input: InfusionInput): Litres {
  const c = input.grainSpecificHeatRatio ?? GRAIN_SPECIFIC_HEAT_RATIO;
  const rise = input.targetTempC - input.currentTempC;
  if (rise <= 0) return 0;
  const head = input.infusionTempC - input.targetTempC;
  if (head <= 0) return Number.POSITIVE_INFINITY;
  return (rise * (c * input.grainKg + input.currentMashWaterL)) / head;
}

/**
 * Input to {@link infusionTemperature}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface InfusionTemperatureInput {
  /** Water already in the mash, litres. */
  readonly currentMashWaterL: Litres;
  /** Grain in the mash, kg. */
  readonly grainKg: Kilograms;
  /** Current rest temperature, °C. */
  readonly currentTempC: Celsius;
  /** Target rest temperature, °C. */
  readonly targetTempC: Celsius;
  /** Volume of water being added, litres. */
  readonly infusionVolumeL: Litres;
  /** Ratio of grain to water specific heat. Defaults to 0.4. */
  readonly grainSpecificHeatRatio?: number;
}

/**
 * Temperature the infusion water must be at for a chosen volume, °C. This is
 * Palmer's infusion equation solved for temperature instead of volume.
 *
 * ```
 * T_infusion = T₂ + (T₂ − T₁) × (c·G + W) / V_add
 * ```
 *
 * Returns `Infinity` when no water is added, because no temperature can raise
 * the mash with no water. Answers above the local boiling point are returned
 * unchanged. Whether the brewer can actually get water that hot is up to the
 * caller to check.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function infusionTemperature(input: InfusionTemperatureInput): Celsius {
  if (input.infusionVolumeL <= 0) return Number.POSITIVE_INFINITY;
  const c = input.grainSpecificHeatRatio ?? GRAIN_SPECIFIC_HEAT_RATIO;
  const rise = input.targetTempC - input.currentTempC;
  return (
    input.targetTempC +
    (rise * (c * input.grainKg + input.currentMashWaterL)) / input.infusionVolumeL
  );
}

/**
 * Input to {@link decoctionVolume}.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export interface DecoctionInput {
  /** Water in the mash, litres. */
  readonly currentMashWaterL: Litres;
  /** Grain in the mash, kg. */
  readonly grainKg: Kilograms;
  /** Current rest temperature, °C. */
  readonly currentTempC: Celsius;
  /** Target rest temperature, °C. */
  readonly targetTempC: Celsius;
  /** Temperature the pulled mash is boiled to, °C. Defaults to 100. */
  readonly boilTempC?: Celsius;
  /** Ratio of grain to water specific heat. Defaults to 0.4. */
  readonly grainSpecificHeatRatio?: number;
}

/**
 * Volume of mash to pull, boil and return to hit the next rest, litres.
 *
 * ```
 * V_decoction = V_mash_equivalent × (T₂ − T₁) / (T_boil − T₁)
 * ```
 *
 * where the mash's water-equivalent volume is `W + c·G`. A thick decoction is
 * conventionally pulled, so the returned figure is the water-equivalent volume
 * of mash, not of liquid alone.
 *
 * ## This is the classic formula. `./decoction` has the full model
 *
 * The formula above assumes the tun doesn't cool while the pull is out, that
 * the pull comes back at a full 100 °C, and that the boil costs no water. None
 * of those are true, and all three push the same way: the pull comes out too
 * small, so the mash undershoots the rest. It also answers in heat capacity,
 * which you can't measure into a pot. Converting it to a pot volume needs the
 * pull's thickness, which this signature doesn't take.
 *
 * So this calls {@link decoctionPull} with those three simplifications
 * applied, which gives the classic result and also tests that
 * {@link decoctionPull} reduces to it. New callers should use
 * {@link decoctionPull} or {@link planDecoctions}. This stays because it's
 * public API and `docs/decoction.md` refers to it.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function decoctionVolume(input: DecoctionInput): Litres {
  const boilTempC = input.boilTempC ?? 100;
  return decoctionPull({
    mashWaterL: input.currentMashWaterL,
    mashGrainKg: input.grainKg,
    currentTempC: input.currentTempC,
    targetTempC: input.targetTempC,
    returnTempC: boilTempC,
    standingLossCPerHour: 0,
    boilOffLPerHour: 0,
    ...(input.grainSpecificHeatRatio !== undefined
      ? { grainSpecificHeatRatio: input.grainSpecificHeatRatio }
      : {}),
  }).heatCapacityLEquivalent;
}

/**
 * Mash thickness that a strike volume implies, litres per kilogram. This is
 * the reverse of the usual calculation, needed for no-sparge and BIAB, where
 * the batch sets the volume and the thickness follows from it.
 *
 * @category Gravity and ABV
 * @group Calculations
 */
export function mashThicknessFromStrike(strikeWaterL: Litres, grainKg: Kilograms): number {
  return grainKg > 0 ? strikeWaterL / grainKg : 0;
}
