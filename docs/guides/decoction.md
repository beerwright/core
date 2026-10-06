---
title: Decoction
category: Guides
---

# Decoction

This is the guide for planning a decoction mash: how much of the mash to pull
for each step, and what the pulls cost in time and water.

## The functions to start with

- {@link decoctionPull} answers "how much do I pull to get from this rest to
  the next?" for one decoction.
- {@link planDecoctions} answers the same for a whole schedule, sizing each pull
  against the mash the one before it left behind.

{@link DECOCTION_SCHEDULES} has the traditional schedules ready to use
(Hochkurz, double and Bohemian triple), and {@link findDecoctionSchedule}
looks one up by id. A recipe whose mash steps include a `decoction` step gets
its plan from {@link calculateRecipe} in `decoctions`.

## One thick pull

5 kg of grain in 15 L of water, resting at 52 °C, with the next rest at 64 °C:

{@includeCode ../examples/decoction.ts#pull}

Pull 6.1 L, about 3.7 kg of it grain. It's out of the tun for 37 minutes
(rest, ramp, a 20-minute boil and the return), during which the tun drifts to
50.8 °C and the pot boils off 0.5 L, and the pull is sized to make up for both.
Brought back, it lands the mash on 64 °C. The pull comes with one issue to show
the brewer: "A pull this thick scorches on a direct flame. Stir it the whole
time it heats."

## The working

`pull.explain` is the heat balance with its numbers filled in: the mash's
heat capacity in water-equivalent liters, the temperatures, the evaporation
and the grain's specific heat. Its notes say how thick the pull was taken and
how far the tun drifted, and one says that the boil's effects on color,
efficiency and pH aren't modeled.

## Traps

- **Other calculators give a smaller pull.** Most use Palmer's classic
  formula, which assumes the tun doesn't cool while the pull is away, the pull
  comes back at 100 °C, and the boil costs no water. Each of those makes the
  pull too small. The [method page](../decoction.md) works through why, with
  numbers, and the classic form is still here as {@link decoctionVolume} if
  you need to match it.
- **A thin pull carries no grain.** It's liquid only, like the traditional
  last pull of a triple, and it's there to raise the temperature. It adds
  little of the character a decoction is usually done for.
- **The rig matters.** Standing loss, burner ramp time and pot boil-off are on
  the equipment profile, and `decoctionPull` takes them as
  {@link DecoctionRigOptions}. The defaults assume a domestic burner and a tun
  that loses 2 °C an hour.

## Going further

[Decoction](../decoction.md), the method page, derives the heat balance, covers
pull thickness and pot volume, and lists what the model leaves out and why.
