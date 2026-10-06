/**
 * Turning an explanation into text a person can read. Used by the Start here
 * guide.
 */
import { type Explanation, primingSugarExplained } from '../../src/index';

// #region explain
/** One explanation as plain lines: the formula, its inputs, then the sources. */
function describe(explanation: Explanation): string[] {
  const lines = [
    `${explanation.label}: ${explanation.value.toFixed(1)} ${explanation.unit}`,
    `  ${explanation.expression}`,
  ];
  for (const [name, value] of Object.entries(explanation.inputs)) {
    lines.push(`  ${name} = ${value}`);
  }
  for (const note of explanation.notes ?? []) lines.push(`  Note: ${note}`);
  for (const source of explanation.sources ?? []) {
    lines.push(
      `  Source: ${[source.author, source.title, source.year].filter(Boolean).join(', ')}`,
    );
  }
  return lines;
}

const working = primingSugarExplained({
  beerVolumeL: 19,
  targetVolumes: 2.4,
  fermentationTempC: 20,
  sugar: 'corn-sugar',
});
const text = describe(working);
// #endregion explain

/** The numbers and lines the guide prints. */
export function explanationExample() {
  return { working, text };
}
