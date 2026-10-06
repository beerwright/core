/**
 * Salt solver for a target water profile.
 *
 * A typical request is "get me within tolerance of this target using at most
 * three salts, and don't use chalk." The answer has to be the same every time,
 * has to be something you can weigh on a kitchen scale, and has to be fast
 * enough to recompute on every keystroke.
 *
 * ## The algorithm
 *
 * Salt dosing is a non-negative least-squares problem. With `x` the grams
 * of each salt per litre, `A` the ppm-per-gram-per-litre matrix from
 * `./water`, and `b` the ppm each ion still needs:
 *
 * ```
 * minimise ‖W(Ax − b)‖²   subject to   x ≥ 0,   ‖x‖₀ ≤ maxSalts
 * ```
 *
 * `W` is diagonal, `Wᵢᵢ = weightᵢ / toleranceᵢ`, which puts every ion's error
 * in units of "tolerances missed", so a 20 ppm sulfate miss and a 20 ppm
 * calcium miss aren't treated as equally bad.
 *
 * The cardinality constraint usually makes this kind of problem hard, but here
 * it makes it easy. With ≤ 9 candidate salts and a cap of 3, there are at most
 * 130 subsets, and we solve each one exactly from its normal equations. The KKT
 * conditions for NNLS say the optimum has some set of variables at zero and the
 * rest at the unconstrained least-squares solution, so enumerating subsets is
 * the same as enumerating active sets, and the best strictly positive solution
 * we find is the global optimum. There's no iteration, starting point or
 * optimiser tolerance. Two salts with identical ion ratios (the two calcium
 * chloride forms) make a singular system, which we detect and skip.
 *
 * Runtime is ~130 solves of a ≤ 3 × 3 system, so microseconds. The result is
 * deterministic: there's no randomness, no floating-point-order dependence
 * beyond the fixed candidate ordering, and ties are broken by the declared salt
 * order.
 *
 * ## Preferring fewer salts
 *
 * We add a flat penalty of `fewerSaltsPenalty` (default 0.05 tolerance units)
 * per salt used, so a third salt has to improve the fit by more than a rounding
 * error to be picked. A salt whose dose comes out below `minSaltGrams` rejects
 * the whole subset. The smaller subset is already in the enumeration and will
 * win.
 */

import type { Explanation } from './explain';
import { explain } from './explain';
import { LAWSON_HANSON_1974, PALMER_KAMINSKI_WATER_2013 } from './sources';
import type { Fraction, Litres, SaltAddition, SaltId, WaterIon, WaterProfile } from './types';
import type {
  IonAmounts,
  SaltSplit,
  SulfateChlorideBalance,
  TreatedWater,
  WaterVolumes,
} from './water';
import {
  applySalts,
  diluteProfile,
  fromIonAmounts,
  ION_ADVISORY_RANGE_PPM,
  ION_LABELS,
  RO_WATER,
  SALT_DEFINITIONS,
  SULFATE_CHLORIDE_MEANINGFUL_PPM,
  saltIonPpmPerGramPerLitre,
  sulfateChlorideBalance,
  sulfateChlorideRatio,
  toIonAmounts,
  unmeasuredIons,
  WATER_IONS,
} from './water';

/**
 * Salts the solver may reach for unless told otherwise.
 *
 * Chalk and slaked lime are excluded. Chalk doesn't dissolve, and slaked lime
 * is potent enough that we don't want a solver picking it unprompted. Anhydrous
 * calcium chloride is excluded because homebrew shops sell the dihydrate, and a
 * recipe that says "3.2 g calcium chloride" meaning the anhydrous form will
 * overshoot calcium by a third. Add any of them through `allowedSalts` when you
 * have them.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_SOLVER_SALTS: readonly SaltId[] = [
  'gypsum',
  'calcium-chloride-dihydrate',
  'epsom-salt',
  'table-salt',
  'magnesium-chloride',
  'baking-soda',
];

/**
 * The salts a brewer has to ask for by name.
 *
 * These are the salts {@link DEFAULT_SOLVER_SALTS} leaves out, derived from it
 * so the two lists can't drift apart. The reasons are in the comment above:
 * chalk won't dissolve, slaked lime is too potent to pick automatically, and
 * "calcium chloride" on a recipe almost always means the dihydrate.
 *
 * Having one of these on the shelf isn't the same as asking for it. A caller
 * that builds `allowedSalts` from a brewer's inventory should still get an
 * explicit yes for these three. Otherwise a bag recorded once in the inventory
 * would put them back into every solve.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const CAUTION_SALTS: readonly SaltId[] = (Object.keys(SALT_DEFINITIONS) as SaltId[]).filter(
  (salt) => !DEFAULT_SOLVER_SALTS.includes(salt),
);

/**
 * Default per-ion tolerances, ppm.
 *
 * Scaled to how much each ion has to move before anyone could taste the
 * difference, which is why sulfate's is much wider than magnesium's. They're
 * also the denominators in the objective, so changing one re-weights the fit.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_ION_TOLERANCE_PPM: Readonly<Record<WaterIon, number>> = {
  calcium: 10,
  magnesium: 5,
  sodium: 10,
  chloride: 15,
  sulfate: 25,
  bicarbonate: 20,
};

/**
 * Default per-ion weights. They're all equal because the tolerances already do the scaling.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const DEFAULT_ION_WEIGHTS: Readonly<Record<WaterIon, number>> = {
  calcium: 1,
  magnesium: 1,
  sodium: 1,
  chloride: 1,
  sulfate: 1,
  bicarbonate: 1,
};

/**
 * How the solved salts are divided between mash and sparge.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export type SaltSplitStrategy =
  /** Split by volume so mash and sparge end up at the same profile. The default. */
  | 'proportional'
  /** Everything into the mash. The sparge stays as the source water. */
  | 'mash-only';

/**
 * Input to {@link solveWaterProfile}.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface WaterSolverInput {
  /** Water as it comes out of the tap. */
  readonly source: WaterProfile;
  /** Profile to aim at. */
  readonly target: WaterProfile;
  /** Mash and sparge volumes. */
  readonly volumes: WaterVolumes;
  /** Salts the solver may use. Defaults to {@link DEFAULT_SOLVER_SALTS}. */
  readonly allowedSalts?: readonly SaltId[];
  /** Maximum number of distinct salts. Defaults to 3. */
  readonly maxSalts?: number;
  /** Per-ion tolerances, ppm. Merged over {@link DEFAULT_ION_TOLERANCE_PPM}. */
  readonly tolerancePpm?: Partial<Record<WaterIon, number>>;
  /** Per-ion weights. Merged over {@link DEFAULT_ION_WEIGHTS}. Set an ion to 0 to ignore it. */
  readonly weights?: Partial<Record<WaterIon, number>>;
  /** Where the salts go. Defaults to `proportional`. */
  readonly splitStrategy?: SaltSplitStrategy;
  /** RO/distilled share of the brewing water, 0–1. Defaults to 0. */
  readonly dilutionFraction?: Fraction;
  /** What the dilution water is. Defaults to ion-free RO. */
  readonly dilutionProfile?: WaterProfile;
  /**
   * Let the solver choose the dilution too, by scanning a grid and then
   * refining around the best point. Off by default, because most brewers have
   * decided how much RO they're buying before they start.
   */
  readonly searchDilution?: boolean;
  /** Upper bound on a searched dilution. Defaults to 0.9. */
  readonly maxDilutionFraction?: Fraction;
  /** Grid points in the coarse dilution scan. Defaults to 19 (0.05 steps to 0.9). */
  readonly dilutionSteps?: number;
  /** Round doses to this many grams. Defaults to 0.1, the resolution of a brewing scale. */
  readonly roundToGrams?: number;
  /** Reject any salt whose dose is below this, grams. Defaults to 0.2. */
  readonly minSaltGrams?: number;
  /** Score penalty per salt used, in tolerance units. Defaults to 0.05. */
  readonly fewerSaltsPenalty?: number;
  /**
   * Score penalty per unit of dilution fraction, in tolerance units. Defaults
   * to 0.5, so replacing 90 % of the water with RO costs 0.45. That's enough to
   * stop the solver sending you out for 25 litres of bottled water to shave an
   * ion that was already inside its tolerance, but not enough to stop it
   * diluting a source that has too many minerals. Only used when
   * {@link searchDilution} is on.
   */
  readonly dilutionPenalty?: number;
}

/**
 * How one ion came out.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface IonFit {
  /** The ion. */
  readonly ion: WaterIon;
  /** Display label for the ion, such as `Ca²⁺`. */
  readonly label: string;
  /** The ion in the source water after any dilution, ppm. */
  readonly sourcePpm: number;
  /** The ion in the target, ppm. */
  readonly targetPpm: number;
  /** The ion in the treated water, ppm. */
  readonly achievedPpm: number;
  /** `achieved − target`. Negative means short. */
  readonly deltaPpm: number;
  /** How far the ion may miss the target and still count as a fit, ppm. */
  readonly tolerancePpm: number;
  /** True when the miss is inside the tolerance, or the ion carries no weight in the fit. */
  readonly withinTolerance: boolean;
}

/**
 * Everything {@link solveWaterProfile} returns.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface WaterSolverResult {
  /** The recommended salt schedule. Already split by `target`. */
  readonly additions: readonly SaltAddition[];
  /** Grams of each salt in each vessel. */
  readonly split: readonly SaltSplit[];
  /** The mash, sparge and combined waters the schedule produces. */
  readonly treated: TreatedWater;
  /** The water the target was fitted against: total water, or mash water for `mash-only`. */
  readonly achieved: WaterProfile;
  /** The source after any dilution. */
  readonly dilutedSource: WaterProfile;
  /** How each ion came out, one entry per ion. */
  readonly fit: readonly IonFit[];
  /** Weighted RMS error in tolerance units. 0 is exact, and ≤ 1 means "every ion inside its tolerance on average". */
  readonly score: number;
  /** Largest single-ion miss, ppm. */
  readonly maxAbsErrorPpm: number;
  /** True when every weighted ion landed inside its tolerance. */
  readonly withinTolerance: boolean;
  /** RO share of the brewing water, 0 to 1. The solver's choice when `searchDilution` is on. */
  readonly dilutionFraction: Fraction;
  /** Number of salt additions in the schedule. */
  readonly saltCount: number;
  /** Number of subsets evaluated, so callers can see what the solve cost. */
  readonly candidatesEvaluated: number;
  /** How the schedule was worked out, for display. */
  readonly explain: Explanation;
  /** Problems worth telling the brewer about, as sentences. */
  readonly warnings: readonly string[];
}

interface Candidate {
  readonly salts: readonly SaltId[];
  readonly gramsPerSalt: readonly number[];
  readonly score: number;
  readonly adjustedScore: number;
  readonly achieved: IonAmounts;
}

/**
 * Recommend a salt schedule that lands the water on a target profile.
 *
 * The same input always produces the same schedule, down to the last decimal
 * place.
 *
 * @category Water and mash pH
 * @group Start here
 */
export function solveWaterProfile(input: WaterSolverInput): WaterSolverResult {
  const allowedSalts = input.allowedSalts ?? DEFAULT_SOLVER_SALTS;
  const maxSalts = Math.max(0, Math.min(input.maxSalts ?? 3, allowedSalts.length));
  const tolerance = { ...DEFAULT_ION_TOLERANCE_PPM, ...input.tolerancePpm };
  const weights = { ...DEFAULT_ION_WEIGHTS, ...input.weights };
  const splitStrategy = input.splitStrategy ?? 'proportional';
  const roundToGrams = input.roundToGrams ?? 0.1;
  const minSaltGrams = input.minSaltGrams ?? 0.2;
  const fewerSaltsPenalty = input.fewerSaltsPenalty ?? 0.05;
  const dilutant = input.dilutionProfile ?? RO_WATER;

  const totalVolumeL = input.volumes.mashVolumeL + input.volumes.spargeVolumeL;
  // `mash-only` fits the mash water; anything else fits all the brewing water.
  const fitVolumeL = splitStrategy === 'mash-only' ? input.volumes.mashVolumeL : totalVolumeL;

  const dilutionCandidates = buildDilutionGrid(input);

  const dilutionPenalty = input.dilutionPenalty ?? 0.5;

  let best: { candidate: Candidate; dilutionFraction: number; total: number } | undefined;
  let candidatesEvaluated = 0;

  for (const dilutionFraction of dilutionCandidates) {
    const diluted = diluteProfile(input.source, dilutionFraction, dilutant);
    const search = searchSubsets({
      source: diluted,
      target: input.target,
      allowedSalts,
      maxSalts,
      tolerance,
      weights,
      volumeL: fitVolumeL,
      roundToGrams,
      minSaltGrams,
      fewerSaltsPenalty,
    });
    candidatesEvaluated += search.evaluated;
    if (!search.best) continue;
    const total = search.best.adjustedScore + dilutionFraction * dilutionPenalty;
    if (!best || total < best.total) {
      best = { candidate: search.best, dilutionFraction, total };
    }
  }

  const dilutionFraction = best?.dilutionFraction ?? input.dilutionFraction ?? 0;
  const dilutedSource = diluteProfile(input.source, dilutionFraction, dilutant);
  const chosen = best?.candidate;

  const additions: SaltAddition[] = [];
  if (chosen) {
    for (let i = 0; i < chosen.salts.length; i += 1) {
      const salt = chosen.salts[i];
      const grams = chosen.gramsPerSalt[i];
      if (salt === undefined || grams === undefined || grams <= 0) continue;
      additions.push({ salt, grams, target: splitStrategy === 'mash-only' ? 'mash' : 'total' });
    }
  }

  const treated = applySalts({
    source: dilutedSource,
    additions,
    volumes: input.volumes,
  });
  const achieved = splitStrategy === 'mash-only' ? treated.mash : treated.total;

  const targetIons = toIonAmounts(input.target);
  const achievedIons = toIonAmounts(achieved);
  const sourceIons = toIonAmounts(dilutedSource);
  const fit: IonFit[] = WATER_IONS.map((ion) => {
    const delta = achievedIons[ion] - targetIons[ion];
    return {
      ion,
      label: ION_LABELS[ion],
      sourcePpm: sourceIons[ion],
      targetPpm: targetIons[ion],
      achievedPpm: achievedIons[ion],
      deltaPpm: delta,
      tolerancePpm: tolerance[ion],
      withinTolerance: weights[ion] === 0 || Math.abs(delta) <= tolerance[ion],
    };
  });

  const score = weightedScore(achievedIons, targetIons, tolerance, weights);
  const maxAbsErrorPpm = fit.reduce(
    (max, f) => (weights[f.ion] === 0 ? max : Math.max(max, Math.abs(f.deltaPpm))),
    0,
  );

  const warnings = [
    ...treated.warnings,
    ...solverWarnings(fit, chosen, weights),
    ...unmeasuredSourceWarnings(dilutedSource, weights),
  ];

  return {
    additions,
    split: treated.split,
    treated,
    achieved,
    dilutedSource,
    fit,
    score,
    maxAbsErrorPpm,
    withinTolerance: fit.every((f) => f.withinTolerance),
    dilutionFraction,
    saltCount: additions.length,
    candidatesEvaluated,
    explain: explain(score, {
      label: 'Water profile fit',
      formula: 'nnls-subset-enumeration',
      expression: 'minimize ‖W(Ax − b)‖² subject to x ≥ 0, ‖x‖₀ ≤ maxSalts',
      inputs: {
        maxSalts,
        saltsUsed: additions.length,
        allowedSalts: allowedSalts.join(', '),
        totalWaterL: roundTo(totalVolumeL, 2),
        fittedWaterL: roundTo(fitVolumeL, 2),
        dilutionFraction: roundTo(dilutionFraction, 3),
        splitStrategy,
        roundToGrams,
        maxAbsErrorPpm: roundTo(maxAbsErrorPpm, 1),
        candidatesEvaluated,
      },
      unit: 'weighted RMS tolerances',
      notes: [
        'Score is the RMS of (achieved − target) / tolerance across the six ions: ' +
          '0 is exact, 1 means "off by one tolerance on average".',
        `Doses are rounded to ${roundToGrams} g and the fit reported here is the fit of the ` +
          'rounded doses, not of the ideal ones.',
      ],
      family: 'water',
      sources: [LAWSON_HANSON_1974, PALMER_KAMINSKI_WATER_2013],
    }),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// The rule solver
// ---------------------------------------------------------------------------

/**
 * A target given as two conditions: keep calcium above a floor, and hit a
 * sulfate:chloride ratio.
 *
 * A brewer who says "at least 50 ppm calcium and a 2:1 sulfate to chloride"
 * has set two conditions and left the other four ions alone. That's a
 * different kind of target from a six-ion profile, and it's why a rule can be
 * satisfied exactly instead of fitted.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface WaterRule {
  /** Calcium the treated water must reach, ppm. */
  readonly minCalciumPpm: number;
  /** Sulfate ÷ chloride the treated water must land on. */
  readonly sulfateChlorideRatio: number;
}

/**
 * Input to {@link solveWaterRule}.
 *
 * @category Water and mash pH
 * @group Inputs
 */
export interface WaterRuleSolverInput {
  /** Water as it comes out of the tap. */
  readonly source: WaterProfile;
  /** The two conditions to satisfy. */
  readonly rule: WaterRule;
  /** Mash and sparge volumes. */
  readonly volumes: WaterVolumes;
  /** Salts the solver may use. Defaults to {@link DEFAULT_SOLVER_SALTS}. */
  readonly allowedSalts?: readonly SaltId[];
  /** Where the salts go. Defaults to `proportional`. */
  readonly splitStrategy?: SaltSplitStrategy;
  /** RO/distilled share of the brewing water, 0–1. Defaults to 0. */
  readonly dilutionFraction?: Fraction;
  /** What the dilution water is. Defaults to ion-free RO. */
  readonly dilutionProfile?: WaterProfile;
  /** Round doses to this many grams. Defaults to 0.1, the resolution of a brewing scale. */
  readonly roundToGrams?: number;
  /** Reject any salt whose dose is below this, grams. Defaults to 0.2. */
  readonly minSaltGrams?: number;
}

/**
 * How the rule came out, in terms of its two conditions.
 *
 * The per-ion `fit` says how close each ion got to a number, but the brewer
 * didn't give numbers for four of the six ions. This reports on the conditions
 * they did give.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface WaterRuleVerdict {
  /** The calcium floor the rule asked for, ppm. */
  readonly calciumFloorPpm: number;
  /** Calcium in the treated water, ppm. */
  readonly calciumAchievedPpm: number;
  /** True when calcium reached the floor, allowing half a ppm of slack for rounding. */
  readonly calciumMet: boolean;
  /** The sulfate:chloride ratio the rule asked for. */
  readonly ratioAim: number;
  /** `sulfateChlorideRatio` of the treated water. `NaN` or `Infinity` when there's no ratio to give. */
  readonly ratioAchieved: number;
  /** True within 5 % of the aim, or when there is too little of either ion for the ratio to mean anything. */
  readonly ratioMet: boolean;
  /** The band word for the treated water. */
  readonly band: SulfateChlorideBalance;
  /** False when the rule cannot be reached by adding salts to this water. */
  readonly reachable: boolean;
}

/**
 * Everything {@link solveWaterRule} returns: a solver result plus the verdicts.
 *
 * @category Water and mash pH
 * @group Results
 */
export interface WaterRuleSolverResult extends WaterSolverResult {
  /** How the rule's two conditions came out. */
  readonly rule: WaterRuleVerdict;
}

/**
 * The narrowest balance the solver will fit. {@link MAX_SULFATE_CHLORIDE_RATIO}
 * is the widest.
 *
 * Outside this range the ratio is really about one ion. 0.05 means "almost no
 * sulfate" and 12 means "almost no chloride". The arithmetic still works, but
 * it would be chasing an ion the brewer has effectively set to zero.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const MIN_SULFATE_CHLORIDE_RATIO = 0.1;

/**
 * The widest balance the solver will fit. See {@link MIN_SULFATE_CHLORIDE_RATIO}.
 *
 * @category Water and mash pH
 * @group Constants and defaults
 */
export const MAX_SULFATE_CHLORIDE_RATIO = 9;

/** How close the achieved ratio must land to count as met: within 5 % of the aim. */
const RATIO_MET_TOLERANCE = 0.05;

/** Calcium may sit this far under the floor before the floor counts as missed, ppm. */
const CALCIUM_FLOOR_SLACK_PPM = 0.5;

/** The three ions the rule's two salts change. The other ions stay as they were. */
const RULE_IONS: readonly WaterIon[] = ['calcium', 'sulfate', 'chloride'];

/** Weights for the rule's fit. Only the three ions it constrains count. */
const RULE_WEIGHTS: Readonly<Record<WaterIon, number>> = {
  calcium: 1,
  magnesium: 0,
  sodium: 0,
  chloride: 1,
  sulfate: 1,
  bicarbonate: 0,
};

/** Lower-case ion names for use inside sentences. {@link ION_LABELS} has the display labels. */
const ION_WORDS: Readonly<Record<WaterIon, string>> = {
  calcium: 'calcium',
  magnesium: 'magnesium',
  sodium: 'sodium',
  chloride: 'chloride',
  sulfate: 'sulfate',
  bicarbonate: 'bicarbonate',
};

/** The two salts a rule can use, named by role. */
type RuleSaltRole = 'gypsum' | 'calcium-chloride';

/** Each role's name as it appears in a warning. */
const RULE_SALT_WORDS: Readonly<Record<RuleSaltRole, string>> = {
  gypsum: 'gypsum',
  'calcium-chloride': 'calcium chloride',
};

/**
 * Satisfy a water rule exactly, with calcium salts.
 *
 * ## Why this isn't a least-squares fit
 *
 * Both conditions are linear in grams of salt, so the rule is a small system
 * with as many equations as unknowns, and isn't over-determined:
 *
 * ```
 * Σ xₛ · (so4ₛ − r · clₛ)  =  r · Cl_source − SO4_source     (the balance)
 * Σ xₛ · caₛ               =  minCa − Ca_source               (the floor)
 * ```
 *
 * Gypsum carries sulfate and calcium, calcium chloride carries chloride and
 * calcium, and between them the two rows are exactly determined. It takes one
 * call to the same `solveLinearSystem` the profile solver uses on its normal
 * equations, and the answer is exact instead of the best of 130 compromises.
 *
 * We solve the floor as an equality. Salts only add, so the solution that
 * lands on the floor is the one that clears it with the least salt. Going
 * higher is up to the brewer. When the source already clears the floor we drop
 * that row and one salt sets the balance. Gypsum's coefficient is positive and
 * calcium chloride's is negative, so the sign of the right-hand side picks the
 * salt: gypsum to raise the balance, calcium chloride to lower it, at the
 * smallest dose that gets there.
 *
 * ## When the rule is out of reach
 *
 * This happens in two ways, and the advice differs. The system can ask for a
 * negative dose, when the source has more of one ion than the ratio allows.
 * Salts can't remove an ion, so the fix is dilution. Or the dose can be
 * positive but far too large. Burton's 725 ppm sulfate balances 1:1 against
 * 700 ppm of added chloride. That's arithmetically correct, but it's 40 g of
 * calcium chloride in a 28 L brew, leaving nearly five times the comfortable
 * chloride maximum. We don't report a schedule nobody should weigh out, so a
 * dose past `MATERIAL_BREACH_FACTOR` (1.5) times an ion's
 * {@link ION_ADVISORY_RANGE_PPM} ceiling is refused too. The advice there is a
 * gentler rule, because diluting a water doesn't change its ratio. A schedule
 * that's only uncomfortable stands, with the water's own warning attached.
 *
 * Sodium and magnesium salts aren't used. Table salt and Epsom can move the
 * ratio without touching calcium, but they add an ion the rule said nothing
 * about, and a rule that doesn't mention sodium shouldn't add any.
 *
 * Like the profile solver, this is deterministic: the same input gives the
 * same schedule, to the last decimal place.
 *
 * @category Water and mash pH
 * @group Start here
 */
export function solveWaterRule(input: WaterRuleSolverInput): WaterRuleSolverResult {
  const rule = checkedRule(input.rule);
  const allowedSalts = input.allowedSalts ?? DEFAULT_SOLVER_SALTS;
  const splitStrategy = input.splitStrategy ?? 'proportional';
  const roundToGrams = input.roundToGrams ?? 0.1;
  const minSaltGrams = input.minSaltGrams ?? 0.2;
  const dilutionFraction = clamp(input.dilutionFraction ?? 0, 0, 1);
  const dilutedSource = diluteProfile(
    input.source,
    dilutionFraction,
    input.dilutionProfile ?? RO_WATER,
  );

  const totalVolumeL = input.volumes.mashVolumeL + input.volumes.spargeVolumeL;
  // `mash-only` satisfies the rule in the mash; anything else in all the water.
  const fitVolumeL = splitStrategy === 'mash-only' ? input.volumes.mashVolumeL : totalVolumeL;
  const sourceIons = toIonAmounts(dilutedSource);

  const plan = planRuleDoses(rule, sourceIons, allowedSalts);
  const solved: SaltAddition[] = [];
  for (const dose of plan.doses ?? []) {
    const grams = roundDoseGrams(dose.gramsPerLitre * fitVolumeL, roundToGrams, minSaltGrams);
    if (grams <= 0) continue;
    solved.push({
      salt: dose.salt,
      grams,
      target: splitStrategy === 'mash-only' ? 'mash' : 'total',
    });
  }
  let additions: readonly SaltAddition[] = solved;

  let treated = applySalts({ source: dilutedSource, additions, volumes: input.volumes });
  let achieved = splitStrategy === 'mash-only' ? treated.mash : treated.total;
  // The dose can be arithmetically right and still unusable (see "When the
  // rule is out of reach" above). In that case we prescribe nothing, because a
  // partial schedule towards an unreachable rule is worse than none.
  const breach =
    additions.length > 0 ? materialBreach(toIonAmounts(achieved), sourceIons, rule) : undefined;
  if (breach !== undefined) {
    additions = [];
    treated = applySalts({ source: dilutedSource, additions, volumes: input.volumes });
    achieved = splitStrategy === 'mash-only' ? treated.mash : treated.total;
  }
  const reachable = plan.missing === undefined && !plan.negativeDose && breach === undefined;

  const achievedIons = toIonAmounts(achieved);
  const targetIons = derivedRuleTarget(achievedIons, sourceIons, rule);
  const fit: IonFit[] = WATER_IONS.map((ion) => {
    const delta = achievedIons[ion] - targetIons[ion];
    return {
      ion,
      label: ION_LABELS[ion],
      sourcePpm: sourceIons[ion],
      targetPpm: targetIons[ion],
      achievedPpm: achievedIons[ion],
      deltaPpm: delta,
      tolerancePpm: DEFAULT_ION_TOLERANCE_PPM[ion],
      withinTolerance:
        RULE_WEIGHTS[ion] === 0 || ruleErrorPpm(ion, delta) <= DEFAULT_ION_TOLERANCE_PPM[ion],
    };
  });

  const ratioAchieved = sulfateChlorideRatio(achieved);
  const combinedPpm = achievedIons.sulfate + achievedIons.chloride;
  const verdict: WaterRuleVerdict = {
    calciumFloorPpm: rule.minCalciumPpm,
    calciumAchievedPpm: achievedIons.calcium,
    calciumMet: achievedIons.calcium >= rule.minCalciumPpm - CALCIUM_FLOOR_SLACK_PPM,
    ratioAim: rule.sulfateChlorideRatio,
    ratioAchieved,
    // If the rule couldn't be reached, the balance isn't met, even if the
    // untreated water's ratio happens to be close.
    ratioMet:
      reachable &&
      (combinedPpm < SULFATE_CHLORIDE_MEANINGFUL_PPM ||
        (Number.isFinite(ratioAchieved) &&
          Math.abs(ratioAchieved - rule.sulfateChlorideRatio) <=
            RATIO_MET_TOLERANCE * rule.sulfateChlorideRatio)),
    band: sulfateChlorideBalance(achieved),
    reachable,
  };

  // Calcium is only scored against the floor while it's below it. Once the
  // floor is cleared the rule is satisfied, and any extra ppm the salts carried
  // past it isn't an error.
  const score = weightedScore(
    achievedIons,
    { ...targetIons, calcium: Math.max(targetIons.calcium, achievedIons.calcium) },
    DEFAULT_ION_TOLERANCE_PPM,
    RULE_WEIGHTS,
  );
  const maxAbsErrorPpm = fit.reduce(
    (max, f) => (RULE_WEIGHTS[f.ion] === 0 ? max : Math.max(max, ruleErrorPpm(f.ion, f.deltaPpm))),
    0,
  );

  return {
    additions,
    split: treated.split,
    treated,
    achieved,
    dilutedSource,
    fit,
    score,
    maxAbsErrorPpm,
    withinTolerance: fit.every((f) => f.withinTolerance),
    dilutionFraction,
    saltCount: additions.length,
    candidatesEvaluated: plan.linearSolves,
    explain: explain(Number.isFinite(ratioAchieved) ? ratioAchieved : 0, {
      label: 'Water rule fit',
      formula: 'water-rule-exact-solve',
      expression: 'Σ xₛ (SO₄ₛ − r·Clₛ) = r·Cl_source − SO₄_source;  Σ xₛ Caₛ = minCa − Ca_source',
      inputs: {
        calciumFloorPpm: rule.minCalciumPpm,
        sulfateChlorideAim: rule.sulfateChlorideRatio,
        rowsActive: plan.floorRowActive ? 'balance and calcium floor' : 'balance only',
        saltsUsed: additions.map((a) => SALT_DEFINITIONS[a.salt].label).join(', ') || 'none',
        allowedSalts: allowedSalts.join(', '),
        totalWaterL: roundTo(totalVolumeL, 2),
        fittedWaterL: roundTo(fitVolumeL, 2),
        dilutionFraction: roundTo(dilutionFraction, 3),
        splitStrategy,
        roundToGrams,
        calciumAchievedPpm: roundTo(achievedIons.calcium, 1),
        ratioAchieved: Number.isFinite(ratioAchieved) ? roundTo(ratioAchieved, 2) : 'none',
        band: verdict.band,
      },
      unit: 'ratio',
      // A refused rule has no schedule, so its notes shouldn't describe one.
      // Notes about which rows were solved and how doses were rounded, next to
      // `saltsUsed: none`, would describe the schedule we threw away, and a
      // brewer reading them could act on something that isn't true.
      notes: reachable
        ? [
            plan.floorRowActive
              ? 'The balance alone leaves calcium under the floor, so both rows are solved ' +
                'together and the floor is met exactly. Salts only add, so landing on it ' +
                'uses the least salt that clears it.'
              : 'One salt sets the balance and the calcium it carries in already clears the ' +
                'floor, which is the least salt the rule can be satisfied with.',
            `Doses are rounded to ${roundToGrams} g and every figure here is the fit of the ` +
              'rounded doses, not of the ideal ones.',
            RULE_BANDS_NOTE,
          ]
        : [
            'No schedule: this rule cannot be reached from this water with these salts, so ' +
              'nothing is prescribed. The figures below are the untreated water.',
            ...refusalNotes(rule, plan, breach),
            RULE_BANDS_NOTE,
          ],
      family: 'water',
      sources: [PALMER_KAMINSKI_WATER_2013],
    }),
    warnings: [
      ...new Set([
        ...treated.warnings,
        ...ruleWarnings(rule, sourceIons, achievedIons, plan, breach),
      ]),
    ],
    rule: verdict,
  };
}

/** The citation both the solved and the refused explanation carry. */
const RULE_BANDS_NOTE =
  'The 50–150 ppm calcium working range and the sulfate:chloride flavor bands are Palmer & ' +
  'Kaminski, Water (2013) ch. 4.';

/**
 * Explanation notes saying why there's no schedule.
 *
 * This parallels {@link ruleWarnings} but doesn't share code with it. A warning
 * tells the brewer what to do about the problem. An explanation note tells
 * whoever is asking how the number was reached what the solver did. Both cover
 * the same three causes, and both need to name the ion and the ppm.
 */
function refusalNotes(
  rule: WaterRule,
  plan: RulePlan,
  breach: RuleBreach | undefined,
): readonly string[] {
  const notes: string[] = [];
  if (plan.missing !== undefined) {
    notes.push(
      `The balance needs ${RULE_SALT_WORDS[plan.missing]}, which is not among the salts the ` +
        'solve was allowed.',
    );
  }
  if (plan.negativeDose) {
    notes.push(
      `Solving the balance asked for a negative dose: reaching ` +
        `${formatRatio(rule.sulfateChlorideRatio)} from this water would mean taking an ion ` +
        'out, and salts only add.',
    );
  }
  if (breach !== undefined) {
    notes.push(
      `The exact doses would leave ${ION_WORDS[breach.ion]} at ` +
        `${breach.achievedPpm.toFixed(0)} ppm, past ${breach.ceilingPpm.toFixed(0)} ppm by more ` +
        `than the ${MATERIAL_BREACH_FACTOR}× a schedule is allowed to run over, so they were ` +
        'not used.',
    );
  }
  return notes;
}

/** One salt's unrounded dose, grams per litre. */
interface RuleDose {
  readonly salt: SaltId;
  readonly gramsPerLitre: number;
}

/** The doses a rule works out to, or the reason there are none. */
interface RulePlan {
  /** Grams per litre per salt, in declared order. Absent when the rule is out of reach. */
  readonly doses?: readonly RuleDose[];
  /** A salt the rule needed that isn't in `allowedSalts`. */
  readonly missing?: RuleSaltRole;
  /** True when the exact solution asked for a dose below zero. */
  readonly negativeDose: boolean;
  /** Whether the calcium row was part of the system. */
  readonly floorRowActive: boolean;
  /** Linear systems solved: one, or none when a needed salt was missing. */
  readonly linearSolves: number;
}

/**
 * The exact solution of the rule's rows, in grams per litre.
 *
 * Calcium is a minimum, so we don't always pin it to the floor. Doing that in
 * every case makes ordinary rules unreachable: a water at
 * Ca 40 / SO₄ 50 / Cl 50 aiming at 3 solves to 2.39 g of gypsum and −1.01 g of
 * calcium chloride, when 5.0 g of gypsum alone lands it at Ca 81.6 and a 2.99
 * balance. So we try the balance on its own first:
 *
 * 1. Solve the balance row alone, with the one salt that can move it in the
 *    direction wanted. If the calcium that comes in with that salt already
 *    clears the floor, that's the answer. It's the least salt that satisfies
 *    the rule, since nothing was added for calcium.
 * 2. If step 1 leaves calcium short, solve both rows with the floor as an
 *    equality. Both doses are strictly positive whenever we get here: step 1's
 *    solution is a point on the balance line with one salt at zero, and the
 *    line's direction (`Δgypsum·SO₄ = Δcalcium-chloride·r·Cl`) has both
 *    components positive and adds calcium, so moving along it up to the floor
 *    can only raise both doses.
 * 3. A dose below zero means the water has more of one ion than the ratio
 *    allows. Step 2's algebra rules that out, but we keep the sign check so a
 *    later refactor can't start prescribing negative grams.
 *
 * Unknowns are ordered gypsum, then calcium chloride. That's the order of
 * {@link DEFAULT_SOLVER_SALTS}, and it keeps the schedule's order and the
 * tie-breaks deterministic.
 */
function planRuleDoses(
  rule: WaterRule,
  source: IonAmounts,
  allowedSalts: readonly SaltId[],
): RulePlan {
  const ratio = rule.sulfateChlorideRatio;
  const balanceRhs = ratio * source.chloride - source.sulfate;
  const gypsum: SaltId | undefined = allowedSalts.includes('gypsum') ? 'gypsum' : undefined;
  const calciumChloride = pickCalciumChloride(allowedSalts);
  /** How much one gram per litre of a salt moves `SO₄ − r·Cl`. */
  const balanceCoefficient = (salt: SaltId): number => {
    const column = saltIonPpmPerGramPerLitre(salt);
    return column.sulfate - ratio * column.chloride;
  };

  // Step 1. Gypsum's balance coefficient is `+SO₄ per gram` and calcium
  // chloride's is `−r × Cl per gram`, so the sign of the balance picks the
  // salt. Only that salt can move `SO₄ − r·Cl` in the direction wanted.
  const role: RuleSaltRole | undefined =
    balanceRhs === 0 ? undefined : balanceRhs > 0 ? 'gypsum' : 'calcium-chloride';
  const balanceSalt = role === undefined ? undefined : role === 'gypsum' ? gypsum : calciumChloride;
  if (role !== undefined && balanceSalt === undefined) {
    return { missing: role, negativeDose: false, floorRowActive: false, linearSolves: 0 };
  }
  let balanceDose = 0;
  if (balanceSalt !== undefined) {
    const [dose] = solveLinearSystem([[balanceCoefficient(balanceSalt)]], [balanceRhs]) ?? [];
    if (dose === undefined || !(dose >= 0))
      return { negativeDose: true, floorRowActive: false, linearSolves: 1 };
    balanceDose = dose;
  }
  const calciumFromBalance =
    balanceSalt === undefined ? 0 : balanceDose * saltIonPpmPerGramPerLitre(balanceSalt).calcium;
  if (source.calcium + calciumFromBalance >= rule.minCalciumPpm) {
    return {
      doses: balanceSalt === undefined ? [] : [{ salt: balanceSalt, gramsPerLitre: balanceDose }],
      negativeDose: false,
      floorRowActive: false,
      linearSolves: balanceSalt === undefined ? 0 : 1,
    };
  }

  // Step 2. Calcium is short, so the floor becomes a row of its own and both
  // salts are solved together.
  if (gypsum === undefined)
    return { missing: 'gypsum', negativeDose: false, floorRowActive: true, linearSolves: 0 };
  if (calciumChloride === undefined)
    return {
      missing: 'calcium-chloride',
      negativeDose: false,
      floorRowActive: true,
      linearSolves: 0,
    };
  const solution = solveLinearSystem(
    [
      [balanceCoefficient(gypsum), balanceCoefficient(calciumChloride)],
      [
        saltIonPpmPerGramPerLitre(gypsum).calcium,
        saltIonPpmPerGramPerLitre(calciumChloride).calcium,
      ],
    ],
    [balanceRhs, rule.minCalciumPpm - source.calcium],
  );
  // Step 3.
  const [gypsumDose, chlorideDose] = solution ?? [];
  if (
    !(
      gypsumDose !== undefined &&
      gypsumDose >= 0 &&
      chlorideDose !== undefined &&
      chlorideDose >= 0
    )
  )
    return { negativeDose: true, floorRowActive: true, linearSolves: 1 };
  return {
    doses: [
      { salt: gypsum, gramsPerLitre: gypsumDose },
      { salt: calciumChloride, gramsPerLitre: chlorideDose },
    ],
    negativeDose: false,
    floorRowActive: true,
    linearSolves: 1,
  };
}

/**
 * Which calcium chloride to dose with.
 *
 * Homebrew shops sell the dihydrate, and it's the one in
 * {@link DEFAULT_SOLVER_SALTS}. We only use the anhydrous form when it's the
 * only one allowed, because a gram of it carries 32 % more calcium and chloride
 * than a gram of the dihydrate, and picking the wrong one wouldn't show up
 * anywhere.
 */
function pickCalciumChloride(allowedSalts: readonly SaltId[]): SaltId | undefined {
  if (allowedSalts.includes('calcium-chloride-dihydrate')) return 'calcium-chloride-dihydrate';
  if (allowedSalts.includes('calcium-chloride-anhydrous')) return 'calcium-chloride-anhydrous';
  return undefined;
}

/**
 * The profile the rule implies, for the per-ion table.
 *
 * A rule sets a ratio and no absolute levels, so we take the sulfate and
 * chloride targets to be the pair that splits the achieved SO₄ + Cl at the
 * aim. That's symmetric, so neither ion is picked as the anchor, and both rows
 * read zero when the balance is hit exactly. Calcium's target is the floor, or
 * the source's calcium if that's higher, since a rule can't ask for less
 * calcium than the water started with. The rule says nothing about the other
 * three ions, so their target is whatever the source had.
 */
function derivedRuleTarget(achieved: IonAmounts, source: IonAmounts, rule: WaterRule): IonAmounts {
  const combined = achieved.sulfate + achieved.chloride;
  const chloride = combined / (1 + rule.sulfateChlorideRatio);
  return {
    ...source,
    calcium: Math.max(rule.minCalciumPpm, source.calcium),
    sulfate: combined - chloride,
    chloride,
  };
}

/** An ion a schedule would push materially past the range brewers work in. */
interface RuleBreach {
  readonly ion: WaterIon;
  /** Where the schedule would leave it, ppm. */
  readonly achievedPpm: number;
  /** The comfortable maximum it's past, ppm. This is the advisory figure, not the refusal threshold. */
  readonly ceilingPpm: number;
}

/**
 * How far past a comfortable maximum a schedule can go before we refuse it.
 *
 * {@link ION_ADVISORY_RANGE_PPM} is a flavour range, and treating it as a hard
 * limit would refuse a reasonable 9:1 schedule for landing sulfate at 359 ppm
 * against a 350 ppm advisory figure. Nobody can taste nine ppm at that level.
 * At half as much again over the maximum, it's no longer a near miss: Burton
 * balanced 1:1 wants 724 ppm of chloride against a 150 ppm maximum. Between
 * the two the schedule stands, and `applySalts` raises its "above the
 * comfortable maximum" warning on the treated water.
 */
const MATERIAL_BREACH_FACTOR = 1.5;

/**
 * The ion a schedule would push materially out of range, if any.
 *
 * We only check ions the salts raised. If the source already has 725 ppm
 * sulfate, that isn't the schedule's fault. Calcium is checked against the
 * brewer's floor when that's higher than the advisory maximum, so a rule that
 * asks for 250 ppm calcium gets 250 ppm. We report the worst breach, measured
 * as a multiple of its own ceiling so ions with very different ranges can be
 * compared.
 */
function materialBreach(
  achieved: IonAmounts,
  source: IonAmounts,
  rule: WaterRule,
): RuleBreach | undefined {
  let worst: RuleBreach | undefined;
  let worstOvershoot = MATERIAL_BREACH_FACTOR;
  for (const ion of RULE_IONS) {
    if (achieved[ion] <= source[ion]) continue;
    const ceiling =
      ion === 'calcium'
        ? Math.max(ION_ADVISORY_RANGE_PPM.calcium.max, rule.minCalciumPpm)
        : ION_ADVISORY_RANGE_PPM[ion].max;
    const overshoot = achieved[ion] / ceiling;
    if (overshoot > worstOvershoot) {
      worstOvershoot = overshoot;
      worst = { ion, achievedPpm: achieved[ion], ceilingPpm: ceiling };
    }
  }
  return worst;
}

/** Warnings specific to the rule solver. */
function ruleWarnings(
  rule: WaterRule,
  source: IonAmounts,
  achieved: IonAmounts,
  plan: RulePlan,
  breach: RuleBreach | undefined,
): readonly string[] {
  const warnings: string[] = [];
  if (plan.missing !== undefined) {
    warnings.push(
      `This balance needs ${RULE_SALT_WORDS[plan.missing]}, which is not among the allowed salts.`,
    );
  }
  if (plan.negativeDose) {
    // The problem ion is the one the source has more of than the aim allows.
    // Salts can't remove it, so the fix is dilution.
    const excess =
      source.sulfate > rule.sulfateChlorideRatio * source.chloride ? 'sulfate' : 'chloride';
    warnings.push(
      `Your water already carries more ${excess} than a ` +
        `${formatRatio(rule.sulfateChlorideRatio)} balance allows; salts can only add, so the ` +
        'way down is dilution.',
    );
  }
  if (breach !== undefined) {
    // Dilution won't help here: the problem ion is one the schedule would add,
    // and diluting doesn't change a ratio. The brewer needs a gentler balance,
    // or a lower floor so less of the salt carrying that ion is needed.
    warnings.push(
      `Landing a ${formatRatio(rule.sulfateChlorideRatio)} balance from this water would take ` +
        `${ION_WORDS[breach.ion]} to ${breach.achievedPpm.toFixed(0)} ppm, well past the ` +
        `${breach.ceilingPpm.toFixed(0)} ppm most brewers stop at. A lower balance or a lower ` +
        'calcium floor would fix it.',
    );
  }
  if (achieved.sulfate + achieved.chloride < SULFATE_CHLORIDE_MEANINGFUL_PPM) {
    warnings.push('Sulfate and chloride are both too low for the balance to mean anything yet.');
  }
  return warnings;
}

/** Returns the rule unchanged, or throws a `RangeError` naming the bound it broke. */
function checkedRule(rule: WaterRule): WaterRule {
  const ratio = rule.sulfateChlorideRatio;
  if (
    !Number.isFinite(ratio) ||
    ratio < MIN_SULFATE_CHLORIDE_RATIO ||
    ratio > MAX_SULFATE_CHLORIDE_RATIO
  ) {
    throw new RangeError(
      `A sulfate:chloride aim of ${ratio} is outside the ${MIN_SULFATE_CHLORIDE_RATIO} to ` +
        `${MAX_SULFATE_CHLORIDE_RATIO} the solver fits. Past either bound one ion dominates, and ` +
        'the number no longer describes a balance between two.',
    );
  }
  if (!Number.isFinite(rule.minCalciumPpm) || rule.minCalciumPpm < 0) {
    throw new RangeError(
      `A calcium floor of ${rule.minCalciumPpm} ppm is invalid. It must be a finite number ` +
        'of ppm at or above 0.',
    );
  }
  return rule;
}

/**
 * What one ion's miss costs, ppm.
 *
 * Calcium is a minimum. Water at 114 ppm against a floor of 80 satisfies the
 * rule, and counting the 34 ppm as error would report `withinTolerance: false`
 * on a schedule whose verdicts are all true. Sulfate and chloride are a ratio,
 * so a miss in either direction counts.
 */
function ruleErrorPpm(ion: WaterIon, deltaPpm: number): number {
  return ion === 'calcium' ? Math.max(0, -deltaPpm) : Math.abs(deltaPpm);
}

/** Formats a ratio as `1.0`, `1.5`, `0.75`: two decimals, with a trailing zero dropped. */
function formatRatio(ratio: number): string {
  const text = ratio.toFixed(2);
  return text.endsWith('0') ? text.slice(0, -1) : text;
}

// ---------------------------------------------------------------------------
// Subset enumeration
// ---------------------------------------------------------------------------

interface SubsetSearchInput {
  readonly source: WaterProfile;
  readonly target: WaterProfile;
  readonly allowedSalts: readonly SaltId[];
  readonly maxSalts: number;
  readonly tolerance: Record<WaterIon, number>;
  readonly weights: Record<WaterIon, number>;
  readonly volumeL: Litres;
  readonly roundToGrams: number;
  readonly minSaltGrams: number;
  readonly fewerSaltsPenalty: number;
}

function searchSubsets(input: SubsetSearchInput): {
  best: Candidate | undefined;
  evaluated: number;
} {
  const sourceIons = toIonAmounts(input.source);
  const targetIons = toIonAmounts(input.target);

  // Column for each salt: ppm per gram per litre, weighted.
  const columns = input.allowedSalts.map((salt) => saltIonPpmPerGramPerLitre(salt));
  const scale: Record<WaterIon, number> = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) {
    scale[ion] = input.tolerance[ion] > 0 ? input.weights[ion] / input.tolerance[ion] : 0;
  }
  // Right-hand side in ppm still needed.
  const need: Record<WaterIon, number> = {} as Record<WaterIon, number>;
  for (const ion of WATER_IONS) need[ion] = targetIons[ion] - sourceIons[ion];

  let best: Candidate | undefined;
  let evaluated = 0;

  const consider = (indices: readonly number[], gramsPerLitre: readonly number[]): void => {
    // Convert to grams for the whole fitted volume, round to the scale's resolution.
    const salts: SaltId[] = [];
    const grams: number[] = [];
    for (let i = 0; i < indices.length; i += 1) {
      const idx = indices[i];
      const perLitre = gramsPerLitre[i];
      if (idx === undefined || perLitre === undefined) return;
      const salt = input.allowedSalts[idx];
      if (salt === undefined) return;
      const raw = perLitre * input.volumeL;
      // A dose too small to weigh rejects the whole subset. The smaller subset
      // is already in the enumeration and will win.
      const rounded = roundDoseGrams(raw, input.roundToGrams, input.minSaltGrams);
      if (rounded <= 0) return;
      salts.push(salt);
      grams.push(rounded);
    }

    const achieved: Record<WaterIon, number> = { ...sourceIons };
    for (let i = 0; i < salts.length; i += 1) {
      const salt = salts[i];
      const g = grams[i];
      if (salt === undefined || g === undefined) continue;
      const column = saltIonPpmPerGramPerLitre(salt);
      for (const ion of WATER_IONS) {
        achieved[ion] += (column[ion] * g) / Math.max(input.volumeL, 1e-9);
      }
    }

    const score = weightedScore(achieved, targetIons, input.tolerance, input.weights);
    const adjustedScore = score + salts.length * input.fewerSaltsPenalty;
    evaluated += 1;
    if (!best || adjustedScore < best.adjustedScore) {
      best = { salts, gramsPerSalt: grams, score, adjustedScore, achieved };
    }
  };

  // The do-nothing candidate.
  consider([], []);

  const n = input.allowedSalts.length;
  const indices: number[] = [];
  const recurse = (start: number): void => {
    if (indices.length > 0) {
      const solution = solveSubset(indices, columns, scale, need);
      if (solution) consider(indices, solution);
    }
    if (indices.length >= input.maxSalts) return;
    for (let i = start; i < n; i += 1) {
      indices.push(i);
      recurse(i + 1);
      indices.pop();
    }
  };
  recurse(0);

  return { best, evaluated };
}

/**
 * Unconstrained weighted least squares over one subset of salts.
 *
 * Builds the normal equations `(A'ᵀA')x = A'ᵀb'` on the weighted system and
 * solves them by Gaussian elimination with partial pivoting. Returns
 * `undefined` when the system is singular (two salts with identical ion ratios,
 * such as the two calcium chloride forms) or when any component comes out
 * non-positive. A non-positive component means the true optimum lies on a
 * smaller subset, which the enumeration reaches separately.
 */
function solveSubset(
  indices: readonly number[],
  columns: readonly IonAmounts[],
  scale: Record<WaterIon, number>,
  need: Record<WaterIon, number>,
): number[] | undefined {
  const k = indices.length;
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let r = 0; r < k; r += 1) {
    const row: number[] = [];
    const ir = indices[r];
    if (ir === undefined) return undefined;
    const colR = columns[ir];
    if (!colR) return undefined;
    for (let c = 0; c < k; c += 1) {
      const ic = indices[c];
      if (ic === undefined) return undefined;
      const colC = columns[ic];
      if (!colC) return undefined;
      let sum = 0;
      for (const ion of WATER_IONS) sum += scale[ion] * scale[ion] * colR[ion] * colC[ion];
      row.push(sum);
    }
    let b = 0;
    for (const ion of WATER_IONS) b += scale[ion] * scale[ion] * colR[ion] * need[ion];
    matrix.push(row);
    rhs.push(b);
  }
  const solution = solveLinearSystem(matrix, rhs);
  if (!solution) return undefined;
  for (const value of solution) {
    if (!(value > 0) || !Number.isFinite(value)) return undefined;
  }
  return solution;
}

/** Gaussian elimination with partial pivoting. `undefined` when singular. */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | undefined {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i] ?? 0]);
  let scaleReference = 0;
  for (const row of a)
    for (const value of row) scaleReference = Math.max(scaleReference, Math.abs(value));
  const epsilon = Math.max(scaleReference, 1) * 1e-12;

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let pivotValue = Math.abs(a[col]?.[col] ?? 0);
    for (let r = col + 1; r < n; r += 1) {
      const value = Math.abs(a[r]?.[col] ?? 0);
      if (value > pivotValue) {
        pivotValue = value;
        pivotRow = r;
      }
    }
    if (pivotValue < epsilon) return undefined;
    if (pivotRow !== col) {
      const tmp = a[col];
      const other = a[pivotRow];
      if (!tmp || !other) return undefined;
      a[col] = other;
      a[pivotRow] = tmp;
    }
    const pivot = a[col];
    if (!pivot) return undefined;
    const pivotElement = pivot[col] ?? 0;
    for (let r = col + 1; r < n; r += 1) {
      const row = a[r];
      if (!row) continue;
      const factor = (row[col] ?? 0) / pivotElement;
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) row[c] = (row[c] ?? 0) - factor * (pivot[c] ?? 0);
    }
  }

  const solution = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    const row = a[r];
    if (!row) return undefined;
    let sum = row[n] ?? 0;
    for (let c = r + 1; c < n; c += 1) sum -= (row[c] ?? 0) * (solution[c] ?? 0);
    const diagonal = row[r] ?? 0;
    if (Math.abs(diagonal) < epsilon) return undefined;
    solution[r] = sum / diagonal;
  }
  return solution;
}

// ---------------------------------------------------------------------------
// Scoring and reporting
// ---------------------------------------------------------------------------

/** Weighted RMS error in tolerance units. */
function weightedScore(
  achieved: IonAmounts,
  target: IonAmounts,
  tolerance: Record<WaterIon, number>,
  weights: Record<WaterIon, number>,
): number {
  let sum = 0;
  let count = 0;
  for (const ion of WATER_IONS) {
    const weight = weights[ion];
    if (weight === 0) continue;
    const tol = tolerance[ion] > 0 ? tolerance[ion] : 1;
    const error = (weight * (achieved[ion] - target[ion])) / tol;
    sum += error * error;
    count += 1;
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/**
 * Salts prescribed against an ion the source water never had measured.
 *
 * The solver works out "the target wants 100 ppm, you have 0, so add gypsum".
 * When that 0 means the water report didn't list the ion, the dose rests on an
 * unknown, and a fit that looks fine won't show it. So we warn per ion, and
 * only for ions the target constrains.
 */
function unmeasuredSourceWarnings(
  source: WaterProfile,
  weights: Record<WaterIon, number>,
): readonly string[] {
  return unmeasuredIons(source)
    .filter((ion) => weights[ion] !== 0)
    .map(
      (ion) =>
        `${ION_LABELS[ion]} is not in your water report, so the solver worked from 0 ppm. ` +
        'Whatever your water already carries is on top of the dose below.',
    );
}

function solverWarnings(
  fit: readonly IonFit[],
  chosen: Candidate | undefined,
  weights: Record<WaterIon, number>,
): readonly string[] {
  const warnings: string[] = [];
  for (const f of fit) {
    if (weights[f.ion] === 0 || f.withinTolerance) continue;
    if (f.deltaPpm > 0) {
      warnings.push(
        `${f.label} overshoots the target by ${f.deltaPpm.toFixed(0)} ppm. Salts can only add ` +
          'ions, so dilute with RO water to bring it down.',
      );
    } else if (f.sourcePpm > f.targetPpm) {
      warnings.push(
        `${f.label} is already ${(f.sourcePpm - f.targetPpm).toFixed(0)} ppm above the target in ` +
          'the source water; no salt can remove it. Dilute with RO water.',
      );
    } else {
      warnings.push(
        `${f.label} falls ${Math.abs(f.deltaPpm).toFixed(0)} ppm short of the target with the ` +
          'salts allowed.',
      );
    }
  }
  if (chosen) {
    for (const salt of chosen.salts) {
      const def = SALT_DEFINITIONS[salt];
      if (def.poorlySoluble) {
        warnings.push(
          `The solver used ${def.label}, which does not reliably dissolve. Allow it only if you ` +
            'know your water can carry it.',
        );
      }
    }
  }
  return [...new Set(warnings)];
}

// ---------------------------------------------------------------------------
// Dilution grid
// ---------------------------------------------------------------------------

/**
 * The dilution fractions to try.
 *
 * With `searchDilution` off, this is one value: whatever the caller asked for.
 * With it on, it's a coarse grid of `dilutionSteps` points up to
 * `maxDilutionFraction`, plus ten refinement points across one coarse cell
 * either side of each coarse point. That resolves the dilution to about 0.5 %.
 * The grid is fixed and never depends on a floating-point comparison, so the
 * search is deterministic.
 */
function buildDilutionGrid(input: WaterSolverInput): readonly number[] {
  const requested = clamp(input.dilutionFraction ?? 0, 0, 1);
  if (!input.searchDilution) return [requested];
  const max = clamp(input.maxDilutionFraction ?? 0.9, 0, 1);
  const steps = Math.max(2, Math.floor(input.dilutionSteps ?? 19));
  const coarse: number[] = [];
  for (let i = 0; i <= steps; i += 1) coarse.push(roundTo((max * i) / steps, 6));
  const cell = max / steps;
  const refined: number[] = [];
  for (const centre of coarse) {
    for (let i = 1; i < 10; i += 1) {
      const value = centre - cell + (2 * cell * i) / 10;
      if (value > 0 && value < max) refined.push(roundTo(value, 6));
    }
  }
  return [...new Set([requested, ...coarse, ...refined])].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The ppm each salt in a schedule contributed, to answer "where did this
 * calcium come from?".
 *
 * @category Water and mash pH
 * @group Calculations
 */
export function saltContributionBreakdown(
  additions: readonly SaltAddition[],
  volumeL: Litres,
): readonly {
  /** The salt. */
  readonly salt: SaltId;
  /** Grams in the addition as given, before any `dissolvedFraction`. */
  readonly grams: number;
  /** The ppm this addition added to the water, as a profile. */
  readonly ions: WaterProfile;
}[] {
  return additions.map((addition) => {
    const perGramPerLitre = saltIonPpmPerGramPerLitre(addition.salt);
    const grams = addition.grams * (addition.dissolvedFraction ?? 1);
    const factor = volumeL > 0 ? grams / volumeL : 0;
    const ions = {} as Record<WaterIon, number>;
    for (const ion of WATER_IONS) ions[ion] = perGramPerLitre[ion] * factor;
    return { salt: addition.salt, grams: addition.grams, ions: fromIonAmounts(ions) };
  });
}

/**
 * A dose as a scale would read it, or 0 when it is too small to weigh.
 *
 * Both solvers use this so they round doses the same way. Below `minSaltGrams`
 * the salt isn't worth adding, and above it the dose is rounded to the scale's
 * resolution before anything is computed from it.
 */
function roundDoseGrams(rawGrams: number, roundToGrams: number, minSaltGrams: number): number {
  if (!(rawGrams >= minSaltGrams)) return 0;
  const rounded = roundToGrams > 0 ? Math.round(rawGrams / roundToGrams) * roundToGrams : rawGrams;
  return rounded > 0 ? rounded : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, dp: number): number {
  return Number(value.toFixed(dp));
}
