import { describe, expect, it } from 'vitest';
import type { PublishedBands, PublishedRecipe } from './fixtures/published-recipes';
import { PUBLISHED_RECIPES } from './fixtures/published-recipes';
import { calculateRecipe } from './recipe';

/**
 * ## Band test: published recipes through the whole engine
 *
 * `recipe.test.ts` checks that the engine reproduces the published formulas to
 * five decimal places, against arithmetic worked longhand in the fixture. This
 * file checks something different and weaker. When a dozen real recipes from
 * the AHA archive and *Brew Your Own* go through `calculateRecipe`, the answers
 * should land close to what the recipes' authors published.
 *
 * It's an integration test over grists the two golden fixtures don't cover:
 * hop-bursted IPA, imperial stout, lager, hefeweizen, tripel with a fermenter
 * sugar, saison, dry stout, bitter, cream ale with flaked corn, oatmeal stout,
 * barleywine, extract-with-steeping-grains. It doesn't replace the golden
 * fixtures, and passing it doesn't show that any single formula is right.
 *
 * ### Why the tolerances are windows and not equalities
 *
 * A published vital isn't a measurement. It's the output of whatever software
 * the author used, on assumptions the article usually doesn't state: which IBU
 * model, which colour fit, which ABV formula, what efficiency, and where the
 * "batch size" was measured. The bands below are sized to the known spread of
 * those choices. If a recipe lands outside one, the engine is wrong about
 * something structural, and it isn't just two calculators rounding
 * differently.
 *
 * | Vital | Band | Why that width |
 * | ----- | ---- | -------------- |
 * | OG  | ±0.004 SG | almost nobody states their efficiency. A point of efficiency is worth ~0.0007 SG on a pale ale, and table PPG figures move ±1 |
 * | FG  | ±0.006 SG | the widest spread. A published FG includes an attenuation the author assumed, and lab ranges are 5–8 points wide before mash temperature moves them further |
 * | ABV | ±0.6 absolute | the simple 131.25 shortcut and Cutaia diverge by `0.5797 / (1.775 − OG) × FG / 0.794`, ~1.7 % at OG 1.050 rising past 9 % at OG 1.094. Three high-gravity fixtures widen this further, each with its own note |
 * | IBU | ±25 % relative, floor ±5 absolute | maybe one source in ten names its model. Rager and Tinseth alone are 20–30 % apart, and whirlpool credit varies more than that |
 * | SRM | ±20 % relative, floor ±1.5 absolute | Morey, Daniels and Mosher agree in the pale range and diverge sharply past MCU ≈ 15 |
 *
 * Per-recipe widenings are on the fixture's `bands`, and each one has a
 * written reason next to it. We only assert what the source states, so a
 * recipe with no published IBU gets no IBU assertion.
 */
const DEFAULT_BANDS: Required<PublishedBands> = {
  ogSg: 0.004,
  fgSg: 0.006,
  abvAbs: 0.6,
  ibuRelative: 0.25,
  ibuAbsolute: 5,
  srmRelative: 0.2,
  srmAbsolute: 1.5,
};

/** The band half-width for a relative-with-floor vital. */
function window(published: number, relative: number, floor: number): number {
  return Math.max(Math.abs(published) * relative, floor);
}

/**
 * Assert `actual` is within `halfWidth` of `published`, and report how far off
 * it was if it isn't. A bare `toBeCloseTo` failure doesn't tell you whether it
 * was a rounding difference or a factor of two.
 */
function expectWithin(label: string, actual: number, published: number, halfWidth: number): void {
  const delta = actual - published;
  expect(
    Math.abs(delta) <= halfWidth,
    `${label}: engine ${actual.toFixed(4)} vs published ${published.toFixed(4)} ` +
      `(off by ${delta >= 0 ? '+' : ''}${delta.toFixed(4)}, band ±${halfWidth.toFixed(4)})`,
  ).toBe(true);
}

function bandsFor(recipe: PublishedRecipe): Required<PublishedBands> {
  return { ...DEFAULT_BANDS, ...recipe.bands };
}

describe('published recipe bands', () => {
  it('covers the corpus the golden fixtures do not', () => {
    // Guards against the array shrinking without anyone noticing. The suite is
    // there for breadth, and three recipes wouldn't give us that.
    expect(PUBLISHED_RECIPES.length).toBeGreaterThanOrEqual(10);
    const styles = new Set(PUBLISHED_RECIPES.map((r) => r.style));
    expect(styles.size).toBe(PUBLISHED_RECIPES.length);
  });

  for (const recipe of PUBLISHED_RECIPES) {
    describe(`${recipe.name} — ${recipe.style}`, () => {
      const result = calculateRecipe(recipe.input, recipe.equipment);
      const bands = bandsFor(recipe);
      const published = recipe.published;

      it('cites a source that can be checked', () => {
        expect(recipe.source.url).toMatch(/^https:\/\//);
        expect(recipe.source.accessed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(recipe.source.statedAssumptions.length).toBeGreaterThan(0);
      });

      it('produces finite numbers for every vital', () => {
        for (const [key, value] of Object.entries(result.vitals)) {
          if (typeof value === 'number') {
            expect(Number.isFinite(value), `vitals.${key} = ${value}`).toBe(true);
          }
        }
        for (const [key, value] of Object.entries(result.volumes)) {
          expect(Number.isFinite(value), `volumes.${key} = ${value}`).toBe(true);
        }
        // The fixtures zero the kettle-side losses so that OG, IBU and SRM are
        // compared at the volume the source states.
        expect(result.volumes.postBoilVolumeL).toBeCloseTo(recipe.input.batchVolumeL, 9);
      });

      it('lands OG in band', () => {
        expectWithin('OG', result.vitals.og, published.og, bands.ogSg);
      });

      it.runIf(published.fg !== undefined)('lands FG in band', () => {
        expectWithin('FG', result.vitals.fg, published.fg as number, bands.fgSg);
      });

      it.runIf(published.abv !== undefined)('lands ABV in band', () => {
        expectWithin('ABV', result.vitals.abv, published.abv as number, bands.abvAbs);
      });

      it.runIf(published.ibu !== undefined)('lands IBU in band', () => {
        const target = published.ibu as number;
        expectWithin(
          'IBU',
          result.vitals.ibu,
          target,
          window(target, bands.ibuRelative, bands.ibuAbsolute),
        );
      });

      it.runIf(published.srm !== undefined)('lands SRM in band', () => {
        const target = published.srm as number;
        expectWithin(
          'SRM',
          result.vitals.srm,
          target,
          window(target, bands.srmRelative, bands.srmAbsolute),
        );
      });
    });
  }
});
