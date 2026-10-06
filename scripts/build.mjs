// @ts-check
/**
 * Builds the package into `dist/`: ES modules, `.d.ts` declarations and
 * source maps for both, from `tsconfig.build.json`.
 *
 *   pnpm run build
 *
 * The source imports its own modules without a file extension
 * (`from './abv'`), which TypeScript resolves fine with
 * `moduleResolution: bundler`. Node's ES module loader doesn't: it wants the
 * file it's loading, `./abv.js`. TypeScript copies import paths into its
 * output as written, so after compiling, this script adds the extension to
 * every relative import in `dist/`, in the JavaScript and in the
 * declarations. A directory import (`./units`) becomes `./units/index.js`.
 * An import that doesn't point at a file in `dist/` fails the build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Start clean, so a module that's been deleted from src/ doesn't linger in
// dist/ and get published.
rmSync(dist, { recursive: true, force: true });

const tsc = spawnSync('tsc', ['-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// `from './x'`, `export * from './x'`, `import './x'` and `import('./x')`.
const RELATIVE_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"\n]*)\2/g;

const problems = [];
let rewritten = 0;

for (const file of walk(dist)) {
  if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue;
  const before = readFileSync(file, 'utf8');
  const after = before.replace(RELATIVE_IMPORT, (match, lead, quote, specifier) => {
    const target = withExtension(dirname(file), specifier);
    if (target === undefined) {
      problems.push(`${relative(root, file)}: nothing in dist/ for '${specifier}'`);
      return match;
    }
    return `${lead}${quote}${target}${quote}`;
  });
  if (after !== before) {
    writeFileSync(file, after);
    rewritten++;
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Built dist/ and added .js to the relative imports in ${rewritten} files.`);

/**
 * The specifier Node needs for `specifier`, imported from a file in `dir`,
 * or undefined if no built file matches.
 *
 * @param {string} dir
 * @param {string} specifier
 */
function withExtension(dir, specifier) {
  const target = resolve(dir, specifier);
  if (specifier.endsWith('.js') && existsSync(target)) return specifier;
  if (existsSync(`${target}.js`)) return `${specifier}.js`;
  if (existsSync(join(target, 'index.js'))) return `${specifier.replace(/\/$/, '')}/index.js`;
  return undefined;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
