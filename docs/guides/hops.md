---
title: Hops
category: Guides
---

# Hops

This is the guide for an IBU calculator, a hop schedule editor, or a hop
inventory that wants to know how much alpha acid is left in an old bag.

## The functions to start with

- {@link calculateIbu} answers "how bitter is this hop schedule?" It takes the
  additions, the wort volume and gravity, and the boil length, and returns the
  total and each addition's share. Boil, first-wort and whirlpool additions all
  count. Dry hops and keg hops are accepted and add nothing.
- {@link agedAlphaAcidPercent} answers "what is this hop's alpha acid now?"
  from the label's figure, how long it's been stored, how cold, and how it's
  packed.

`calculateRecipe` calls `calculateIbu` itself, so you only need it directly
when you're working on hops without the rest of the recipe.

## A bag from the back of the fridge

Cascade that's been open in the fridge for a year, used in a whirlpool after
a 60-minute Magnum charge:

{@includeCode ../examples/hops.ts#age}

{@includeCode ../examples/hops.ts#ibu}

The 6.5 % on the label has dropped to 4.0 %. Cascade is a poor keeper, losing
about half its alpha in six months at room temperature, and a fridge and a
squeezed-shut bag slow that down without stopping it.

The schedule comes to 24.3 IBU. The Magnum gives 21.7 of it. The Cascade gives
2.5, because a 20-minute stand that starts at 85 °C and cools is worth only
2.5 minutes at a full boil.

## The working

Each entry in `contributions` carries its own IBU, its utilization, and the
boil minutes it was worth. A whirlpool addition also has a `standDescription`,
a sentence you can show as it is: "Cascade, 20 min from 85 °C cooling: worth
2.5 boil minutes, 2.5 IBU."

For the whole recipe, `calculateRecipe`'s `explain.ibu` names the model
(`tinseth-1997` by default), lists the volume and gravity it used, and cites
Tinseth, Malowicki's isomerization kinetics and the mIBU method the whirlpool
model comes from. The README prints that explanation in full.

## Traps

- **Amounts are in kilograms.** A 15 g addition is `amountKg: 0.015`.
- **`timeMinutes` means different things.** For a boil addition it's the time
  left in the boil. For a whirlpool it's the length of the stand. First-wort
  hops get the whole boil whatever it says, and dry hops use `dryHopDays`.
- **The volume and gravity are post-boil by default.** That's what Tinseth
  measured against. {@link CalculationOptions} can change both
  (`ibuVolumeBasis`, `bitternessGravityBasis`), but numbers then stop matching
  other calculators.
- **Pellets get a bonus.** Pellet and cryo hops are multiplied by 1.10 over
  whole cones, a common default that you can override with
  `hopFormMultipliers`.
- **Iso-alpha extract is a different number.** An `iso-extract` addition reads
  `isoAlphaPercent`, not `alphaAcidPercent`. They measure different things, and
  reading one as the other makes the beer about a fifth as bitter as intended.

## Going further

- [Gravity, IBU and color](../gravity-ibu-colour.md) has the three IBU models
  and the whirlpool model, with their sources.
- In the reference, the Hops category has the pieces: the Tinseth, Rager and
  Garetz utilization curves, the whirlpool integration in
  {@link standEffectiveBoilMinutes}, and the storage model in
  {@link hopAlphaRemaining}.
