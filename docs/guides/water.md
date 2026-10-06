---
title: Water and mash pH
category: Guides
---

# Water and mash pH

This is the guide for a water calculator: what salts to add to a tap water,
and what pH the mash will land on with a given grist. It's the biggest area in
the package, with about 150 exports, but four functions cover most of what
you'd build.

## The functions to start with

- {@link solveWaterRule} answers "how much gypsum and calcium chloride for at
  least this much calcium and this sulfate-to-chloride balance?" It solves the
  two conditions exactly, using only calcium salts.
- {@link solveWaterProfile} answers "which salts get this water closest to a
  named profile?" It fits all six ions with up to three salts and reports how
  close each one came.
- {@link applySalts} answers "what does the water look like after I add
  these?" It's the forward direction, for salts the brewer chose.
- {@link predictMashPh} answers "what pH will this mash be?" from the grist,
  the treated mash water and its volume.

When the recipe has a `water` section, {@link calculateRecipe} runs the last
two for you and returns the results in `water`, along with the lactic acid it
would take to reach the target pH.

## A tap water, a rule and a mash

A moderately hard tap water, treated for a pale ale, then the pH of the
README's pale ale grist in it:

{@includeCode ../examples/water.ts#water}

{@link waterProfile} takes the report the way it's printed. US utilities give
alkalinity as CaCO₃, European ones give bicarbonate, and German ones often give
carbonate hardness in °dH, and it accepts any of the three. Here 110 ppm as
CaCO₃ becomes 134 ppm of bicarbonate.

The rule wants 3.4 g of gypsum and 1.2 g of calcium chloride dihydrate across
the 30 L of brewing water, split between mash and sparge by volume. That lands
calcium at 75.2 ppm and the ratio at 1.99, and `treatment.rule` says both
conditions were met.

The mash comes out at pH 5.67. The grist alone in distilled water would sit
at 5.63, and the water's alkalinity pushes it up more than the calcium and
magnesium pull it down. `mash.warnings` says so: "Predicted mash pH 5.67 is
above 5.6: expect harsh tannin extraction, dull bitterness and hazy beer."

The fix is acid, and {@link solveAdditionsForTargetPh} sizes it:

{@includeCode ../examples/water.ts#acid}

That's 5.2 mL of 88 % lactic acid for pH 5.40. The solver re-runs
`predictMashPh` at every step, so feeding the dose back in gives the target.

## The working

`mash.explain` names the model (`charge-balance-troester`, Kai Troester's
charge balance) and lists every term: the grist's buffering, the alkalinity the
mash actually titrated, the calcium and magnesium reactions, and any acid.
`mash.contributions` has the same terms in mEq, which makes a good bar chart.
One of the notes is worth passing on to a brewer. Only 82 % of this water's
measured alkalinity counts, because at mash pH the rest is still bicarbonate
and consumes no acid. {@link MashPhOptions} can switch that off if you want
to match a calculator that counts all of it.

## Traps

- **Salts are in grams for the whole batch.** `SaltAddition.grams` is what you
  put on the scale, not grams per liter. The `target` field says which water it
  goes in: `mash`, `sparge`, or `total` (the default, split by volume).
- **An ion the report leaves out is unknown.** A missing row tells you nothing
  about that ion, which is different from a row that says 0. List it in
  {@link WaterProfile.unmeasured} and the engine won't compute a
  sulfate-to-chloride ratio from a value it doesn't have.
- **Baking soda and chalk are salts.** They raise pH through the water's
  alkalinity, so add them with the salts and leave them out of
  `acidAdditions`. That way `predictMashPh` counts them once.
- **Calcium chloride comes in two forms.** The damp, clumping homebrew kind is
  the dihydrate, and the free-flowing prills are anhydrous. They differ by
  about a third in calcium and chloride per gram, so pick the right
  {@link SaltId}.
- **Mash pH is at room temperature.** The prediction is for a sample cooled to
  25 °C, which is what a pH meter is calibrated at. A hot mash reads lower.

## Going further

The water chemistry doesn't have its own method page yet. The comments on
{@link predictMashPh}, {@link solveWaterProfile} and {@link solveWaterRule}
explain the models in full, with their sources. In the reference, the Water
and mash pH category has the rest: acid strengths, residual alkalinity,
kettle pH, and the ion and salt tables.
