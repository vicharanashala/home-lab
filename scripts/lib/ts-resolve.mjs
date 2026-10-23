/**
 * A resolver hook that lets node load the app's TypeScript modules directly.
 *
 * WHY THIS EXISTS
 * The app's modules import each other without a file extension —
 * `import { convertScoop } from './units'` — which is what a bundler
 * expects. Node's ESM resolver does not add extensions, so a test that
 * imports `src/utils/portions.ts` dies on `ERR_MODULE_NOT_FOUND` the moment
 * that file reaches for a sibling.
 *
 * The alternative was to copy the maths into the test, but a copy proves
 * nothing: it is the copy that passes. This hook lets the tests drive the
 * REAL source, so a regression in the app shows up in the test.
 *
 * Usage, from a test script:
 *
 *     import { register } from 'node:module';
 *     register('./lib/ts-resolve.mjs', import.meta.url);
 *
 * The registration has to happen before the app modules are imported, which
 * is why the imports below are dynamic rather than static.
 */

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Only relative specifiers are ours to fix. Bare ones ('react') are
    // package names and belong to node's resolver.
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      for (const suffix of ['.ts', '/index.ts', '.tsx']) {
        try {
          return await nextResolve(specifier + suffix, context);
        } catch {
          // Try the next shape.
        }
      }
    }
    throw err;
  }
}
