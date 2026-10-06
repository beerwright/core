---
title: Carbonation and packaging
category: How the math works
---

# Carbonation and packaging

*CO₂ volumes against temperature and pressure, the residual-CO₂ curve, and priming sugar doses derived from fermentation stoichiometry.*

<!--
  Source of truth: packages/core/src/carbonation.ts, and DEFAULT_CARBONATION_VOLUMES
  in packages/core/src/defaults.ts. Formulas and citations transcribed from their
  comments; worked values from packages/core/src/carbonation.test.ts.
-->

## What a "volume" is

One volume of CO₂ is one litre of gas at 0 °C and one atmosphere dissolved in one
litre of beer. CO₂'s density under those conditions is 1.96 g/L, so **one volume
is 1.96 grams of CO₂ per litre**. That's the conversion between the two ways
carbonation is usually quoted.

The default target is 2.4 volumes, mid-range for most ale styles.

## Forced carbonation: pressure and temperature

This is the empirical fit of the standard carbonation tables that keg
calculators use:

```
V = (P + 14.695) × (0.01821 + 0.09011 × e^(−(T − 32) / 43.11)) − 0.003342
```

with `P` in PSI gauge and `T` in °F. The functions take °C and PSI and
convert internally. We keep PSI because that's how regulators are labelled.
There are also conversions to bar (`× 0.0689475729`) and kilopascals
(`× 6.89475729`), since some European regulators are marked in kPa, and
100 kPa is 1 bar.

The inverse is exact, so you can solve for either pressure or volumes. Some
worked values:

| Temperature | Pressure | Volumes |
| --- | --- | --- |
| 38 °F (3.3 °C) | 12 psi | 2.58 |
| 4 °C | 10 psi | 2.33 |
| 0 °C | 8 psi | 2.45 |
| 3 °C | 10.9 psi | 2.50 |

There are two things this doesn't do. It doesn't clamp: ask for a low volume
at a warm temperature and you get a negative gauge pressure, because you can't
get there with pressure alone. And there's **no line-balancing or
serving-pressure model**; dispense line length is out of scope.

## Residual CO₂

Beer leaving fermentation already holds dissolved CO₂, and how much depends on
how warm it got. The standard residual-CO₂ curve:

```
V_residual = 3.0378 − 0.050062 × T + 0.00026555 × T²
```

with `T` in °F. The important detail is *which* temperature: it's the
**highest** temperature the beer reached at or after the end of fermentation,
not the temperature it's at now. CO₂ driven off by a warm diacetyl rest doesn't
come back when the beer is chilled. `scheduleResidualCo2` takes that peak from
the fermentation schedule, including ramp end temperatures, so a schedule with
a 20 °C rest is dosed as a 20 °C rest.

| Peak temperature | Residual volumes |
| --- | --- |
| 10 °C | 1.20 |
| 18 °C | 0.92 |
| 20 °C | 0.86 |

## Priming sugar

```
volumesToAdd = target − residual(peak fermentation temperature)
CO₂_g        = volumesToAdd × beerVolume_L × 1.96
sugar_g      = CO₂_g / yield(sugar)
```

If the beer already holds more CO₂ than the target, the dose is zero (not
negative), and the explanation says so.

The per-sugar yields are **derived from the stoichiometry of fermentation**,
`C₆H₁₂O₆ → 2 C₂H₅OH + 2 CO₂`, not copied from a table:

| Sugar | g CO₂ per g | Where the number comes from |
| --- | --- | --- |
| Corn sugar (dextrose monohydrate) | 0.4442 | 88.02 g CO₂ from 198.17 g/mol |
| Dextrose (anhydrous) | 0.4886 | 88.02 g CO₂ from 180.16 g/mol |
| Table sugar (sucrose) | 0.5142 | 176.04 g CO₂ from 342.30 g/mol, after hydrolysis |
| Turbinado / demerara | 0.5039 | ~98 % sucrose |
| Dry malt extract | 0.3908 | ~95 % extract × ~80 % fermentable × sucrose's yield |
| Honey | 0.4007 | ~82 % fermentable monosaccharides |
| Maple syrup | 0.3394 | ~66 % sucrose |

The DME and honey figures are approximations, since DME fermentability varies
by product.

### Why corn sugar doses look high

For **20 L to 2.4 volumes from a 20 °C peak**, `primingSugar` gives 135.8 g
of corn sugar (6.79 g/L): 60.31 g of CO₂ to add, on top of 0.86 residual
volumes. Table sugar for the same beer is 117.3 g, anhydrous dextrose 123.4 g.

Published tools give anywhere from 105 to 140 g of "priming sugar", and the
spread comes down to what each tool assumes corn sugar *is*. Tools that treat
it as dextrose monohydrate (which is what the bag from the homebrew shop
contains; roughly 9 % of its weight is water of crystallisation) sit at the top
of that range, and so do we. The calculation is the same; the assumption about
the sugar is different, and ours matches what you're actually weighing.

## Bottles and kegs

The calculations make no distinction between kegs and bottles. They take a
beer volume and a target.

### The keg reduction we don't apply

Homebrewing folklore primes a keg *below* the bottle rate, at **50 to 75 %**
of it depending on the source. We don't, and since the advice is widespread,
here's why.

The only attributable figure is *Brew Your Own*'s Mr. Wizard, at 75 %, and
the same answer that gives it says he has "never been able to find the original
source of this advice". The usual explanation is headspace (CO₂ that fills the
keg's ullage instead of dissolving), and the arithmetic doesn't support it.
Nineteen litres at 2.4 volumes needs 89 g of CO₂ dissolved. The ~1 L of
headspace above it holds about **3.5 g** at the equilibrium pressure and 4 °C,
which is under 4 % of the dose, while the rule of thumb withholds a quarter to
a half of it. The same beer in fifty-three bottles has about 2.6 g in its
headspace, so the two are within a gram of each other.

Dissolving 89 g of CO₂ takes the sugar that makes 89 g of CO₂ whatever the
beer is sealed in, so kegs get the bottle rate. Purge and seepage losses are
real (a keg is pressurised and vented, sometimes repeatedly, and gaskets leak a
little over the weeks of conditioning), but they depend on the brewer's routine,
not on kegs in general, and nobody has measured them. If you purge a lot, take
a few grams off yourself.

The alternative that needs no sugar and no guesswork is **spunding**: hold the
last days of fermentation at the pressure that gives your target at the
fermentation temperature, and the pressure sets the carbonation directly.
`pressureFromCo2Volumes` gives that pressure, and the forced-carbonation
explanation mentions it.

This package has no style-based carbonation targets. The BJCP 2021 guidelines
describe carbonation in words ("high", "moderately low", "cask-conditioned")
and never in volumes. The conventional homebrewing ranges by style family are
published in Palmer's *How to Brew* carbonation table and Zainasheff & Palmer's
*Brewing Classic Styles*.
