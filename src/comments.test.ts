import { describe, expect, it } from 'vitest';

// Vitest (through Vite) replaces `import.meta.glob` at build time. This
// package has no Vite or Node types, so the signature is declared here.
declare global {
  interface ImportMeta {
    glob<T>(
      pattern: string | readonly string[],
      options: { query: string; import: string; eager: true },
    ): Record<string, T>;
  }
}

/**
 * This package is published on its own, so its source and docs shouldn't
 * point at anything a reader of that repository can't see: the app's
 * planning documents and decision ids, or code in the other packages and
 * apps. When one of these patterns turns up, write out the reason the
 * reference was standing in for instead.
 */
const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'a plan document', pattern: /PLAN[-\s§]/ },
  { name: 'a section reference', pattern: /§/ },
  { name: 'a decision id', pattern: /\bD-[A-Z]{2,}\d/ },
  { name: 'a design document', pattern: /DESIGN-[A-Z]/ },
  { name: 'a path into the apps', pattern: /\bapps\// },
  { name: 'another package', pattern: /@beerwright\/(?!core\b)/ },
];

const files = {
  ...import.meta.glob<string>('./**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob<string>(['../docs/**/*.md', '../docs/**/*.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
};

describe('references a published reader can follow', () => {
  it('finds the files it is meant to check', () => {
    expect(Object.keys(files).length).toBeGreaterThan(70);
  });

  for (const [path, text] of Object.entries(files)) {
    if (path === './comments.test.ts') continue;
    it(`${path} points only at things inside this package`, () => {
      const hits = text
        .split('\n')
        .flatMap((line, index) =>
          FORBIDDEN.filter(({ pattern }) => pattern.test(line)).map(
            ({ name }) => `${path}:${index + 1} mentions ${name}: ${line.trim()}`,
          ),
        );
      expect(hits).toEqual([]);
    });
  }
});
