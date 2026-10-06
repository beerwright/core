// @ts-check
/**
 * Checks the package the way someone installing it from npm would get it.
 *
 *   pnpm run build && pnpm run smoke
 *
 * It packs the tarball with `npm pack`, installs it into a new project in a
 * temporary directory, and then:
 *
 * - imports the root and every subpath in `exports` under Node, and runs the
 *   README's recipe through `calculateRecipe` plus one function from each of
 *   two subpaths, checking the numbers;
 * - type-checks a TypeScript file that does the same, with
 *   `moduleResolution: nodenext` and `skipLibCheck` off, under the
 *   TypeScript this package builds with and under TypeScript 5.9, so the
 *   declarations resolve and hold up for people who haven't moved to 7 yet.
 *
 * Nothing here uses the repository's own node_modules, so a file missing
 * from `files` or a broken `exports` entry fails here before it reaches npm.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OLDER_TYPESCRIPT = '~5.9.0';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'beerwright-core-smoke-'));

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 */
function run(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
}

try {
  // Pack. Lifecycle scripts are skipped: the build has already run.
  const [packed] = JSON.parse(
    run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], root),
  );
  /** @param {number} bytes */
  const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
  console.log(
    `Packed ${packed.filename}: ${packed.entryCount} files, ${kb(packed.size)} ` +
      `(${kb(packed.unpackedSize)} unpacked)`,
  );

  // A project that depends on nothing but the tarball and TypeScript.
  const project = join(work, 'project');
  mkdirSync(project);
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ name: 'smoke', private: true, type: 'module' }, null, 2)}\n`,
  );
  run(
    'npm',
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      join(work, packed.filename),
      `typescript@${pkg.devDependencies.typescript}`,
      `typescript-older@npm:typescript@${OLDER_TYPESCRIPT}`,
    ],
    project,
  );

  // Under Node.
  const subpaths = Object.keys(pkg.exports).map((key) => key.replace(/^\./, pkg.name));
  writeFileSync(join(project, 'smoke.mjs'), nodeScript(subpaths));
  console.log(run('node', ['smoke.mjs'], project).trim());

  // Under TypeScript.
  writeFileSync(join(project, 'smoke.ts'), typescriptFile());
  writeFileSync(
    join(project, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
        files: ['smoke.ts'],
      },
      null,
      2,
    )}\n`,
  );
  for (const ts of ['typescript', 'typescript-older']) {
    const version = JSON.parse(
      readFileSync(join(project, 'node_modules', ts, 'package.json'), 'utf8'),
    ).version;
    run('node', [join('node_modules', ts, 'bin', 'tsc'), '-p', '.'], project);
    console.log(`Types resolve under TypeScript ${version}.`);
  }

  console.log('Smoke test passed.');
} catch (error) {
  // execFileSync has already printed the command's stderr.
  console.error(`Smoke test failed in ${work}`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });

/** The README's pale ale, as plain data both checks share. */
function recipeSource() {
  return `{
  batchVolumeL: 20,
  boilTimeMinutes: 60,
  fermentables: [
    { name: 'Pale ale malt', amountKg: 4.5, class: 'grain', use: 'mash',
      extractFineGrindDryBasisPercent: 80, moisturePercent: 4, colorLovibond: 3 },
    { name: 'Crystal 60', amountKg: 0.4, class: 'steeping-grain', use: 'mash',
      extractFineGrindDryBasisPercent: 74, moisturePercent: 4, colorLovibond: 60 },
  ],
  hops: [
    { name: 'Centennial', amountKg: 0.02, alphaAcidPercent: 9.5, form: 'pellet',
      use: 'boil', timeMinutes: 60 },
    { name: 'Cascade', amountKg: 0.03, alphaAcidPercent: 6, form: 'pellet',
      use: 'boil', timeMinutes: 15 },
  ],
  yeasts: [{ name: 'US-05', type: 'ale', form: 'dry',
    attenuationMinPercent: 78, attenuationMaxPercent: 82 }],
}`;
}

/** @param {string[]} subpaths */
function nodeScript(subpaths) {
  return `import assert from 'node:assert/strict';
import { calculateRecipe } from '@beerwright/core';
import { abv } from '@beerwright/core/abv';
import { primingSugar } from '@beerwright/core/carbonation';

// Some entry points, such as ./types, are types only and load as empty
// modules, so this only checks that each one loads.
for (const name of ${JSON.stringify(subpaths)}) await import(name);

const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, what + ': ' + actual + ', expected ' + expected);

const { vitals, explain } = calculateRecipe(${recipeSource()});
near(vitals.og, 1.0508, 0.0001, 'OG');
near(vitals.fg, 1.0098, 0.0001, 'FG');
near(vitals.ibu, 33.0, 0.1, 'IBU');
near(vitals.srm, 9.4, 0.1, 'SRM');
assert.equal(explain.ibu.formula, 'tinseth-1997');

near(abv(vitals.og, vitals.fg), vitals.abv, 1e-9, 'ABV from the abv subpath');
const dose = primingSugar({ beerVolumeL: 19, targetVolumes: 2.4, fermentationTempC: 20, sugar: 'corn-sugar' });
near(dose.sugarGrams, 129, 0.5, 'Priming sugar');

console.log('Imports ${subpaths.length} entry points under Node ' + process.version + ' and gets the README numbers.');
`;
}

function typescriptFile() {
  return `import { calculateRecipe, type RecipeInput, type RecipeCalculation } from '@beerwright/core';
import { abv } from '@beerwright/core/abv';
import { primingSugar, type PrimingInput } from '@beerwright/core/carbonation';

const recipe: RecipeInput = ${recipeSource()};
const result: RecipeCalculation = calculateRecipe(recipe);
const og: number = result.vitals.og;
const strength: number = abv(og, result.vitals.fg);
const input: PrimingInput = { beerVolumeL: 19, targetVolumes: 2.4, fermentationTempC: 20, sugar: 'corn-sugar' };
const grams: number = primingSugar(input).sugarGrams;

// @ts-expect-error a recipe needs a batch volume
calculateRecipe({ boilTimeMinutes: 60, fermentables: [], hops: [], yeasts: [] });

export { grams, strength };
`;
}
