---
title: The engine, formula by formula
category: How the math works
---

# The engine, formula by formula

*Which formula runs where, and where every formula came from.*

To call the engine from your own code, start with the [guides](./guides/start-here.md).

These pages document the engine for people working on it. They aren't user
documentation.

They live next to the code so that a formula and its description change in
the same commit and get read in the same review. Every formula here is copied
from this package's own TSDoc, and every citation is the one the source code
gives.

## The five areas

| Page | Covers |
| --- | --- |
| [Gravity, IBU and colour](./gravity-ibu-colour.md) | Extract and efficiency, OG/FG, ABV, attenuation, three IBU models, three colour fits |
| [Carbonation and packaging](./carbonation.md) | CO₂ volumes against temperature and pressure, residual CO₂, priming sugar |
| [Volume corrections](./volumes.md) | The volume waterfall, boil-off, absorption, shrinkage, strike temperature |
| [Refractometer and hydrometer](./instruments.md) | Wort correction factor, reading a fermenting sample, temperature correction |
| [Decoction](./decoction.md) | Sizing a pull, thickness and pot volume, schedule presets, what isn't modelled and why |

## Where a choice exists, which one runs

Three calculations have more than one published formula, and the engine
implements more than one for each. These are the defaults:

- **ABV**: the *Zymurgy* (1995) formula. `(OG − FG) × 131.25` is also
  available. The two diverge above about 7 % ABV.
- **IBU**: Tinseth (1997). Rager (1990) and Garetz (1994) are selectable.
- **Colour**: Morey (1999). Daniels (1996) and Mosher (1994) are selectable.

The engine reports which formula it used with each result, so a caller can
label a colour `morey-1999`. If one of our numbers disagrees with a number in
a book, check first which model the book used.

## Units

Internally the engine works in one set of units (kilograms, litres, degrees
Celsius, specific gravity) and converts at the edges. If a formula was
published in US customary units, it's implemented in them and its inputs are
converted on the way in, because those are the units it was regressed in.
Colour is the clearest example. Malt colour units are defined in pounds per US
gallon, so kilograms and litres are converted inside that one function and
nowhere else.

Pressure is the exception. It's in PSI in the inputs as well as the maths,
because regulators are labelled in PSI. Bar and kilopascals are supported
too.

## How exact these numbers are

The engine has golden tests that check it against published tables, not
against its own earlier output. Tinseth's utilisation table is reproduced to
within 0.0005 across nine gravities and seven boil times. The carbonation
tables are reproduced to 0.01 volumes, a tenth of the precision they're
printed at. The volume waterfall is checked to 10⁻⁹ litres, because that part
is arithmetic and not a fit.

That has two consequences. First, a number here should match any other
calculator using the same model, and where it doesn't, the pages linked above
explain why. Second, a formula regressed over 8–20 °Bx or 0–40 °C says
nothing about inputs outside that range. The engine doesn't clamp inputs to hide this, so a
nonsense temperature gives an obviously nonsense answer instead of a plausible
wrong one.
