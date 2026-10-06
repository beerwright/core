/**
 * The recipe orchestrator.
 *
 * `calculateRecipe` is the entry point. It's a pure function from a recipe, an
 * equipment profile and options to every computed number. It does no I/O, so
 * the same inputs give the same answer wherever it runs.
 *
 * Every headline number comes back with a structured {@link Explanation} of the
 * formula and inputs behind it.
 */

import {
  ABV_FORMULA_EXPRESSIONS,
  ABV_FORMULA_NAMES,
  ABV_FORMULA_SOURCES,
  abv,
  abvAdvanced,
  abvSimple,
} from './abv';
import {
  COLOR_FORMULA_EXPRESSIONS,
  COLOR_FORMULA_NAMES,
  COLOR_FORMULA_SOURCES,
  calculateColor,
  maltColorUnits,
} from './color';
import type { DecoctionPlan, DecoctionScheduleStep } from './decoction';
import { decoctionEvaporation, decoctionWarnings, planDecoctions } from './decoction';
import { resolveCalculationOptions, resolveEquipmentProfile } from './defaults';
import type { Explanation } from './explain';
import { explain } from './explain';
import {
  apparentAttenuationPercent,
  caloriesPer12UsFlOz,
  caloriesPer330ml,
  caloriesPerLitre,
  effectiveMashTempC,
  fermentableEfficiencyFraction,
  fermentablePointLitres,
  fermentablePpg,
  fermentableStage,
  mashGrainMass,
  predictFinalGravity,
  predictGravities,
  realAttenuationPercent,
  realExtractPlato,
  resolveAttenuationPercent,
  totalGristMass,
} from './gravity';
import type { HopIbuContribution } from './ibu';
import {
  bitternessGravity,
  buGuRatio,
  calculateIbu,
  IBU_FORMULA_EXPRESSIONS,
  IBU_FORMULA_NAMES,
  IBU_FORMULA_SOURCES,
  WHIRLPOOL_SOURCES,
} from './ibu';
import { kettleBufferingPerLitreMEqPerPh } from './kettlePh';
import type { MashPhResult, MashPhSolution, WaterAcidificationResult } from './mashPh';
import { acidifyWater, predictMashPh, solveAdditionsForTargetPh } from './mashPh';
import {
  ASBC_METHODS,
  DANIELS_DESIGNING_1996,
  PALMER_HOW_TO_BREW,
  SRM_COLOUR_CHART,
} from './sources';
import type {
  AcidAddition,
  CalculationOptions,
  EquipmentProfileInput,
  FermentableAddition,
  Fraction,
  HopUse,
  Ibu,
  Kilograms,
  Litres,
  MashStep,
  Percent,
  Plato,
  RecipeInput,
  RecipeWaterInput,
  SpecificGravity,
  Srm,
  WaterIon,
  WaterProfile,
} from './types';
import { sgToPlato } from './units/gravity';
import type { VolumeWaterfall } from './volumes';
import { infusionVolume, planVolumes, strikeWaterTemperature, volumeWarnings } from './volumes';
import type { SaltSplit, SulfateChlorideBalance } from './water';
import {
  alkalinityPpm,
  applySalts,
  diluteProfile,
  ION_LABELS,
  RO_WATER,
  residualAlkalinityExplained,
  residualAlkalinityPpm,
  sulfateChlorideBalance,
  sulfateChlorideExplained,
  sulfateChlorideRatio,
  toIonAmounts,
  WATER_IONS,
} from './water';

/**
 * What one fermentable brings to the recipe.
 *
 * @category Recipe
 * @group Results
 */
export interface FermentableContribution {
  /** Position of the fermentable in `recipe.fermentables`. */
  readonly index: number;
  /** The fermentable's id, when the input had one. */
  readonly id?: string;
  /** The fermentable's name. */
  readonly name: string;
  /** Amount of the fermentable, kilograms. */
  readonly amountKg: Kilograms;
  /** Share of the total grist by mass, %. */
  readonly percentOfGrist: Percent;
  /** Yield, points per pound per US gallon. */
  readonly ppg: number;
  /** Efficiency applied to this addition, %. */
  readonly efficiencyPercent: Percent;
  /** Extract delivered, point·litres. */
  readonly pointLitres: number;
  /** Gravity points this addition adds to the OG-equivalent. */
  readonly gravityPoints: number;
  /** Share of the wort's extract, %. */
  readonly percentOfExtract: Percent;
  /** Malt colour units contributed. */
  readonly mcu: number;
  /** Where in the process it lands. */
  readonly stage: 'pre-boil' | 'boil' | 'fermenter';
}

/**
 * The headline numbers for a recipe.
 *
 * @category Recipe
 * @group Results
 */
export interface RecipeVitals {
  /** Gravity of the wort as the boil starts, as specific gravity. */
  readonly preBoilGravity: SpecificGravity;
  /** Gravity at the end of the boil, as specific gravity. */
  readonly postBoilGravity: SpecificGravity;
  /** Original gravity, as specific gravity: what a hydrometer reads on the wort going into the fermenter. */
  readonly og: SpecificGravity;
  /** OG including fermenter sugar additions. ABV is computed from this. */
  readonly ogEquivalent: SpecificGravity;
  /** Predicted final gravity, as specific gravity. */
  readonly fg: SpecificGravity;
  /** Alcohol by volume, %, from the formula `options.abvFormula` picks. */
  readonly abv: Percent;
  /** Both ABV formulas side by side. `abv` is the one `options.abvFormula` picks. */
  readonly abvSimple: Percent;
  /** ABV from the advanced formula, %. */
  readonly abvAdvanced: Percent;
  /** Bitterness, IBU. */
  readonly ibu: Ibu;
  /** Color, SRM. */
  readonly srm: Srm;
  /** Color, EBC. */
  readonly ebc: number;
  /** Approximate sRGB swatch for the colour, `#RRGGBB`. */
  readonly colorHex: string;
  /** Malt color units of the grist, in the volume `options.colorVolumeBasis` picks. */
  readonly mcu: number;
  /** BU:GU, the IBU divided by the gravity units of the OG-equivalent. */
  readonly buGu: number;
  /** Apparent attenuation, %. */
  readonly apparentAttenuationPercent: Percent;
  /** Real attenuation, %. */
  readonly realAttenuationPercent: Percent;
  /** Real extract of the finished beer, °P. */
  readonly realExtractPlato: Plato;
  /** Original extract, °P, from the OG-equivalent. */
  readonly originalExtractPlato: Plato;
  /** Calories per liter of finished beer, kcal. */
  readonly caloriesPerLitre: number;
  /** Calories in a 330 mL serving, kcal. */
  readonly caloriesPer330ml: number;
  /** Calories in a 12 US fl oz serving, kcal. */
  readonly caloriesPer12UsFlOz: number;
  /** Mash efficiency from the equipment profile, %. */
  readonly mashEfficiencyPercent: Percent;
  /** Brewhouse efficiency, %: the extract that reaches the fermenter as a share of the grist's theoretical maximum. */
  readonly brewhouseEfficiencyPercent: Percent;
  /** Yeast attenuation applied, %. */
  readonly yeastAttenuationPercent: Percent;
}

/**
 * How one ion compares with a target profile.
 *
 * @category Recipe
 * @group Results
 */
export interface IonComparison {
  /** The ion being compared. */
  readonly ion: WaterIon;
  /** Display label for the ion, such as `Ca²⁺`. */
  readonly label: string;
  /** The ion in the source water after dilution, ppm. */
  readonly sourcePpm: number;
  /** The ion in the treated total water, ppm. */
  readonly achievedPpm: number;
  /** The ion in the target profile, ppm. */
  readonly targetPpm: number;
  /** `achieved − target`, ppm. */
  readonly deltaPpm: number;
}

/**
 * One vessel's water bill: litres of dilutant, litres of source.
 *
 * @category Recipe
 * @group Results
 */
export interface DilutionShareL {
  /** Dilution water (RO, or whatever `dilutionProfile` names), liters. */
  readonly dilutionWaterL: Litres;
  /** Source water, liters. */
  readonly sourceWaterL: Litres;
}

/**
 * The water and mash-pH section. Only present when the recipe has water data.
 *
 * @category Recipe
 * @group Results
 */
export interface RecipeWaterCalculation {
  /** Water as drawn. */
  readonly sourceProfile: WaterProfile;
  /** Source after RO dilution. */
  readonly dilutedSourceProfile: WaterProfile;
  /** Share of the brewing water that's dilution water, 0 to 1, as the recipe gave it. */
  readonly dilutionFraction: Fraction;
  /** Water in the mash tun, after dilution and salts. */
  readonly mashProfile: WaterProfile;
  /** Sparge water, after dilution and salts. */
  readonly spargeProfile: WaterProfile;
  /** Volume-weighted total, which is what reaches the kettle. */
  readonly totalProfile: WaterProfile;
  /** Mash water volume, liters. */
  readonly mashVolumeL: Litres;
  /** Sparge water volume, liters. */
  readonly spargeVolumeL: Litres;
  /**
   * The dilution in litres: how much RO (or whatever `dilutionProfile` names)
   * goes into the strike + sparge water. The stored fraction is a ratio for the
   * chemistry, but on brew day the brewer measures litres. 40 % of a 30 L
   * liquor is 12 L in jugs from the shop. Zero when nothing is diluted.
   */
  readonly dilutionWaterL: Litres;
  /** The source water left in the blend after the dilutant's share. */
  readonly sourceWaterL: Litres;
  /**
   * The same blend per vessel. Strike and sparge water are usually prepared
   * separately, often hours apart, so each needs its own share of the dilutant
   * measured out. These sum to the totals above. The sparge entry is all zeros
   * for no-sparge and BIAB systems.
   */
  readonly mashDilution: DilutionShareL;
  /** The sparge water's share of the blend. See {@link mashDilution}. */
  readonly spargeDilution: DilutionShareL;
  /** How each salt was divided between the vessels. */
  readonly saltSplit: readonly SaltSplit[];
  /** Total-water alkalinity, ppm as CaCO₃. */
  readonly alkalinityPpmAsCaCO3: number;
  /** Mash-water residual alkalinity, ppm as CaCO₃. */
  readonly residualAlkalinityPpm: number;
  /**
   * SO₄:Cl of the treated total water, or `NaN` when there's no ratio because
   * one ion wasn't measured or both are zero. {@link sulfateChlorideBalance}
   * says which.
   */
  readonly sulfateChlorideRatio: number;
  /** The descriptive band for the treated total water's SO₄:Cl. */
  readonly sulfateChlorideBalance: SulfateChlorideBalance;
  /** The mash-pH prediction, with its per-term breakdown. */
  readonly mashPh: MashPhResult;
  /** The mash pH aimed for: the recipe's own, or {@link DEFAULT_TARGET_MASH_PH}. */
  readonly targetMashPh: number;
  /**
   * How strongly the wort in the kettle is expected to resist an acid dose, in
   * mEq per pH unit per litre of pre-boil wort.
   *
   * It's per litre because the volume that matters is the one the brewer reads
   * off the sight glass on the day, not the planned one. Multiply by the
   * measured pre-boil volume to get `estimateKettleBufferingMEqPerPh`'s answer.
   * We compute it here so sizing a kettle dose doesn't need the pH model run
   * again. See {@link kettleBufferingPerLitreMEqPerPh} for the assumption
   * behind it. It's a first estimate, and the brewer's own before-and-after
   * readings should replace it.
   */
  readonly kettleBufferingMEqPerPhPerLitre: number;
  /**
   * What it would take to reach {@link targetMashPh} with 88 % lactic acid,
   * on top of whatever is already dosed. Absent when the target is already met
   * or the mash pH is undefined.
   */
  readonly mashPhCorrection?: MashPhSolution;
  /** Sparge acidification, when asked for. */
  readonly spargeAcid?: WaterAcidificationResult;
  /** The achieved water against `targetProfile`, when one was supplied. */
  readonly targetComparison?: readonly IonComparison[];
  /** Problems with the water worth telling the brewer about, as sentences. */
  readonly warnings: readonly string[];
}

/**
 * Everything {@link calculateRecipe} returns.
 *
 * @category Recipe
 * @group Results
 */
export interface RecipeCalculation {
  /** The headline numbers. */
  readonly vitals: RecipeVitals;
  /** The volume waterfall, from strike water to packaged beer. */
  readonly volumes: VolumeWaterfall;
  /** What each fermentable brings, in recipe order. */
  readonly fermentables: readonly FermentableContribution[];
  /** Each hop addition's contribution to the bitterness. */
  readonly hops: readonly HopIbuContribution[];
  /** Strike water temperature for the first mash step, °C. Absent for extract recipes. */
  readonly strikeTemperatureC?: number;
  /**
   * Every decoction the mash schedule calls for, sized. Only present when the
   * schedule has a `decoction` step. No other number depends on it for an
   * infusion mash.
   */
  readonly decoctions?: DecoctionPlan;
  /**
   * Water chemistry and mash pH. Only present when `recipe.water` is supplied,
   * and no other number depends on it.
   */
  readonly water?: RecipeWaterCalculation;
  /** Per-number breakdowns, keyed by vital. */
  readonly explain: Readonly<Record<string, Explanation>>;
  /** Problems worth telling the brewer about. */
  readonly warnings: readonly string[];
}

/**
 * The rests of a decoction schedule, with the water each infusion adds.
 *
 * Every rest is listed, not only the decocted ones, because a pull is sized
 * against the rest immediately before it, and that rest is often reached some
 * other way (see {@link planDecoctions}).
 *
 * Infusion volumes come from `infusionVolume`, using near-boiling water unless
 * the step gives a temperature. If a step gives its own volume, we use it.
 *
 * The first rest is included and marked as not decocted. The strike water
 * lands on it, so nothing is pulled or added to reach it. If we dropped it,
 * `DecoctionPull.stepIndex` would index a list one shorter than the schedule
 * and every consumer would have to add one. Keeping it costs one no-op
 * iteration.
 */
function decoctionSchedule(
  steps: readonly MashStep[],
  strikeWaterL: Litres,
  grainKg: Kilograms,
): readonly DecoctionScheduleStep[] {
  const rests = steps.filter((step) => step.type !== 'sparge');
  const out: DecoctionScheduleStep[] = [];
  let mashWaterL = strikeWaterL;
  let currentTempC = rests[0]?.targetTempC ?? 66.7;

  for (const [index, rest] of rests.entries()) {
    let waterAddedL = 0;
    if (rest.type === 'infusion') {
      const infusionTempC = rest.infusionTempC ?? 100;
      const addL =
        rest.infusionVolumeL ??
        infusionVolume({
          currentMashWaterL: mashWaterL,
          grainKg,
          currentTempC,
          targetTempC: rest.targetTempC,
          infusionTempC,
        });
      if (Number.isFinite(addL) && addL > 0) waterAddedL = addL;
    }
    mashWaterL += waterAddedL;
    currentTempC = rest.targetTempC;
    out.push({
      targetTempC: rest.targetTempC,
      // The first rest is where the strike water lands, so nothing is pulled to
      // reach it, whatever the step's type.
      decoction: index > 0 && rest.type === 'decoction',
      waterAddedL,
      ...(rest.decoction !== undefined ? { spec: rest.decoction } : {}),
    });
  }
  return out;
}

/**
 * Compute a recipe's full vitals block.
 *
 * Order of operations: volumes first (everything else is a concentration and
 * needs them), then gravity, then FG, then the numbers that depend on both.
 *
 * @category Recipe
 * @group Start here
 */
export function calculateRecipe(
  recipe: RecipeInput,
  equipmentInput: EquipmentProfileInput = {},
  optionsInput: CalculationOptions = {},
): RecipeCalculation {
  const equipment = resolveEquipmentProfile(equipmentInput);
  const options = resolveCalculationOptions(optionsInput);
  const warnings: string[] = [];

  // --- Volumes -------------------------------------------------------------
  const grainKg = mashGrainMass(recipe.fermentables);
  // A keg hop never goes in the kettle, and what it soaks up is beer, not wort,
  // so we charge it at the dry-hop rate along with other losses after the boil.
  const afterTheKettle = (use: HopUse) => use === 'dry-hop' || use === 'keg';
  const kettleHopKg = recipe.hops
    .filter((h) => !afterTheKettle(h.use))
    .reduce((sum, h) => sum + h.amountKg, 0);
  const dryHopKg = recipe.hops
    .filter((h) => afterTheKettle(h.use))
    .reduce((sum, h) => sum + h.amountKg, 0);
  const firstMashStep = recipe.mashSteps?.[0];
  const mashThicknessLPerKg =
    recipe.mashThicknessLPerKg ?? firstMashStep?.thicknessLPerKg ?? equipment.mashThicknessLPerKg;

  // Water the decoction pots will boil away. `decoctionEvaporation` works this
  // out before the pulls are sized, so it can be a plain term in the waterfall
  // below and the two don't have to be iterated to a fixed point.
  const decoctionSteps = (recipe.mashSteps ?? []).filter((step) => step.type === 'decoction');
  const decoctionEvaporationL = decoctionEvaporation(
    decoctionSteps.map((step) => step.decoction),
    equipment.decoctionBoilOffLPerHour,
  );

  const volumes = planVolumes(
    recipe.batchVolumeL,
    recipe.batchVolumeBasis ?? 'fermenter',
    equipment,
    {
      grainKg,
      kettleHopKg,
      dryHopKg,
      boilTimeMinutes: recipe.boilTimeMinutes,
      mashThicknessLPerKg,
      decoctionEvaporationL,
    },
  );
  warnings.push(...volumeWarnings(volumes, equipment));

  // --- Gravity -------------------------------------------------------------
  const gravity = predictGravities({
    fermentables: recipe.fermentables,
    volumes: {
      preBoilVolumeL: volumes.preBoilVolumeL,
      postBoilVolumeL: volumes.postBoilVolumeL,
      volumeIntoFermenterL: volumes.volumeIntoFermenterL,
    },
    mashEfficiencyPercent: equipment.mashEfficiencyPercent,
    options,
  });

  // --- Final gravity -------------------------------------------------------
  // Fermentability depends on the whole schedule, not only the first step (see
  // `effectiveMashTempC`). The strike-water calculation below doesn't use this
  // figure, because strike water has to hit the first rest, whatever that rest
  // is for.
  const mashTempC = effectiveMashTempC(recipe.mashSteps);
  const yeastAttenuationPercent = resolveAttenuationPercent({
    yeasts: recipe.yeasts,
    mashTempC,
    options,
  });
  const kettleRetentionFraction =
    volumes.postBoilVolumeL > 0 ? volumes.volumeIntoFermenterL / volumes.postBoilVolumeL : 1;
  const finalGravity = predictFinalGravity({
    fermentables: recipe.fermentables,
    ogEquivalent: gravity.ogEquivalent,
    attenuationPercent: yeastAttenuationPercent,
    mashEfficiencyPercent: equipment.mashEfficiencyPercent,
    kettleRetentionFraction,
    options,
  });

  // --- Bitterness ----------------------------------------------------------
  const ibuVolumeL = volumeForBasis(volumes, options.ibuVolumeBasis);
  const gravityForBitterness = bitternessGravity(
    options.bitternessGravityBasis,
    gravity.preBoilGravity,
    gravity.postBoilGravity,
  );
  const ibuResult = calculateIbu({
    hops: recipe.hops,
    volumeL: ibuVolumeL,
    boilGravity: gravityForBitterness,
    boilTimeMinutes: recipe.boilTimeMinutes,
    options,
  });

  // --- Colour --------------------------------------------------------------
  const colorVolumeL = volumeForBasis(volumes, options.colorVolumeBasis);
  const color = calculateColor(recipe.fermentables, colorVolumeL, options.colorFormula);

  // --- Alcohol and the rest ------------------------------------------------
  const og = gravity.ogEquivalent;
  const fg = finalGravity.fg;
  const abvSimpleValue = abvSimple(og, fg);
  const abvAdvancedValue = abvAdvanced(og, fg);
  const abvValue = abv(og, fg, options.abvFormula);

  const vitals: RecipeVitals = {
    preBoilGravity: gravity.preBoilGravity,
    postBoilGravity: gravity.postBoilGravity,
    og: gravity.og,
    ogEquivalent: gravity.ogEquivalent,
    fg,
    abv: abvValue,
    abvSimple: abvSimpleValue,
    abvAdvanced: abvAdvancedValue,
    ibu: ibuResult.ibu,
    srm: color.srm,
    ebc: color.ebc,
    colorHex: color.hex,
    mcu: color.mcu,
    buGu: buGuRatio(ibuResult.ibu, og),
    apparentAttenuationPercent: apparentAttenuationPercent(og, fg),
    realAttenuationPercent: realAttenuationPercent(og, fg),
    realExtractPlato: realExtractPlato(og, fg),
    originalExtractPlato: sgToPlato(og),
    caloriesPerLitre: caloriesPerLitre(og, fg),
    caloriesPer330ml: caloriesPer330ml(og, fg),
    caloriesPer12UsFlOz: caloriesPer12UsFlOz(og, fg),
    mashEfficiencyPercent: equipment.mashEfficiencyPercent,
    brewhouseEfficiencyPercent: gravity.brewhouseEfficiencyPercent,
    yeastAttenuationPercent,
  };

  // --- Per-fermentable breakdown -------------------------------------------
  const gristMass = totalGristMass(recipe.fermentables);
  const fermentables: FermentableContribution[] = recipe.fermentables.map((f, index) => {
    const pointLitres = fermentablePointLitres(f, equipment.mashEfficiencyPercent, options);
    const stage = fermentableStage(f);
    const volumeForStage =
      stage === 'fermenter' ? volumes.volumeIntoFermenterL : volumes.postBoilVolumeL;
    return {
      index,
      ...(f.id !== undefined ? { id: f.id } : {}),
      name: f.name,
      amountKg: f.amountKg,
      percentOfGrist: gristMass > 0 ? (f.amountKg / gristMass) * 100 : 0,
      ppg: fermentablePpg(f, options),
      efficiencyPercent:
        fermentableEfficiencyFraction(f, equipment.mashEfficiencyPercent, options) * 100,
      pointLitres,
      gravityPoints: volumeForStage > 0 ? pointLitres / volumeForStage : 0,
      percentOfExtract:
        gravity.totalPointLitres > 0 ? (pointLitres / gravity.totalPointLitres) * 100 : 0,
      mcu: maltColorUnits([f], colorVolumeL),
      stage,
    };
  });

  // --- Strike temperature --------------------------------------------------
  // Strike water has to hit the first rest the grain meets, even if it's a
  // protein rest, not the schedule's fermentability-weighted mean.
  const firstRestTempC = recipe.mashSteps?.find((s) => s.type !== 'sparge')?.targetTempC;
  const strikeTemperatureC =
    grainKg > 0 && volumes.strikeWaterL > 0
      ? strikeWaterTemperature({
          grainTempC: recipe.grainTemperatureC ?? 20,
          targetMashTempC: firstRestTempC ?? 66.7,
          mashThicknessLPerKg: volumes.strikeWaterL / grainKg,
          tunThermalMassLEquivalent: equipment.mashTunThermalMassLEquivalent,
          tunTempC: equipment.mashTunInitialTempC,
          grainKg,
        })
      : undefined;

  // --- Decoctions ----------------------------------------------------------
  // These are sized against the strike volume, so they come after the
  // waterfall. The evaporation term above is the part that had to come first.
  const decoctions =
    decoctionSteps.length > 0 && grainKg > 0
      ? planDecoctions({
          mashWaterL: volumes.strikeWaterL,
          mashGrainKg: grainKg,
          startTempC: firstRestTempC ?? 66.7,
          steps: decoctionSchedule(recipe.mashSteps ?? [], volumes.strikeWaterL, grainKg),
          grainAbsorptionLPerKg: equipment.grainAbsorptionLPerKg,
          standingLossCPerHour: equipment.mashStandingLossCPerHour,
          boilOffLPerHour: equipment.decoctionBoilOffLPerHour,
          ...(equipment.decoctionPotVolumeL !== undefined
            ? { potVolumeL: equipment.decoctionPotVolumeL }
            : {}),
        })
      : undefined;
  if (decoctions) warnings.push(...decoctionWarnings(decoctions));

  // --- Water chemistry and mash pH -----------------------------------------
  const water = recipe.water
    ? calculateRecipeWater({
        input: recipe.water,
        grist: recipe.fermentables,
        mashVolumeL: volumes.strikeWaterL,
        spargeVolumeL: volumes.spargeWaterL,
        options,
      })
    : undefined;
  if (water) warnings.push(...water.warnings);

  if (recipe.hops.length === 0) {
    warnings.push('No hops in this recipe: IBU is 0.');
  }
  if (!recipe.yeasts || recipe.yeasts.length === 0) {
    warnings.push(
      `No yeast selected: final gravity assumes ${yeastAttenuationPercent} % apparent attenuation.`,
    );
  }

  return {
    vitals,
    volumes,
    fermentables,
    hops: ibuResult.contributions,
    ...(strikeTemperatureC !== undefined ? { strikeTemperatureC } : {}),
    ...(decoctions !== undefined ? { decoctions } : {}),
    ...(water !== undefined ? { water } : {}),
    explain: buildExplanations({
      water,
      recipe,
      vitals,
      volumes,
      options,
      gravityForBitterness,
      ibuVolumeL,
      hopContributions: ibuResult.contributions,
      colorVolumeL,
      grainKg,
      netAttenuationPercent: finalGravity.netApparentAttenuationPercent,
      maxPointLitres: gravity.maxPointLitres,
      totalPointLitres: gravity.totalPointLitres,
    }),
    warnings,
  };
}

/**
 * Default target mash pH when a recipe doesn't give one, the middle of the 5.2–5.6 window.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const DEFAULT_TARGET_MASH_PH = 5.4;

/**
 * Build the water/mash-pH section.
 *
 * Order matters: dilute the source, dose the salts, then predict the pH from
 * the resulting mash water. Alkalinity from baking soda, chalk or slaked lime
 * reaches the pH model through the mash water profile, and acids reach it
 * through the acid list. The two paths don't overlap, so alkaline salts aren't
 * counted twice.
 *
 * An acid dosed at `total` is split between mash and sparge by volume before it
 * reaches the pH model, because only the mash share affects mash pH.
 *
 * @internal
 * @category Recipe
 */
export function calculateRecipeWater(args: {
  readonly input: RecipeWaterInput;
  readonly grist: readonly FermentableAddition[];
  readonly mashVolumeL: Litres;
  readonly spargeVolumeL: Litres;
  readonly options: ReturnType<typeof resolveCalculationOptions>;
}): RecipeWaterCalculation {
  const { input, grist, mashVolumeL, spargeVolumeL, options } = args;
  const totalVolumeL = mashVolumeL + spargeVolumeL;
  const mashShare = totalVolumeL > 0 ? mashVolumeL / totalVolumeL : 1;
  const dilutionFraction = input.dilutionFraction ?? 0;
  const dilutant = input.dilutionProfile ?? RO_WATER;
  // Clamped the same way `diluteProfile` clamps, so the litres and the ions
  // always describe the same blend.
  const clampedDilution = Math.min(Math.max(dilutionFraction, 0), 1);
  const dilutionWaterL = clampedDilution * totalVolumeL;
  const shareOf = (volumeL: Litres): DilutionShareL => ({
    dilutionWaterL: clampedDilution * volumeL,
    sourceWaterL: (1 - clampedDilution) * volumeL,
  });

  const dilutedSourceProfile = diluteProfile(input.sourceProfile, dilutionFraction, dilutant);
  const spargeSource = input.spargeSourceProfile
    ? diluteProfile(input.spargeSourceProfile, dilutionFraction, dilutant)
    : dilutedSourceProfile;

  const treated = applySalts({
    source: dilutedSourceProfile,
    additions: input.saltAdditions ?? [],
    volumes: { mashVolumeL, spargeVolumeL },
    spargeSource,
  });

  // Acids that act on the mash, with `total` doses pro-rated by volume.
  const mashAcids: AcidAddition[] = [];
  for (const acid of input.acidAdditions ?? []) {
    const target = acid.target ?? 'mash';
    if (target === 'sparge') continue;
    const share = target === 'total' ? mashShare : 1;
    mashAcids.push(scaleAcidAddition(acid, share));
  }

  const mashPh = predictMashPh({
    grist,
    water: treated.mash,
    mashVolumeL,
    acidAdditions: mashAcids,
    options: options.mashPh,
  });

  const targetMashPh = input.targetMashPh ?? DEFAULT_TARGET_MASH_PH;
  const mashPhCorrection =
    Number.isFinite(mashPh.ph) && Math.abs(mashPh.ph - targetMashPh) > 0.005
      ? solveAdditionsForTargetPh({
          targetPh: targetMashPh,
          agent:
            mashPh.ph > targetMashPh
              ? { kind: 'acid', acid: 'lactic' }
              : { kind: 'alkali', salt: 'baking-soda' },
          grist,
          water: treated.mash,
          mashVolumeL,
          existingAcidAdditions: mashAcids,
          options: options.mashPh,
        })
      : undefined;

  const spargeAcid =
    input.acidifySparge && spargeVolumeL > 0
      ? acidifyWater({
          profile: treated.sparge,
          volumeL: spargeVolumeL,
          targetPh: input.spargeTargetPh ?? 5.5,
          acid: input.spargeAcid ?? 'lactic',
          ...(input.spargeAcidConcentrationPercent !== undefined
            ? { concentrationPercent: input.spargeAcidConcentrationPercent }
            : {}),
          assumedSourceWaterPh: options.mashPh.assumedSourceWaterPh,
        })
      : undefined;

  const targetComparison = input.targetProfile
    ? compareToTarget(dilutedSourceProfile, treated.total, input.targetProfile)
    : undefined;

  const warnings = [
    ...treated.warnings,
    ...mashPh.warnings,
    ...(spargeAcid?.warnings ?? []),
    ...(dilutionFraction > 0 && dilutionFraction < 1
      ? [`Brewing water is ${(dilutionFraction * 100).toFixed(0)} % RO by volume.`]
      : []),
  ];

  return {
    sourceProfile: input.sourceProfile,
    dilutedSourceProfile,
    dilutionFraction,
    mashProfile: treated.mash,
    spargeProfile: treated.sparge,
    totalProfile: treated.total,
    mashVolumeL,
    spargeVolumeL,
    dilutionWaterL,
    sourceWaterL: totalVolumeL - dilutionWaterL,
    mashDilution: shareOf(mashVolumeL),
    spargeDilution: shareOf(spargeVolumeL),
    saltSplit: treated.split,
    alkalinityPpmAsCaCO3: alkalinityPpm(treated.total),
    residualAlkalinityPpm: residualAlkalinityPpm(treated.mash),
    sulfateChlorideRatio: sulfateChlorideRatio(treated.total),
    sulfateChlorideBalance: sulfateChlorideBalance(treated.total),
    mashPh,
    targetMashPh,
    kettleBufferingMEqPerPhPerLitre: kettleBufferingPerLitreMEqPerPh({
      gristBufferingMEqPerPh: mashPh.totalBufferingMEqPerPh,
      mashProfile: treated.mash,
      mashVolumeL,
      spargeProfile: treated.sparge,
      spargeVolumeL,
      // The water's carbonate slope should be read at the wort's pH leaving the
      // mash. If the grist isn't mashed there's no prediction, so we use the
      // target.
      ph: Number.isFinite(mashPh.ph) ? mashPh.ph : targetMashPh,
    }),
    ...(mashPhCorrection !== undefined ? { mashPhCorrection } : {}),
    ...(spargeAcid !== undefined ? { spargeAcid } : {}),
    ...(targetComparison !== undefined ? { targetComparison } : {}),
    warnings: [...new Set(warnings)],
  };
}

function scaleAcidAddition(acid: AcidAddition, share: number): AcidAddition {
  if (share === 1) return acid;
  return {
    acid: acid.acid,
    ...(acid.millilitres !== undefined ? { millilitres: acid.millilitres * share } : {}),
    ...(acid.grams !== undefined ? { grams: acid.grams * share } : {}),
    ...(acid.concentrationPercent !== undefined
      ? { concentrationPercent: acid.concentrationPercent }
      : {}),
    target: 'mash',
  };
}

function compareToTarget(
  source: WaterProfile,
  achieved: WaterProfile,
  target: WaterProfile,
): readonly IonComparison[] {
  const s = toIonAmounts(source);
  const a = toIonAmounts(achieved);
  const t = toIonAmounts(target);
  return WATER_IONS.map((ion) => ({
    ion,
    label: ION_LABELS[ion],
    sourcePpm: s[ion],
    achievedPpm: a[ion],
    targetPpm: t[ion],
    deltaPpm: a[ion] - t[ion],
  }));
}

function volumeForBasis(
  volumes: VolumeWaterfall,
  basis: 'pre-boil' | 'post-boil' | 'fermenter',
): Litres {
  switch (basis) {
    case 'pre-boil':
      return volumes.preBoilVolumeL;
    case 'fermenter':
      return volumes.volumeIntoFermenterL;
    default:
      return volumes.postBoilVolumeL;
  }
}

interface ExplanationContext {
  readonly water: RecipeWaterCalculation | undefined;
  readonly recipe: RecipeInput;
  readonly vitals: RecipeVitals;
  readonly volumes: VolumeWaterfall;
  readonly options: ReturnType<typeof resolveCalculationOptions>;
  readonly gravityForBitterness: SpecificGravity;
  readonly ibuVolumeL: Litres;
  readonly hopContributions: readonly HopIbuContribution[];
  readonly colorVolumeL: Litres;
  readonly grainKg: Kilograms;
  readonly netAttenuationPercent: Percent;
  readonly maxPointLitres: number;
  readonly totalPointLitres: number;
}

function buildExplanations(ctx: ExplanationContext): Record<string, Explanation> {
  const { vitals, volumes, options } = ctx;
  const round = (n: number, dp = 4) => Number(n.toFixed(dp));
  const water = ctx.water;

  return {
    ...(water
      ? {
          mashPh: water.mashPh.explain,
          residualAlkalinity: residualAlkalinityExplained(water.mashProfile),
          sulfateChloride: sulfateChlorideExplained(water.totalProfile),
          ...(water.mashPhCorrection ? { mashPhCorrection: water.mashPhCorrection.explain } : {}),
          ...(water.spargeAcid ? { spargeAcid: water.spargeAcid.explain } : {}),
        }
      : {}),
    preBoilGravity: explain(vitals.preBoilGravity, {
      label: 'Pre-boil gravity',
      formula: 'extract-bookkeeping',
      expression: 'SG = 1 + (Σ kg × PPG × 8.345404 × efficiency) / preBoilVolume / 1000',
      inputs: {
        preBoilVolumeL: round(volumes.preBoilVolumeL, 2),
        mashEfficiencyPercent: vitals.mashEfficiencyPercent,
      },
      unit: 'SG',
      family: 'gravity',
      sources: [PALMER_HOW_TO_BREW],
    }),
    og: explain(vitals.og, {
      label: 'Original gravity',
      formula: 'extract-bookkeeping',
      expression: 'SG = 1 + (Σ kg × PPG × 8.345404 × efficiency) / postBoilVolume / 1000',
      inputs: {
        postBoilVolumeL: round(volumes.postBoilVolumeL, 2),
        mashEfficiencyPercent: vitals.mashEfficiencyPercent,
        totalPointLitres: round(ctx.totalPointLitres, 1),
        theoreticalMaxPointLitres: round(ctx.maxPointLitres, 1),
      },
      unit: 'SG',
      notes:
        vitals.ogEquivalent !== vitals.og
          ? [
              `Fermenter additions raise the OG-equivalent to ${vitals.ogEquivalent.toFixed(4)}; a hydrometer at pitching reads ${vitals.og.toFixed(4)}.`,
            ]
          : undefined,
      family: 'gravity',
      sources: [PALMER_HOW_TO_BREW],
    }),
    fg: explain(vitals.fg, {
      label: 'Final gravity',
      formula: 'weighted-apparent-attenuation',
      expression: 'AE = OE × (1 − Σ(extract × attenuation) / Σ extract); FG = SG(AE)',
      inputs: {
        ogEquivalent: round(vitals.ogEquivalent),
        originalExtractPlato: round(vitals.originalExtractPlato, 2),
        yeastAttenuationPercent: round(vitals.yeastAttenuationPercent, 1),
        netAttenuationPercent: round(ctx.netAttenuationPercent, 1),
      },
      unit: 'SG',
      notes:
        Math.abs(ctx.netAttenuationPercent - vitals.yeastAttenuationPercent) > 0.05
          ? [
              `Net attenuation (${ctx.netAttenuationPercent.toFixed(1)} %) differs from the yeast's ${vitals.yeastAttenuationPercent.toFixed(1)} % because of sugars or non-fermentables in the grist.`,
            ]
          : undefined,
      family: 'gravity',
      sources: [ASBC_METHODS, PALMER_HOW_TO_BREW],
    }),
    abv: explain(vitals.abv, {
      label: 'Alcohol by volume',
      formula: ABV_FORMULA_NAMES[options.abvFormula],
      expression: ABV_FORMULA_EXPRESSIONS[options.abvFormula],
      inputs: { og: round(vitals.ogEquivalent), fg: round(vitals.fg) },
      unit: '%',
      notes: [
        `The other formula gives ${(options.abvFormula === 'advanced' ? vitals.abvSimple : vitals.abvAdvanced).toFixed(2)} %.`,
      ],
      family: 'alcohol',
      sources: ABV_FORMULA_SOURCES[options.abvFormula],
    }),
    ibu: explain(vitals.ibu, {
      label: 'Bitterness',
      formula: IBU_FORMULA_NAMES[options.ibuFormula],
      expression: IBU_FORMULA_EXPRESSIONS[options.ibuFormula],
      inputs: {
        volumeL: round(ctx.ibuVolumeL, 2),
        volumeBasis: options.ibuVolumeBasis,
        boilGravity: round(ctx.gravityForBitterness),
        gravityBasis: options.bitternessGravityBasis,
        whirlpoolModel: options.whirlpool.model,
        hopCount: ctx.recipe.hops.length,
      },
      unit: 'IBU',
      // Whirlpool stands first, in recipe order, then the dry-hop line. Boil
      // additions don't get a line, because the formula above already covers
      // their minutes.
      notes: [
        ...ctx.hopContributions.flatMap((hop) =>
          hop.standDescription === null ? [] : [hop.standDescription],
        ),
        'Dry hops contribute 0 IBU.',
      ],
      family: 'bitterness',
      sources: [
        ...IBU_FORMULA_SOURCES[options.ibuFormula],
        ...(options.whirlpool.model === 'none' ? [] : WHIRLPOOL_SOURCES),
      ],
    }),
    srm: explain(vitals.srm, {
      label: 'Color',
      formula: COLOR_FORMULA_NAMES[options.colorFormula],
      expression: COLOR_FORMULA_EXPRESSIONS[options.colorFormula],
      inputs: {
        mcu: round(vitals.mcu, 2),
        volumeL: round(ctx.colorVolumeL, 2),
        volumeBasis: options.colorVolumeBasis,
      },
      unit: 'SRM',
      notes: [`EBC = SRM × 1.97 = ${vitals.ebc.toFixed(1)}.`],
      family: 'color',
      sources: [...COLOR_FORMULA_SOURCES[options.colorFormula], SRM_COLOUR_CHART],
    }),
    buGu: explain(vitals.buGu, {
      label: 'BU:GU',
      formula: 'bu-gu-ratio',
      expression: 'BU:GU = IBU / ((OG − 1) × 1000)',
      inputs: { ibu: round(vitals.ibu, 1), og: round(vitals.ogEquivalent) },
      unit: 'ratio',
      family: 'bitterness',
      sources: [DANIELS_DESIGNING_1996],
    }),
    calories: explain(vitals.caloriesPer12UsFlOz, {
      label: 'Calories per 12 US fl oz',
      formula: 'abw-real-extract-calories',
      expression: 'kcal/12oz = [6.9 × ABW + 4.0 × (RE − 0.1)] × FG × 3.55',
      inputs: {
        realExtractPlato: round(vitals.realExtractPlato, 2),
        og: round(vitals.ogEquivalent),
        fg: round(vitals.fg),
      },
      unit: 'kcal',
      notes: [`330 mL serving = ${round(vitals.caloriesPer330ml, 0)} kcal.`],
      family: 'alcohol',
      sources: [ASBC_METHODS],
    }),
    brewhouseEfficiency: explain(vitals.brewhouseEfficiencyPercent, {
      label: 'Brewhouse efficiency',
      formula: 'extract-into-fermenter',
      expression: 'brewhouse% = 100 × (OG points × fermenter volume) / Σ theoretical point·liters',
      inputs: {
        mashEfficiencyPercent: vitals.mashEfficiencyPercent,
        volumeIntoFermenterL: round(volumes.volumeIntoFermenterL, 2),
        theoreticalMaxPointLitres: round(ctx.maxPointLitres, 1),
      },
      unit: '%',
      notes: [
        'The gap to mash efficiency is kettle deadspace, hop absorption, chiller loss and trub.',
      ],
      family: 'gravity',
      sources: [PALMER_HOW_TO_BREW],
    }),
    volumes: explain(volumes.packagedVolumeL, {
      label: 'Packaged volume',
      formula: 'volume-waterfall',
      expression:
        'strike + sparge − absorption − tun loss − boil-off − shrinkage − kettle losses − trub',
      inputs: {
        strikeWaterL: round(volumes.strikeWaterL, 2),
        spargeWaterL: round(volumes.spargeWaterL, 2),
        grainAbsorptionL: round(volumes.grainAbsorptionL, 2),
        boilOffL: round(volumes.boilOffL, 2),
        shrinkageL: round(volumes.shrinkageL, 2),
        kettleHopAbsorptionL: round(volumes.kettleHopAbsorptionL, 3),
        volumeIntoFermenterL: round(volumes.volumeIntoFermenterL, 2),
        grainKg: round(ctx.grainKg, 3),
      },
      unit: 'L',
      family: 'volumes',
      sources: [PALMER_HOW_TO_BREW],
    }),
  };
}
