/**
 * Calculation-domain types for the brewing engine.
 *
 * These are the inputs the calculations take. They aren't a stored recipe
 * document: the caller maps a stored recipe onto these shapes, copying in
 * catalog values at the time of use.
 *
 * ## Canonical units
 *
 * Every field in this file is documented with its unit, and the engine uses
 * only these units internally:
 *
 * | Quantity     | Canonical unit                          |
 * | ------------ | --------------------------------------- |
 * | Mass         | kilograms (`kg`)                        |
 * | Volume       | litres (`L`)                            |
 * | Temperature  | degrees Celsius (`°C`)                  |
 * | Time         | minutes (`min`), days for dry hop/ferm  |
 * | Gravity      | specific gravity at 20 °C (`SG`)        |
 * | Colour       | degrees Lovibond (`°L`) in, SRM/EBC out |
 * | Ion content  | parts per million (`ppm` = mg/L)        |
 * | Percentages  | 0–100 (never 0–1) unless named `…Fraction` |
 *
 * Callers convert to and from them at the edges; see `./units`.
 */

// ---------------------------------------------------------------------------
// Unit-tagged numeric aliases
//
// These are plain aliases for documentation. They aren't branded types because
// the engine is mostly arithmetic, and branding every scalar would make the
// maths hard to read. The alias name tells you the unit.
// ---------------------------------------------------------------------------

/**
 * Mass in kilograms.
 *
 * @category Units
 * @group Inputs
 */
export type Kilograms = number;

/**
 * Volume in litres.
 *
 * @category Units
 * @group Inputs
 */
export type Litres = number;

/**
 * Temperature in degrees Celsius.
 *
 * @category Units
 * @group Inputs
 */
export type Celsius = number;

/**
 * A duration in minutes.
 *
 * @category Units
 * @group Inputs
 */
export type Minutes = number;

/**
 * A duration in days.
 *
 * @category Units
 * @group Inputs
 */
export type Days = number;

/**
 * Specific gravity at 20 °C / 20 °C, e.g. `1.048`.
 *
 * @category Units
 * @group Inputs
 */
export type SpecificGravity = number;

/**
 * Degrees Plato (mass % extract).
 *
 * @category Units
 * @group Inputs
 */
export type Plato = number;

/**
 * A percentage expressed 0–100.
 *
 * @category Units
 * @group Inputs
 */
export type Percent = number;

/**
 * A ratio expressed 0–1.
 *
 * @category Units
 * @group Inputs
 */
export type Fraction = number;

/**
 * Colour in degrees Lovibond.
 *
 * @category Units
 * @group Inputs
 */
export type Lovibond = number;

/**
 * Bitterness in International Bitterness Units (mg/L iso-alpha-acid equivalent).
 *
 * @category Units
 * @group Inputs
 */
export type Ibu = number;

/**
 * Colour on the Standard Reference Method scale.
 *
 * @category Units
 * @group Inputs
 */
export type Srm = number;

// ---------------------------------------------------------------------------
// Fermentables
// ---------------------------------------------------------------------------

/**
 * How a fermentable behaves in the brewhouse and in the fermenter.
 *
 * The class drives two defaults: the extraction efficiency that applies to it
 * (`grain` gets mash efficiency, `steeping-grain` a partial efficiency,
 * everything else 100 %) and how much of its extract the yeast can consume
 * (see {@link FermentableAddition.fermentabilityPercent}).
 *
 * @category Recipe
 * @group Inputs
 */
export type FermentableClass =
  /** Malted or unmalted grain that must be mashed (base malt, flaked adjuncts). */
  | 'grain'
  /** Crystal/roasted malt whose extract is available without conversion. */
  | 'steeping-grain'
  /** Dry malt extract (DME). */
  | 'dry-extract'
  /** Liquid malt extract (LME). */
  | 'liquid-extract'
  /** Simple sugar the yeast ferments essentially completely (sucrose, dextrose, honey). */
  | 'sugar'
  /** Dissolves and raises gravity but the yeast cannot touch it (lactose, maltodextrin). */
  | 'non-fermentable';

/**
 * Where in the process a fermentable is added.
 *
 * @category Recipe
 * @group Inputs
 */
export type FermentableUse =
  /** In the mash tun, subject to mash efficiency. */
  | 'mash'
  /** Steeped (no conversion), subject to the partial steep efficiency. */
  | 'steep'
  /** Dissolved in the boil — in the kettle before the end of the boil. */
  | 'boil'
  /** Added at flameout / during the whirlpool. */
  | 'whirlpool'
  /** Added to the fermenter after the wort is chilled and transferred. */
  | 'fermenter';

/**
 * Which titration curve a malt follows in the mash-pH model.
 *
 * The class picks the default DI pH and buffering capacity. Measured values
 * from a catalog entry override both, through the other fields on
 * {@link FermentablePhProperties}. `none` means the fermentable adds no acidity
 * and no buffering. It's used for sugars, and for extracts, whose wort pH is
 * already set.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type MaltPhClass =
  /** Pilsner, pale ale, 2-row, Maris Otter — the diastatic base malts. */
  | 'base'
  /** Munich, Vienna, aromatic, melanoidin — kilned darker, measurably more acidic. */
  | 'munich-vienna'
  /** Wheat, rye, oats and unmalted adjuncts — less acidic than barley base malt. */
  | 'wheat-other'
  /** Crystal/caramel malts, whose acidity tracks their colour. */
  | 'crystal'
  /** Chocolate, black, roasted barley, Carafa — the most acidic malts in the grist. */
  | 'roasted'
  /** Acidulated / Sauermalz: base malt carrying lactic acid. */
  | 'acidulated'
  /** No contribution to mash pH. */
  | 'none';

/**
 * Mash-pH properties.
 *
 * Every field is optional and overrides the class default. The catalog supplies
 * measured values where a maltster publishes them; otherwise the class-based
 * defaults in `mashPh.ts` apply.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface FermentablePhProperties {
  /** Which titration curve to use. Inferred from class, colour and name when absent. */
  readonly maltClass?: MaltPhClass;
  /** pH of a distilled-water mash of this malt, pH units. */
  readonly distilledWaterPh?: number;
  /** Buffering capacity, mEq of acid per kg per pH unit. */
  readonly bufferingCapacityMEqPerKgPerPh?: number;
  /** Acid content for acidulated malt, % lactic acid by mass. */
  readonly acidContentPercentLactic?: Percent;
}

/**
 * One fermentable addition in a recipe, carrying catalog-style spec fields.
 *
 * Provide **either** {@link extractFineGrindDryBasisPercent} (the maltster's
 * published FGDB figure) **or** {@link ppg}. When both are present `ppg` wins,
 * because it's the value the user entered as an override.
 *
 * @category Recipe
 * @group Inputs
 */
export interface FermentableAddition {
  /** Catalog id or a client-side uuid. Opaque to the engine. */
  readonly id?: string;
  /** Display name, e.g. "Weyermann Pilsner". */
  readonly name: string;
  /** Amount, **kilograms**. */
  readonly amountKg: Kilograms;
  /** Behaviour class — drives efficiency and fermentability defaults. */
  readonly class: FermentableClass;
  /** Point in the process where it is added. */
  readonly use: FermentableUse;
  /**
   * Fine-grind dry-basis extract, **% of dry mass** (e.g. `80.5`).
   * The maltster's headline yield figure.
   */
  readonly extractFineGrindDryBasisPercent?: Percent;
  /**
   * Fine/coarse difference, **percentage points** subtracted from FGDB to get
   * the coarse-grind figure a homebrew mill actually achieves. Defaults to 0
   * (i.e. assume the catalog figure is already the usable one).
   */
  readonly fineCoarseDifferencePercent?: Percent;
  /**
   * Moisture, **% of as-is mass** (e.g. `4`). Defaults by class — see
   * `DEFAULT_MOISTURE_PERCENT_BY_CLASS`.
   */
  readonly moisturePercent?: Percent;
  /**
   * Yield as **points per pound per US gallon**, as-is (e.g. `37`).
   * It's a US customary unit, but we keep it because every catalog and every
   * competing app publishes it. Converted to points·L/kg internally.
   */
  readonly ppg?: number;
  /** Colour, **degrees Lovibond**. */
  readonly colorLovibond: Lovibond;
  /**
   * Override: **% of this fermentable's extract the yeast consumes** (0–100).
   * Defaults by class — `sugar` 100, `non-fermentable` 0, everything else
   * "whatever the yeast's apparent attenuation is".
   */
  readonly fermentabilityPercent?: Percent;
  /** Diastatic power in °Lintner. None of the calculations use it yet. */
  readonly diastaticPowerLintner?: number;
  /** Mash pH data for this malt. If it's set, it overrides the defaults for the malt's class in mashPh.ts. */
  readonly ph?: FermentablePhProperties;
}

// ---------------------------------------------------------------------------
// Hops
// ---------------------------------------------------------------------------

/**
 * Physical form of the hop, which changes utilisation.
 *
 * The first four are cone-derived and all isomerise on the same curve; they
 * differ only by the surface area the wort sees, which is what
 * `hopFormMultipliers` expresses. The last two are not:
 *
 * - `co2-extract` — pure resin, added to the kettle. It still isomerises in the
 *   boil, so it's treated as an ordinary Tinseth hop with a very high alpha.
 * - `iso-extract` — **pre-isomerised**. The utilisation curve doesn't describe
 *   this form at all. See {@link HopAddition.isoAlphaPercent}.
 * - `aroma-extract` — a cold-side flavour product with the alpha acid removed.
 *   It adds no bitterness, and the maths handles that without a special case:
 *   its alpha is zero, so every model returns zero. The form exists so a
 *   recipe can record what the product is instead of calling it a pellet.
 *
 * @category Hops
 * @group Inputs
 */
export type HopForm =
  | 'whole'
  | 'plug'
  | 'pellet'
  | 'cryo'
  | 'co2-extract'
  | 'iso-extract'
  | 'aroma-extract';

/**
 * Where in the process a hop is added.
 *
 * @category Hops
 * @group Inputs
 */
export type HopUse =
  /** Added to the mash runnings before the boil starts. */
  | 'first-wort'
  /** In the boil for {@link HopAddition.timeMinutes} minutes. */
  | 'boil'
  /** Whirlpool / hop stand after flameout. */
  | 'whirlpool'
  /** In the fermenter. Contributes 0 IBU. */
  | 'dry-hop'
  /**
   * In the keg. Contributes 0 IBU, like a dry hop. It has no time, because
   * the beer sits on it until the keg is empty and there's no contact time
   * to measure.
   */
  | 'keg';

/**
 * One hop addition in a recipe.
 *
 * @category Hops
 * @group Inputs
 */
export interface HopAddition {
  /** Catalog id or a client-side uuid. Opaque to the engine. */
  readonly id?: string;
  /** Display name, e.g. "Citra". */
  readonly name: string;
  /** Amount, **kilograms** (a 28 g addition is `0.028`). */
  readonly amountKg: Kilograms;
  /** Alpha acid content, **% by mass** (e.g. `12.5`). Set per addition because lots vary. */
  readonly alphaAcidPercent: Percent;
  /** Physical form. Drives the utilisation multiplier. */
  readonly form: HopForm;
  /** Where it goes. */
  readonly use: HopUse;
  /**
   * **Minutes**. For `boil` this is boil time remaining; for `whirlpool` it is
   * the stand duration; for `first-wort` it is ignored (the full boil applies);
   * for `dry-hop` it is ignored (see {@link dryHopDays}); for `keg` there is
   * no duration to record at all.
   */
  readonly timeMinutes: Minutes;
  /** Dry-hop contact time, **days**. Informational — dry hops are always 0 IBU. */
  readonly dryHopDays?: Days;
  /**
   * Whirlpool/hop-stand temperature at the *start* of the stand, **°C**.
   * Defaults to `DEFAULT_WHIRLPOOL_TEMP_C` (80 °C) when omitted.
   */
  readonly whirlpoolTempC?: Celsius;
  /**
   * Wort temperature when the stand *ends*, **°C**, or omitted.
   *
   * We ask for an end temperature and not a cooling constant, because a brewer
   * knows where the kettle finished. One number covers three cases. Omitted
   * uses the model's default curve. Equal to {@link whirlpoolTempC} means a
   * stand held at one temperature, as in a recirculating whirlpool. Below it
   * means a kettle that cooled that far, and we solve the cooling constant so
   * the curve ends there. An end above the start, or at or below ambient,
   * isn't a cooling curve and is treated as held at the start.
   */
  readonly whirlpoolEndTempC?: Celsius;
  /** Beta acid in % by mass. None of the calculations use it yet. */
  readonly betaAcidPercent?: Percent;
  /** Total oil in mL/100 g. None of the calculations use it yet. */
  readonly totalOilMlPer100g?: number;
  /**
   * Iso-alpha-acid content, **% by mass**. Only read when `form` is
   * `iso-extract`, and required there in practice.
   *
   * This is separate from {@link alphaAcidPercent} because they're different
   * quantities. Alpha acid is what isomerises in the kettle, and iso-alpha has
   * already isomerised. Reading one as the other makes a beer come out about a
   * fifth as bitter as intended, without any sign that something is wrong.
   * When it's absent we fall back to `alphaAcidPercent` and add a note saying
   * which number was used, which is more useful than refusing to calculate.
   */
  readonly isoAlphaPercent?: Percent;
}

// ---------------------------------------------------------------------------
// Yeast
// ---------------------------------------------------------------------------

/**
 * Yeast family. Drives the default pitch rate.
 *
 * @category Yeast
 * @group Inputs
 */
export type YeastType = 'ale' | 'lager' | 'wheat' | 'wine' | 'brett' | 'other';

/**
 * Packaging form. Drives the viability decay model.
 *
 * @category Yeast
 * @group Inputs
 */
export type YeastForm = 'dry' | 'liquid';

/**
 * How the starter is kept moving while it ferments.
 *
 * This is defined here and not in `starter-growth.ts`, where its bands are,
 * because {@link YeastSelection} carries one. This file holds the types every
 * other module uses, and it imports nothing.
 *
 * @category Yeast
 * @group Inputs
 */
export type StarterMethod =
  /** Magnetic stir plate, continuous. Braukaiser's model was measured on one. */
  | 'stir-plate'
  /** Swirled or shaken whenever the brewer walks past. */
  | 'shaken'
  /** Left alone on the counter. */
  | 'still';

/**
 * A starter the brewer plans to build for one culture before pitching it.
 *
 * This holds the inputs only, not the yield. `pitchPlan` runs the steps
 * through the starter-growth model to compute the cell count, which is also
 * why a pack carries a manufacture date and not a viability percentage.
 *
 * @category Yeast
 * @group Inputs
 */
export interface YeastStarter {
  /**
   * Step volumes in order, **litres**. One step, or two.
   *
   * Step one is pitched with the viable cells from the packs. Each later step is
   * pitched with the whole output of the step before, as when the brewer
   * decants and pitches the slurry.
   */
  readonly stepVolumesL: readonly number[];
  /** Agitation, which decides which of Braukaiser's growth bands applies. */
  readonly method: StarterMethod;
}

/**
 * A yeast selection for a recipe.
 *
 * @category Yeast
 * @group Inputs
 */
export interface YeastSelection {
  /** Catalog id or a client-side uuid. Opaque to the engine. */
  readonly id?: string;
  /** Display name, e.g. "Wyeast 1056 American Ale". */
  readonly name: string;
  /** Family. */
  readonly type: YeastType;
  /** Packaging form. Defaults to `liquid`. */
  readonly form?: YeastForm;
  /** Published minimum apparent attenuation, **%**. */
  readonly attenuationMinPercent: Percent;
  /** Published maximum apparent attenuation, **%**. */
  readonly attenuationMaxPercent: Percent;
  /**
   * Override for the attenuation actually used, **%**. When absent the engine
   * uses the midpoint of the published range.
   */
  readonly attenuationPercent?: Percent;
  /** Number of packs/vials pitched. Defaults to 1. */
  readonly packs?: number;
  /** Viable cells per pack at manufacture, **billion**. */
  readonly cellsPerPackBillion?: number;
  /** Manufacture date, for viability decay. */
  readonly manufactureDate?: Date;
  /** Grams per dry sachet. Used with `cellsPerGramBillion` for dry yeast. */
  readonly gramsPerPack?: number;
  /** Viable cells per gram at manufacture, **billion** (dry yeast). */
  readonly cellsPerGramBillion?: number;
  /**
   * The maker's recommended dosage, **g/hL**, for dry yeast.
   *
   * Dry pitches are checked against this instead of a cell-count target; see
   * `DRY_DOSAGE_G_PER_HL`. When it's absent we use a band by strain type.
   */
  readonly dosageGramsPerHl?: {
    /** Lowest recommended dosage, g/hL. */
    readonly min: number;
    /** Highest recommended dosage, g/hL. */
    readonly max: number;
  } | null;
  /**
   * Bottom of the maker's published fermentation range, **°C**.
   *
   * Only the pre-brew checks read this. No number `calculateRecipe` returns
   * depends on it. It's absent when the range is unknown, and a range with
   * only one end is treated as unknown.
   */
  readonly temperatureMinC?: Celsius;
  /** Top of the maker's published fermentation range, **°C**. See {@link temperatureMinC}. */
  readonly temperatureMaxC?: Celsius;
  /**
   * The starter this culture is pitched from, when the brewer plans one.
   *
   * Usually absent, which means the packs go straight into the wort. When it's
   * set, `pitchPlan` grows the starter and counts the cells that come out of the
   * flask instead of the cells in the packs. It's ignored for **dry** yeast,
   * with a note explaining why; see `dryYeastSachets`.
   */
  readonly starter?: YeastStarter | null;
}

// ---------------------------------------------------------------------------
// Mash & fermentation schedules
// ---------------------------------------------------------------------------

/**
 * How a mash step reaches its target temperature.
 *
 * @category Recipe
 * @group Inputs
 */
export type MashStepType =
  /** Water is added at a higher temperature. */
  | 'infusion'
  /** Direct heat (RIMS/HERMS/all-in-one). */
  | 'temperature'
  /** Part of the mash is pulled, boiled and returned. */
  | 'decoction'
  /** Sparge/mash-out rinse. */
  | 'sparge';

/**
 * How much grain comes out with a decoction relative to liquid.
 *
 * @category Decoction
 * @group Inputs
 */
export type DecoctionThickness =
  /**
   * Grain scooped from the bottom and drained on the spoon, the traditional
   * pull. It gives the most Maillard development and the most scorch risk, and
   * it's the thickest a pull can be. The ratio is the grain's own absorption,
   * because drained grain still holds about a litre of liquid per kilogram.
   */
  | 'thick'
  /** The usual compromise, around 1.5 L/kg. */
  | 'medium'
  /**
   * Liquid only. It's used to raise temperature, not for flavour. With no
   * grain there's no starch to gelatinise and little of the Maillard character
   * a decoction is usually done for.
   */
  | 'thin';

/**
 * How a decoction step is pulled. See `docs/decoction.md`.
 *
 * These are recipe choices, not properties of the equipment. Two brewers on
 * the same kit make different beer by pulling thick or thin, so this lives on
 * the step. The pot, the burner and the tun's standing loss live on the
 * equipment profile.
 *
 * @category Decoction
 * @group Inputs
 */
export interface DecoctionSpec {
  /** How thick the pull is. Defaults to `thick`. */
  readonly thickness?: DecoctionThickness;
  /**
   * Explicit pull thickness, **litres of liquid per kilogram of grain in the
   * pull**. Overrides {@link thickness}. A value below the grain's absorption
   * is clamped up to it, because no pull can be thicker than drained grain.
   */
  readonly ratioLPerKg?: number;
  /** How long the pull boils, **minutes**. Defaults to 20. */
  readonly boilMinutes?: Minutes;
  /**
   * A conversion rest held on the pull before it is brought to the boil.
   *
   * This is traditional on a thick pull. A pull boiled straight from a protein
   * rest is boiling unconverted starch, which sets the starch and loses its
   * extract. Absent means the pull goes straight to the boil.
   */
  readonly restBeforeBoil?: {
    /** Rest temperature, **°C**. */
    readonly tempC: Celsius;
    /** Rest length, **minutes**. */
    readonly minutes: Minutes;
  };
  /**
   * Pull this volume, **litres**, instead of the volume the heat balance asks
   * for, e.g. to fit the brewer's pot. The engine then reports the temperature
   * the mash actually lands on, which may miss the target.
   */
  readonly pullVolumeL?: Litres;
}

/**
 * One step in a mash schedule.
 *
 * @category Recipe
 * @group Inputs
 */
export interface MashStep {
  /** Display name, e.g. "Saccharification". */
  readonly name: string;
  /** How the step is reached. */
  readonly type: MashStepType;
  /** Rest temperature, **°C**. */
  readonly targetTempC: Celsius;
  /** Rest duration, **minutes**. */
  readonly timeMinutes: Minutes;
  /** Infusion water volume, **litres**. Computed if omitted. */
  readonly infusionVolumeL?: Litres;
  /** Infusion water temperature, **°C**. Computed if omitted. */
  readonly infusionTempC?: Celsius;
  /**
   * Mash thickness for this step, **litres of water per kilogram of grain**.
   * Only meaningful on the first step; the volumes module uses it as the
   * strike-water ratio.
   */
  readonly thicknessLPerKg?: number;
  /**
   * How a `decoction` step is pulled. Ignored on every other step type.
   * Defaults apply when absent; see `decoction.ts`.
   */
  readonly decoction?: DecoctionSpec;
}

/**
 * Phase of a fermentation schedule.
 *
 * @category Recipe
 * @group Inputs
 */
export type FermentationStepType = 'primary' | 'secondary' | 'conditioning' | 'lagering';

/**
 * One step in a fermentation schedule.
 *
 * @category Recipe
 * @group Inputs
 */
export interface FermentationStep {
  /** Display name, e.g. "Primary". */
  readonly name: string;
  /** Phase. */
  readonly type: FermentationStepType;
  /**
   * Hold temperature, **°C**, or the start of a ramp when {@link endTempC} is
   * set. The warmest temperature across the schedule also drives residual CO₂
   * at packaging.
   */
  readonly tempC: Celsius;
  /** End of a temperature ramp, **°C**. Omitted for a hold at {@link tempC}. */
  readonly endTempC?: Celsius;
  /** Duration, **days**. */
  readonly days: Days;
  /**
   * Gauge pressure held on the vessel through this step, **psi**. Omitted means
   * atmospheric, which covers everything except a spunded ferment.
   *
   * We use psi because it's the engine's pressure unit everywhere else. The
   * Henry's-law fit in `carbonation.ts` is a polynomial in °F and psi, and
   * that's the only function that reads this field. Callers convert to bar or
   * kPa for display.
   *
   * Pressure affects one prediction only, the CO₂ still dissolved in the beer
   * at packaging. See {@link scheduleResidualCo2}.
   */
  readonly pressurePsi?: number;
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/**
 * Lautering strategy. `no-sparge` and `biab-full-volume` both mean zero sparge water.
 *
 * @category Recipe
 * @group Inputs
 */
export type SpargeType = 'batch' | 'fly' | 'no-sparge' | 'biab-full-volume';

/**
 * Everything the volume waterfall and efficiency maths need to know about a
 * brewing system.
 *
 * All fields are required so that a profile is unambiguous; use
 * `resolveEquipmentProfile` to fill a partial profile from the defaults.
 *
 * @category Recipe
 * @group Inputs
 */
export interface EquipmentProfile {
  /** Display name, e.g. "Anvil Foundry 10.5 gal". */
  readonly name: string;
  /** Lautering strategy. */
  readonly spargeType: SpargeType;
  /**
   * Volume below the mash tun outlet / false bottom that returns to the kettle
   * (all-in-one systems), **litres**. Does not change water requirements.
   *
   * This is "mash tun deadspace" as Brewfather uses it. On a single-vessel rig
   * the liquid under the false bottom never leaves the kettle, so it's still
   * part of the wort. We keep the field so imports and presets carry it over,
   * but no term of the volume waterfall uses it. Wort the brewer actually
   * loses to the tun goes in {@link mashTunLossL}.
   */
  readonly mashTunDeadspaceL: Litres;
  /**
   * Wort left behind in the mash tun, **litres**.
   *
   * Brewfather's "Mash Tun Loss", and BeerXML's `LAUTER_DEADSPACE`. This liquid
   * never reaches the kettle, so the brewer has to measure out that much extra
   * water. The waterfall adds it to the total water requirement and counts it
   * in the total loss.
   */
  readonly mashTunLossL: Litres;
  /**
   * Water retained by spent grain, **litres per kilogram**.
   * ~1.0 L/kg for a lauter tun, ~0.8 L/kg for a squeezed BIAB bag.
   */
  readonly grainAbsorptionLPerKg: number;
  /** Default mash thickness, **litres of water per kilogram of grain**. */
  readonly mashThicknessLPerKg: number;
  /** Evaporation rate at a rolling boil, **litres per hour**. */
  readonly boilOffRateLPerHour: number;
  /**
   * Thermal contraction of wort from boiling to 20 °C, **%** of the hot volume.
   * 4 % is the conventional figure.
   */
  readonly boilShrinkagePercent: Percent;
  /** Wort left in the kettle below the pickup, **litres**. */
  readonly kettleDeadspaceL: Litres;
  /**
   * Wort retained by kettle hops, **millilitres per gram**.
   * Numerically identical to litres per kilogram. ~6 mL/g for pellets.
   */
  readonly hopAbsorptionMlPerG: number;
  /**
   * Wort retained by dry hops in the fermenter, **millilitres per gram**.
   * Defaults to the kettle figure when a profile does not distinguish.
   */
  readonly dryHopAbsorptionMlPerG: number;
  /** Wort left in the chiller and transfer hoses, **litres**. */
  readonly chillerLossL: Litres;
  /** Beer left behind on the fermenter's trub/yeast cake, **litres**. */
  readonly fermenterTrubLossL: Litres;
  /** Water added to the kettle after lautering, **litres** (extract brewing). */
  readonly topUpKettleL: Litres;
  /** Water added to the fermenter after transfer, **litres** (partial boils). */
  readonly topUpFermenterL: Litres;
  /**
   * Mash efficiency, **%**: extract recovered into the kettle as a fraction of
   * the grist's theoretical maximum.
   */
  readonly mashEfficiencyPercent: Percent;
  /**
   * Brewhouse efficiency, **%**: extract that reaches the fermenter as a
   * fraction of the grist's theoretical maximum. The engine doesn't read it as
   * an input, because it predicts this from the mash efficiency and the volume
   * losses. It's kept on the profile because users record it from batches.
   */
  readonly brewhouseEfficiencyPercent: Percent;
  /**
   * Mash tun thermal mass expressed as an equivalent **litres of water**.
   * 0 for a well-preheated or fully-insulated vessel.
   */
  readonly mashTunThermalMassLEquivalent: Litres;
  /** Mash tun temperature at dough-in, **°C**. Only used when the thermal mass is non-zero. */
  readonly mashTunInitialTempC: Celsius;
  /** Kettle capacity, **litres**. Used only to raise a boil-over warning. */
  readonly kettleVolumeL?: Litres;
  /** Mash tun capacity, **litres**. Used only to raise an overflow warning. */
  readonly mashTunVolumeL?: Litres;
  /**
   * Fermenter capacity, **litres**. Used only to raise a headspace warning.
   *
   * This is the vessel's volume, not the batch's. A 30 L bucket holding a 23 L
   * batch has 7 L of headspace for the krausen. Unlike the two above it doesn't
   * feed any calculation, because nothing downstream of the fermenter depends
   * on headspace. The warning tells the brewer before brew day whether they
   * need a blow-off tube. See `recipe-checks.ts`.
   */
  readonly fermenterVolumeL?: Litres;
  /**
   * How fast a resting mash loses heat, **°C per hour**.
   *
   * Only the decoction code reads it, and it's the largest correction a
   * decoction needs. A thick pull is away from the tun for 35–50 minutes, and a
   * mash that drifts 1.5 °C in that time needs a noticeably bigger pull to hit
   * the step. Defaults to 2, for a lidded insulated cooler, which is what
   * decoction is usually done in. **A rig that holds mash temperature actively
   * (RIMS, HERMS, an all-in-one) should set this to 0**, which gives the
   * standard textbook pull size.
   */
  readonly mashStandingLossCPerHour: number;
  /**
   * Evaporation from the decoction pot at a rolling boil, **litres per hour**.
   *
   * It's separate from {@link boilOffRateLPerHour} because the pot is much
   * smaller: 1.5 L/h suits the 8–12 L pot a pull is boiled in, against 3 L/h
   * for a full kettle. This water never reaches the kettle, so the waterfall
   * counts it as a loss and the mash gets thicker by that amount.
   */
  readonly decoctionBoilOffLPerHour: number;
  /** Decoction pot capacity, **litres**. Used only to raise an overflow warning. */
  readonly decoctionPotVolumeL?: Litres;
}

/**
 * A partially-specified equipment profile; missing fields come from the defaults.
 *
 * @category Recipe
 * @group Inputs
 */
export type EquipmentProfileInput = Partial<EquipmentProfile>;

// ---------------------------------------------------------------------------
// Water chemistry & mash pH
// ---------------------------------------------------------------------------

/**
 * The six ions the engine accounts for.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type WaterIon = 'calcium' | 'magnesium' | 'sodium' | 'chloride' | 'sulfate' | 'bicarbonate';

/**
 * A brewing water analysis, every ion in **ppm (mg/L)**.
 *
 * Alkalinity is stored as **bicarbonate**, because that's the ion actually in
 * the water. "Alkalinity as CaCO₃" is a reporting convention. `waterProfile()`
 * in `./water` accepts either form (plus German °dH) and converts to this one.
 *
 * ## Unmeasured ions
 *
 * A water report that doesn't list sulfate isn't reporting zero sulfate. But
 * the arithmetic downstream (charge balance, dilution, the salt solver) needs
 * a number for every ion, or else a `null` branch on every line. So
 * unmeasured ions are stored as zero, and {@link unmeasured} records which
 * ones they are. The calculations ignore that list. Only the code that tells
 * a brewer something about the water checks it.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface WaterProfile {
  /** Display name, e.g. "Burton on Trent". Purely informational. */
  readonly name?: string;
  /** Calcium (Ca²⁺), ppm. */
  readonly calciumPpm: number;
  /** Magnesium (Mg²⁺), ppm. */
  readonly magnesiumPpm: number;
  /** Sodium (Na⁺), ppm. */
  readonly sodiumPpm: number;
  /** Chloride (Cl⁻), ppm. */
  readonly chloridePpm: number;
  /** Sulfate (SO₄²⁻), ppm. */
  readonly sulfatePpm: number;
  /** HCO₃⁻, ppm. Alkalinity as CaCO₃ = this × 0.820162. */
  readonly bicarbonatePpm: number;
  /** Measured pH of the water as drawn. Used to work out how much of the alkalinity titrates. */
  readonly ph?: number;
  /**
   * Ions the analysis never printed, as distinct from ions it printed as zero.
   *
   * RO water has 0 ppm sulfate, but a utility report that leaves the row out
   * tells you nothing, and the two have to be told apart. Each ion listed here
   * still holds `0` in its own field. The list only records where that zero
   * came from. It's never a second source for the value.
   *
   * Absent (the usual case) means the whole analysis was measured. Blending,
   * dilution and salt additions take the **union** of the lists. Adding 30 ppm
   * of chloride to a water whose chloride was never measured still leaves the
   * total unknown, so nothing downstream can report a ratio from it.
   */
  readonly unmeasured?: readonly WaterIon[];
}

/**
 * The brewing salts the engine models.
 *
 * Calcium chloride is listed twice because the hydrate state changes the
 * calcium and chloride yield per gram by 32 %, and homebrew suppliers label the
 * two forms inconsistently.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type SaltId =
  /** CaSO₄·2H₂O. */
  | 'gypsum'
  /** CaCl₂·2H₂O — the usual damp, clumping homebrew form. */
  | 'calcium-chloride-dihydrate'
  /** CaCl₂ — free-flowing prills. */
  | 'calcium-chloride-anhydrous'
  /** MgSO₄·7H₂O. */
  | 'epsom-salt'
  /** NaCl. */
  | 'table-salt'
  /** MgCl₂·6H₂O. */
  | 'magnesium-chloride'
  /** NaHCO₃. */
  | 'baking-soda'
  /** CaCO₃ — barely soluble; see the warning it raises. */
  | 'chalk'
  /** Ca(OH)₂. */
  | 'slaked-lime';

/**
 * Which water a treatment goes into.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type WaterTreatmentTarget = 'mash' | 'sparge' | 'total';

/**
 * One salt addition.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface SaltAddition {
  /** Which salt. */
  readonly salt: SaltId;
  /** Amount, **grams**. Salts are weighed, not measured by volume. */
  readonly grams: number;
  /** Which water it goes into. Defaults to `total` (split by volume). */
  readonly target?: WaterTreatmentTarget;
  /**
   * Fraction of the dose that actually dissolves, 0–1. Defaults to 1.
   * This is mainly for chalk, which hardly dissolves in practice.
   */
  readonly dissolvedFraction?: Fraction;
}

/**
 * The acids the engine models.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type AcidId =
  /** CH₃CH(OH)COOH — the homebrew default, sold at 80–88 % w/w. */
  | 'lactic'
  /** H₃PO₄ — sold at 10 %, 75 % and 85 % w/w. Triprotic. */
  | 'phosphoric'
  /** C₆H₈O₇ — usually a solid (monohydrate). Triprotic. */
  | 'citric'
  /** CH₃COOH — vinegar at 5 %, glacial at 100 %. */
  | 'acetic'
  /** HCl — "muriatic acid", 31–37 % w/w. Strong. */
  | 'hydrochloric'
  /** H₂SO₄ — battery acid at ~35 %. Strong in its first proton. */
  | 'sulfuric';

/**
 * One acid addition.
 *
 * Give **either** `millilitres` (a liquid acid at `concentrationPercent` w/w)
 * **or** `grams` (a solid, e.g. citric acid crystals). If both are set, the
 * engine reports an error instead of guessing.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface AcidAddition {
  /** Which acid. */
  readonly acid: AcidId;
  /** Volume of the acid solution, **millilitres**. */
  readonly millilitres?: number;
  /** Mass of solid acid, **grams**. */
  readonly grams?: number;
  /** Strength, **% w/w**. Defaults per acid — 88 % for lactic, 85 % for phosphoric. */
  readonly concentrationPercent?: Percent;
  /** Which water it goes into. Defaults to `mash`. */
  readonly target?: WaterTreatmentTarget;
}

/**
 * The optional water/mash-pH section of a recipe.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface RecipeWaterInput {
  /** The water as it comes out of the tap or the bottle. */
  readonly sourceProfile: WaterProfile;
  /** Share of the brewing water replaced with RO/distilled, 0–1. Defaults to 0. */
  readonly dilutionFraction?: Fraction;
  /** What the dilution water is. Defaults to ion-free RO. */
  readonly dilutionProfile?: WaterProfile;
  /** Sparge water source when it differs from the mash source. Defaults to the same. */
  readonly spargeSourceProfile?: WaterProfile;
  /** Salts added. */
  readonly saltAdditions?: readonly SaltAddition[];
  /** Acids added. */
  readonly acidAdditions?: readonly AcidAddition[];
  /** A target profile to report the achieved water against. Purely informational. */
  readonly targetProfile?: WaterProfile;
  /** Target mash pH used for advice and warnings. Defaults to 5.4. */
  readonly targetMashPh?: number;
  /** Acidify the sparge water. Defaults to `false`. */
  readonly acidifySparge?: boolean;
  /** Target sparge pH. Defaults to 5.5. */
  readonly spargeTargetPh?: number;
  /** Which acid to dose the sparge with. Defaults to lactic. */
  readonly spargeAcid?: AcidId;
  /** Sparge acid strength, % w/w. Defaults to the acid's own default. */
  readonly spargeAcidConcentrationPercent?: Percent;
}

// ---------------------------------------------------------------------------
// Recipe input & options
// ---------------------------------------------------------------------------

/**
 * Which point in the waterfall the user's "batch size" refers to.
 *
 * @category Recipe
 * @group Inputs
 */
export type BatchVolumeBasis =
  /** Volume of chilled wort transferred into the fermenter. The common default. */
  | 'fermenter'
  /** Volume of finished beer into keg/bottles. */
  | 'packaged';

/**
 * The calculation-side view of a recipe.
 *
 * @category Recipe
 * @group Inputs
 */
export interface RecipeInput {
  /** Display name. Purely informational. */
  readonly name?: string;
  /** Target batch volume, **litres**, measured at {@link batchVolumeBasis}. */
  readonly batchVolumeL: Litres;
  /** What `batchVolumeL` measures. Defaults to `fermenter`. */
  readonly batchVolumeBasis?: BatchVolumeBasis;
  /** Boil duration, **minutes**. */
  readonly boilTimeMinutes: Minutes;
  /** Grist and sugars. */
  readonly fermentables: readonly FermentableAddition[];
  /** Hop schedule. */
  readonly hops: readonly HopAddition[];
  /** Yeast. Multiple entries are allowed; the most attenuative dominates. */
  readonly yeasts?: readonly YeastSelection[];
  /** Mash schedule. The first step's thickness overrides the equipment default. */
  readonly mashSteps?: readonly MashStep[];
  /** Fermentation schedule. The warmest step drives residual CO₂. */
  readonly fermentationSteps?: readonly FermentationStep[];
  /** Mash thickness override, **litres per kilogram**. */
  readonly mashThicknessLPerKg?: number;
  /** Grain temperature at dough-in, **°C**. Defaults to 20 °C. */
  readonly grainTemperatureC?: Celsius;
  /** Target carbonation, **volumes of CO₂**. Defaults to 2.4. */
  readonly carbonationVolumes?: number;
  /**
   * Water chemistry and mash pH. This is optional, and if it's missing the
   * result just has no water or mash pH figures.
   */
  readonly water?: RecipeWaterInput;
}

/**
 * Which bitterness model to use.
 *
 * @category Hops
 * @group Inputs
 */
export type IbuFormula = 'tinseth' | 'rager' | 'garetz';

/**
 * Which whirlpool/hop-stand model to use.
 *
 * @category Hops
 * @group Inputs
 */
export type WhirlpoolModel =
  /** Temperature-corrected integration over an exponential cooling curve (mIBU-style). */
  | 'mibu'
  /** The stand is held at a single temperature for its whole duration. */
  | 'fixed-temperature'
  /** Whirlpool additions contribute nothing. */
  | 'none';

/**
 * Which MCU → SRM fit to use.
 *
 * @category Color
 * @group Inputs
 */
export type ColorFormula = 'morey' | 'daniels' | 'mosher';

/**
 * Which ABV formula to use.
 *
 * @category Gravity and ABV
 * @group Inputs
 */
export type AbvFormula = 'simple' | 'advanced';

/**
 * Which wort volume a bitterness or colour figure is expressed against.
 *
 * @category Recipe
 * @group Inputs
 */
export type VolumeBasis = 'pre-boil' | 'post-boil' | 'fermenter';

/**
 * Which gravity feeds the bitterness model's gravity term.
 *
 * @category Hops
 * @group Inputs
 */
export type BitternessGravityBasis = 'pre-boil' | 'post-boil' | 'average-boil';

/**
 * Tuning for the whirlpool/hop-stand models.
 *
 * The cooling curve is `T(t) = T_ambient + (T_0 − T_ambient)·e^(−k·t)`.
 *
 * @category Hops
 * @group Inputs
 */
export interface WhirlpoolOptions {
  /** Which model to run. Defaults to `mibu`. */
  readonly model?: WhirlpoolModel;
  /** Ambient temperature the wort decays towards, **°C**. Defaults to 20. */
  readonly ambientTempC?: Celsius;
  /**
   * Cooling rate constant `k`, **per minute**. Defaults to 0.015 min⁻¹ — a
   * covered ~20 L kettle left to whirlpool. See
   * `DEFAULT_WHIRLPOOL_COOLING_RATE_PER_MIN`.
   */
  readonly coolingRateConstantPerMin?: number;
  /** Integration step for the mIBU model, **minutes**. Defaults to 0.05. */
  readonly integrationStepMinutes?: Minutes;
  /**
   * When true, boil additions keep isomerising through the stand as well.
   * Defaults to `false` so plain Tinseth numbers stay comparable with other
   * calculators.
   */
  readonly includePostBoilIsomerisationForBoilHops?: boolean;
}

/**
 * How much of a water's measured alkalinity the mash actually has to overcome.
 *
 * Alkalinity is titrated to the ~pH 4.3 carbonic end point, but a mash only
 * pulls the water down to ~5.4, at which pH about a tenth of the carbonate is
 * still bicarbonate and has not consumed any acid. Ignoring that overstates the
 * water's effect by roughly 10 %.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type AlkalinityModel =
  /** Titrate the carbonate system from the water's pH to the mash pH. The default. */
  | 'titrated-to-mash-ph'
  /** Treat the whole measured alkalinity as active. What most calculators do. */
  | 'full-alkalinity';

/**
 * Tuning for the mash-pH model.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface MashPhOptions {
  /** How much of the alkalinity counts. Defaults to `titrated-to-mash-ph`. */
  readonly alkalinityModel?: AlkalinityModel;
  /**
   * pH assumed for a source water whose report does not state one.
   * Defaults to 7.5. The prediction moves by under 0.01 pH across the whole
   * 7.0–8.3 range that municipal water actually occupies.
   */
  readonly assumedSourceWaterPh?: number;
  /** Root-finder convergence tolerance, **pH units**. Defaults to 1e-6. */
  readonly convergenceTolerancePh?: number;
  /** Root-finder iteration cap. Defaults to 100. */
  readonly maxIterations?: number;
  /** Acidulated malt's lactic acid content, **% by mass**. Defaults to 3. */
  readonly acidulatedMaltPercentLactic?: Percent;
}

/**
 * Every knob the engine exposes. All fields optional; see `DEFAULT_CALCULATION_OPTIONS`.
 *
 * @category Recipe
 * @group Inputs
 */
export interface CalculationOptions {
  /** Mash-pH model tuning. */
  readonly mashPh?: MashPhOptions;
  /** Bitterness model. Defaults to `tinseth`. */
  readonly ibuFormula?: IbuFormula;
  /** Colour model. Defaults to `morey`. */
  readonly colorFormula?: ColorFormula;
  /** ABV model. Defaults to `advanced`. */
  readonly abvFormula?: AbvFormula;
  /** Whirlpool/hop-stand tuning. */
  readonly whirlpool?: WhirlpoolOptions;
  /** Per-form utilisation multipliers. Defaults: whole 1.0, plug 1.0, pellet 1.10, cryo 1.10. */
  readonly hopFormMultipliers?: Partial<Record<HopForm, number>>;
  /**
   * Fraction of a pre-isomerised extract's iso-alpha that survives into the
   * finished beer. Defaults to 0.95.
   *
   * It's a single figure because recovery for these products is high and
   * flat. It changes with losses to trub and yeast, not with time or gravity.
   * Brewers dosing after fermentation see closer to 1.0 and can set that.
   */
  readonly isoExtractRecovery?: number;
  /** First-wort-hop utilisation bonus, as a multiplier. Defaults to 1.10. */
  readonly firstWortMultiplier?: number;
  /** Global utilisation fudge factor applied to every addition. Defaults to 1.0. */
  readonly utilizationMultiplier?: number;
  /** Elevation above sea level, **metres**. Only the Garetz model uses it. Defaults to 0. */
  readonly elevationM?: number;
  /** Which wort volume IBU is expressed against. Defaults to `post-boil`. */
  readonly ibuVolumeBasis?: VolumeBasis;
  /** Which gravity the bitterness model's gravity term uses. Defaults to `post-boil`. */
  readonly bitternessGravityBasis?: BitternessGravityBasis;
  /** Which wort volume MCU is expressed against. Defaults to `post-boil`. */
  readonly colorVolumeBasis?: VolumeBasis;
  /** Efficiency applied to steeped grain, **%**. Defaults to 50. */
  readonly steepEfficiencyPercent?: Percent;
  /**
   * Apparent attenuation override, **%**. Wins over the yeast's published range.
   * Explicitly allows `undefined` so a resolved options object round-trips.
   */
  readonly attenuationOverridePercent?: Percent | undefined;
  /** Maximum theoretical yield of pure sucrose, **PPG**. Defaults to 46.214. */
  readonly maxSucrosePpg?: number;
}

/**
 * `CalculationOptions` with every default filled in.
 *
 * @category Recipe
 * @group Results
 */
export type ResolvedCalculationOptions = Required<
  Omit<
    CalculationOptions,
    'whirlpool' | 'hopFormMultipliers' | 'attenuationOverridePercent' | 'mashPh'
  >
> & {
  /** Whirlpool tuning, every field filled in. */
  readonly whirlpool: Required<WhirlpoolOptions>;
  /** Utilization multiplier for every hop form. */
  readonly hopFormMultipliers: Record<HopForm, number>;
  /** Apparent attenuation override, **%**, or `undefined` when the yeast decides. */
  readonly attenuationOverridePercent: Percent | undefined;
  /** Mash-pH tuning, every field filled in. */
  readonly mashPh: Required<MashPhOptions>;
};
