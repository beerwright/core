---
title: Sizing a decoction
category: How the math works
---

# Decoction

*How the engine sizes a decoction: the heat balance, why the classic formula undersizes every pull, what a thick pull costs in pot volume, and what the model leaves out.*

<!--
  Source of truth: src/decoction.ts. Constants from src/defaults.ts. Worked
  figures from src/decoction.test.ts.
-->

Part of the mash is pulled into a pot, boiled, and stirred back in, and the
heat it brings back raises the rest of the mash to the next step. The engine
sizes that pull, schedules it, and works out what it costs in water and time.

## The heat balance

The pull is sized against the mash **as it will be when the pull comes back**,
not as it is when the pull leaves:

```
           C·(T₂ − T_r) + e·(T_ret − T₂)
C_pull  =  ─────────────────────────────
                   T_ret − T_r
```

where `C = W + c·G` is the mash's heat capacity in water-equivalent litres
(`c ≈ 0.4`, the ratio of grain's specific heat to water's), `T_r` is what the
tun has drifted down to by the time the decoction returns, `T_ret` is the
temperature it returns *at*, and `e` is the water the pot boiled away.

### Where it comes from

Let the mash before the pull hold water `W` litres and grain `G` kg at `T₁`.
The pull takes grain `g` and water `w`, so its capacity is `C_pull = w + c·g`,
and the remainder left in the tun keeps `C_r = C − C_pull`. While the pull is
out, the remainder cools from `T₁` to `T_r`. The pull boils off `e` litres and
comes back at `T_ret`. Mixing the two, the heat the returned pull gives up
equals the heat the remainder takes on:

```
(C_pull − e)·(T_ret − T₂) = C_r·(T₂ − T_r)
```

Substituting `C_r = C − C_pull` and solving for `C_pull` gives the balance
above. Every term on the right is known before the pull is sized, so it's a
closed form and doesn't need iterating.

### How far the tun drifts

The remainder cools at the rig's standing loss for as long as the pull is
away:

```
T_r = T₁ − standingLossCPerHour × awayMinutes / 60

awayMinutes = restBeforeBoilMinutes + rampMinutes + boilMinutes + returnMinutes
```

The ramp to the boil defaults to 12 minutes on a domestic burner and the
return to 5. The away-time is reported with the pull, because it also tells
the brewer when to pull.

A step whose target is at or below the mash's current temperature pulls
nothing, even though the tun would drift below it while a pull was out. The
standing-loss term only corrects a pull the schedule already calls for.

## Why not the formula every other calculator uses

The classic form is Palmer's:

```
V_decoction = (W + c·G) × (T₂ − T₁) / (T_boil − T₁)
```

The engine still has it as `decoctionVolume`. It makes three assumptions, and
**each one makes the pull too small, so the mash undershoots the rest.**

| Assumption | What actually happens |
| --- | --- |
| The tun does not cool while the pull is out | A thick pull is away 35–50 minutes once its conversion rest, its ramp and the boil are counted. An insulated cooler drops 1–3 °C — on a 10 °C step, a 10–30 % error in the pull. |
| The pull returns at 100 °C | It returns at 96–99 °C, cooled by the pot, the transfer and the stirring-in. The engine assumes 98. |
| The boil costs no water | Three 20-minute boils evaporate 1.5–3 L, which never reaches the kettle and which thickens the mash step by step. |

Set the standing loss to zero, the return temperature to 100 °C and the
decoction boil-off to zero, and the balance above reduces to Palmer's. The
tests check this, so a recipe with no decoction detail gets the same numbers as
the classic formula.

## Heat capacity and pot volume

`C_pull` is a heat capacity, in water-equivalent litres, not a volume you can
pour. Converting it to the litre mark on the pot needs something the classic
formula never asks for, **how thick the pull is**:

```
g = C_pull / (ρ + c)      w = ρ·g      V_pot = w + g × 0.6676
```

where `ρ` is litres of liquid per kilogram of grain *in the pull*, `g` and `w`
are the grain and liquid in the pull, and 0.6676 L/kg is the volume grain
itself displaces. A thin pull takes no grain at all, so `g = 0` and
`C_pull = w`.

**Thickness has a floor above zero.** Grain can't be pulled drier than the
liquid it holds, so the floor is your rig's grain absorption, about 1 L/kg.
A "thick" pull at 0.5 L/kg isn't something anyone can lift out of a tun. The
engine clamps to the absorption figure and adds a note saying so.

| Pull | `ρ` | What it is |
| --- | --- | --- |
| Thick | grain absorption (~1.0 L/kg) | Grain drained on the spoon. Most malt character, most scorch risk. |
| Medium | 1.5 L/kg | The usual compromise. |
| Thin | no grain at all | Liquid only. Heat, but no starch to gelatinize and little Maillard. |

An explicit ratio overrides the named thickness, and is clamped to the same
floor.

### A thick pull needs a bigger volume

Grain solids are dense, about 1.5 kg per litre of the volume they displace, but
they have only 0.4 of water's specific heat per kilogram. Multiplied together,
that means a litre of grain solids holds roughly **0.6** of the heat a litre of
water does.

So at 1 L/kg a thick pull carries 0.84 of the capacity per litre of pot that a
liquid pull carries, and has to be about **19 % larger** to make the same step.
That is why the traditional thick decoction is quoted as roughly a third of the
mash while a thin one is smaller.

It also means the usual limit is **grain, not water**. A thick pull out of a
3 L/kg mash is grain-rich compared with the tun it comes from, so on a big step
the tun runs out of grain long before it runs out of liquid. The fix is a
thinner pull, not a smaller one.

## Evaporation is a rate, not a fraction

The water a decoction boils away is `decoctionBoilOffLPerHour × boilMinutes / 60`,
a rate over the boil and not a fraction of the pull.

A fraction would make the evaporation depend on the pull size, which depends on
the evaporation, and the whole volume waterfall would become a fixed point to
iterate. A pot at a given vigour evaporates at a roughly fixed rate whatever is
in it, so the rate model is more accurate and isn't circular. The figure is
known before the pull is sized, so it can be an ordinary term in the
[volume waterfall](./volumes.md) beside grain absorption and mash tun
loss.

The total water requirement already includes it.

## The schedule

Each pull is sized against the mash **the previous pull left**, minus the
water that boiled away and at the temperature it actually reached. Most
calculators that offer a triple decoction size every pull against the original
mash, which overstates the later ones.

A pull is also sized from the rest just before it, however that rest was
reached. A Hochkurz mash infuses to 63 °C and decocts from there, so
`planDecoctions` takes every rest in the schedule. Given only the decoctions,
it would size from the wrong rest.

Three named schedules are included in `DECOCTION_SCHEDULES`, and
`findDecoctionSchedule` looks one up by id:

| Schedule | Shape |
| --- | --- |
| Hochkurz, single decoction | 63 °C maltose rest, one thick pull to 72 °C, mash out at 78 °C |
| Double decoction | 52 °C protein rest, two thick pulls, mash out at 78 °C |
| Triple decoction, Bohemian | Mash in at 37 °C, three pulls, mash out at 76 °C |

Every thick pull in every preset holds a conversion rest near 70 °C before it
boils. A pull taken from a protein rest is full of unconverted starch, and
boiling unconverted starch sets it and loses the extract. The Bohemian triple's
last pull is **thin**, which is traditional: by then there's nothing to gain
from boiling more grain.

## What the engine doesn't model

Brewers often ask about three effects of decoction. They're real, but they're
**not modelled**.

- **Colour.** Decoction darkens wort. How much depends on the process, and the
  published figures don't agree with each other. A confident number here would
  be worse than none.
- **Efficiency.** With modern well-modified malt the gain is 0–2 points; with
  undermodified malt it is larger and unquantified.
- **Mash pH.** Boiling a pull precipitates calcium phosphate and drives off
  CO₂. The net effect on the finished mash is small and disputed *in direction*.
  The [water](https://docs.beerwright.com/water/) prediction is an infusion-mash prediction; a decoction
  mash typically measures within about 0.05 pH of it.

A brewer who wants to account for extra colour can add it as a fermentable
adjustment. That keeps their own assumption visible in the recipe instead of
hidden in the engine. To model it properly we'd need data: measured
before-and-after colours across known schedules. A fit to that data would be a
model. A constant picked because it looks about right wouldn't be.

Fermentability treats a decoction rest the same as an infusion rest, because
the enzymes respond to the rest temperature, not to how the tun got there. The
100 °C boil is outside the saccharification window and isn't included in the
weighted mean. The pull's own conversion rest converts a minority of the grist
at its own temperature, which this doesn't capture. That's a known limitation.

## What it warns you about

`planDecoctions` won't give a plausible-looking number when the physics doesn't
allow one. It reports an issue when the pull is bigger than the mash, when it
won't fit your decoction pot, when boiling mash isn't hot enough to reach the
rest, when a liquid-only pull needs more free liquid than the grain bed has
left, when the boil would evaporate the pull dry, and when the schedule's
evaporation leaves the mash too stiff to stir.

## Your rig

How a pull is taken (its thickness, its boil, its conversion rest, an
overridden volume) is a recipe choice, so it's set on the mash step. Two
brewers on the same kit make different beer by pulling thick or thin. The pot,
its boil-off and how fast the tun cools are properties of the rig, so they're
set on the equipment profile.

There are three fields on the equipment profile (`mashStandingLossCPerHour`,
`decoctionBoilOffLPerHour` and `decoctionPotVolumeL`), and they have no effect
until a mash schedule has a decoction step in it:

| Field | Default | What it does |
| --- | --- | --- |
| Mash standing loss (°C/hour) | 2 | How fast the mash cools with the lid on. **Set it to 0 if your rig holds mash temperature for you** — a RIMS, a HERMS or an all-in-one. |
| Decoction pot boil-off | 1.5 L/h | Evaporation from the pot, not the kettle. Adds to the water you need. |
| Decoction pot | unset | Only warns you when a pull would not fit. |

Standing loss is the largest correction a decoction needs. It's a field and
not a constant because a cooler and an all-in-one behave very differently.
