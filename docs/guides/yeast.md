---
title: Yeast and starters
category: Guides
---

# Yeast and starters

This is the guide for a pitch-rate calculator or a starter planner: is the
yeast I have enough for this beer, and if it isn't, what starter makes up the
difference?

## The functions to start with

- {@link pitchPlan} answers "is this pitch enough?" from the yeast rows, the
  volume and the gravity. It ages each pack from its manufacture date, counts
  the viable cells, and says how short or over the pitch is and how many packs
  would cover it.
- {@link planStarter} answers "what starter gets me there?" from the cells you
  need and the cells you have. It returns one step if one is enough, two if
  not, and refuses to plan three.

## Two old packs and a lager

Two liquid packs of a lager strain, made on August 1st and pitched on October
1st into 20 L of 1.048 wort:

{@includeCode ../examples/yeast.ts#pitch}

The batch needs 357 billion cells, which is the lager rate of 1.5 million cells
per mL per °P. Two months on the shelf has left the packs at 62 % viability,
so they hold 124 billion between them. The pitch is 234 billion short, and
`packsRequired` says six packs of this age would cover it. That works, and so
does a starter:

{@includeCode ../examples/yeast.ts#starter}

One step is enough: 1.75 L on a stir plate with 175 g of dry malt extract,
growing the 124 billion to 369 billion.

## The working

`pitch.notes` lists the assumptions as sentences. Here there are two: the pitch
rate defaulted to 1.5 for a lager, and each liquid pack was assumed to hold 100
billion cells when it was made. {@link pitchPlanExplained} and
{@link starterPlanExplained} return the same working as an
{@link Explanation}, citing White and Zainasheff's *Yeast* and Mr Malty for
the rates and viability, and Kai Troester's measurements for starter growth.

## Traps

- **`pitchDate` defaults to today.** Pass it, or the same recipe gives a
  different answer tomorrow, and your tests fail next month.
- **A dry yeast starter is ignored.** Dry yeast is packed with the sterols it
  needs, and a starter uses them up, so `pitchPlan` ignores a starter on a dry
  row and adds a note saying why. Count sachets with {@link dryYeastSachets}
  instead.
- **Cells are in billions.** `cellsNeededBillion: 357` is 357 billion cells,
  and every count in this area uses the same unit.
- **The volume is the wort into the fermenter.** Pass what goes in the
  fermenter, which may differ from the batch size on the recipe.
- **Starter growth is an estimate.** The growth model is Kai Troester's
  (Braukaiser's), and he puts it at ±15 % or worse. A planned starter can
  still come up a little short.

## Going further

There's no method page for yeast yet. The comments on {@link pitchPlan},
{@link packViability} and {@link starterGrowth} explain the models and where
their numbers come from. In the reference, the Yeast category has the viability
curves, the pitch-rate table {@link DEFAULT_PITCH_RATES}, and the dry-yeast
dosage bands.
