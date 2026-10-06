/**
 * The brewing calculation engine behind Beerwright.
 *
 * It's plain TypeScript with no DOM, no I/O and no framework, so it runs the
 * same in a browser, a Cloudflare Worker or a test runner.
 *
 * Every function works in one set of units: kilograms, liters, degrees
 * Celsius, specific gravity and ppm. Convert at the edges with the functions
 * in the Units category.
 *
 * Start at {@link calculateRecipe}. It runs the other modules and returns the
 * recipe's numbers, with an explanation of how each one was worked out. The
 * [Start here](../docs/guides/start-here.md) guide walks through it, and
 * through the units and defaults the rest of the package shares.
 *
 * @categoryDescription Guides
 * One guide per area: what you'd build with it, the functions to call first,
 * and a worked example whose numbers are checked by the tests.
 *
 * @categoryDescription How the math works
 * The formulas behind the numbers, where each one comes from, and what it
 * leaves out.
 *
 * @categoryDescription Recipe
 * A whole recipe in, every number out. Start with {@link calculateRecipe},
 * then {@link recipeChecks} for what's worth knowing before brew day. The
 * recipe's input types, the equipment profile and the engine-wide defaults
 * live here too. See the [Recipe guide](../docs/guides/recipe.md).
 *
 * @categoryDescription Gravity and ABV
 * Extract, efficiency, original and final gravity, attenuation, ABV and
 * calories, the volume waterfall, and the corrections for hydrometer and
 * refractometer readings. Start with {@link abv},
 * {@link correctHydrometerReading}, {@link refractometerFinalGravityRaw} and
 * {@link planVolumes}. The [Recipe guide](../docs/guides/recipe.md) has them
 * in use.
 *
 * @categoryDescription Hops
 * Bitterness by Tinseth, Rager or Garetz, whirlpool and hop-stand additions,
 * and the alpha acid a hop loses in storage. Start with {@link calculateIbu}
 * and {@link agedAlphaAcidPercent}. See the
 * [Hops guide](../docs/guides/hops.md).
 *
 * @categoryDescription Color
 * Malt color units to SRM by Morey, Daniels or Mosher, conversions between
 * SRM, EBC and Lovibond, and a hex swatch for the beer. Start with
 * {@link calculateColor} and {@link srmToHex}. The formulas are on the
 * [Gravity, IBU and color](../docs/gravity-ibu-colour.md) page.
 *
 * @categoryDescription Water and mash pH
 * Water profiles, salt and acid additions, two salt solvers, and a mash pH
 * prediction from the grist. Start with {@link solveWaterRule} or
 * {@link solveWaterProfile} for the salts, {@link applySalts} for salts the
 * brewer chose, and {@link predictMashPh} for the pH. See the
 * [Water and mash pH guide](../docs/guides/water.md).
 *
 * @categoryDescription Yeast
 * Pitch rates, cell counts, viability by age, starters and dry-yeast sachets.
 * Start with {@link pitchPlan} and {@link planStarter}. See the
 * [Yeast and starters guide](../docs/guides/yeast.md).
 *
 * @categoryDescription Decoction
 * Sizing each decoction pull from a heat balance, and planning a whole
 * schedule. Start with {@link decoctionPull} and {@link planDecoctions}. See
 * the [Decoction guide](../docs/guides/decoction.md).
 *
 * @categoryDescription Packaging
 * CO₂ volumes from temperature and pressure, priming sugar, and sulfite and
 * sorbate doses. Start with {@link primingSugar} and
 * {@link pressureFromCo2Volumes}. See the
 * [Packaging guide](../docs/guides/packaging.md).
 *
 * @categoryDescription Blending, mead and spirits
 * Blends of finished beers, the Pearson square, mead and cider musts with
 * their nutrient schedules, and proofing and sweetening a spirit. Start with
 * {@link evaluateBlend}, {@link pearsonSquare}, {@link sugarToGravity} and
 * {@link proofAndSweeten}. See the
 * [Blending, mead and spirits guide](../docs/guides/blending.md).
 *
 * @categoryDescription Flavor
 * A recipe's flavor profile on three wheels (malt, hops and fermentation),
 * and how well it fits a style's bands. Start with {@link flavorProfile},
 * then {@link flavorFit}.
 *
 * @categoryDescription Units
 * The engine works in kilograms, liters, °C and specific gravity. These
 * convert at the edges. Start with {@link sgToPlato} and
 * {@link gallonsToLitres}, and see
 * [Start here](../docs/guides/start-here.md) for which unit each field
 * expects.
 *
 * @categoryDescription Explanations and sources
 * The working behind every headline number, and the bibliography it cites.
 * Start with the {@link Explanation} type, then
 * {@link referenceExplanations} for every explanation of one worked example.
 * [Start here](../docs/guides/start-here.md) shows how to display one.
 *
 * @packageDocumentation
 */

/**
 * Version string for this build of the engine, for callers that report which
 * engine produced a result.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const CORE_VERSION = '0.0.0';

export * from './abv';
export * from './acid';
export * from './blending';
export * from './carbonation';
export * from './color';
export * from './corrections';
export * from './decoction';
export * from './defaults';
export * from './explain';
export * from './flavor';
export * from './gravity';
export * from './hop-freshness';
export * from './ibu';
export * from './kettlePh';
export * from './mashPh';
export * from './must';
export * from './pearson';
export * from './recipe';
export * from './recipe-checks';
export * from './reference';
export * from './schedules';
export * from './sources';
export * from './spirits';
export * from './stabilising';
export * from './starter';
export type * from './types';
export * from './units/index';
export * from './volumes';
export * from './water';
export * from './waterSolver';
export * from './yeast';
