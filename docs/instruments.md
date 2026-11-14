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
FG = 1.0000 − 0.00085683·OB + 0.0034941·FB
```

`OB` and `FB` are the **corrected** Brix readings (original and final, both
divided by the WCF), which is how Terrill defines them. You can pass raw
instrument readings instead, and the factor is applied to both.

| Original Brix | Final Brix | FG |
| --- | --- | --- |
| 12 | 6.5 | 1.0124 |
| 12 | 7 | 1.0142 |
| 16 | 9 | 1.0177 |

### Where it holds

Terrill fitted it to beers that had fermented most of the way and checked it
against 68 sets of readings from eight brewers. He left out four beers under
about 61 % apparent attenuation, because no correlation came close on them. So
it is a final-gravity formula. On a sample early in fermentation it reads low,
and for a wort that hasn't fermented at all it is about 17 points low at
12 °Bx.

### The older correlation

The engine also carries the cubic that most brewing software used before 2011,
as the `standard-cubic` model:

```
FG = 1.001843 − 0.002318474·OB − 0.000007775·OB² − 0.000000034·OB³
              + 0.00574·FB    + 0.00003344·FB²  + 0.000000086·FB³
```

Given `OB = FB` (a sample that hasn't fermented at all) it returns within
0.002 SG of the true gravity of that Brix from 8 to 20 °Bx, so it behaves
better at the start of a fermentation. Terrill's data show it reading a
finished beer a few points low, which is why it isn't the default.

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
