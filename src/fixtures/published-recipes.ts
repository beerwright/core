/**
 * Published homebrew recipes, transcribed for the band test.
 *
 * These aren't golden fixtures. `reference-recipes.ts` holds numbers worked
 * out longhand from the published formulas, and those are asserted to five
 * decimal places. Nothing here is hand-verified arithmetic. Every `published`
 * figure is whatever the author's software printed, and the author usually
 * doesn't name the software, the efficiency, the IBU model or the colour fit.
 * So the test that uses this file asserts windows instead of equality. It
 * checks that the whole pipeline (yields, the volume waterfall, attenuation,
 * Tinseth, Morey) lands in the right place across a dozen very different
 * grists.
 *
 * ## Sourcing rules
 *
 * - Every recipe is a real, publicly readable page. Title, URL and access date
 *   are recorded on the fixture, and the vitals are read off that page, never
 *   from memory.
 * - Recipes behind the AHA's member paywall are left out even when the vitals
 *   are visible, because we can't check the grist.
 * - If a source states an efficiency, the fixture uses it. If it doesn't
 *   (most AHA recipes), the fixture records the efficiency implied by the
 *   source's own grist and OG, rounded to a conventional value, and shows that
 *   division in the comment. That makes OG a weak assertion for those recipes.
 *   It mostly re-checks the yield and volume maths, not the efficiency, and
 *   FG, IBU and SRM do most of the work.
 *
 * ## Conversions
 *
 * Every one of these sources uses US-customary units first. The metric figures
 * printed next to them are rounded (a recipe that says "4.5 lb (2 kg)" means
 * 2.0412 kg). The fixtures convert from the US figure with these constants,
 * written as multiplications so a reviewer can see both units:
 *
 * ```
 * LB  = 0.45359237 kg      (1 / 2.2046226)
 * OZ  = 0.028349523 kg     (LB / 16)
 * GAL = 3.785411784 L      (1 / 0.26417205)
 * ```
 *
 * ## Malt yields and colours
 *
 * Sources give a malt's name, not its certificate of analysis. Yields (PPG,
 * as-is) and colours (°L) are the conventional homebrew-table figures from the
 * Brewer's Friend fermentables database
 * (https://www.brewersfriend.com/fermentables/, accessed 2026-08-25), except
 * where we checked a maltster's own published figure and cite it inline. If
 * the database doesn't have a malt, we use the nearest row of the same type
 * and colour class and note that where it's used. An individual lot varies by
 * ±1 PPG and ±10 % on colour, and both are inside the bands.
 *
 * We use the `ppg` field throughout instead of
 * `extractFineGrindDryBasisPercent`, because PPG is what these tables publish.
 * Guessing an FGDB/moisture pair to reproduce it would just add made-up
 * numbers.
 *
 * ## Why the equipment profiles zero the kettle-side losses
 *
 * A recipe that says "5 gallons" and "OG 1.062" means the OG of five gallons
 * of wort. It doesn't say how much of that is left under the kettle pickup or
 * soaked into the hop bed, and the engine takes OG at the post-boil volume. So
 * each fixture's profile sets kettle deadspace, hop absorption, chiller loss
 * and trub loss to zero, which makes
 *
 * ```
 * postBoilVolumeL = batchVolumeL = the source's stated batch size
 * ```
 *
 * so the OG, IBU and SRM comparisons mean the same thing the source means.
 * Boil-off and grain absorption are left at plausible defaults. They only
 * affect the water volumes and the pre-boil gravity, and nothing here asserts
 * those.
 *
 * Each recipe still gets its own profile object with its own stated
 * efficiency. The loss convention is the only thing they share.
 */

import type { EquipmentProfile, RecipeInput } from '../types';

/** Kilograms per pound. */
const LB = 0.45359237;

/** Kilograms per ounce, `LB / 16`. */
const OZ = 0.028349523;

/** Litres per US gallon. */
const GAL = 3.785411784;

/** What the source page says, and where to go and check it. */
export interface PublishedSource {
  /** Page title as published. */
  readonly title: string;
  readonly url: string;
  /** ISO date this page was read. */
  readonly accessed: string;
  /**
   * The assumptions the source states, plus any the fixture had to supply
   * because the source doesn't say. Those are marked as such.
   */
  readonly statedAssumptions: string;
}

/** The vitals the source prints. Fields the source omits are omitted here. */
export interface PublishedVitals {
  readonly og: number;
  readonly fg?: number;
  readonly abv?: number;
  readonly ibu?: number;
  readonly srm?: number;
}

/**
 * Per-recipe band overrides. Each one needs a written reason in the comment
 * above it. If bands get widened without a reason, the suite stops catching
 * anything.
 */
export interface PublishedBands {
  /** OG half-width, SG. Default 0.004. */
  readonly ogSg?: number;
  /** FG half-width, SG. Default 0.006. */
  readonly fgSg?: number;
  /** ABV half-width, percentage points absolute. Default 0.6. */
  readonly abvAbs?: number;
  /** IBU half-width as a fraction of the published figure. Default 0.25. */
  readonly ibuRelative?: number;
  /** IBU half-width floor, absolute. Default 5. */
  readonly ibuAbsolute?: number;
  /** SRM half-width as a fraction of the published figure. Default 0.20. */
  readonly srmRelative?: number;
  /** SRM half-width floor, absolute. Default 1.5. */
  readonly srmAbsolute?: number;
}

/** One published recipe, its provenance, and the window its vitals must land in. */
export interface PublishedRecipe {
  readonly name: string;
  readonly style: string;
  readonly source: PublishedSource;
  readonly equipment: EquipmentProfile;
  readonly input: RecipeInput;
  readonly published: PublishedVitals;
  readonly bands?: PublishedBands;
}

/**
 * A per-recipe profile with that recipe's efficiency, and the kettle-side
 * losses zeroed for the reason in the file header.
 *
 * The engine predicts `brewhouseEfficiencyPercent` and doesn't read it from
 * the input. With every loss at zero it equals the mash figure, so that's what
 * the profile records.
 */
function benchProfile(name: string, mashEfficiencyPercent: number): EquipmentProfile {
  return {
    name,
    spargeType: 'batch',
    mashTunDeadspaceL: 0,
    mashTunLossL: 0,
    grainAbsorptionLPerKg: 1.0,
    mashThicknessLPerKg: 3.0,
    boilOffRateLPerHour: 3.0,
    boilShrinkagePercent: 4,
    kettleDeadspaceL: 0,
    hopAbsorptionMlPerG: 0,
    dryHopAbsorptionMlPerG: 0,
    chillerLossL: 0,
    fermenterTrubLossL: 0,
    topUpKettleL: 0,
    topUpFermenterL: 0,
    mashEfficiencyPercent,
    brewhouseEfficiencyPercent: mashEfficiencyPercent,
    mashTunThermalMassLEquivalent: 0,
    mashTunInitialTempC: 20,
    mashStandingLossCPerHour: 2,
    decoctionBoilOffLPerHour: 1.5,
  };
}

/**
 * Brew Your Own's house efficiency, used by every BYO recipe below.
 *
 * > "For example, BYO uses a standard of 65% efficiency in published recipes;
 * > if you want to brew your version and your extract efficiency is, say, 70%
 * > then you would need less malt than is given in the BYO recipe."
 * >
 * > — *Calculating Brewhouse Efficiency*, https://byo.com/articles/calculating-brewhouse-efficiency/
 * >   (accessed 2026-08-25)
 *
 * The recipes bear this out. Boomslang's 12.625 lb of grain yields 478.6
 * points·lb, and 478.6 × 0.65 / 5 gal = 62.2, which is the OG 1.062 BYO prints.
 * Three more BYO recipes below come within a point the same way.
 */
const BYO_EFFICIENCY = 65;

// ===========================================================================
// 1 — Wrecking Bar Brewpub Boomslang IPA clone (hop-bursted American IPA)
// ===========================================================================

/**
 * The hop-burst case, with no 60-minute addition. Everything goes in at 20
 * minutes or later, so almost all of the bitterness comes from the steep part
 * of Tinseth's curve and not its plateau.
 *
 * ```
 * OG check   11.5 lb × 38 + 1.125 lb × 37 = 478.6 pt·lb
 *            478.6 × 0.65 / 5 gal         = 62.2  → 1.062  (published 1.062)
 * SRM check  MCU = (11.5×2 + 1.125×6) / 5 = 5.95
 *            1.4922 × 5.95^0.6859         = 5.07  (published 5)
 * ```
 */
export const BOOMSLANG_IPA: PublishedRecipe = {
  name: 'Wrecking Bar Brewpub Boomslang IPA clone',
  style: 'American IPA (hop-bursted)',
  source: {
    title: 'Wrecking Bar Brewpub Boomslang IPA clone',
    url: 'https://byo.com/recipes/wrecking-bar-brewpub-boomslang-ipa-clone/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (19 L) all-grain, 90 min boil, 152 °F (67 °C) single infusion, ' +
      'top up to 6.5 gal of wort. Efficiency not stated on the page; BYO publishes ' +
      'to a house standard of 65 %. Hop form not stated — the fixture assumes ' +
      'pellets, which is how these varieties are sold. Whirlpool duration not ' +
      'stated beyond "whirlpool before draining"; the fixture assumes 10 minutes ' +
      'from the engine’s default 80 °C.',
  },
  equipment: benchProfile('Boomslang bench (BYO 65 %)', BYO_EFFICIENCY),
  input: {
    name: 'Boomslang IPA clone',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 90,
    fermentables: [
      {
        name: 'German Pilsner',
        amountKg: 11.5 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 2,
      },
      // "18 oz Munich malt" = 1.125 lb.
      { name: 'Munich', amountKg: 18 * OZ, class: 'grain', use: 'mash', ppg: 37, colorLovibond: 6 },
    ],
    hops: [
      {
        name: 'Simcoe',
        amountKg: 1 * OZ,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 20,
      },
      {
        name: 'Nelson Sauvin',
        amountKg: 1 * OZ,
        alphaAcidPercent: 11,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 20,
      },
      {
        name: 'Citra',
        amountKg: 1 * OZ,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 5,
      },
      {
        name: 'Simcoe (whirlpool)',
        amountKg: 1 * OZ,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 10,
        whirlpoolTempC: 80,
      },
      {
        name: 'Citra (whirlpool)',
        amountKg: 1 * OZ,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 10,
        whirlpoolTempC: 80,
      },
      {
        name: 'Nelson Sauvin (whirlpool)',
        amountKg: 1 * OZ,
        alphaAcidPercent: 11,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 10,
        whirlpoolTempC: 80,
      },
      {
        name: 'Simcoe (dry hop)',
        amountKg: 1.33 * OZ,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'dry-hop',
        timeMinutes: 0,
        dryHopDays: 5,
      },
      {
        name: 'Citra (dry hop)',
        amountKg: 1.33 * OZ,
        alphaAcidPercent: 12,
        form: 'pellet',
        use: 'dry-hop',
        timeMinutes: 0,
        dryHopDays: 5,
      },
      {
        name: 'Nelson Sauvin (dry hop)',
        amountKg: 1.33 * OZ,
        alphaAcidPercent: 11,
        form: 'pellet',
        use: 'dry-hop',
        timeMinutes: 0,
        dryHopDays: 5,
      },
    ],
    yeasts: [
      // WLP001 California Ale, the first strain the recipe lists.
      // White Labs publishes 73–80 % apparent attenuation.
      {
        name: 'White Labs WLP001 California Ale',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 73,
        attenuationMaxPercent: 80,
      },
    ],
    // "Strike with 4 gallons of 164 °F water to reach 152 °F" — 152 °F = 66.67 °C.
    mashSteps: [{ name: 'Saccharification', type: 'infusion', targetTempC: 66.7, timeMinutes: 60 }],
  },
  published: { og: 1.062, fg: 1.012, abv: 6.8, ibu: 62, srm: 5 },
};

// ===========================================================================
// 2 — North Coast Old Rasputin Russian Imperial Stout clone
// ===========================================================================

/**
 * The dark, high-gravity end. It has 17.25 lb of grist in 5 gallons, six
 * malts, and a colour dominated by chocolate malt and roasted barley, which is
 * where the Morey fit is least certain.
 *
 * ```
 * implied efficiency
 *   14×37 + 1×34 + 1×33 + 0.5×29 + 0.5×32 + 0.25×33 = 623.75 pt·lb
 *   623.75 / 5 gal = 124.75 points at 100 %
 *   published 94 points / 124.75 = 75.35 %  → the fixture uses 75 %
 *   623.75 × 0.75 / 5 = 93.6 → 1.0936 against a published 1.094
 * SRM check
 *   MCU = (14×2 + 1×35 + 1×120 + 0.5×350 + 0.5×65 + 0.25×300) / 5 = 93.1
 *   1.4922 × 93.1^0.6859 = 33.4  (published 33)
 * ```
 */
export const OLD_RASPUTIN_CLONE: PublishedRecipe = {
  name: 'North Coast Old Rasputin Russian Imperial Stout clone',
  style: 'Russian Imperial Stout',
  source: {
    title: 'North Coast Old Rasputin Russian Imperial Stout Clone',
    url: 'https://homebrewersassociation.org/homebrew-recipe/north-coast-old-rasputin-clone/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (19 L). Mash 152 °F (67 °C) 60 min, mash out 158 °F (70 °C) 10 min. ' +
      'Pellet hops, alpha acids given. Efficiency not stated — the fixture uses the ' +
      '75 % the grist and published OG imply. Boil length not stated — the fixture ' +
      'assumes 60 minutes, which changes no asserted vital (every hop is timed from ' +
      'the end of the boil). Yeast given only as "American or California ale".',
  },
  equipment: benchProfile('Old Rasputin bench (implied 75 %)', 75),
  input: {
    name: 'Old Rasputin clone',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 60,
    fermentables: [
      {
        name: 'Pale two-row',
        amountKg: 14 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 37,
        colorLovibond: 2,
      },
      // Carastan: Bairds' British crystal, published at 35 °L / 34 PPG.
      {
        name: 'Carastan',
        amountKg: 1 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 34,
        colorLovibond: 35,
      },
      {
        name: 'Crystal 120 °L',
        amountKg: 1 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 120,
      },
      {
        name: 'Chocolate malt',
        amountKg: 0.5 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 29,
        colorLovibond: 350,
      },
      // Brown malt colour varies a lot by maltster. US tables put English brown
      // near 65 °L, and Simpsons publishes 162–226 °L for theirs. The fixture
      // takes the lighter figure. Morey gives 33.4 SRM at 65 °L and 36.2 at
      // 180 °L, and the ±20 % band around the published 33 covers both.
      {
        name: 'Brown malt',
        amountKg: 0.5 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 32,
        colorLovibond: 65,
      },
      {
        name: 'Roasted barley',
        amountKg: 0.25 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 300,
      },
    ],
    hops: [
      {
        name: 'Cluster',
        amountKg: 2 * OZ,
        alphaAcidPercent: 7,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
      {
        name: 'Northern Brewer',
        amountKg: 1 * OZ,
        alphaAcidPercent: 9,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 2,
      },
      {
        name: 'Centennial',
        amountKg: 1 * OZ,
        alphaAcidPercent: 10.5,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 2,
      },
    ],
    yeasts: [
      {
        name: 'White Labs WLP001 California Ale',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 73,
        attenuationMaxPercent: 80,
      },
    ],
    mashSteps: [
      { name: 'Saccharification', type: 'infusion', targetTempC: 66.7, timeMinutes: 60 },
      { name: 'Mash out', type: 'temperature', targetTempC: 70, timeMinutes: 10 },
    ],
  },
  published: { og: 1.094, fg: 1.023, abv: 9.3, ibu: 43, srm: 33 },
  bands: {
    // The AHA's 9.30 % is (1.094 − 1.023) × 131.0, the simple ABV shortcut.
    // The engine defaults to Cutaia, and the two diverge by
    // 0.5797 / (1.775 − OG) × FG / 0.794. At OG 1.094 / FG 1.022 that's a
    // 9.6 % gap, 9.41 % simple against 10.31 % advanced. Both numbers are
    // correct for their formula, so the band has to be wide enough for either.
    abvAbs: 1.2,
  },
};

// ===========================================================================
// 3 — Gordon Strong's Munich Helles (pale lager)
// ===========================================================================

/**
 * The pale-lager case. It has a four-rest step mash, a first-wort hop, and a
 * colour low enough that the ±1.5 SRM floor applies instead of the ±20 %.
 *
 * ```
 * OG check   8.5×38 + 1.25×37 + 0.25×33 + 0.125×35 = 381.9 pt·lb
 *            381.9 × 0.65 / 5 gal                  = 49.6 → 1.0496 (published 1.049)
 * SRM check  MCU = (8.5×2 + 1.25×6 + 0.25×38 + 0.125×11) / 5 = 7.08
 *            1.4922 × 7.08^0.6859                  = 5.71 (published 5)
 * ```
 *
 * The engine reads the step mash as the duration-weighted mean of the rests
 * inside 55–75 °C, so the 169 °F (76.1 °C) recirculation drops out and the
 * remainder is (55×10 + 62.8×40 + 70×20) / 70 = 63.7 °C.
 */
export const GORDON_STRONG_HELLES: PublishedRecipe = {
  name: "Gordon Strong's Munich Helles",
  style: 'Munich Helles',
  source: {
    title: "Gordon Strong's Munich Helles Recipe",
    url: 'https://byo.com/recipes/gordon-strongs-munich-helles-recipe/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (19 L) all-grain, 90 min boil, step mash 131/145/158/169 °F. ' +
      'RO water to pH 5.5. Efficiency not stated on the page; BYO’s house ' +
      'standard is 65 %. Hop form not stated — the fixture assumes pellets.',
  },
  equipment: benchProfile('Gordon Strong helles bench (BYO 65 %)', BYO_EFFICIENCY),
  input: {
    name: "Gordon Strong's Munich Helles",
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 90,
    fermentables: [
      {
        name: 'German Pilsner',
        amountKg: 8.5 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 2,
      },
      {
        name: 'Munich',
        amountKg: 1.25 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 37,
        colorLovibond: 6,
      },
      {
        name: 'Aromatic',
        amountKg: 4 * OZ,
        class: 'grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 38,
      },
      // Weyermann publishes Carahell at 8.1–11.8 °L, 1.035 PPG.
      {
        name: 'Carahell',
        amountKg: 2 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 35,
        colorLovibond: 11,
      },
    ],
    hops: [
      // The engine credits a first-wort hop with the whole boil (90 minutes
      // here) plus the 1.10 utilisation bonus.
      {
        name: 'Vanguard (first wort)',
        amountKg: 0.25 * OZ,
        alphaAcidPercent: 5.2,
        form: 'pellet',
        use: 'first-wort',
        timeMinutes: 0,
      },
      {
        name: 'Vanguard',
        amountKg: 0.75 * OZ,
        alphaAcidPercent: 5.2,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
    ],
    yeasts: [
      // WLP833 German Bock Lager, the first strain listed. White Labs
      // publishes 70–76 % apparent attenuation.
      {
        name: 'White Labs WLP833 German Bock Lager',
        type: 'lager',
        form: 'liquid',
        attenuationMinPercent: 70,
        attenuationMaxPercent: 76,
      },
    ],
    mashSteps: [
      { name: 'Acid/protein rest', type: 'infusion', targetTempC: 55, timeMinutes: 10 },
      { name: 'Beta rest', type: 'temperature', targetTempC: 62.8, timeMinutes: 40 },
      { name: 'Alpha rest', type: 'temperature', targetTempC: 70, timeMinutes: 20 },
      { name: 'Recirculate', type: 'temperature', targetTempC: 76.1, timeMinutes: 15 },
    ],
  },
  published: { og: 1.049, fg: 1.011, abv: 5.0, ibu: 18, srm: 5 },
};

// ===========================================================================
// 4 — Holier than Meow Hefeweizen
// ===========================================================================

/**
 * A 50/50 wheat grist, one bittering hop, one rest. It's the simplest recipe
 * in the corpus and the closest thing it has to a control.
 *
 * ```
 * implied efficiency  4.5×38 + 4.5×37 = 337.5 pt·lb → 67.5 points at 100 %
 *                     48 / 67.5 = 71.1 %  → the fixture uses 70 %
 *                     337.5 × 0.70 / 5 = 47.25 → 1.0473 (published 1.048)
 * IBU check           34.02 g × 4 % / 18.927 L = 71.9 mg/L
 *                     bigness 1.0786 × btf(60) 0.219104 × 1.10 pellet × 71.9 = 18.7
 *                     (published 18)
 * ```
 */
export const HOLIER_THAN_MEOW_HEFEWEIZEN: PublishedRecipe = {
  name: 'Holier than Meow Hefeweizen',
  style: 'Hefeweizen',
  source: {
    title: 'Holier than Meow Hefeweizen',
    url: 'https://homebrewersassociation.org/homebrew-recipe/holier-meow-hefeweizen/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (18.9 L), 60–75 min boil (the fixture takes 60), single infusion ' +
      '149 °F (65 °C) for 60–75 min, mash out 168 °F (76 °C). Efficiency not ' +
      'stated — the fixture uses the 70 % the grist and published OG imply. Hop ' +
      'form not stated — the fixture assumes pellets.',
  },
  equipment: benchProfile('Holier than Meow bench (implied 70 %)', 70),
  input: {
    name: 'Holier than Meow Hefeweizen',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 60,
    fermentables: [
      {
        name: 'Pilsner malt',
        amountKg: 4.5 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 2,
      },
      {
        name: 'Red wheat malt',
        amountKg: 4.5 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 37,
        colorLovibond: 2,
      },
    ],
    hops: [
      {
        name: 'Hallertau',
        amountKg: 1.2 * OZ,
        alphaAcidPercent: 4,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
    ],
    yeasts: [
      // Wyeast publishes 73–77 % apparent attenuation for 3068.
      {
        name: 'Wyeast 3068 Weihenstephan Weizen',
        type: 'wheat',
        form: 'liquid',
        attenuationMinPercent: 73,
        attenuationMaxPercent: 77,
      },
    ],
    mashSteps: [
      { name: 'Saccharification', type: 'infusion', targetTempC: 65, timeMinutes: 60 },
      // 168 °F is above the engine's 75 °C saccharification ceiling, so this
      // step is kept in the schedule but left out of the attenuation estimate.
      { name: 'Mash out', type: 'temperature', targetTempC: 76, timeMinutes: 10 },
    ],
  },
  published: { og: 1.048, fg: 1.01, abv: 4.9, ibu: 18, srm: 3.5 },
};

// ===========================================================================
// 5 — BYO Trappist-style Tripel (candi syrup added in the fermenter)
// ===========================================================================

/**
 * The adjunct case. A pound of Belgian candi syrup goes in near the end of
 * fermentation, which tests the engine's `fermenter` stage and the
 * `ogEquivalent`/`og` split. The wort that gets pitched is 1.080, the finished
 * beer got 1.086 worth of extract, and the FG is worked out from the 1.086 with
 * the sugar at 100 % fermentability.
 *
 * ```
 * OG check   15.75×38 + 0.4375×36.8      = 614.6 pt·lb
 *            614.6 × 0.65 / 5 gal        = 79.9 → 1.0799 (published 1.082)
 * with syrup 1 lb × 32 PPG / 5 gal       = +6.4 points → ogEquivalent ≈ 1.086
 * ```
 */
export const BYO_TRAPPIST_TRIPEL: PublishedRecipe = {
  name: 'BYO Trappist-style Tripel',
  style: 'Belgian Tripel',
  source: {
    title: 'Belgian Tripel (Trappist-style Tripel)',
    url: 'https://byo.com/recipes/trappist-style-tripel/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (19 L) all-grain, 90 min boil, step mash 144 °F 30 min / 158 °F ' +
      '30 min / 172 °F mash out, 2.8 volumes CO₂. The candi syrup is stated as ' +
      'going in "near end of fermentation". Efficiency not stated; BYO’s house ' +
      'standard is 65 %. Hop form not stated — the fixture assumes pellets. The ' +
      'recipe gives Weyermann Abbey Malt as 26 °L, which is darker than ' +
      'Weyermann’s own 15.5–19.3 °L; the fixture keeps the recipe’s figure.',
  },
  equipment: benchProfile('BYO tripel bench (BYO 65 %)', BYO_EFFICIENCY),
  input: {
    name: 'Trappist-style Tripel',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 90,
    fermentables: [
      {
        name: 'Pilsner malt',
        amountKg: 15.75 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 2,
      },
      {
        name: 'Weyermann Abbey Malt',
        amountKg: 7 * OZ,
        class: 'grain',
        use: 'mash',
        ppg: 36.8,
        colorLovibond: 26,
      },
      {
        name: 'Belgian candi syrup',
        amountKg: 1 * LB,
        class: 'sugar',
        use: 'fermenter',
        ppg: 32,
        colorLovibond: 1,
      },
    ],
    hops: [
      {
        name: 'Premiant',
        amountKg: 1.1 * OZ,
        alphaAcidPercent: 7.5,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
      {
        name: 'Saaz',
        amountKg: 0.7 * OZ,
        alphaAcidPercent: 3.75,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 30,
      },
    ],
    yeasts: [
      // Wyeast publishes 74–78 % apparent attenuation for 3787.
      {
        name: 'Wyeast 3787 Trappist High Gravity',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 74,
        attenuationMaxPercent: 78,
      },
    ],
    mashSteps: [
      { name: 'Beta rest', type: 'infusion', targetTempC: 62.2, timeMinutes: 30 },
      { name: 'Alpha rest', type: 'temperature', targetTempC: 70, timeMinutes: 30 },
      { name: 'Mash out', type: 'temperature', targetTempC: 77.8, timeMinutes: 10 },
    ],
  },
  published: { og: 1.082, fg: 1.013, abv: 8.9, ibu: 32, srm: 6 },
  bands: {
    // Two widenings, both caused by the same fermenter sugar addition.
    //
    // For FG, BYO's 1.013 is 84 % apparent attenuation on its own 1.082, six
    // points above the 78 % Wyeast publishes for 3787. The recipe is quoting
    // what the strain does on a sugar-fed tripel, and the lab figure is for
    // all-malt wort. The engine works from the published range, so it finishes
    // near 1.018.
    fgSg: 0.008,
    // For ABV, BYO's 8.9 % is (1.082 − 1.013) × 131.25 = 9.06 rounded down,
    // which is the simple shortcut. Cutaia on the engine's own OG-equivalent/FG
    // pair lands near 9.7 %. See the Old Rasputin note for the divergence term.
    abvAbs: 1.0,
  },
};

// ===========================================================================
// 6 — Battre L'oie Saison (AHA Big Brew 2017)
// ===========================================================================

/**
 * The high-attenuation case: 85.7 % apparent on the published pair, a pound of
 * table sugar at flame-out, and a finish at 1.007. It tests the per-fermentable
 * fermentability weighting from the other direction to recipe B, with sugar
 * pulling the net attenuation up where lactose pulled it down.
 *
 * ```
 * implied efficiency
 *   grain 6.6×38 + 1.1×37 + 1.1×37 = 332.2 pt·lb; sugar 1.1×46 = 50.6 pt·lb
 *   published 49 points × 5 gal = 245 → grain must deliver 245 − 50.6 = 194.4
 *   194.4 / 332.2 = 58.5 %  → the fixture uses 60 %
 *   (332.2 × 0.60 + 50.6) / 5 = 50.0 → 1.0500 against a published 1.049
 * ```
 *
 * 60 % is low for all-grain, but it isn't a transcription mistake. Big Brew
 * recipes are written to be brewed on a folding table in a car park, and the
 * AHA's other Big Brew sheets give similar figures (the 2026 imperial stout
 * states 49 %).
 */
export const BATTRE_LOIE_SAISON: PublishedRecipe = {
  name: "Battre L'oie Saison",
  style: 'Saison',
  source: {
    title: "Battre L'oie Saison (All-Grain) — AHA Big Brew 2017 official recipe",
    url: 'https://homebrewersassociation.org/homebrew-recipe/battre-loie-saison-grain/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (18.93 L), 60 min boil, pre-boil 7 gallons, mash 153 °F (67 °C) ' +
      '60 min, mash out 168 °F (76 °C). Pellet hops with alpha acids given. Sugar ' +
      'added at flame-out. Yeast given only as "Belgian saison yeast, 200 billion ' +
      'cells". Efficiency not stated — the fixture uses the 60 % the grist, the ' +
      'sugar and the published OG imply.',
  },
  equipment: benchProfile("Battre L'oie bench (implied 60 %)", 60),
  input: {
    name: "Battre L'oie Saison",
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 60,
    fermentables: [
      {
        name: 'Pilsner malt',
        amountKg: 6.6 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 2,
      },
      {
        name: 'Vienna malt',
        amountKg: 1.1 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 37,
        colorLovibond: 4,
      },
      {
        name: 'Wheat malt',
        amountKg: 1.1 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 37,
        colorLovibond: 2,
      },
      // Flame-out is the whirlpool stage. The extract is in the kettle, so it
      // counts towards OG, which a fermenter addition wouldn't.
      {
        name: 'White table sugar',
        amountKg: 1.1 * LB,
        class: 'sugar',
        use: 'whirlpool',
        ppg: 46,
        colorLovibond: 0,
      },
    ],
    hops: [
      {
        name: 'Aramis',
        amountKg: 1 * OZ,
        alphaAcidPercent: 7,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
      {
        name: 'Barbe Rouge',
        amountKg: 1 * OZ,
        alphaAcidPercent: 8.5,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 15,
        whirlpoolTempC: 80,
      },
    ],
    yeasts: [
      // Wyeast 3724 Belgian Saison, the archetype for "Belgian saison yeast".
      // Wyeast publishes 76–80 % apparent attenuation.
      {
        name: 'Wyeast 3724 Belgian Saison',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 76,
        attenuationMaxPercent: 80,
      },
    ],
    mashSteps: [
      { name: 'Saccharification', type: 'infusion', targetTempC: 67, timeMinutes: 60 },
      { name: 'Mash out', type: 'temperature', targetTempC: 76, timeMinutes: 10 },
    ],
  },
  published: { og: 1.049, fg: 1.007, abv: 5.6, ibu: 27, srm: 3 },
};

// ===========================================================================
// 7 — Whiplash "Slow Life" Dry Irish Stout
// ===========================================================================

/**
 * A working brewery's recipe scaled to 5 gallons. It has flaked barley,
 * dehusked Carafa, and a single high-alpha bittering charge that has to reach
 * 43 IBU on its own.
 *
 * ```
 * implied efficiency
 *   5.6×38 + 1.3×32 + 0.6875×30 + 0.59375×32 + 0.4375×33 = 308.4 pt·lb
 *   308.4 / 5 gal = 61.7 points at 100 %; 47 / 61.7 = 76.2 % → fixture uses 75 %
 *   308.4 × 0.75 / 5 = 46.3 → 1.0463 against a published 1.047
 * IBU check
 *   21.26 g × 14.5 % / 18.927 L = 162.9 mg/L
 *   bigness 1.0883 × btf(60) 0.219104 × 1.10 pellet × 162.9 = 42.7 (published 43)
 * ```
 */
export const WHIPLASH_SLOW_LIFE_STOUT: PublishedRecipe = {
  name: 'Whiplash Slow Life Dry Irish Stout',
  style: 'Irish Dry Stout',
  source: {
    title: 'Whiplash Slow Life Dry Irish Stout',
    url: 'https://homebrewersassociation.org/homebrew-recipe/whiplash-slow-life-dry-irish-stout/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 US gallons (18.9 L), 80 min boil, mash 154 °F (68 °C) 60 min, pitch ' +
      '0.8 M cells/mL/°P, ferment 66 °F 7 days. Efficiency not stated — the ' +
      'fixture uses the 75 % the grist and published OG imply. Hop form not ' +
      'stated — the fixture assumes pellets, which is what a 14.5 % alpha Magnum ' +
      'is sold as.',
  },
  equipment: benchProfile('Whiplash bench (implied 75 %)', 75),
  input: {
    name: 'Slow Life Dry Irish Stout',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 80,
    fermentables: [
      {
        name: 'Maris Otter',
        amountKg: 5.6 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 4,
      },
      {
        name: 'Flaked barley',
        amountKg: 1.3 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 32,
        colorLovibond: 2,
      },
      // Weyermann publishes Carafa Special Type 2 at EBC 1100–1200, i.e.
      // 415–453 °L, and the fixture takes 430 °L. The yield isn't published in
      // PPG, so we use 30, the conventional figure for a dehusked roasted malt.
      {
        name: 'Carafa Special II',
        amountKg: 11 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 30,
        colorLovibond: 430,
      },
      // See the Old Rasputin note on brown malt colour.
      {
        name: 'Brown malt',
        amountKg: 9.5 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 32,
        colorLovibond: 65,
      },
      // Crisp publishes English amber malt at approximately 27 °L.
      {
        name: 'Amber malt',
        amountKg: 7 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 27,
      },
    ],
    hops: [
      {
        name: 'Hallertau Magnum',
        amountKg: 0.75 * OZ,
        alphaAcidPercent: 14.5,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
    ],
    yeasts: [
      // WLP007 Dry English Ale, the first strain listed. White Labs publishes
      // 70–80 % apparent attenuation.
      {
        name: 'White Labs WLP007 Dry English Ale',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 70,
        attenuationMaxPercent: 80,
      },
    ],
    mashSteps: [{ name: 'Saccharification', type: 'infusion', targetTempC: 68, timeMinutes: 60 }],
  },
  published: { og: 1.047, fg: 1.013, abv: 4.5, ibu: 43, srm: 31 },
};

// ===========================================================================
// 8 — BYO Ordinary Bitter
// ===========================================================================

/**
 * The low-gravity end. At OG 1.038 Tinseth's bigness factor is 1.17, compared
 * with ~1.0 for a mid-gravity beer, so this recipe would catch a bigness term
 * applied the wrong way round.
 *
 * ```
 * OG check   7×38 + 0.5×33 + 0.25×33 = 290.75 pt·lb
 *            290.75 × 0.65 / 5 gal   = 37.8 → 1.0378 (published 1.038)
 * SRM check  MCU = (7×4 + 0.5×120 + 0.25×50) / 5 = 20.1
 *            1.4922 × 20.1^0.6859    = 11.69 (published 11)
 * ```
 */
export const BYO_ORDINARY_BITTER: PublishedRecipe = {
  name: 'BYO Ordinary Bitter',
  style: 'Ordinary Bitter',
  source: {
    title: 'Ordinary Bitter',
    url: 'https://byo.com/recipes/ordinary-bitter-2/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (19 L) all-grain, 75 min boil, dough in at ~1 qt/lb, mash 152 °F ' +
      '(67 °C) 60 min. Hops given as AAU with the alpha acid stated. Efficiency ' +
      'not stated; BYO’s house standard is 65 %. Hop form not stated — the ' +
      'fixture assumes pellets.',
  },
  equipment: benchProfile('BYO ordinary bitter bench (BYO 65 %)', BYO_EFFICIENCY),
  input: {
    name: 'Ordinary Bitter',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 75,
    fermentables: [
      {
        name: 'English pale ale malt',
        amountKg: 7 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 4,
      },
      {
        name: 'Crystal 120 °L',
        amountKg: 0.5 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 120,
      },
      {
        name: 'Special Roast',
        amountKg: 0.25 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 50,
      },
    ],
    hops: [
      {
        name: 'East Kent Goldings',
        amountKg: 1.2 * OZ,
        alphaAcidPercent: 5,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
      {
        name: 'East Kent Goldings',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 5,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 30,
      },
      {
        name: 'East Kent Goldings',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 5,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 1,
      },
    ],
    yeasts: [
      // WLP002 English Ale, the first strain listed. White Labs publishes
      // 63–70 % apparent attenuation.
      {
        name: 'White Labs WLP002 English Ale',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 63,
        attenuationMaxPercent: 70,
      },
    ],
    mashSteps: [{ name: 'Saccharification', type: 'infusion', targetTempC: 66.7, timeMinutes: 60 }],
  },
  published: { og: 1.038, fg: 1.011, abv: 3.5, ibu: 30, srm: 11 },
};

// ===========================================================================
// 9 — Gordon Strong's Cream Ale
// ===========================================================================

/**
 * Flaked corn mashed with the base malts, plus a pound of corn sugar at 15
 * minutes. The adjunct is in the mash (so it takes mash efficiency) and the
 * sugar is in the kettle at 100 %, so the grist goes down two different paths.
 *
 * ```
 * OG check   grain 3.5×38 + 3.5×37 + 2×40 = 342.5 pt·lb → × 0.65 = 222.6
 *            sugar 1×42 at 100 %                        = 42
 *            (222.6 + 42) / 5 gal                       = 52.9 → 1.0529 (published 1.052)
 * ```
 */
export const GORDON_STRONG_CREAM_ALE: PublishedRecipe = {
  name: "Gordon Strong's Cream Ale",
  style: 'Cream Ale',
  source: {
    title: "Gordon Strong's Cream Ale",
    url: 'https://byo.com/recipes/gordon-strongs-cream-ale/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (19 L) all-grain, 90 min boil, mash malts and corn at 152 °F ' +
      '(66 °C) 60 min, raise to 168 °F for lautering, corn sugar at 15 min, lager ' +
      'four weeks. Efficiency not stated; BYO’s house standard is 65 %. Hop form ' +
      'not stated — the fixture assumes pellets.',
  },
  equipment: benchProfile('Gordon Strong cream ale bench (BYO 65 %)', BYO_EFFICIENCY),
  input: {
    name: "Gordon Strong's Cream Ale",
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 90,
    fermentables: [
      {
        name: 'German Pilsner',
        amountKg: 3.5 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 2,
      },
      {
        name: 'US 2-row',
        amountKg: 3.5 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 37,
        colorLovibond: 2,
      },
      {
        name: 'Flaked corn',
        amountKg: 2 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 40,
        colorLovibond: 1,
      },
      {
        name: 'Corn sugar',
        amountKg: 1 * LB,
        class: 'sugar',
        use: 'boil',
        ppg: 42,
        colorLovibond: 1,
      },
    ],
    hops: [
      {
        name: 'Vanguard (first wort)',
        amountKg: 0.25 * OZ,
        alphaAcidPercent: 4.6,
        form: 'pellet',
        use: 'first-wort',
        timeMinutes: 0,
      },
      {
        name: 'Vanguard',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 4.6,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
      {
        name: 'Vanguard',
        amountKg: 0.25 * OZ,
        alphaAcidPercent: 4.6,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 5,
      },
    ],
    yeasts: [
      // Wyeast 1056 American Ale, the first strain listed: 73–77 %.
      {
        name: 'Wyeast 1056 American Ale',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 73,
        attenuationMaxPercent: 77,
      },
    ],
    mashSteps: [
      { name: 'Saccharification', type: 'infusion', targetTempC: 66, timeMinutes: 60 },
      { name: 'Mash out', type: 'temperature', targetTempC: 75.6, timeMinutes: 15 },
    ],
  },
  published: { og: 1.052, fg: 1.01, abv: 5.6, ibu: 14, srm: 3 },
};

// ===========================================================================
// 10 — Danado de Bom Oatmeal Stout
// ===========================================================================

/**
 * The only 6-gallon batch in the corpus, and the highest MCU. It has 713
 * MCU·gal of colour over 6 gallons, which is where the Morey fit flattens most.
 *
 * ```
 * implied efficiency
 *   7×38 + 1×35 + 0.5×33 + 0.75×33 + 0.5×28 + 0.5×29 + 0.75×33 = 395.5 pt·lb
 *   395.5 / 6 gal = 65.9 points at 100 %; 48 / 65.9 = 72.8 % → fixture uses 72 %
 *   395.5 × 0.72 / 6 = 47.5 → 1.0475 against a published 1.048
 * SRM check
 *   MCU = (7×4 + 1×15 + 0.5×38 + 0.75×300 + 0.5×500 + 0.5×350 + 0.75×2) / 6 = 118.9
 *   1.4922 × 118.9^0.6859 = 39.6 (published 45)
 * ```
 */
export const DANADO_DE_BOM_OATMEAL_STOUT: PublishedRecipe = {
  name: 'Danado de Bom Oatmeal Stout',
  style: 'Oatmeal Stout',
  source: {
    title: 'Danado de Bom Oatmeal Stout (Damn Good Oatmeal Stout)',
    url: 'https://homebrewersassociation.org/homebrew-recipe/danado-de-bom-oatmeal-stout-damn-good-oatmeal-stout/',
    accessed: '2026-08-25',
    statedAssumptions:
      '6 gallons (23 L), 60 min boil, step infusion 132 °F 30 min / 155 °F 30 min ' +
      '/ 167 °F mash out, 1 tsp gypsum, Irish moss at 10 min. Efficiency not ' +
      'stated — the fixture uses the 72 % the grist and published OG imply. Hop ' +
      'form stated only for the dry hop ("Crystal hop pellets"); the fixture ' +
      'assumes pellets throughout.',
  },
  equipment: benchProfile('Danado de Bom bench (implied 72 %)', 72),
  input: {
    name: 'Danado de Bom Oatmeal Stout',
    batchVolumeL: 6 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 60,
    fermentables: [
      {
        name: 'Maris Otter pale malt',
        amountKg: 7 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 4,
      },
      {
        name: 'English crystal 15 °L',
        amountKg: 1 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 35,
        colorLovibond: 15,
      },
      {
        name: 'Belgian aromatic malt',
        amountKg: 8 * OZ,
        class: 'grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 38,
      },
      {
        name: 'Roasted barley',
        amountKg: 12 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 300,
      },
      {
        name: 'Black malt',
        amountKg: 8 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 28,
        colorLovibond: 500,
      },
      {
        name: 'Chocolate malt',
        amountKg: 8 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 29,
        colorLovibond: 350,
      },
      {
        name: 'Rolled oats',
        amountKg: 12 * OZ,
        class: 'grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 2,
      },
    ],
    hops: [
      {
        name: 'UK Challenger',
        amountKg: 1.25 * OZ,
        alphaAcidPercent: 5.8,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
      {
        name: 'UK Kent Goldings',
        amountKg: 1 * OZ,
        alphaAcidPercent: 6.3,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 10,
      },
      {
        name: 'Crystal (dry hop)',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 5.5,
        form: 'pellet',
        use: 'dry-hop',
        timeMinutes: 0,
        dryHopDays: 5,
      },
    ],
    yeasts: [
      // WLP862 Cry Havoc, named in the recipe. White Labs publishes 66–70 %
      // apparent attenuation, which is also what the recipe's own 1.048 → 1.016
      // pair works out to (66.7 %).
      {
        name: 'White Labs WLP862 Cry Havoc',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 66,
        attenuationMaxPercent: 70,
      },
    ],
    mashSteps: [
      { name: 'Protein rest', type: 'infusion', targetTempC: 55.6, timeMinutes: 30 },
      { name: 'Saccharification', type: 'temperature', targetTempC: 68.3, timeMinutes: 30 },
      { name: 'Mash out', type: 'temperature', targetTempC: 75, timeMinutes: 10 },
    ],
  },
  published: { og: 1.048, fg: 1.016, abv: 4.2, ibu: 34, srm: 45 },
};

// ===========================================================================
// 11 — Big Blimp! American Barleywine (AHA Big Brew 2025)
// ===========================================================================

/**
 * The biggest grist in the corpus, and the one where Tinseth's gravity term
 * matters most. At OG 1.096 the bigness factor is 0.70, so every hop in the
 * recipe gives 30 % less than it would in a pale ale.
 *
 * ```
 * implied efficiency
 *   grain 19×38 + 1×34 + 0.5×34 + 0.25×34 + 0.25×33 = 789.75 pt·lb
 *   sugar 1 lb dextrose × 42 = 42 pt·lb at 100 %
 *   published 96 points × 5 gal = 480 → grain must deliver 438 → 55.5 %
 *   the fixture uses 55 %: (789.75 × 0.55 + 42) / 5 = 95.3 → 1.0953 (published 1.096)
 * ```
 *
 * 55 % isn't a transcription error. Nineteen pounds of grain in a 5-gallon
 * batch does lauter that badly, and the AHA's own Big Brew sheets for beers
 * this size give figures in the same range (the 2026 imperial stout states
 * 49 %).
 *
 * ```
 * SRM check
 *   MCU = (19×4 + 1×38 + 0.5×65 + 0.25×115 + 0.25×2 + 1×1) / 5 = 35.35
 *   1.4922 × 35.35^0.6859 = 17.2 (published 17)
 * ```
 */
export const BIG_BLIMP_BARLEYWINE: PublishedRecipe = {
  name: 'Big Blimp! American Barleywine',
  style: 'American Barleywine',
  source: {
    title: 'Big Blimp! American Barleywine — Big Brew 2025 Official Recipe',
    url: 'https://homebrewersassociation.org/homebrew-recipe/big-blimp-barleywine-big-brew-2025/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 US gallons (18.9 L), 90 min boil, mash 150 °F (66 °C) 90 min at pH 5.3, ' +
      'batch or fly sparge 15–30 min, dextrose in the boil, dry hop 4 days. ' +
      'Efficiency not stated — the fixture uses the 55 % the grist and published ' +
      'OG imply. Hop form not stated — the fixture assumes pellets. Whirlpool ' +
      'duration not stated — the fixture assumes 20 minutes from 80 °C.',
  },
  equipment: benchProfile('Big Blimp bench (implied 55 %)', 55),
  input: {
    name: 'Big Blimp! American Barleywine',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 90,
    fermentables: [
      {
        name: 'Simpsons Finest Maris Otter',
        amountKg: 19 * LB,
        class: 'grain',
        use: 'mash',
        ppg: 38,
        colorLovibond: 4,
      },
      // Simpsons publishes Crystal Light at 36.2–42.9 °L and Crystal Medium at
      // 63.2–71.8 °L. The fixture takes the low end of each.
      {
        name: 'Simpsons Crystal Light',
        amountKg: 1 * LB,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 34,
        colorLovibond: 38,
      },
      {
        name: 'Simpsons Crystal Medium',
        amountKg: 8 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 34,
        colorLovibond: 65,
      },
      {
        name: 'Dingemans Special B',
        amountKg: 4 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 34,
        colorLovibond: 115,
      },
      {
        name: 'Rahr Dextrin Malt',
        amountKg: 4 * OZ,
        class: 'steeping-grain',
        use: 'mash',
        ppg: 33,
        colorLovibond: 2,
      },
      {
        name: 'Dextrose',
        amountKg: 1 * LB,
        class: 'sugar',
        use: 'boil',
        ppg: 42,
        colorLovibond: 1,
      },
    ],
    hops: [
      {
        name: 'Cascade (first wort)',
        amountKg: 0.75 * OZ,
        alphaAcidPercent: 5.8,
        form: 'pellet',
        use: 'first-wort',
        timeMinutes: 0,
      },
      {
        name: 'Centennial (first wort)',
        amountKg: 0.75 * OZ,
        alphaAcidPercent: 12.8,
        form: 'pellet',
        use: 'first-wort',
        timeMinutes: 0,
      },
      {
        name: 'Chinook (first wort)',
        amountKg: 0.75 * OZ,
        alphaAcidPercent: 10,
        form: 'pellet',
        use: 'first-wort',
        timeMinutes: 0,
      },
      {
        name: 'Cascade (whirlpool)',
        amountKg: 1.25 * OZ,
        alphaAcidPercent: 5.8,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 20,
        whirlpoolTempC: 80,
      },
      {
        name: 'Centennial (whirlpool)',
        amountKg: 1.25 * OZ,
        alphaAcidPercent: 12.8,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 20,
        whirlpoolTempC: 80,
      },
      {
        name: 'Chinook (whirlpool)',
        amountKg: 1.25 * OZ,
        alphaAcidPercent: 10,
        form: 'pellet',
        use: 'whirlpool',
        timeMinutes: 20,
        whirlpoolTempC: 80,
      },
      {
        name: 'Cascade (dry hop)',
        amountKg: 1 * OZ,
        alphaAcidPercent: 5.8,
        form: 'pellet',
        use: 'dry-hop',
        timeMinutes: 0,
        dryHopDays: 4,
      },
      {
        name: 'Centennial (dry hop)',
        amountKg: 2 * OZ,
        alphaAcidPercent: 12.8,
        form: 'pellet',
        use: 'dry-hop',
        timeMinutes: 0,
        dryHopDays: 4,
      },
      {
        name: 'Chinook (dry hop)',
        amountKg: 1 * OZ,
        alphaAcidPercent: 10,
        form: 'pellet',
        use: 'dry-hop',
        timeMinutes: 0,
        dryHopDays: 4,
      },
    ],
    yeasts: [
      // Two 11 g packs of LalBrew BRY-97. Lallemand publishes 78–84 %.
      {
        name: 'LalBrew BRY-97',
        type: 'ale',
        form: 'dry',
        attenuationMinPercent: 78,
        attenuationMaxPercent: 84,
        packs: 2,
        gramsPerPack: 11,
      },
    ],
    mashSteps: [{ name: 'Saccharification', type: 'infusion', targetTempC: 65.6, timeMinutes: 90 }],
  },
  published: { og: 1.096, fg: 1.018, abv: 11.2, ibu: 100, srm: 17 },
  bands: {
    // Every hop in this recipe is first-wort or whirlpool, with no boil
    // addition, and Tinseth's bigness factor at OG 1.096 is 0.70. The
    // first-wort charge gives ~64 IBU and a 20-minute stand from 80 °C adds ~6,
    // so Tinseth can't reach 100 on this schedule. A model that credits
    // whirlpool hops at or near boil utilisation can, and the AHA's figure
    // looks like it came from one. We widen the band to −35 % instead of
    // dropping the assertion, so the size of the disagreement stays visible.
    ibuRelative: 0.35,
  },
};

// ===========================================================================
// 12 — BYO American Pale Ale (extract with steeping grains)
// ===========================================================================

/**
 * The extract path. Liquid malt extract goes in at 100 %, three steeped grains
 * at the engine's 50 % steep efficiency, and with no mash there's no
 * mash-temperature shift on attenuation.
 *
 * ```
 * OG check   LME     6.6   × 35 × 1.00 = 231.0 pt·lb
 *            Munich  0.6625× 37 × 0.50 =  12.3
 *            Victory 0.6625× 34 × 0.50 =  11.3
 *            Wheat   0.4438× 37 × 0.50 =   8.2
 *            262.8 / 5 gal             = 52.6 → 1.0526 (published 1.056)
 * ```
 *
 * The 0.003 SG gap comes from the LME yield. The table figure used here is
 * 35 PPG, and an LME quoted at 36–37 (as BYO's own conversion articles do)
 * closes it. It's inside the OG band, and it's what you get from using the
 * cited table without fitting to the answer.
 */
export const BYO_AMERICAN_PALE_ALE_EXTRACT: PublishedRecipe = {
  name: 'BYO American Pale Ale (extract with grains)',
  style: 'American Pale Ale (extract with steeping grains)',
  source: {
    title: 'American Pale Ale',
    url: 'https://byo.com/recipes/american-pale-ale/',
    accessed: '2026-08-25',
    statedAssumptions:
      '5 gallons (19 L) extract with grains, 1 hour boil, steep the grain bag in ' +
      '~1 gallon at 160 °F (71 °C) for 30 min. Pellet hops, alpha acids given, ' +
      'with two "0 min." flame-out additions. No efficiency applies to the ' +
      'extract; the steep is left on the engine’s 50 % default.',
  },
  // There's no mash, so the efficiency figure isn't used. The extract is 100 %
  // and the steeped grain takes the 50 % steep default from the options. 65 %
  // is recorded so this profile matches the other BYO profiles.
  equipment: benchProfile('BYO American Pale Ale bench (extract)', BYO_EFFICIENCY),
  input: {
    name: 'American Pale Ale (extract with grains)',
    batchVolumeL: 5 * GAL,
    batchVolumeBasis: 'fermenter',
    boilTimeMinutes: 60,
    fermentables: [
      {
        name: 'Pale liquid malt extract',
        amountKg: 6.6 * LB,
        class: 'liquid-extract',
        use: 'boil',
        ppg: 35,
        colorLovibond: 4,
      },
      {
        name: 'Best Malz Munich malt',
        amountKg: 10.6 * OZ,
        class: 'steeping-grain',
        use: 'steep',
        ppg: 37,
        colorLovibond: 6,
      },
      // Briess publishes Victory at 28 °L.
      {
        name: 'Briess Victory malt',
        amountKg: 10.6 * OZ,
        class: 'steeping-grain',
        use: 'steep',
        ppg: 34,
        colorLovibond: 28,
      },
      {
        name: 'Great Western wheat malt',
        amountKg: 7.1 * OZ,
        class: 'steeping-grain',
        use: 'steep',
        ppg: 37,
        colorLovibond: 2,
      },
    ],
    hops: [
      {
        name: 'Horizon',
        amountKg: 0.53 * OZ,
        alphaAcidPercent: 13,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 60,
      },
      {
        name: 'Centennial',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 9,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 10,
      },
      {
        name: 'Cascade',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 6,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 10,
      },
      // "0 min." is flame-out with no stand stated. It's entered as a
      // zero-minute boil addition, which is how BYO's own IBU figure treats it.
      {
        name: 'Centennial (flame-out)',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 9,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 0,
      },
      {
        name: 'Cascade (flame-out)',
        amountKg: 0.5 * OZ,
        alphaAcidPercent: 6,
        form: 'pellet',
        use: 'boil',
        timeMinutes: 0,
      },
    ],
    yeasts: [
      {
        name: 'White Labs WLP001 California Ale',
        type: 'ale',
        form: 'liquid',
        attenuationMinPercent: 73,
        attenuationMaxPercent: 80,
      },
    ],
  },
  published: { og: 1.056, fg: 1.013, abv: 5.7, ibu: 40, srm: 6 },
};

/** Every published recipe in the band-test corpus. */
export const PUBLISHED_RECIPES: readonly PublishedRecipe[] = [
  BOOMSLANG_IPA,
  OLD_RASPUTIN_CLONE,
  GORDON_STRONG_HELLES,
  HOLIER_THAN_MEOW_HEFEWEIZEN,
  BYO_TRAPPIST_TRIPEL,
  BATTRE_LOIE_SAISON,
  WHIPLASH_SLOW_LIFE_STOUT,
  BYO_ORDINARY_BITTER,
  GORDON_STRONG_CREAM_ALE,
  DANADO_DE_BOM_OATMEAL_STOUT,
  BIG_BLIMP_BARLEYWINE,
  BYO_AMERICAN_PALE_ALE_EXTRACT,
];
