---
title: Packaging
category: Guides
---

# Packaging

This is the guide for a bottling or kegging calculator: how much priming
sugar, what pressure to set the regulator to, and, for cider and wine, how
much sulfite.

## The functions to start with

- {@link primingSugar} answers "how much sugar to carbonate these bottles?"
  from the volume, the target carbonation, and the warmest temperature the beer
  reached after fermentation.
- {@link pressureFromCo2Volumes} answers "what do I set the regulator to?"
  from the beer's temperature and the carbonation you want.
- {@link sulfiteDose} answers "how much potassium metabisulfite?" from the
  volume and the pH, for ciders, meads and wines.

## The same carbonation three ways

19 L of beer that finished at 20 °C, to be bottled at 2.4 volumes with table
sugar:

{@includeCode ../examples/packaging.ts#bottle}

That's 111 g. The beer already holds 0.86 volumes of CO₂ from fermentation,
so the sugar only has to make the rest. Corn sugar, as in
[Start here](./start-here.md), takes 129 g for the same beer, because a gram of
it makes less CO₂.

The same 2.4 volumes in a keg at 4 °C:

{@includeCode ../examples/packaging.ts#keg}

10.7 PSI, or 0.74 bar.

And 20 L of cider at pH 3.5, sulfited before it's sweetened:

{@includeCode ../examples/packaging.ts#sulfite}

The cider has to hold 40 mg/L of free SO₂, which takes 1.39 g of potassium
metabisulfite.

## The working

{@link primingSugarExplained} and {@link forcedCarbonationExplained} return
the working for the first two. [Start here](./start-here.md#3-the-working-behind-a-number)
prints the priming explanation line by line. One of its notes is worth
knowing before someone asks: a keg gets the same dose as bottles. The common
advice to prime a keg with less has no source behind it, and the comment on
{@link primingSugar} works through why.

{@link sulfiteDoseExplained} gives the working for the sulfite, including a
note when the pH is too high for sulfite to be practical on its own.

## Traps

- **Use the warmest temperature, not the current one.** Residual CO₂ depends
  on the warmest the beer got at or after the end of fermentation. A beer that
  finished at 20 °C and was then cold-crashed to 2 °C still holds only what it
  held at 20 °C.
- **Pressure is in PSI gauge.** That's what regulators read. Convert with
  {@link psiToBar} and {@link psiToKilopascals}.
- **A sulfite dose without a pH is meaningless.** The free SO₂ needed rises
  about sixfold between pH 3.0 and 3.8. If you've already sulfited, pass the
  free SO₂ you measured as `currentFreeSo2MgL`. The engine doesn't estimate it,
  because it binds at a rate you can't compute.
- **Sorbate is a separate dose.** {@link sorbateDose} works from the ABV, and
  you'll want both before backsweetening.

## Going further

[Carbonation and packaging](../carbonation.md), the method page, has the
carbonation tables, the residual-CO₂ curve and the sugar yields with their
sources. A blend of finished beers primes differently, because sweeter
components keep fermenting in the bottle. The
[Blending guide](./blending.md) covers that.
