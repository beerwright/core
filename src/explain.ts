/**
 * Structured breakdowns of how a number was worked out.
 *
 * Every headline number the engine produces can come with an
 * {@link Explanation}: the formula's name, the formula written out, the
 * inputs that went in, and the result. That's enough for a brewer to answer
 * "why is my FG so high?" from the number's own working.
 *
 * These are plain data, not rendered strings. Callers do the formatting and
 * any unit conversion for display.
 */

/**
 * A scalar that can appear as an explanation input.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export type ExplainValue = number | string | boolean;

/**
 * The named inputs that produced a value. Keys are stable identifiers.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export type ExplainInputs = Readonly<Record<string, ExplainValue>>;

/**
 * Where a formula comes from, as data.
 *
 * Every model in this package names its paper, book or web page in the
 * comment above it, but anything published from an explanation can only
 * carry what's in the payload. A citation that only exists in a comment
 * can't be shown next to the number it backs up, so this puts the same
 * attribution in the payload.
 *
 * `title` is the only required field. For some curves that homebrewing has
 * copied for thirty years, a title is all we can cite, and making up an
 * author would be worse than leaving the field out.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export interface Source {
  /** The work's title, e.g. `"Hop Utilization"`. */
  readonly title: string;
  /** Who wrote it, if we know. */
  readonly author?: string;
  /** Year of publication, if we know it. */
  readonly year?: number;
  /** A link a reader can follow, if the work is online. */
  readonly url?: string;
}

/**
 * Which family of related numbers an explanation belongs to. A calculator
 * reference is organised by family, one family to a section (see
 * `referenceExplanationsByFamily`).
 *
 * `cellar` holds the numbers that meads, ciders and wines need and beers
 * mostly don't. `spirits` covers proofing a macerate down and sweetening it,
 * which is the only thing on the list that isn't fermented.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export type ExplanationFamily =
  | 'bitterness'
  | 'color'
  | 'gravity'
  | 'alcohol'
  | 'carbonation'
  | 'corrections'
  | 'mash-ph'
  | 'water'
  | 'yeast'
  | 'freshness'
  | 'blending'
  | 'cellar'
  | 'spirits'
  | 'volumes'
  | 'decoction';

/**
 * Every family, in the order a reference presents them.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const EXPLANATION_FAMILIES: readonly ExplanationFamily[] = [
  'bitterness',
  'color',
  'gravity',
  'alcohol',
  'carbonation',
  'corrections',
  'mash-ph',
  'water',
  'yeast',
  'freshness',
  'blending',
  'cellar',
  'spirits',
  'volumes',
  'decoction',
];

/**
 * Display title for each family, used as its section heading.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const EXPLANATION_FAMILY_LABELS: Readonly<Record<ExplanationFamily, string>> = {
  bitterness: 'Bitterness',
  color: 'Color',
  gravity: 'Gravity, efficiency and losses',
  alcohol: 'Alcohol',
  carbonation: 'Carbonation',
  corrections: 'Hydrometer and refractometer corrections',
  'mash-ph': 'Mash pH',
  water: 'Water chemistry',
  yeast: 'Yeast pitch and starters',
  freshness: 'Hop freshness',
  blending: 'Blending arithmetic',
  cellar: 'Must, nutrients and stabilizing',
  spirits: 'Proofing and sweetening',
  volumes: 'Volumes and losses',
  decoction: 'Decoctions',
};

/**
 * A machine-readable breakdown of one computed number.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export interface Explanation {
  /** Human label for the value, e.g. `"Original gravity"`. */
  readonly label: string;
  /**
   * Stable identifier for the formula used, e.g. `"tinseth-1997"`.
   * Selectable formulas report which one actually ran.
   */
  readonly formula: string;
  /** The formula written out, e.g. `"SRM = 1.4922 × MCU^0.6859"`. */
  readonly expression: string;
  /** The inputs, in canonical units, keyed by name. */
  readonly inputs: ExplainInputs;
  /** The result. */
  readonly value: number;
  /** The result's unit, e.g. `"SG"`, `"IBU"`, `"L"`, `"%"`. */
  readonly unit: string;
  /** Caveats, assumptions and defaults that were applied. */
  readonly notes?: readonly string[];
  /** Where the formula comes from. This is the citation shown next to the number. */
  readonly sources?: readonly Source[];
  /** Which family this number belongs to. */
  readonly family?: ExplanationFamily;
}

/**
 * A value carried together with its breakdown.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export interface Explained<T = number> {
  /** The value. */
  readonly value: T;
  /** How the value was worked out. */
  readonly explain: Explanation;
}

/**
 * Fields of an {@link Explanation} other than the value itself.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export interface ExplanationSpec {
  /** Human label for the value. See {@link Explanation.label}. */
  readonly label: string;
  /** Stable identifier for the formula. See {@link Explanation.formula}. */
  readonly formula: string;
  /** The formula written out. See {@link Explanation.expression}. */
  readonly expression: string;
  /** The inputs, in canonical units, keyed by name. */
  readonly inputs: ExplainInputs;
  /** The result's unit. See {@link Explanation.unit}. */
  readonly unit: string;
  /** Explicitly allows `undefined` so callers can pass a conditional. */
  readonly notes?: readonly string[] | undefined;
  /** Explicitly allows `undefined` so callers can pass a conditional. */
  readonly sources?: readonly Source[] | undefined;
  /** Explicitly allows `undefined` so callers can pass a conditional. */
  readonly family?: ExplanationFamily | undefined;
}

/**
 * Build an {@link Explanation} for `value`.
 *
 * `notes`, `sources` and `family` are omitted rather than set to `undefined` so
 * the object satisfies `exactOptionalPropertyTypes`.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export function explain(value: number, spec: ExplanationSpec): Explanation {
  const notes = spec.notes;
  const sources = spec.sources;
  const family = spec.family;
  return {
    label: spec.label,
    formula: spec.formula,
    expression: spec.expression,
    inputs: spec.inputs,
    value,
    unit: spec.unit,
    ...(notes && notes.length > 0 ? { notes } : {}),
    ...(sources && sources.length > 0 ? { sources } : {}),
    ...(family !== undefined ? { family } : {}),
  };
}

/**
 * Pair a value with its breakdown.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export function explained<T extends number>(value: T, spec: ExplanationSpec): Explained<T> {
  return { value, explain: explain(value, spec) };
}

/**
 * Append notes to an existing explanation.
 *
 * @category Explanations and sources
 * @group Explanations
 */
export function withNotes(explanation: Explanation, ...notes: readonly string[]): Explanation {
  return { ...explanation, notes: [...(explanation.notes ?? []), ...notes] };
}
