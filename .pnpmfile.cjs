// TypeDoc reads source through TypeScript's JavaScript compiler API, and
// TypeScript 7 doesn't ship that API. TypeDoc 0.28 supports TypeScript up to
// 6.0, so it gets its own copy of 6.0 here. Everything else, including
// `pnpm typecheck`, uses the TypeScript 7 in package.json.
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'typedoc') {
        if (pkg.peerDependencies) delete pkg.peerDependencies.typescript;
        pkg.dependencies = { ...pkg.dependencies, typescript: '6.0.3' };
      }
      return pkg;
    },
  },
};
