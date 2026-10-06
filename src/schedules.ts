/**
 * Named mash and fermentation schedules.
 *
 * These are ready-made schedules a brewer can pick instead of entering steps.
 * They live in the engine so every caller uses the same ids, and because one
 * of the two mash sets is derived from constants in this package.
 *
 * ## Two separate axes
 *
 * A mash schedule answers two independent questions, and we keep them apart:
 *
 * - Body: where the saccharification rest sits, which decides how
 *   fermentable the wort is. Light, medium, full.
 * - Technique: how the mash gets there. Single infusion, a step mash, a
 *   decoction.
 *
 * "Full body" and "Bohemian triple decoction" are both mash schedules, but
 * they answer different questions. Offering every combination would mean
 * nine near-duplicate profiles. Keeping the axes separate lets a brewer choose
 * the beer they want, then choose how to mash it.
 *
 * ## Where the body temperatures come from
 *
 * They aren't arbitrary. `defaults.ts` has the curve the engine uses to turn a
 * mash temperature into an attenuation:
 *
 * ```
 * MASH_TEMP_ATTENUATION_REFERENCE_C   = 66.7   (152 °F)
 * MASH_TEMP_ATTENUATION_POINTS_PER_C  = 1.2    percentage points per °C
 * MASH_TEMP_ATTENUATION_MAX_SHIFT     = 8      clamp
 * ```
 *
 * So {@link BODY_MASH_SCHEDULES} is three points on that line. Medium sits on
 * the reference, and light and full sit either side of it. Applying one moves
 * the predicted final gravity in the direction the name suggests.
 * {@link bodyAttenuationShift} gives the shift, so callers can show it next to
 * the name.
 *
 * The same caveat applies to these as to the curve: `MASH_TEMP_ATTENUATION_*`
 * is a rule of thumb reproducing "149 °F for a dry beer, 156 °F for a full
 * one", not a published model.
 */

import { DECOCTION_SCHEDULES } from './decoction';
import { MASH_TEMP_ATTENUATION_POINTS_PER_C, MASH_TEMP_ATTENUATION_REFERENCE_C } from './defaults';
import type { Celsius, FermentationStep, MashStep, Percent } from './types';
import { fahrenheitToCelsius } from './units/temperature';

/**
 * What a named schedule is for, so callers can group them without parsing names.
 *
 * @category Recipe
 * @group Results
 */
export type ScheduleKind =
  /** Where the saccharification rest sits: how fermentable the wort will be. */
  | 'body'
  /** How the mash reaches its rests: infusion, steps, decoction. */
  | 'technique'
  /** A fermentation schedule. */
  | 'fermentation';

/**
 * A schedule this package ships, ready to be copied into a recipe.
 *
 * @category Recipe
 * @group Results
 */
export interface NamedSchedule<TStep> {
  /**
   * Stable id, safe to persist and to refer to from outside the engine.
   */
  readonly id: string;
  /** What brewers call it. */
  readonly name: string;
  /** A short description of what it's for and what it does to the beer. */
  readonly description: string;
  /** Which list the schedule belongs to. */
  readonly kind: ScheduleKind;
  /** The schedule itself, in execution order. */
  readonly steps: readonly TStep[];
}

/**
 * Attenuation shift a saccharification rest implies, in percentage points.
 *
 * Positive means drier. It's the same arithmetic `gravity.ts` applies, exposed
 * so a profile can show "+4.4 points drier" beside its name. It isn't clamped
 * here. {@link MASH_TEMP_ATTENUATION_MAX_SHIFT} limits what the engine
 * applies, and a caller showing a shift beyond it would be showing a number
 * the prediction doesn't use. Every body profile here is well inside it.
 *
 * @category Recipe
 * @group Calculations
 */
export function bodyAttenuationShift(saccharificationTempC: Celsius): Percent {
  return (
    (MASH_TEMP_ATTENUATION_REFERENCE_C - saccharificationTempC) * MASH_TEMP_ATTENUATION_POINTS_PER_C
  );
}

/**
 * The body vocabulary's three rest temperatures.
 *
 * These are written in Fahrenheit, 148, 152 and 156, because that's how the
 * rule of thumb is quoted, and a °C literal of 64.44 would look like a
 * measurement instead of a convention. `MASH_TEMP_ATTENUATION_POINTS_PER_C`
 * cites the same rule ("mash at 149 °F for a dry beer, 156 °F for a full
 * one"), and 152 °F is the reference the model is built on, so the set is
 * ±4 °F either side of it.
 *
 * Medium uses the reference constant, not `fahrenheitToCelsius(152)` (66.7
 * against 66.667), because it has to shift the prediction by exactly zero.
 * `schedules.test.ts` checks that.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const LIGHT_BODY_TEMP_C = fahrenheitToCelsius(148);
/**
 * The engine's reference temperature, which shifts attenuation by zero.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MEDIUM_BODY_TEMP_C = MASH_TEMP_ATTENUATION_REFERENCE_C;
/**
 * The full-bodied end of the same line.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const FULL_BODY_TEMP_C = fahrenheitToCelsius(156);

/** A single-infusion schedule at one rest, plus a mash-out. */
function singleInfusion(tempC: Celsius, minutes: number): readonly MashStep[] {
  return [
    { name: 'Saccharification', type: 'infusion', targetTempC: tempC, timeMinutes: minutes },
    { name: 'Mash-out', type: 'temperature', targetTempC: 76, timeMinutes: 10 },
  ];
}

/**
 * The three body profiles.
 *
 * Each is a single infusion, so it only changes body. A step mash would also
 * change technique. A brewer who wants both picks a technique profile and
 * moves its rest.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const BODY_MASH_SCHEDULES: readonly NamedSchedule<MashStep>[] = [
  {
    id: 'mash-body-light',
    name: 'Light body',
    description:
      'A cool rest, so beta-amylase runs longer and leaves less unfermentable sugar. Drier, thinner, and a little more alcohol.',
    kind: 'body',
    steps: singleInfusion(LIGHT_BODY_TEMP_C, 60),
  },
  {
    id: 'mash-body-medium',
    name: 'Medium body',
    description:
      'The middle of the range, and the temperature our attenuation model is built around. Start here if you are not sure.',
    kind: 'body',
    steps: singleInfusion(MEDIUM_BODY_TEMP_C, 60),
  },
  {
    id: 'mash-body-full',
    name: 'Full body',
    description:
      'A warm rest, favoring alpha-amylase and the dextrins it leaves behind. Sweeter, rounder, and a little less alcohol.',
    kind: 'body',
    steps: singleInfusion(FULL_BODY_TEMP_C, 60),
  },
];

/**
 * Why there are two hefeweizen schedules.
 *
 * They produce different beers, and neither is the single correct choice.
 *
 * Traditional steps through a maltose rest. β-amylase, an exo-enzyme, cuts
 * maltose off the non-reducing ends and fills the wort with it. The result is
 * highly fermentable and finishes dry and effervescent, which is how weissbier
 * is usually described.
 *
 * Ester-forward skips that rest and sits at 156 °F. β-amylase is largely
 * suppressed there, so there's much less maltose. The malt's own free glucose,
 * plus the small amount α-amylase releases along the way, then makes up a
 * larger share of the simple sugars. The yeast responds to that share. Glucose
 * is taken up first and represses maltose transport, so a wort with more
 * glucose gives a more glucose-dominated early ferment, more acetyl-CoA, and
 * more acetate esters. Isoamyl acetate is the banana.
 *
 * The cost is that a higher rest is less fermentable overall, so the
 * ester-forward schedule gets a more ester-friendly sugar mix with a fuller
 * finish. Weizen yeast attenuates hard enough to make up a good deal of that,
 * which is why we offer the schedule at all.
 *
 * Some limits. Mash composition has a smaller effect on esters than
 * fermentation temperature, pitch rate and oxygen. And α-glucosidase, the
 * enzyme that releases free glucose in quantity, is denatured well below both
 * schedules' first saccharification rest, so neither produces glucose that
 * way. The argument above is about the ratio of glucose to maltose, not the
 * absolute amount of either.
 */

/**
 * The German step mash: a maltose rest, a saccharification rest, a mash-out.
 *
 * Two schedules use this, so it's shared to keep the numbers in sync. 63 °C
 * favours beta-amylase and 72 °C alpha, which is why you step instead of
 * resting once. The pair is standard enough to have names in German brewing
 * literature (*Maltoserast* and *Verzuckerungsrast*).
 */
const HOCHKURZ_STEPS: readonly MashStep[] = [
  { name: 'Maltose rest', type: 'infusion', targetTempC: 63, timeMinutes: 40 },
  { name: 'Saccharification', type: 'temperature', targetTempC: 72, timeMinutes: 20 },
  { name: 'Mash-out', type: 'temperature', targetTempC: 78, timeMinutes: 10 },
];

/**
 * The rest a hefeweizen mash starts with, and what is and isn't known about it.
 *
 * The mechanism is well understood. Ferulic acid esterase releases ferulic
 * acid from the wheat's cell walls, and the yeast decarboxylates it to
 * 4-vinyl guaiacol, which is the clove. The enzyme works around 43–45 °C and
 * is denatured well before saccharification, so it needs its own rest. It
 * converts no starch, so `effectiveMashTempC` ignores it.
 *
 * Whether the rest changes the finished beer is not settled, and the
 * description doesn't claim it does. Homebrew-scale trials have often failed
 * to find a perceptible difference. The usual explanations are that a normal
 * mash passes through the range on its way up, and that the wort already has
 * free ferulic acid. There's also a pH dependency this model doesn't
 * represent.
 *
 * This is convention, not something we can cite. It's the schedule German
 * wheat-beer practice is usually described with. If the effect is ever
 * measured properly, update the rest and the description.
 */
const FERULIC_ACID_REST: MashStep = {
  name: 'Ferulic acid rest',
  type: 'infusion',
  targetTempC: 44,
  timeMinutes: 15,
};

/**
 * The technique profiles: how the mash reaches its rests.
 *
 * The three decoction schedules are adapted from `decoction.ts`'s
 * {@link DECOCTION_SCHEDULES}, not copied, so decoctions are mash schedules
 * like the others.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const TECHNIQUE_MASH_SCHEDULES: readonly NamedSchedule<MashStep>[] = [
  {
    id: 'mash-single-infusion',
    name: 'Single infusion',
    description:
      'One rest and a mash-out. What most ale recipes call for, and what a well-modified malt needs.',
    kind: 'technique',
    steps: singleInfusion(MEDIUM_BODY_TEMP_C, 60),
  },
  {
    id: 'mash-hochkurz',
    name: 'Hochkurz step mash',
    description:
      'A maltose rest then a saccharification rest, both reached by heating the mash, with no decoction pull. The modern German lager schedule.',
    kind: 'technique',
    steps: HOCHKURZ_STEPS,
  },
  {
    id: 'mash-hefeweizen-ferulic',
    name: 'Hefeweizen, traditional',
    description:
      'A ferulic acid rest for the clove, then an ordinary German step mash. Finishes dry and effervescent, the way the style is usually described.',
    kind: 'technique',
    steps: [
      FERULIC_ACID_REST,
      // The rest is Hochkurz, reached by heat because the mash is already in the
      // tun. We reuse the shared steps so they can't drift into small,
      // arbitrary differences from Hochkurz's 63 °C / 40 min and 78 °C.
      ...HOCHKURZ_STEPS.map((step) => ({ ...step, type: 'temperature' as const })),
    ],
  },
  {
    id: 'mash-hefeweizen-ester',
    name: 'Hefeweizen, ester-forward',
    description:
      'The same clove rest, then one warm rest instead of two. A higher share of glucose in the wort, which favors the banana, at the cost of a fuller finish.',
    kind: 'technique',
    steps: [
      FERULIC_ACID_REST,
      {
        name: 'Saccharification',
        type: 'temperature',
        targetTempC: FULL_BODY_TEMP_C,
        timeMinutes: 60,
      },
      { name: 'Mash-out', type: 'temperature', targetTempC: 78, timeMinutes: 10 },
    ],
  },
  /**
   * The two lambic mashes, and how much of them the model sees.
   *
   * A turbid mash pulls starchy wort out of the tun between rests, holds it
   * near 88 °C in a second kettle so it can't convert, and returns it later.
   * The pulls aren't decoction steps, because the planner boils a decoction
   * pull and a turbid pull is held hot so that it never boils. So the steps
   * below are the tun's rests, which is all the fermentability model reads,
   * and the pulls are only in the description. The rest temperatures are the
   * schedule the references give (45, 58, 65, 72 °C, hot mash-out), and they
   * assume a grist of 30–40 % raw wheat.
   *
   * The mock turbid is de Garde's shortcut, with one vessel and one hot rest.
   * At 74 °C conversion can't keep up, and the starch and long dextrins that
   * survive feed the Brettanomyces in year two. Both finish hotter than an
   * ordinary mash-out because lambic sparges hot.
   */
  {
    id: 'mash-turbid',
    name: 'Turbid mash',
    description:
      'The traditional lambic schedule, from the tun’s side: an acid rest, then stepped infusions with a starchy pull drawn off after the first rest and again after saccharification, held just off the boil in a second kettle so it cannot convert, and returned for the warm rest. The starch that survives feeds the Brett for the next two years. Written for a grist that is a third raw wheat.',
    kind: 'technique',
    steps: [
      { name: 'Acid rest', type: 'infusion', targetTempC: 45, timeMinutes: 20 },
      { name: 'First rest', type: 'infusion', targetTempC: 58, timeMinutes: 10 },
      { name: 'Saccharification', type: 'infusion', targetTempC: 65, timeMinutes: 30 },
      { name: 'Warm rest', type: 'temperature', targetTempC: 72, timeMinutes: 20 },
      { name: 'Mash-out', type: 'temperature', targetTempC: 75, timeMinutes: 10 },
    ],
  },
  {
    id: 'mash-mock-turbid',
    name: 'Mock turbid',
    description:
      'One hot rest in place of the turbid mash’s five. A quarter of an hour at a temperature too hot for conversion to keep up, so the unconverted starch a turbid mash is after survives without the second kettle. The shortcut American coolship brewers use to feed a Brett beer from a single vessel.',
    kind: 'technique',
    steps: [
      { name: 'Hot saccharification', type: 'infusion', targetTempC: 74, timeMinutes: 15 },
      { name: 'Mash-out', type: 'temperature', targetTempC: 77, timeMinutes: 10 },
    ],
  },
  ...DECOCTION_SCHEDULES.map(
    (preset): NamedSchedule<MashStep> => ({
      id: `mash-${preset.id}`,
      name: preset.name,
      description: preset.description,
      kind: 'technique',
      steps: preset.steps,
    }),
  ),
];

/**
 * Every mash schedule in this package, body first.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const MASH_SCHEDULES: readonly NamedSchedule<MashStep>[] = [
  ...BODY_MASH_SCHEDULES,
  ...TECHNIQUE_MASH_SCHEDULES,
];

/**
 * Notes on the pressure lager schedule: what pressure gains and what it costs.
 *
 * ## Why ferment under pressure
 *
 * A lager is slow because it's cold, and it's cold because warm lager yeast
 * produces esters, the fruitiness that makes a pilsner taste like an ale.
 * Pressure lets you ferment warmer. Dissolved CO₂ suppresses yeast growth, and
 * ester formation tracks growth. Fewer new cells means less acetyl-CoA going
 * into acetate esters, so the same strain at 15 °C under 15 psi finishes
 * closer to a cold ferment's profile than a warm one's. The published homebrew
 * work agrees on the pressure range more than on the mechanism. Brülosophy's
 * pressurised-lager exBEERiments and BYO's "Fermenting Under Pressure" both
 * describe 10–20 psi, with 10–15 psi named as enough to hold esters down while
 * fermenting at ale temperatures.
 *
 * So the schedule takes ten days instead of six weeks, at room temperature
 * instead of in a fridge, and the beer is carbonated by packaging.
 *
 * ## What it costs
 *
 * - It needs a pressure-rated fermenter and a spunding valve. It's the only
 *   schedule in this set that a brewer can't apply without extra equipment.
 * - The suppression isn't selective. The same pressure that holds down the
 *   esters slows the yeast. Attenuation is slower and can stop short, which is
 *   why the primary here is seven days and not four.
 * - It's the wrong choice for a beer that depends on yeast character. A
 *   hefeweizen or a Belgian under pressure loses most of its flavour. The
 *   free-rise schedules do the opposite.
 * - Crashing at the wrong pressure over-carbonates. See
 *   {@link PRESSURE_LAGER_CRASH_PSI}. This is the most common mistake, and
 *   the schedule is set up to avoid it.
 *
 * ## Carbonation
 *
 * This doesn't change how `carbonation.ts` handles keg priming. A spunded beer
 * isn't primed at a reduced rate. It arrives holding more CO₂, which is
 * worked out from the pressure, not from a rule-of-thumb fraction.
 */

/**
 * The spunding pressure for the pressure-lager primary, in psi.
 *
 * This is a named constant because {@link PRESSURE_LAGER_CRASH_PSI} only makes
 * sense next to it, and the difference between the two matters. 15 psi is the
 * middle of the published homebrew guidance. Brülosophy's pressurised-lager
 * exBEERiments and *Brew Your Own*'s "Fermenting Under Pressure" both work in
 * the 10–20 psi band, with 10–15 psi quoted as enough to hold esters down at
 * ale temperatures.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const PRESSURE_LAGER_PRIMARY_PSI = 15;

/**
 * The spunding valve setting for the crash, in psi.
 *
 * Lowering the pressure stops the beer reaching packaging over-carbonated. CO₂
 * solubility roughly doubles between 15 °C and 2 °C, so holding 15 psi through
 * the crash leaves the beer near 2.9 volumes, above the usual range for any
 * lager. Backing the valve down to 10 psi gives about 2.5, which suits a
 * pilsner. `carbonation.ts` computes both figures and `schedules.test.ts`
 * checks this one, so the number and this comment stay in agreement.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const PRESSURE_LAGER_CRASH_PSI = 10;

/**
 * The fermentation schedules.
 *
 * ## What they're for
 *
 * A fermentation schedule mostly follows the yeast, so this set doesn't try
 * to cover every beer. It covers the cases where the shape of the schedule
 * matters and there's a common mistake to avoid: holding a Belgian cool,
 * letting a saison stall, crashing a lager before the diacetyl is gone. Each
 * description says which mistake it's for.
 *
 * ## The common shape
 *
 * Six of the eleven hold and then move: a short cool primary while the yeast
 * multiplies and produces its character, then a rise or a drop for the rest.
 * Modern ale charts use this shape, for the same reason each time. The first
 * two or three days set the ester and phenol profile, and the days after that
 * are attenuation and clean-up, which want a different temperature.
 *
 * ## Variants
 *
 * Where a schedule has two reasonable forms we include both, as with the two
 * hefeweizen mashes. "Clean ale" and "Clean ale, cold crashed" are the clearest
 * case. Adding a crash step to the first would change a schedule whose
 * description says two weeks at one temperature, and a brewer who
 * bottle-conditions wants the yeast that a crash drops out. Applying a profile
 * copies its steps, so existing recipes wouldn't change, but the name would
 * mean something different, and that's worse than having a second name.
 *
 * @category Recipe
 * @group Constants and defaults
 */
export const FERMENTATION_SCHEDULES: readonly NamedSchedule<FermentationStep>[] = [
  {
    id: 'ferment-clean-ale',
    name: 'Clean ale',
    description: 'Two weeks at one temperature, then packaging. What most ale yeast wants.',
    kind: 'fermentation',
    steps: [{ name: 'Primary', type: 'primary', tempC: 19, days: 14 }],
  },
  {
    id: 'ferment-clean-ale-crashed',
    name: 'Clean ale, cold crashed',
    description:
      'The same two weeks, with the last two of them cold so the yeast and haze drop. Clearer beer, and more CO₂ still in it at packaging.',
    kind: 'fermentation',
    steps: [
      { name: 'Primary', type: 'primary', tempC: 19, days: 12 },
      // 'conditioning', not 'lagering', because a two-day crash on an ale is for
      // clearing the beer, not a month of cold conditioning.
      { name: 'Cold crash', type: 'conditioning', tempC: 2, days: 2 },
    ],
  },
  {
    id: 'ferment-english-ale',
    name: 'English ale, cool drop',
    description:
      'A week warm to finish the job, then a cool cellar fortnight. English yeasts flocculate hard and drop bright if you let them sit cool.',
    kind: 'fermentation',
    steps: [
      { name: 'Primary', type: 'primary', tempC: 20, days: 6 },
      { name: 'Cool conditioning', type: 'conditioning', tempC: 12, days: 8 },
    ],
  },
  {
    id: 'ferment-hazy-free-rise',
    name: 'Hazy IPA free-rise',
    description:
      'Cool for three days while the esters are made, then let it climb. Free-rising early throws solvent and fusel notes a hazy has nowhere to hide.',
    kind: 'fermentation',
    steps: [
      { name: 'Primary', type: 'primary', tempC: 18, days: 3 },
      { name: 'Free rise', type: 'primary', tempC: 21, days: 9 },
    ],
  },
  {
    id: 'ferment-belgian-free-rise',
    name: 'Belgian free-rise',
    description:
      'Two days cool, then let it climb to the top of the strain’s range. Holding a Belgian cool the whole way is the classic mistake: the spice and stone fruit are made by the rise, so a beer kept at the starting temperature finishes clean and characterless.',
    kind: 'fermentation',
    steps: [
      { name: 'Primary', type: 'primary', tempC: 18, days: 2 },
      { name: 'Free rise', type: 'primary', tempC: 25, days: 10 },
    ],
  },
  {
    id: 'ferment-saison-hot',
    name: 'Saison, hot finish',
    description:
      'Start warm and finish hotter. Saison strains famously stall in the last few gravity points, and more heat gets them through without a second pitch.',
    kind: 'fermentation',
    steps: [
      { name: 'Primary', type: 'primary', tempC: 24, days: 3 },
      { name: 'Free rise', type: 'primary', tempC: 29, days: 11 },
    ],
  },
  {
    id: 'ferment-hefeweizen',
    name: 'Hefeweizen',
    description:
      'Cool and left alone: the banana and clove are the yeast under mild stress, and chasing them warmer usually overshoots.',
    kind: 'fermentation',
    steps: [{ name: 'Primary', type: 'primary', tempC: 18, days: 14 }],
  },
  {
    id: 'ferment-kveik',
    name: 'Kveik',
    description: 'Hot and fast. Kveik is pitched warm on purpose and is often done in three days.',
    kind: 'fermentation',
    steps: [{ name: 'Primary', type: 'primary', tempC: 35, days: 4 }],
  },
  {
    id: 'ferment-lager-diacetyl',
    name: 'Lager with a diacetyl rest',
    description:
      'Cold primary, then a warm rest so the yeast clears the butterscotch it made, then weeks of cold conditioning.',
    kind: 'fermentation',
    steps: [
      { name: 'Primary', type: 'primary', tempC: 10, days: 10 },
      { name: 'Diacetyl rest', type: 'primary', tempC: 18, days: 3 },
      { name: 'Lagering', type: 'lagering', tempC: 2, days: 28 },
    ],
  },
  {
    id: 'ferment-fast-lager',
    name: 'Fast lager, warm finish',
    description:
      'Two weeks instead of six. Warmer primary, a warm finish that doubles as the diacetyl rest, then a short crash. Pick this one when you need the fermenter back. For a pilsner that wants the full schedule, pick the classic profile beside it.',
    kind: 'fermentation',
    steps: [
      { name: 'Primary', type: 'primary', tempC: 13, days: 6 },
      { name: 'Warm finish', type: 'primary', tempC: 18, days: 4 },
      { name: 'Cold crash', type: 'lagering', tempC: 2, days: 4 },
    ],
  },
  {
    id: 'ferment-pressure-lager',
    name: 'Pressure lager',
    description:
      'A lager at ale temperature, kept clean by the spunding valve with no fridge needed. Ten days start to finish, and it carbonates itself.',
    kind: 'fermentation',
    steps: [
      {
        name: 'Primary',
        type: 'primary',
        tempC: 15,
        days: 7,
        pressurePsi: PRESSURE_LAGER_PRIMARY_PSI,
      },
      {
        name: 'Cold crash',
        type: 'lagering',
        tempC: 2,
        days: 3,
        pressurePsi: PRESSURE_LAGER_CRASH_PSI,
      },
    ],
  },
];

/**
 * One shipped schedule by id, mash or fermentation.
 *
 * @category Recipe
 * @group Calculations
 */
export function findNamedSchedule(
  id: string,
): NamedSchedule<MashStep> | NamedSchedule<FermentationStep> | undefined {
  return (
    MASH_SCHEDULES.find((schedule) => schedule.id === id) ??
    FERMENTATION_SCHEDULES.find((schedule) => schedule.id === id)
  );
}
