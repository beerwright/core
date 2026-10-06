---
title: Volume corrections
category: How the math works
---

# Volume corrections

*The volume waterfall from strike water to packaged beer, boil-off, grain and hop absorption, thermal shrinkage, and Palmer's strike and infusion equations.*

<!--
  Source of truth: src/volumes.ts (the waterfall and mash thermodynamics) and
  src/corrections.ts (the measurement-side temperature correction, Kell's
  equation, and the keg weigh-in). Constants from src/defaults.ts. Worked
  figures from volumes.test.ts and corrections.test.ts.
-->

## The waterfall

Every volume in a recipe is one line of a single calculation, which runs in
either direction: from a target batch size back to the water you need, or from
the water you have forward to what you'll end up with:

```
strike + sparge
  − grain absorption − mash tun loss − decoction boil-off  (+ kettle top-up)
= pre-boil
  − boil-off
= post-boil (hot)
  − 4 % shrinkage
= post-boil (20 °C)
  − kettle deadspace − hop absorption − chiller loss  (+ fermenter top-up)
= into fermenter
  − trub loss − dry-hop absorption
= packaged
```

The two directions are exact inverses of each other, tested to 10⁻⁹ litres,
because this part is plain arithmetic, not a fit. Litres are conserved: total
water minus total loss equals packaged beer.

Every stored volume is a 20 °C volume, which is why the hot post-boil figure
and the corrected one are separate lines.

## The losses, and their defaults

| Loss | How it is computed | Default |
| --- | --- | --- |
| Grain absorption | `grain_kg × rate` | 1.0 L/kg |
| Kettle hop absorption | `hops_kg × rate` | 6 mL/g |
| Dry-hop absorption | `hops_kg × rate` | inherits 6 mL/g |
| Boil-off | `rate × boil_hours` | 3.0 L/h |
| Boil shrinkage | `hot × (1 − %/100)` | 4 % |
| Mash tun loss | flat | 0 L |
| Kettle deadspace | flat | 1.0 L |
| Chiller loss | flat | 0 L |
| Trub loss | flat | 1.0 L |

### Mash tun deadspace isn't in that table

An equipment profile also has a **mash tun deadspace**, and it isn't part of
the waterfall: it's not in any line above or in any total. The two figures
follow Brewfather's split, so numbers copied from there mean the same thing
here.

- **Mash tun deadspace** is the volume below the outlet or false bottom of an
  all-in-one, like the wort under a Grainfather's grain basket or an Anvil's
  malt pipe. That liquid is already in the boil kettle, so it costs no extra
  water and none of it is lost. Grainfather publish 6.8 L of it for the G70.
  Entering that as a loss would add nearly two gallons to your strike water
  for no reason.
- **Mash tun loss** is wort left in a *separate* mash tun (a cooler, a HERMS
  tun) that never reaches the kettle. That volume is lost, so you have to
  measure out that much extra water. This is the figure the waterfall counts
  as a loss, and the one BeerXML's `LAUTER_DEADSPACE` maps to on import.

A single-vessel rig usually has a deadspace and no loss. A three-vessel rig
usually has a loss and no deadspace. A full-volume BIAB kettle has neither,
because the grain absorption figure already accounts for what the bag keeps.

Millilitres per gram and litres per kilogram are numerically identical, so hop
absorption needs no conversion factor. About 1.0 L/kg suits a lauter tun and
about 0.8 L/kg a squeezed BIAB bag; about 6 mL/g is right for pellets.

Strike water is `mash thickness × grain` (3.0 L/kg by default) and the sparge
makes up the rest. No-sparge and full-volume BIAB profiles put everything in the
strike. If the requested thickness would need more water than the batch calls
for, strike is capped at the total and the sparge goes to zero.

A worked 20 L batch (4.9 kg grain, 90 g kettle hops, 50 g dry hops, 60 minute
boil) comes out as 30.34 L of total water (14.70 strike + 15.64 sparge),
25.44 L pre-boil, 22.44 L hot post-boil, 21.54 L at 20 °C, 20 L into the
fermenter, 18.70 L packaged.

Nothing is clamped. Volume problems come back as warnings instead: a negative
sparge (the mash thickness needs more water than the batch), a non-positive
packaged volume (system losses exceed the batch size), a pre-boil volume over
the kettle, or a mash volume over the tun. The mash volume check uses a grain
displacement of 0.6676 L/kg (one pound of crushed malt displaces about 0.08 US
gallons), and it's only used to check whether the mash fits.

## Thermal shrinkage: two models

There are two ways to relate a hot volume to a 20 °C volume, and they're
separate functions because they answer different questions.

**Planning** uses a flat percentage from the equipment profile, 4 % by default.
That's the conventional figure, and the one BeerSmith, Brewer's Friend and
Grainfather all use. It's editable because it also has to cover whatever else
your rig loses between flame-out and the measuring jug, and the whole waterfall
follows when you change it.

**Measurement** uses the physics. Mass is conserved as wort cools, so volumes are
in inverse ratio to densities:

```
V_ref = V_t × ρ(t) / ρ(ref)
```

where ρ is Kell's equation (G. S. Kell, "Density, thermal expansivity, and
compressibility of liquid water from 0° to 150 °C", *J. Chem. Eng. Data* **20**(1),
1975, 97–105):

```
       999.83952 + 16.945176·t − 7.9870401e-3·t² − 46.170461e-6·t³
                 + 105.56302e-9·t⁴ − 280.54253e-12·t⁵
ρ(t) = ───────────────────────────────────────────────────────────
                       1 + 16.879850e-3·t
```

It's fitted over 0–150 °C and reproduces tabulated densities to a few parts per
million: 998.204 kg/m³ at 20 °C, 958.364 kg/m³ at 100 °C. Only ratios of it are
used, so even that small error mostly cancels. It also reproduces water's
density maximum at 3.98 °C (not 0 °C), which is an easy check that the
coefficients were transcribed correctly.

The two models agree. The physical figure at 100 °C is **3.991 %** against the
planning constant's 4.000 %, and a test checks they stay within 0.01
percentage points.

Measurement uses a temperature instead of a percentage because a sight glass
read at 85 °C needs the contraction for 85 °C, not for boiling. 26 L read off a
98 °C kettle is 25.00 L at 20 °C. Below 20 °C the correction goes the other way
and the volume goes up, because cold water is denser: 20 L read at 4 °C is
20.04 L.

This treats wort as water. At brewing strengths wort is 88–95 % water by mass
and the dissolved extract only raises the expansion coefficient slightly, so
real wort contracts a little more than this predicts. The error bound comes from
observation: the commonly observed 4 % is reproduced to 0.009 percentage points,
so the wort-versus-water difference is smaller than the one significant figure
that figure is quoted to. Taking that as the bound, the approximation costs at
most about 0.5 percentage points of volume: 0.1 L in a 25 L kettle, against a
sight glass you can read to perhaps 0.25 L.

Valid from 0 to 100 °C, and not clamped outside it. Kell's equation still
evaluates up to 150 °C, but the answer has nothing to do with brewing.

## The keg weigh-in

You can't see how much is in a sealed keg, but you can work it out with a
scale. Weigh the keg empty, weigh it full, and:

```
net_kg = gross − tare
ρ      = sg × 0.99823 kg/L
litres = net_kg / ρ
```

0.99823 kg/L is water at 20 °C. That's the reference specific gravity is
quoted against, and the same 20 °C the waterfall uses. (Kell's equation above
gives 998.204 kg/m³ at the same temperature. The 26 ppm difference is three
orders of magnitude below what a scale holding a keg can resolve.)

A 4.2 kg keg weighing 23.36 kg full holds 19.16 kg of 1.010 beer, which is
**19.0 L**.

Dissolved CO₂ is ignored. 19 L at 2.4 volumes holds 89 g of it, but 89 g
against 19 kg of beer is 0.47 % of the mass, about 90 mL of apparent volume.
That's below the precision of two weighings of a wet keg. A gross weight at or
below the tare returns zero instead of a negative volume. It means the numbers
were entered the wrong way round, and a negative volume could end up as the
batch's packaged volume and corrupt every yield figure computed from it.

Use the measured FG if you have one, or the recipe's predicted FG otherwise.
You can compare the result with the predicted packaged volume from the
waterfall at the top of this page, which is what that recipe on that equipment
profile should have yielded.

## Mash thermodynamics

From the energy balance `V(T_w − T₂) = c·G·(T₂ − T_g) + M·(T₂ − T_t)`:

```
T_w = T₂ + (c / r) × (T₂ − T_g) + M × (T₂ − T_t) / V
```

where `r` is litres of water per kilogram of grain, `c ≈ 0.4` is the ratio of
grain's specific heat to water's (grain ≈ 1.67 kJ/kg·K, water 4.186), and `M` is
the tun's thermal mass as equivalent litres of water. This is Palmer's strike
formula from *How to Brew* in SI units. His imperial constant 0.2 becomes 0.4
once quarts per pound become litres per kilogram.

At 3 L/kg, mashing 20 °C grain to 66 °C needs 72.13 °C strike water. At 2 L/kg
it needs 75.20 °C. Add a tun with the thermal mass of 3 L of water sitting at
10 °C, with 5 kg of grain at 3 L/kg, and it needs 83.33 °C. The tun term is the
biggest single correction on a cold rig, and leaving it out is why the first
mash of the day often undershoots.

Palmer's infusion equation, in the same terms:

```
V_infusion = rise × (c·G + W) / (T_infusion − T_target)
```

and the classic form of a decoction:

```
V_decoction = (W + c·G) × (T₂ − T₁) / (T_boil − T₁)
```

When the physics doesn't allow an answer, they don't return a plausible-looking
number: an infusion that isn't hotter than the target returns infinity.

The decoction figure above is a **heat capacity**: water-equivalent litres of
mash, not litres of anything you can pour. The formula assumes the tun doesn't
cool while the pull is out, that the pull returns at a full 100 °C, and that the
boil costs no water. None of those are true, and all three make the pull too
small. The engine still computes this number because it's the published
formula and recipes without decoction detail should keep getting it. The full
model is on the [decoction page](./decoction.md), including the pull's
thickness, which is what turns a heat capacity into a pot volume.

## Dilution, boil-down and blending

All of these conserve extract:

- **Dilute or boil down to a target gravity**: `V₂ = V₁ × points₁ / points₂`.
  Diluting to a higher gravity or boiling down to a lower one returns no change.
- **Gravity after adding water**: `SG₂ = 1 + points₁ × V₁ / (V₁ + V_water) / 1000`.
- **Sugar to hit a target**: `kg = (points_target − points_current) × V / pointsPerKgPerL`.
  This ignores the small volume the sugar itself adds.
- **Blending two beers**: gravity blends by conserved extract
  (`Σ points × V / Σ V`). Bitterness, colour and alcohol blend linearly by
  volume, which is exact for ABV and a good approximation for IBU and SRM.
