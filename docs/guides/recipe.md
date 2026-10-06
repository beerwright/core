---
title: Recipe
category: Guides
---

# Recipe

This is the guide for a recipe builder, a brew-day sheet, or anything else
that holds a whole recipe and wants all its numbers at once. It also covers
the gravity readings you take along the way.

## The functions to start with

- {@link calculateRecipe} answers "what will this recipe make?" It returns the
  vitals, the volume waterfall, each fermentable's and each hop's share, the
  strike temperature and, when the recipe has them, the water chemistry and the
  decoction plan.
- {@link recipeChecks} answers "is there anything I should know before brew
  day?" It reads what `calculateRecipe` returned and reports problems in the
  order you'd hit them on the day: kettle, mash, fermenter, pH, pitch,
  fermentation temperature, style.
- {@link correctHydrometerReading}, {@link refractometerFinalGravityRaw} and
  {@link abv} answer the questions you have once it's brewing: what a warm
  sample really reads, what a refractometer reading means once there's alcohol
  in it, and how strong the beer came out.

## A recipe on a small kettle

[Start here](./start-here.md) ran the README's pale ale on the default
equipment. Here it is on a 25 L kettle with a 23 L fermenter:

{@includeCode ../examples/recipe-checks.ts#checks}

The pale ale needs 25.2 L in the kettle when the boil starts, so `findings`
has two entries:

- a `warning` with id `boil-over-kettle`, saying the boil overflows the kettle
  by 0.19 L;
- a `note` with id `fermenter-headspace`. 20 L in a 23 L fermenter leaves 3 L
  of headspace, and the check would like a quarter of the fermenter, 5.75 L.

Each finding is a typed object with its numbers on it, discriminated on `id`,
so you write the sentence yourself in whatever words and units your app uses.
`calculateRecipe` also put "Pre-boil volume 25.2 L exceeds the kettle's 25 L."
in its own `warnings`. `supersedes` returns that exact string, so if you show
both lists you can drop the duplicate.

Two of the checks need something extra. The pitch check needs `now`, the date
to judge the yeast's age against, because a function that read the clock
would give different answers on different days. The style check needs
`styleBands`, the OG, FG, IBU and SRM ranges of the style you're aiming at.
Leave either out and that check is skipped.

## The working, and choosing formulas

`result.explain` has an {@link Explanation} for each headline number. For the
pale ale, `explain.og` says the formula is `extract-bookkeeping`, shows the
expression, and lists its inputs: 21.3 L post-boil, 75 % mash efficiency,
1,081.9 point-liters of extract out of a theoretical 1,442.5. Its source is
Palmer's *How to Brew*.

{@link CalculationOptions} picks the formula where there's a choice. The
same recipe under Rager instead of Tinseth:

{@includeCode ../examples/recipe-checks.ts#options}

Tinseth gives 33.0 IBU and Rager 37.7. The two are fits to different data and
a gap that size is normal between them, which is why the explanation always
says which one ran.

## Readings on brew day

A hydrometer sample at 32 °C that reads 1.048, and refractometer readings of
12.4 °Bx before pitching and 6.6 °Bx at the end:

{@includeCode ../examples/gravity.ts#readings}

The warm sample is really 1.052. The refractometer's final reading works out
to 1.011, and the beer is 5.5 % ABV.

## Traps

- **The batch size is into the fermenter.** `batchVolumeL` means chilled wort
  going into the fermenter unless you set `batchVolumeBasis: 'packaged'`.
  Everything upstream (strike, sparge, pre-boil) is worked back from it.
- **Hops are in kilograms.** A 28 g addition is `amountKg: 0.028`. It's the
  most common mistake, and the IBU comes out a thousand times too high.
- **Give a malt's yield one way.** A fermentable takes either
  `extractFineGrindDryBasisPercent` (the maltster's figure) or `ppg`. If you
  pass both, `ppg` wins, on the reasoning that it's the number someone typed
  in to override the catalog.
- **A refractometer reading needs both readings once fermentation starts.**
  {@link refractometerToGravity} is for unfermented wort only. Once there's
  alcohol, use {@link refractometerFinalGravityRaw} with the original and the
  current reading. It applies the wort correction factor (1.04 by default) to
  both, so pass what the instrument shows.
- **ABV comes from the OG-equivalent.** If the recipe adds sugar in the
  fermenter, `vitals.og` is what a hydrometer reads on the wort and
  `vitals.ogEquivalent` includes the sugar. ABV uses the second.

## Going further

- [Gravity, IBU and color](../gravity-ibu-colour.md) has the formulas behind
  the vitals.
- [Volume corrections](../volumes.md) explains the volume waterfall.
- [Refractometer and hydrometer](../instruments.md) covers the reading
  corrections.
- In the reference, the Recipe and Gravity and ABV categories list the rest:
  {@link planVolumes} for the waterfall alone, {@link predictGravities} for
  gravity without the rest of the recipe, and the inputs such as
  {@link RecipeInput} and {@link EquipmentProfileInput}.
