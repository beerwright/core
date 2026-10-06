---
title: Start here
category: none
---

# Start here

`@beerwright/core` is the brewing math Beerwright runs on. You hand it a
recipe, or one reading from brew day, and it hands back numbers: gravities,
bitterness, color, water and mash pH, yeast counts, priming doses and the rest.
It's plain TypeScript with no dependencies and no I/O, so it runs anywhere
TypeScript does. About seven hundred names are exported, which is a lot to walk
into cold, so this page is the short way through them.

It's on npm, so `npm install @beerwright/core` (or `pnpm add` or `yarn add`)
gets you started. Everything is exported from the package root, so every name
on these pages comes from one import:

```ts
import { calculateRecipe, primingSugar } from '@beerwright/core';
```

I've left that line out of the snippets. The examples themselves live in
`docs/examples/`, where they import the same names from `src/index.ts`, the
file behind the package root, so the tests can run them.

## Three ways in

### 1. A whole recipe

{@link calculateRecipe} takes a recipe and returns everything about it at once.
This is the pale ale from the README:

{@includeCode ../examples/pale-ale.ts#recipe}

What comes back has four parts.

- **`vitals`** has the headline numbers. This recipe comes out at OG 1.051,
  FG 1.010, 5.5 % ABV, 33 IBU and 9.4 SRM, which `colorHex` turns into
  `#E28100` for a swatch.
- **`volumes`** is the volume waterfall, from the strike water to the beer in
  the bottle. Here that's 14.7 L of strike water and 15.4 L of sparge, 25.2 L
  in the kettle at the start of the boil, and 20 L into the fermenter.
- **`explain`** holds the working behind each headline number, keyed by name
  (`og`, `fg`, `abv`, `ibu`, `srm` and a few more). More on these below.
- **`warnings`** is a list of sentences about anything worth a second look,
  such as a boil that won't fit in the kettle. This recipe has none.

There's more in the result when the recipe asks for it. Give it a `water`
section and you get `water`, with the treated profiles and a mash pH. Give it a
decoction step and you get `decoctions`. The [Recipe guide](./recipe.md) goes
through all of it.

### 2. One question at a time

Most of the package is calculators that answer one question each, and you
don't need a recipe to call them. Priming sugar for 19 liters of beer that
finished fermenting at 20 °C, aiming for 2.4 volumes of CO₂, looks like this:

{@includeCode ../examples/priming.ts#priming}

That's 129 g of corn sugar. The beer already holds 0.86 volumes from
fermentation, so the sugar only has to make the other 1.54. The same pattern
holds across the package. A refractometer reading goes through
{@link refractometerFinalGravityRaw}, a starter through {@link planStarter}, a
hydrometer sample taken warm through {@link correctHydrometerReading}. The
guides below name the two to four functions to reach for first in each area.

### 3. The working behind a number

Every headline number comes with an {@link Explanation}: the formula's name
(`formula`), the formula written out (`expression`), the values that went into
it (`inputs`), any assumptions or caveats (`notes`), and the books and papers
it comes from (`sources`). A recipe's are in `result.explain`. Most
calculators have a twin ending in `Explained` that returns one, so
{@link primingSugar} has {@link primingSugarExplained}.

They're plain data, so showing one is up to you. Here's a small function that
turns one into lines of text:

{@includeCode ../examples/explanation.ts#explain}

For the priming dose above, the first lines read:

```text
Priming sugar: 129.0 g
  sugar_g = (target − residual) × beerVolume_L × 1.96 / CO₂ yield per gram of sugar
  beerVolumeL = 19
  targetVolumes = 2.4
  fermentationTempC = 20
  residualVolumes = 0.86
```

and it ends with three notes and three sources, the first being Kai Troester's
article on calculating priming sugar. Beerwright shows exactly this when you
tap a number to see how it was worked out. If you want every explanation for
one worked example in a fixed order, {@link referenceExplanations} returns the
lot.

## Units

Everything inside is metric, in one set of units:

| Quantity | Unit | Example |
| --- | --- | --- |
| Mass | kilograms | a 28 g hop addition is `0.028` |
| Volume | liters | |
| Temperature | °C | |
| Gravity | specific gravity | `1.050`, not 50 points or 12.4 °P |
| Color | SRM, and °Lovibond for malts | |
| Percentages | 0 to 100 | 75 % efficiency is `75` |
| Fractions | 0 to 1 | a 40 % RO dilution is `0.4` |

The last two catch people out. A field typed {@link Percent} wants `75`, and
one typed {@link Fraction} wants `0.75`. The field's name usually says which
(`mashEfficiencyPercent`, `dilutionFraction`).

The Units category converts at the edges: {@link gallonsToLitres},
{@link poundsToKg}, {@link fahrenheitToCelsius}, {@link sgToPlato} and their
reverses. Two exceptions are worth knowing. Keg pressure is in PSI, because
that's what regulators are labeled in, with {@link psiToBar} and
{@link psiToKilopascals} alongside. And where a formula was published in US
units, such as malt color units, it's implemented in them and converted inside
that one function, so the coefficients match the paper.

## Defaults

Leave something out and the engine fills it in. The defaults are in
`src/defaults.ts`, and each one has a comment saying where its number came
from. The two you'll meet first are {@link DEFAULT_EQUIPMENT_PROFILE}, a 20 L
batch on a typical all-in-one system at 75 % mash efficiency, and
{@link DEFAULT_CALCULATION_OPTIONS}.

You override them by passing your own. `calculateRecipe`'s second argument is
an equipment profile where every field is optional, so
`{ boilOffRateLPerHour: 4 }` changes the boil-off and keeps everything else.
{@link resolveEquipmentProfile} shows you the profile that results.

## Choosing formulas

Where there's more than one published answer, you choose with
{@link CalculationOptions}, the third argument to `calculateRecipe`. The
defaults are Tinseth for IBU, Morey for color and the *Zymurgy* formula for
ABV. `{ ibuFormula: 'rager' }` gives the same pale ale 37.7 IBU in place of
33.0. The result's explanation always names the formula that ran, so a number
can be labeled `tinseth-1997` and checked against the paper.

## Where to go next

- [Recipe](./recipe.md): `calculateRecipe` in full, the pre-brew checks, and
  gravity readings from brew day.
- [Water and mash pH](./water.md): salts for a target, and the mash pH a grist
  and water give.
- [Hops](./hops.md): IBU from boil and whirlpool additions, and what a year in
  the fridge does to alpha acid.
- [Yeast and starters](./yeast.md): whether a pitch is enough, and the starter
  that makes it enough.
- [Decoction](./decoction.md): how big each pull should be.
- [Packaging](./packaging.md): priming sugar, keg pressure, sulfite.
- [Blending, mead and spirits](./blending.md): blends of finished beers,
  honey musts, and proofing a macerate.

The method pages after the guides go into the formulas themselves, with their
sources. The reference after those lists every export, grouped by subject.
