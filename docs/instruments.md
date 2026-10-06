---
title: Refractometer and hydrometer
category: How the math works
---

# Refractometer and hydrometer

*The wort correction factor, reading a fermenting sample with a refractometer, and correcting a hydrometer reading for temperature.*

<!--
  Source of truth: src/corrections.ts. Formulas, citations and the
  rejected-model note come from its TSDoc comments, and worked values from
  corrections.test.ts.
-->

## Refractometer: the wort correction factor

A refractometer is calibrated against sucrose, but wort's mix of maltose,
dextrins and protein refracts more per unit of extract, so a raw reading runs
high by about 4 %:

```
Brix_corrected = Brix_measured / WCF
```

The default WCF is **1.04**. Brewers who calibrate their own instrument against
a hydrometer typically get between 1.02 and 1.06, so it's worth calibrating
yours:

```
WCF = Brix_measured / °P(hydrometer SG)
```

Take both readings on the same unfermented sample, and the result is the factor
for that instrument.

With the default factor, a 12 °Bx reading corrects to 11.54 °Bx, which is
SG 1.0464.

This is only valid **before fermentation starts**.

## Refractometer: a fermenting or finished sample

Alcohol refracts far more strongly than sugar, so a refractometer reading taken
after fermentation has started is meaningless unless the correction also knows
the original reading. The engine uses Sean Terrill's linear regression against
measured hydrometer data ("Refractometer FG Results", seanterrill.com):

```
FG = 1.001843 − 0.002318474·OB − 0.000007775·OB² − 0.000000034·OB³
              + 0.00574·FB    + 0.00003344·FB²  + 0.000000086·FB³
```

`OB` and `FB` are the **corrected** Brix readings (original and final, both
divided by the WCF), which is how Brewer's Friend and Brewfather apply the same
model. You can pass raw instrument readings instead, and the factor is applied
to both.

It's called "linear" in the regression sense. The polynomial isn't first-order.

| Original Brix | Final Brix | FG |
| --- | --- | --- |
| 12 | 6.5 | 1.0116 |
| 12 | 7 | 1.0147 |
| 16 | 9 | 1.0170 |

### The rejected model

We tried a second, widely circulated "Terrill cubic" and didn't use it. As
transcribed it returns SG below 1.000 and implied attenuations above 100 % for
strong beers, so its coefficients can't be right.

The tests set the standard any replacement has to meet. Given `OB = FB` (a
sample that hasn't fermented at all), the current model returns within 0.002 SG
of the true gravity of that Brix from 8 to 20 °Bx, and over realistic
fermentations it implies apparent attenuations of 69–75 %. There's only one
fermenting-sample model. The parameter that selects it is there so a second can
be added later without a breaking change.

## Hydrometer: temperature correction

A hydrometer is calibrated at one temperature, usually 60 °F (15.56 °C), and a
sample at any other temperature reads wrong:

```
SG_true = SG_read × ρ(T_sample) / ρ(T_calibration)
```

Hot samples read low, because the wort is less dense than the instrument
assumes, and the correction pushes them back up. A 30 °C sample read as 1.050 is
really 1.0534. Cold samples correct the other way, and the size of the
correction grows with the gap.

The density here uses the cubic fit against °F that every hydrometer-correction
calculator in homebrewing uses:

```
ρ = 1.00130346 − 1.34722124e-4·T + 2.04052596e-6·T² − 2.32820948e-9·T³
```

This is **not** Kell's equation, which the
[volume correction](./volumes.md) uses. We use this fit to match the other
calculators, so a reading checked against Brewer's Friend gives the same
answer. The downside is that it's only good over the range a hydrometer sample
is realistically at, roughly 0–40 °C, and is badly wrong outside it (at 212 °F
it returns 1.042). That's why the volume correction doesn't use it.
