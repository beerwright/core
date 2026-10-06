---
title: Blending, mead and spirits
category: Guides
---

# Blending, mead and spirits

This is the guide for the cellar side: blending finished beers (sours and
barrel-aged beers, mostly), building a mead or cider must, and proofing and
sweetening a spirit. These are smaller calculations than a recipe, and each
one stands on its own.

## The functions to start with

- {@link pearsonSquare} answers "how much of each of these two do I need to
  hit a target?" for any value that blends by volume: ABV, gravity, acidity.
- {@link evaluateBlend} answers "what will this blend come out at?" for any
  number of components, with fruit, sugar and spirit additions, and works out
  the priming dose that accounts for what's still fermentable.
- {@link sugarToGravity} answers "how much honey or sugar to reach this
  gravity?" for a mead must, a thin cider juice, or backsweetening.
- {@link proofAndSweeten} answers "how much water and sugar to bring this
  macerate to a strength and a sweetness?" for limoncello, amaro and the like.

## Four small jobs

How much of a 7.5 % sour and a 4.5 % sour make 20 L at 6.5 %:

{@includeCode ../examples/blending.ts#pearson}

13.3 L of the stronger and 6.7 L of the weaker. If the target is outside the
two, or the two are the same, it returns `null`.

Three barrels of sour, blended and bottle conditioned to 2.8 volumes:

{@includeCode ../examples/blending.ts#blend}

The 24 L blend is 7.3 % ABV at pH 3.40 and FG 1.0043. The barrels have
off-gassed, so the blend holds only 0.41 volumes of CO₂ from fermentation. The
two sweeter barrels will ferment down to the driest one's 1.002 in the bottle,
and that leftover extract is worth 1.19 volumes more. That makes 1.60 volumes
before any sugar, so the priming dose is 110 g of table sugar for the last
1.2. Priming a blend from its temperature alone would overcarbonate it.

Honey for a traditional mead, 15 L of water up to 1.100:

{@includeCode ../examples/blending.ts#must}

5.1 kg of honey. Leave room for it, because dissolving it adds about 0.7 L
per kilogram and the calculation doesn't count that.

A liter of lemon-peel macerate at 60 %, down to 28 % with 250 g of sugar per
liter:

{@includeCode ../examples/blending.ts#spirits}

Add 0.54 kg of sugar and 0.81 L of water, for 2.14 L of finished limoncello.
The strength fixes the final volume first, because water and sugar add no
alcohol, and the sugar's own volume comes out of the water.

## The working

{@link blendExplanations} returns an {@link Explanation} for each figure a
blend shows, citing Michael Tonsmeire's article on priming barrel-aged and
blended sours and Curtis Crane's blending spreadsheet, which extends it. The
others have twins: {@link pearsonSquareExplained},
{@link sugarToGravityExplained}, {@link proofAndSweetenExplained}, and
{@link nutrientScheduleExplained} for the TOSNA nutrient schedule.

## Traps

- **`evaluateBlend` wants every field, with `null` for unknown.** A component
  with no measured pH has `ph: null`, and the blend's pH is worked out from
  the components that have one. A figure that none of them can supply comes
  back `null`.
- **Dated additions change the priming.** Fruit or sugar added close to
  packaging will still be sugar in the bottle. Pass `packagedOn` and dates on
  the additions, and `evaluateBlend` counts that sugar toward the dose.
- **A blend's pH isn't the average.** pH is a log scale, so
  {@link blendPh} averages the hydrogen-ion concentration and converts back.
- **`sugarToGravity` never lowers a gravity.** A target below the current one
  returns zero. To dilute, use {@link dilutionToTargetGravity}.
- **`proofAndSweeten` returns `null` for an impossible target.** Water can't
  make a spirit stronger, and past some sweetness the sugar alone takes more
  room than the target strength leaves.

## Going further

There's no method page for this area yet. The comments on
{@link evaluateBlend}, {@link sugarToGravity} and {@link proofAndSweeten} have
the formulas and their sources. In the reference, the Blending, mead and
spirits category has the rest, including the nutrient schedule in
{@link nutrientSchedule} and the acid-shock starter in {@link acidShockStarter}.
