---
title: Gravity, IBU and color
category: How the math works
---

# Gravity, IBU and colour

*Extract and efficiency, original and final gravity, ABV, attenuation, the three IBU models and the three colour fits, with their sources.*

<!--
  Source of truth: src/{units/gravity,gravity,abv,ibu,color}.ts. Formulas and
  citations are copied from their TSDoc comments, and test values from the
  matching *.test.ts files. Don't edit a number here without checking there.
-->

## Gravity scales

Specific gravity to degrees Plato is the ASBC cubic fit of the Plato table:

```
°P = -616.868 + 1111.14·SG − 630.272·SG² + 135.997·SG³
```

It's accurate to well under 0.1 °P from 1.000 to 1.130. Going the other way,
brewing calculators use this standard inversion:

```
SG = 1 + °P / (258.6 − (°P / 258.2) × 227.1)
```

These are two different published approximations, so they aren't exact
inverses of each other, and a round trip loses about 0.05 °P. Attenuation is
defined on extract, so wherever the engine predicts a final gravity and then
reads the attenuation back off it, it inverts the same cubic numerically
(Newton–Raphson, converging to about 10⁻¹² SG) instead of using the second
formula. One side effect is visible: the cubic reads −0.003 °P at SG 1.000, so
it doesn't pass exactly through the origin.

Brix is treated as Plato. The two scales differ (sucrose versus maltose
reference) but are within about 0.05 of each other over the brewing range. The
wort correction factor a refractometer needs is covered
[separately](./instruments.md).

## Extract, yield and efficiency

Internally the engine measures extract in **point·litres**:

```
pointLitres = kg × pointsPerKgPerL × efficiency
SG          = 1 + (Σ pointLitres) / volumeL / 1000
```

A fermentable's yield, in points per pound per US gallon, as weighed out:

```
PPG = ((FGDB% − fine/coarse difference%) / 100) × (1 − moisture% / 100) × 46.214
```

The moisture term converts a dry-basis laboratory figure to the as-is grain you
weigh. **46.214** is the yield of pure sucrose (one pound dissolved to one US
gallon gives 1.04621 SG), from Palmer, *How to Brew*, 4th edition. The
conversion between the two yield units is exact: `points·L/kg = PPG × 8.345404`.

If a fermentable has an explicit PPG, that's used. If it has neither a PPG nor
an extract percentage, the calculation throws instead of guessing.
Moisture defaults by class: 4 % for grain and steeping grain, 2 % for dry
extract, 20 % for liquid extract, zero for sugars.

Efficiency depends on how the addition is used as well as what it is. Extract
and sugar always convert fully. Grain converts at mash efficiency when mashed,
at the steeping efficiency (50 % by default) when steeped or boiled, and at
**zero** in the whirlpool or the fermenter. Grain added to a whirlpool
contributes no extract.

### The two efficiencies

**Mash efficiency** is set on the equipment profile, and it's what the grist is
scaled by. Measured from a pre-boil sample:

```
mashEff% = 100 × (measuredPoints × volume − Σ fixed-efficiency point·litres)
                 / Σ mashable theoretical point·litres
```

For an all-extract recipe there's nothing mash efficiency applies to, so the
engine returns `NaN` instead of 0 %, since there's no value to report. Callers
should show a dash.

**Brewhouse efficiency** is the whole-process figure, measured against the wort
that reached the fermenter:

```
brewhouseEff% = 100 × (OG points × fermenter volume) / Σ theoretical point·litres
```

### Rescaling a recipe onto your own efficiency

A recipe from a blog, a book or an imported file was written for someone
else's system. To brew it on yours, you rewrite the grain bill so the recipe
predicts the same numbers at your efficiency (*written for X %, your system
does Y %*) as it did at theirs.

It's one multiplication. Extract is `kg × pointsPerKgPerL × efficiency`, which
is linear in both, so multiplying the mass by `from / to` cancels the
efficiency change exactly:

```
kg × (from / to) × ppg × to  ≡  kg × ppg × from
```

So a 75 % recipe on a 68 % system needs `75 / 68`, about 10 %, more grain.

**Only the mashed grain changes.** Sugars, syrups and malt extract dissolve
completely on any system, and steeped grain converts at the fixed 50 % steeping
figure whatever your mash does. Their extract doesn't change with efficiency,
so scaling them would move the beer away from the original. A saison with 20 %
more dextrose is a stronger, drier saison.

**Both figures are brewhouse efficiency.** The transform is a ratio, so it's
only correct like-for-like. A mash figure on one side and a brewhouse figure on
the other would mis-scale the grist. A recipe file's own `EFFICIENCY` is a
brewhouse figure.

The resulting OG is close but not exact. More grain absorbs more water, so the
volume waterfall shifts a little and the OG comes out a point or two off the
recipe's printed figure. We report where it lands instead of iterating to hide
the difference.

## Original and final gravity

Extract is added up in three stages (pre-boil for mash and steep, boil for boil
and whirlpool, and fermenter) and divided by the volume at that stage.

Original gravity equals the post-boil gravity, because losses between the
kettle and the fermenter remove wort, not concentration. Sugars added in the
fermenter aren't in the OG you measure, so the engine also reports an **OG
equivalent** that includes them, and ABV is calculated from the OG equivalent.
A recipe with fermenter sugar will report a higher ABV than the hydrometer
readings alone would give, and that's correct.

Final gravity comes from a weighted attenuation:

```
netADF = Σ (extract_i × attenuation_i) / Σ extract_i
AE     = OE × (1 − netADF)
FG     = SG(AE)
```

An addition's attenuation is its own `fermentability` if it has one. Sugar is
100 %, a non-fermentable is 0 %, and everything else takes the yeast's figure.
That's the midpoint of the strain's published range, or the **maximum** across
a blend, because when several strains are pitched together the most
attenuative one dominates the finished beer. With no yeast at all the engine
assumes 75 %, the middle of the range for a typical American ale strain.

The mash schedule then shifts that attenuation by 1.2 points per °C away from
66.7 °C, clamped to ±8 points. This is **always applied**, because a mash at
63 °C and a mash at 69 °C make different beers and the predicted FG should
reflect it. It's a heuristic, not a published formula. It reproduces the "mash
at 149 °F for a dry beer, 156 °F for a full one" rule of thumb and nothing
more.

The temperature it shifts by is the schedule's **effective mash temperature**,
the duration-weighted mean of the rests that convert starch: the non-sparge
steps between 55 °C and 75 °C. A Hochkurz mash of 62 °C for 40 minutes then
72 °C for 20 reads as 65.3 °C, not 62. An acid or protein rest below 55 °C and
a mash-out above 75 °C are left out, because neither converts anything. A
recipe with no mash, such as an extract batch, keeps the yeast's published
figure.

## ABV

There are two formulas. The first is the common rule of thumb:

```
ABV% = (OG − FG) × 131.25
```

It's a linear fit. It's close enough below about 1.070 and reads increasingly
low above it. We keep it because recipe books print it and you should be able
to reproduce their numbers.

The default is:

```
ABV% = (76.08 × (OG − FG) / (1.775 − OG)) × (FG / 0.794)
```

The first term is alcohol by weight from the gravity drop, and `FG / 0.794`
converts weight to volume using the density of ethanol. It's usually attributed
to a 1995 *Zymurgy* article (the engine's formula key names Cutaia), and
BeerSmith, Brewer's Friend and Brewfather all use it. It pulls away from the
rule of thumb above about 7 % ABV, and it's the more accurate of the two there.
For 1.090 → 1.020 the two give 9.19 % and 9.99 %.

## Attenuation, real extract and calories

- **Apparent attenuation**: `ADF = 100 × (OE − AE) / OE`. Yeast labs quote
  attenuation against this definition.
- **Real extract**: `RE = 0.1808 × OE + 0.8192 × AE`, Balling's relation.
- **Real attenuation**: `100 × (OE − RE) / OE`. With Balling's relation this
  reduces to `0.8192 × ADF`, which is where the "real is about 80 % of
  apparent" rule comes from. ASBC's laboratory figure has an extra correction
  for the CO₂ that left the beer. That's a few tenths of a percent and isn't
  modelled.
- **Alcohol by weight**: `ABW = (OE − RE) / (2.0665 − 0.010665 × OE)`, the
  standard relation used with Balling's real extract.
- **Calories**: `kcal/12 oz = [6.9 × ABW + 4.0 × (RE − 0.1)] × FG × 3.55`, the
  standard brewing-industry formula. That's 6.9 kcal/g for ethanol and
  4.0 kcal/g for carbohydrate, scaled by the mass of a 12 oz serving. Per litre
  and per 330 mL are derived from it.

## Bitterness

All three models compute the same product:

```
IBU  = utilisation × (mg/L of alpha acid)
mg/L = alphaAcid% / 100 × mass_g × 1000 / volume_L
```

and differ only in the utilisation term.

### Tinseth (1997), the default

Source: Glenn Tinseth, "Hop Utilization" (1997), realbeer.com. It multiplies
two factors:

```
bigness factor    = 1.65 × 0.000125^(Gb − 1)
boil time factor  = (1 − e^(−0.04t)) / 4.15
```

The bigness factor models the suppression of iso-alpha-acid solubility by wort
gravity, where `Gb` is the boil gravity. The boil-time factor is the integrated
form of a first-order isomerisation with rate 0.04 min⁻¹, normalised so
utilisation approaches 1/4.15 ≈ 0.241. This reproduces Tinseth's published
utilisation table exactly, because that table was generated from this formula:
1.050 at 60 minutes gives 0.231.

Beerwright uses **post-boil** gravity by default. Tinseth's own guidance is to
use the average gravity over the boil, but most calculators use post-boil, and
we match them so a recipe's numbers line up with BeerSmith and Brewfather.

### Rager (1990)

Source: Jackie Rager, *Zymurgy* Special Issue 1990.

```
U(t) = (18.11 + 13.86 × tanh((t − 31.32) / 18.27)) / 100
```

with a gravity adjustment `(Gb − 1.050) / 0.2` above 1.050, applied as a divisor
`(1 + GA)` on the final IBU. It gives consistently higher numbers than
Tinseth. Rager noted that his numbers suit full-wort boils.

### Garetz (1994)

Source: Mark Garetz, *Using Hops* (1994).

```
U(t) = (7.2994 + 15.0746 × tanh((t − 21.86) / 24.71)) / 100
```

divided by three multiplicative penalties: a gravity factor, a hopping-rate
factor `IBU_total / 260 + 1`, and a temperature factor
`1 + (elevation_ft / 550) × 0.02`, since elevation lowers the boiling point and
with it isomerisation. The hopping-rate factor depends on the answer, so Garetz
is solved by fixed-point iteration. Garetz also defines a concentration factor,
which is 1 here because the alpha acids are already expressed against the same
volume.

### Whirlpool and hop stands

A stand below boiling still isomerises, and modern hoppy recipes come out wrong
if you ignore it. Beerwright converts a stand into **effective boil minutes**
using the Arrhenius rate from Malowicki, *Hop bitter acid isomerization and
degradation kinetics* (MSc, Oregon State, 2005):

```
k₁(T) = 7.9×10¹¹ × exp(−11858 / T)      T in kelvin
```

At 100 °C that's 0.01245 min⁻¹, which is different from Tinseth's 0.04 min⁻¹.
Tinseth's constant is an empirical fit to measured utilisation and includes
losses to trub, break and foam. We only use the Arrhenius rate as a **ratio**
to the rate at boiling, so the absolute rate cancels and only the
well-established temperature dependence is left. That ratio is 0.165 at 80 °C
and 0.022 at 60 °C.

There are two stand models:

- **mIBU** (the default shape) integrates the ratio over an exponential cooling
  curve, `T(τ) = T_ambient + (T₀ − T_ambient) · e^(−kτ)`, following John-Paul
  Hosom, *A Modified IBU Calculation* (2018). The cooling constant defaults to
  0.015 min⁻¹: a stand starting at 80 °C is still at 64 °C twenty minutes
  later, which matches a covered 20 L kettle. Raise it to 0.05–0.10 if you run
  an immersion chiller through the stand. A 20-minute stand at 80 °C is worth
  1.64 effective boil minutes.
- **Fixed temperature** multiplies the stand length by the ratio at one
  temperature. It suits a recirculating whirlpool with active temperature
  control, and overestimates for a kettle left to cool. It's the `k → 0` limit
  of the other model.

### Per-addition rules

- **Boil**: the stated time at boiling.
- **First wort**: the full boil time, times 1.10. FWH sits in the kettle while
  it heats and isomerises the whole time. The 1.10 is the BeerSmith and
  Brewer's Friend convention, which comes from the 1995 *Brauwelt* trials that
  measured about 10 % more bitterness than an equivalent 60-minute addition.
- **Whirlpool**: the stand, converted as above.
- **Dry hop**: 0 IBU. Dry hops add aroma and perceived bitterness, but no
  measurable iso-alpha-acid.

Hop form multiplies utilisation: whole and plug 1.0 (the baseline every
published table was measured against), and pellet 1.10 for the larger surface
area of milled cones. **Cryo also gets 1.10.** Its extra bitterness is already
accounted for by its roughly doubled stated alpha-acid percentage, and a second
potency multiplier would count it twice.

### BU:GU

```
BU:GU = IBU / ((OG − 1) × 1000)
```

Around 0.5 is balanced, 0.8 or above is firmly bitter, 0.3 or below is malty.

## Colour

Malt colour units first, in the US customary units every published SRM fit was
regressed against:

```
MCU = Σ (weight_lb × colour_°L) / volume_gal
```

Colour is set in the kettle, so the volume is normally the post-boil volume.
Then one of three fits from MCU to SRM.

**Morey (1999), the default:**

```
SRM = 1.4922 × MCU^0.6859
```

Dan Morey fitted it to the Daniels and Mosher data plus Noonan's tables. It
behaves best of the three across the whole range, which is why nearly every
modern calculator defaults to it.

**Daniels**, from Ray Daniels, *Designing Great Beers* (1996):

```
SRM = 0.2 × MCU + 8.4
```

A straight line regressed over roughly MCU 7–50. It can't return less than
8.4 SRM, so it's wrong for pale beers.

**Mosher**, from Randy Mosher, *The Brewer's Companion* (1994):

```
SRM = 0.3 × MCU + 4.7
```

It was regressed on commercial beers, so it has a floor too, at 4.7 SRM.

Beerwright changes the last two on purpose. Below the crossover (MCU 10 for
Daniels, MCU 7 for Mosher) it clamps to Morey, so a pale lager doesn't come out
amber. If you pick Daniels and get a paler answer than the straight line gives,
that's why.

Conversions: `EBC = SRM × 1.97`, and `SRM = 1.3546 × °L − 0.76` (Daniels) is
available as a helper, but the colour calculation uses a malt's Lovibond figure
directly and never applies it.

The colour swatch interpolates the standard 40-step beer-colour chart in sRGB.
It's an approximate swatch, not a colorimetric transform.
