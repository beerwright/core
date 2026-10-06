import { describe, expect, it } from 'vitest';
import type {
  DecoctionIssue,
  DecoctionIssueCode,
  DecoctionPullInput,
  DecoctionQuantity,
} from './decoction';
import {
  DECOCTION_SCHEDULES,
  DEFAULT_DECOCTION_RETURN_TEMP_C,
  decoctionEvaporation,
  decoctionPull,
  decoctionWarnings,
  findDecoctionSchedule,
  planDecoctions,
  renderDecoctionIssue,
  resolvePullRatio,
  thicknessRatioLPerKg,
} from './decoction';
import type { DecoctionSpec } from './types';
import { decoctionVolume } from './volumes';

/** A 20 L Bohemian pale lager mash: 4.9 kg of grain at 3 L/kg. */
const MASH = { mashWaterL: 14.7, mashGrainKg: 4.9 } as const;

/**
 * The assumptions that reduce this module to the classic textbook decoction:
 * a tun that does not cool, a pull that returns at a full boil, and a pot that
 * costs no water.
 */
const CLASSIC = {
  standingLossCPerHour: 0,
  boilOffLPerHour: 0,
  returnTempC: 100,
} as const;

const codes = (issues: readonly { code: DecoctionIssueCode }[]) => issues.map((i) => i.code);

describe('thicknessRatioLPerKg', () => {
  it('floors a thick pull at what drained grain still holds', () => {
    expect(thicknessRatioLPerKg('thick', 1.0)).toBe(1.0);
    expect(thicknessRatioLPerKg('thick', 1.2)).toBe(1.2);
  });

  it('takes no grain at all for a thin pull', () => {
    expect(thicknessRatioLPerKg('thin', 1.0)).toBeNull();
  });
});

describe('resolvePullRatio', () => {
  it('defaults to a thick pull', () => {
    expect(resolvePullRatio(undefined, 1.0)).toEqual({ ratioLPerKg: 1.0, clamped: false });
  });

  it('lets an explicit ratio win over the named thickness', () => {
    expect(resolvePullRatio({ thickness: 'thin', ratioLPerKg: 2 }, 1.0).ratioLPerKg).toBe(2);
  });

  it('clamps a ratio no tun can give, and says it clamped', () => {
    expect(resolvePullRatio({ ratioLPerKg: 0.4 }, 1.0)).toEqual({
      ratioLPerKg: 1.0,
      clamped: true,
    });
  });
});

describe('decoctionVolume delegation', () => {
  // A recipe with no decoction detail gets the classic number exactly.
  it('reproduces the classic formula to the last decimal', () => {
    // (14.7 + 0.4 × 4.9) × (72 − 52) / (100 − 52) = 16.66 × 20 / 48 = 6.9417 L
    expect(
      decoctionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 52,
        targetTempC: 72,
      }),
    ).toBeCloseTo(6.9417, 3);
  });

  it('agrees with decoctionPull under the reducing assumptions', () => {
    for (const [t1, t2] of [
      [35, 52],
      [52, 64],
      [62, 72],
      [64, 76],
    ] as const) {
      const classic = decoctionVolume({
        currentMashWaterL: MASH.mashWaterL,
        grainKg: MASH.mashGrainKg,
        currentTempC: t1,
        targetTempC: t2,
      });
      const whole = decoctionPull({
        ...MASH,
        ...CLASSIC,
        currentTempC: t1,
        targetTempC: t2,
      });
      expect(whole.heatCapacityLEquivalent).toBeCloseTo(classic, 9);
    }
  });

  it('still pulls nothing when the mash is already at target', () => {
    expect(
      decoctionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 72,
        targetTempC: 72,
      }),
    ).toBe(0);
  });

  it('still refuses a target boiling mash cannot reach', () => {
    expect(
      decoctionVolume({
        currentMashWaterL: 14.7,
        grainKg: 4.9,
        currentTempC: 52,
        targetTempC: 100,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('decoctionPull', () => {
  it('lands the mash exactly on the target it was sized for', () => {
    // Size the pull, mix it back, and the mash should land on the step. This
    // catches a mistake in any of the assumptions the classic form drops.
    for (const thickness of ['thick', 'medium', 'thin'] as const) {
      for (const [t1, t2] of [
        [35, 50],
        [50, 62],
        [62, 72],
        [64, 76],
      ] as const) {
        const pull = decoctionPull({
          ...MASH,
          currentTempC: t1,
          targetTempC: t2,
          spec: { thickness },
        });
        expect(pull.achievedTempC).toBeCloseTo(t2, 9);
      }
    }
  });

  it('needs a bigger pull than the classic form, because the tun cools', () => {
    const classic = decoctionPull({ ...MASH, ...CLASSIC, currentTempC: 52, targetTempC: 64 });
    const whole = decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 64 });
    expect(whole.heatCapacityLEquivalent).toBeGreaterThan(classic.heatCapacityLEquivalent);
    expect(whole.restTempAtReturnC).toBeLessThan(52);
    expect(whole.returnTempC).toBe(DEFAULT_DECOCTION_RETURN_TEMP_C);
  });

  it('reads a bigger pot for a thicker pull at the same heat capacity', () => {
    const base = { ...MASH, currentTempC: 52, targetTempC: 64 } satisfies DecoctionPullInput;
    const thick = decoctionPull({ ...base, spec: { thickness: 'thick' } });
    const thin = decoctionPull({ ...base, spec: { thickness: 'thin' } });
    // Same step and the same heat to move, but per litre of volume grain solids
    // hold only ~0.6 of the heat water does, so the thick pull is the bigger
    // volume. The module comment explains why.
    expect(thick.heatCapacityLEquivalent).toBeCloseTo(thin.heatCapacityLEquivalent, 6);
    expect(thick.pullVolumeL).toBeGreaterThan(thin.pullVolumeL);
    expect(thick.pullVolumeL / thin.pullVolumeL).toBeCloseTo(1.19, 2);
    expect(thick.pullGrainKg).toBeGreaterThan(0);
    expect(thin.pullGrainKg).toBe(0);
  });

  it('pulls more for a bigger step', () => {
    const base = { ...MASH, currentTempC: 52 } satisfies Omit<DecoctionPullInput, 'targetTempC'>;
    expect(decoctionPull({ ...base, targetTempC: 72 }).pullVolumeL).toBeGreaterThan(
      decoctionPull({ ...base, targetTempC: 64 }).pullVolumeL,
    );
  });

  it('pulls more when the pull is away longer', () => {
    const base = { ...MASH, currentTempC: 52, targetTempC: 64 } satisfies DecoctionPullInput;
    const short = decoctionPull({ ...base, spec: { boilMinutes: 10 } });
    const long = decoctionPull({
      ...base,
      spec: { boilMinutes: 30, restBeforeBoil: { tempC: 70, minutes: 15 } },
    });
    expect(long.awayMinutes).toBeGreaterThan(short.awayMinutes);
    expect(long.restTempAtReturnC).toBeLessThan(short.restTempAtReturnC);
    expect(long.heatCapacityLEquivalent).toBeGreaterThan(short.heatCapacityLEquivalent);
  });

  it('conserves grain and water, and loses only what the pot boiled away', () => {
    const pull = decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 64 });
    expect(pull.pullGrainKg).toBeLessThanOrEqual(MASH.mashGrainKg);
    expect(pull.pullWaterL).toBeLessThanOrEqual(MASH.mashWaterL);
    expect(pull.mashAfter.grainKg).toBe(MASH.mashGrainKg);
    expect(pull.mashAfter.waterL).toBeCloseTo(MASH.mashWaterL - pull.evaporationL, 9);
    expect(pull.evaporationL).toBeGreaterThan(0);
  });

  it('reports where an overridden pull lands', () => {
    const sized = decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 64 });
    const short = decoctionPull({
      ...MASH,
      currentTempC: 52,
      targetTempC: 64,
      spec: { pullVolumeL: sized.pullVolumeL - 1 },
    });
    expect(short.achievedTempC).toBeLessThan(64);
    expect(short.achievedTempC).toBeGreaterThan(52);
    expect(short.explain.notes).toContain(
      'Volume overridden by the brewer; the achieved temperature is computed from it.',
    );
  });

  it('carries a breakdown naming the formula that ran', () => {
    const pull = decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 64 });
    expect(pull.explain.formula).toBe('decoction-heat-balance');
    expect(pull.explain.value).toBeCloseTo(pull.pullVolumeL, 9);
    expect(pull.explain.unit).toBe('L');
    expect(pull.explain.inputs.restTempAtReturnC).toBeCloseTo(pull.restTempAtReturnC, 9);
  });

  it('pulls nothing when the mash is already there', () => {
    const pull = decoctionPull({ ...MASH, currentTempC: 72, targetTempC: 72 });
    expect(pull.pullVolumeL).toBe(0);
    expect(pull.awayMinutes).toBe(0);
    expect(pull.mashAfter.waterL).toBe(MASH.mashWaterL);
  });
});

describe('decoctionPull feasibility', () => {
  const at = (spec: DecoctionSpec | undefined, over: Partial<DecoctionPullInput> = {}) =>
    decoctionPull({
      ...MASH,
      currentTempC: 52,
      targetTempC: 64,
      ...over,
      ...(spec !== undefined ? { spec } : {}),
    });

  it('flags a target boiling mash cannot reach', () => {
    const pull = at(undefined, { targetTempC: 99 });
    expect(codes(pull.issues)).toContain('target-unreachable');
    expect(pull.pullVolumeL).toBe(Number.POSITIVE_INFINITY);
  });

  it('flags a pull bigger than the mash', () => {
    // A 40 °C jump that a pull returning at 98 °C can't provide.
    expect(codes(at(undefined, { currentTempC: 40, targetTempC: 95 }).issues)).toContain(
      'pull-exceeds-mash',
    );
  });

  it('runs out of grain before it runs out of liquid on a thick pull', () => {
    // 52 → 78 °C needs 9.8 water-equivalent litres, which at 1 L/kg is 7 kg of
    // grain out of a 4.9 kg mash, even though the water it needs is well
    // inside the 14.7 L in the tun. The grain runs out here, not the liquid.
    const pull = at({ thickness: 'thick' }, { targetTempC: 78 });
    expect(pull.pullGrainKg).toBeGreaterThan(MASH.mashGrainKg);
    expect(pull.pullWaterL).toBeLessThan(MASH.mashWaterL);
    expect(codes(pull.issues)).toContain('pull-exceeds-mash');
    // …and the same step as a thin pull is inside what the mash can give.
    expect(codes(at({ thickness: 'thin' }, { targetTempC: 78 }).issues)).not.toContain(
      'pull-exceeds-mash',
    );
  });

  it('flags a pull that will not fit the pot', () => {
    expect(codes(at(undefined, { potVolumeL: 2 }).issues)).toContain('pull-exceeds-pot');
    expect(codes(at(undefined, { potVolumeL: 30 }).issues)).not.toContain('pull-exceeds-pot');
  });

  it('flags a thickness the tun cannot give', () => {
    expect(codes(at({ ratioLPerKg: 0.3 }).issues)).toContain('thickness-clamped');
  });

  it('flags a liquid-only pull the mash has no free liquid for', () => {
    // A stiff 2 L/kg mash: 4.9 kg of grain holds 4.9 L, leaving 4.9 L free,
    // and a 52 → 72 °C step wants more liquid than that.
    const pull = at({ thickness: 'thin' }, { mashWaterL: 9.8, targetTempC: 72 });
    expect(codes(pull.issues)).toContain('thin-pull-short-of-liquid');
  });

  it('flags a pull that is most of the mash', () => {
    const pull = at({ thickness: 'thin' }, { targetTempC: 77 });
    expect(pull.fractionOfMash).toBeGreaterThan(0.5);
    expect(codes(pull.issues)).toContain('pull-dominates-mash');
  });

  it('notes the scorch risk on a thick pull only', () => {
    expect(codes(at({ thickness: 'thick' }).issues)).toContain('scorch-risk');
    expect(codes(at({ thickness: 'medium' }).issues)).not.toContain('scorch-risk');
    expect(codes(at({ thickness: 'thin' }).issues)).not.toContain('scorch-risk');
  });

  it('flags a boil that would evaporate the pull dry', () => {
    const pull = at({ boilMinutes: 120 }, { boilOffLPerHour: 4 });
    expect(codes(pull.issues)).toContain('evaporation-exceeds-pull');
  });
});

describe('planDecoctions', () => {
  /** A classic Bohemian triple: 37 → 52 → 64 → 72 °C, thick pulls throughout. */
  const TRIPLE = {
    ...MASH,
    startTempC: 37,
    steps: [
      { targetTempC: 52, decoction: true },
      { targetTempC: 64, decoction: true },
      { targetTempC: 72, decoction: true },
    ],
  } as const;

  it('lands every rest', () => {
    const plan = planDecoctions(TRIPLE);
    expect(plan.pulls.map((p) => p.achievedTempC)).toEqual([
      expect.closeTo(52, 6),
      expect.closeTo(64, 6),
      expect.closeTo(72, 6),
    ]);
  });

  it('sizes each pull against the mash the last one left, not the original', () => {
    const plan = planDecoctions(TRIPLE);
    const third = plan.pulls[2];
    expect(third).toBeDefined();
    // By the third pull the tun has lost two pulls' worth of evaporation.
    const standalone = decoctionPull({
      ...MASH,
      currentTempC: 64,
      targetTempC: 72,
    });
    expect(third?.heatCapacityLEquivalent).toBeLessThan(standalone.heatCapacityLEquivalent);
  });

  it('accounts for the water the pots boil away', () => {
    const plan = planDecoctions(TRIPLE);
    const summed = plan.pulls.reduce((sum, p) => sum + p.evaporationL, 0);
    expect(plan.totalEvaporationL).toBeCloseTo(summed, 9);
    expect(plan.totalEvaporationL).toBeGreaterThan(1);
    expect(plan.finalMashThicknessLPerKg).toBeCloseTo(
      (MASH.mashWaterL - plan.totalEvaporationL) / MASH.mashGrainKg,
      9,
    );
    expect(plan.finalMashThicknessLPerKg).toBeLessThan(3);
  });

  it('adds up the brew day', () => {
    const plan = planDecoctions(TRIPLE);
    expect(plan.addedBrewDayMinutes).toBe(plan.pulls.reduce((sum, p) => sum + p.awayMinutes, 0));
    expect(codes(plan.issues)).toContain('long-brew-day');
  });

  it('warns when the boils leave the mash too stiff', () => {
    const plan = planDecoctions({
      ...TRIPLE,
      mashWaterL: 10.5, // 2.14 L/kg to start with
      steps: [
        { targetTempC: 52, decoction: true, spec: { boilMinutes: 30 } },
        { targetTempC: 64, decoction: true, spec: { boilMinutes: 30 } },
        { targetTempC: 72, decoction: true, spec: { boilMinutes: 30 } },
      ],
    });
    expect(codes(plan.issues)).toContain('mash-thickened');
  });

  it('stops at a step it cannot reach rather than planning past it', () => {
    const plan = planDecoctions({
      ...MASH,
      startTempC: 52,
      steps: [
        { targetTempC: 99, decoction: true },
        { targetTempC: 72, decoction: true },
      ],
    });
    expect(plan.pulls).toHaveLength(1);
    expect(codes(plan.pulls[0]?.issues ?? [])).toContain('target-unreachable');
  });

  it('starts a pull from the rest before it, however that rest was reached', () => {
    // Hochkurz: infuse to 62, decoct to 72. The pull must be sized from 62 °C,
    // not from the 37 °C the mash started at.
    const mixed = planDecoctions({
      ...MASH,
      startTempC: 37,
      steps: [
        { targetTempC: 62, decoction: false },
        { targetTempC: 72, decoction: true },
      ],
    });
    expect(mixed.pulls).toHaveLength(1);
    expect(mixed.pulls[0]?.stepIndex).toBe(1);
    expect(mixed.pulls[0]?.achievedTempC).toBeCloseTo(72, 6);
    const standalone = decoctionPull({ ...MASH, currentTempC: 62, targetTempC: 72 });
    expect(mixed.pulls[0]?.heatCapacityLEquivalent).toBeCloseTo(
      standalone.heatCapacityLEquivalent,
      9,
    );
  });

  it('threads the water an infusion adds into the pull that follows it', () => {
    const dry = planDecoctions({
      ...MASH,
      startTempC: 52,
      steps: [
        { targetTempC: 62, decoction: false },
        { targetTempC: 72, decoction: true },
      ],
    });
    const wet = planDecoctions({
      ...MASH,
      startTempC: 52,
      steps: [
        { targetTempC: 62, decoction: false, waterAddedL: 4 },
        { targetTempC: 72, decoction: true },
      ],
    });
    // More water in the tun is more heat to move, so the pull grows.
    expect(wet.pulls[0]?.heatCapacityLEquivalent).toBeGreaterThan(
      dry.pulls[0]?.heatCapacityLEquivalent ?? 0,
    );
    expect(wet.finalMashThicknessLPerKg).toBeGreaterThan(dry.finalMashThicknessLPerKg);
  });

  it('plans nothing for no steps', () => {
    const plan = planDecoctions({ ...MASH, startTempC: 65, steps: [] });
    expect(plan.pulls).toEqual([]);
    expect(plan.totalEvaporationL).toBe(0);
    expect(plan.issues).toEqual([]);
  });
});

describe('decoctionEvaporation', () => {
  it('is knowable before any pull is sized — that is the whole point', () => {
    // 3 × 20 min at 1.5 L/h. It needs no mash, grain or temperatures, so the
    // waterfall can get this term before the pulls are sized.
    expect(decoctionEvaporation([undefined, undefined, undefined])).toBeCloseTo(1.5, 9);
  });

  it('agrees with what the planner actually boils away', () => {
    const specs = [{ boilMinutes: 15 }, { boilMinutes: 25 }] as const;
    const plan = planDecoctions({
      ...MASH,
      startTempC: 37,
      steps: [
        { targetTempC: 52, decoction: true, spec: specs[0] },
        { targetTempC: 64, decoction: true, spec: specs[1] },
      ],
    });
    expect(decoctionEvaporation(specs)).toBeCloseTo(plan.totalEvaporationL, 9);
  });

  it('follows the rig pot', () => {
    expect(decoctionEvaporation([{ boilMinutes: 60 }], 2)).toBeCloseTo(2, 9);
    expect(decoctionEvaporation([], 2)).toBe(0);
  });
});

describe('decoctionWarnings', () => {
  it('numbers each pull and drops the notes', () => {
    const plan = planDecoctions({
      ...MASH,
      startTempC: 52,
      steps: [
        { targetTempC: 64, decoction: true },
        { targetTempC: 99, decoction: true },
      ],
    });
    const warnings = decoctionWarnings(plan);
    // The thick first pull's scorch issue is only a note, so it isn't in the list.
    expect(warnings.every((w) => !w.includes('scorches'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('Decoction 2:'))).toBe(true);
  });

  it('says nothing about a schedule with nothing wrong', () => {
    const plan = planDecoctions({
      ...MASH,
      startTempC: 62,
      steps: [{ targetTempC: 72, decoction: true, spec: { thickness: 'medium' } }],
    });
    expect(decoctionWarnings(plan)).toEqual([]);
  });
});

describe('DECOCTION_SCHEDULES', () => {
  it('finds a schedule by id, and nothing by a bad one', () => {
    expect(findDecoctionSchedule('triple-bohemian')?.name).toBe('Triple decoction, Bohemian');
    expect(findDecoctionSchedule('nope')).toBeUndefined();
  });

  it('gives every preset a unique id and a rising temperature schedule', () => {
    const ids = DECOCTION_SCHEDULES.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of DECOCTION_SCHEDULES) {
      const temps = preset.steps.map((step) => step.targetTempC);
      expect(
        [...temps].sort((a, b) => a - b),
        preset.id,
      ).toEqual(temps);
    }
  });

  it('puts a spec on every decoction step and none on any other', () => {
    for (const preset of DECOCTION_SCHEDULES) {
      for (const step of preset.steps) {
        expect(step.decoction === undefined, `${preset.id}/${step.name}`).toBe(
          step.type !== 'decoction',
        );
      }
    }
  });

  it('converts a thick pull before boiling it', () => {
    // A pull taken from a protein rest is full of unconverted starch, and
    // boiling that sets it. Every thick pull in every preset rests first.
    for (const preset of DECOCTION_SCHEDULES) {
      for (const step of preset.steps) {
        if (step.decoction?.thickness !== 'thick') continue;
        expect(step.decoction.restBeforeBoil, `${preset.id}/${step.name}`).toBeDefined();
      }
    }
  });

  it('plans on a 20 L mash without asking for the impossible', () => {
    for (const preset of DECOCTION_SCHEDULES) {
      const rests = preset.steps.filter((step) => step.type !== 'sparge');
      const first = rests[0];
      expect(first, preset.id).toBeDefined();
      if (first === undefined) continue;
      const plan = planDecoctions({
        ...MASH,
        startTempC: first.targetTempC,
        steps: rests.map((step, index) => ({
          targetTempC: step.targetTempC,
          decoction: index > 0 && step.type === 'decoction',
          ...(step.decoction !== undefined ? { spec: step.decoction } : {}),
        })),
      });
      for (const pull of plan.pulls) {
        expect(Number.isFinite(pull.pullVolumeL), preset.id).toBe(true);
        const errors = pull.issues.filter((issue) => issue.severity === 'error');
        expect(
          errors.map((e) => e.code),
          `${preset.id}`,
        ).toEqual([]);
      }
      expect(plan.pulls.length, preset.id).toBeGreaterThan(0);
    }
  });

  it('takes its last Bohemian pull thin, which is the traditional answer', () => {
    const triple = findDecoctionSchedule('triple-bohemian');
    const pulls = triple?.steps.filter((step) => step.type === 'decoction') ?? [];
    expect(pulls).toHaveLength(3);
    expect(pulls.at(-1)?.decoction?.thickness).toBe('thin');
  });
});

describe('issue wording', () => {
  /** Every issue any of the feasibility paths can raise. */
  function everyIssue(): readonly DecoctionIssue[] {
    const plans = [
      // A pull bigger than the mash, and the scorch note with it.
      decoctionPull({ ...MASH, currentTempC: 40, targetTempC: 95 }),
      // Unreachable. This one returns before the feasibility checks run, so
      // the pot case needs a target the mash can reach.
      decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 99 }),
      decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 64, potVolumeL: 1 }),
      decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 64, spec: { ratioLPerKg: 0.3 } }),
      // A thin pull with no free liquid left, and a boil that dries it out.
      decoctionPull({
        ...MASH,
        mashWaterL: 9.8,
        currentTempC: 52,
        targetTempC: 72,
        spec: { thickness: 'thin' },
      }),
      decoctionPull({
        ...MASH,
        currentTempC: 52,
        targetTempC: 64,
        boilOffLPerHour: 4,
        spec: { boilMinutes: 120 },
      }),
      // Over half the mash.
      decoctionPull({ ...MASH, currentTempC: 52, targetTempC: 77, spec: { thickness: 'thin' } }),
    ];
    const schedule = planDecoctions({
      ...MASH,
      mashWaterL: 10.5,
      startTempC: 37,
      steps: [
        { targetTempC: 52, decoction: true, spec: { boilMinutes: 30 } },
        { targetTempC: 64, decoction: true, spec: { boilMinutes: 30 } },
        { targetTempC: 72, decoction: true, spec: { boilMinutes: 30 } },
      ],
    });
    return [...plans.flatMap((pull) => pull.issues), ...schedule.issues];
  }

  it('reaches every issue code, so the assertions below cover them all', () => {
    const seen = new Set(everyIssue().map((issue) => issue.code));
    const declared: readonly DecoctionIssueCode[] = [
      'pull-exceeds-mash',
      'pull-exceeds-pot',
      'target-unreachable',
      'thickness-clamped',
      'thin-pull-short-of-liquid',
      'pull-dominates-mash',
      'evaporation-exceeds-pull',
      'mash-thickened',
      'scorch-risk',
      'long-brew-day',
    ];
    for (const code of declared) expect(seen, code).toContain(code);
  });

  it('keeps the short form short enough for a table cell', () => {
    // The short form is for a table cell, so it shouldn't wrap to three lines.
    for (const issue of everyIssue()) {
      expect(issue.short.length, `${issue.code}: ${issue.short}`).toBeLessThanOrEqual(32);
    }
  });

  it('never makes the short form a truncation of the message', () => {
    // Cutting the sentence would lose the advice, which is its second half.
    for (const issue of everyIssue()) {
      expect(issue.short.endsWith('…'), issue.code).toBe(false);
      expect(issue.short, issue.code).not.toBe(issue.message);
    }
  });

  it('says what to do in the long form, and only what is wrong in the short', () => {
    for (const issue of everyIssue()) {
      expect(issue.message.length, issue.code).toBeGreaterThan(issue.short.length);
    }
  });

  it('gives every issue that quotes a measurement a template to re-unit it', () => {
    // The ones left out quote a percentage, a number of minutes or no number
    // at all, so they read the same in any unit system.
    const withTemplate = new Set(
      everyIssue()
        .filter((issue) => issue.template !== undefined)
        .map((issue) => issue.code),
    );
    expect([...withTemplate].sort()).toEqual([
      'mash-thickened',
      'pull-exceeds-mash',
      'pull-exceeds-pot',
      'target-unreachable',
      'thickness-clamped',
      'thin-pull-short-of-liquid',
    ]);
  });

  it('renders every template back to the message it ships with', () => {
    // `message` is the canonical rendering of `template`, so a caller that
    // fills the placeholders itself can't say something the message doesn't.
    for (const issue of everyIssue()) {
      expect(renderDecoctionIssue(issue, canonical), issue.code).toBe(issue.message);
    }
  });

  it('leaves no placeholder without a quantity behind it', () => {
    for (const issue of everyIssue()) {
      for (const name of placeholders(issue.template ?? '')) {
        expect(issue.quantities?.[name], `${issue.code}/${name}`).toBeDefined();
      }
    }
  });
});

/** Canonical units, the way the module's own messages are written. */
function canonical(quantity: DecoctionQuantity): string {
  const decimals = quantity.precision ?? (quantity.kind === 'thickness' ? 2 : 1);
  const unit = { volume: 'L', temperature: '°C', thickness: 'L/kg' }[quantity.kind];
  return `${quantity.value.toFixed(decimals)} ${unit}`;
}

/** The `{name}` placeholders in a template. */
function placeholders(template: string): readonly string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map(([, name]) => name ?? '');
}

describe('renderDecoctionIssue', () => {
  const issue: DecoctionIssue = {
    code: 'pull-exceeds-pot',
    severity: 'error',
    short: 'Too big for the pot',
    message: 'The pull is 20.1 L and the decoction pot holds 12.0 L.',
    template: 'The pull is {pullVolume} and the decoction pot holds {potVolume}.',
    quantities: {
      pullVolume: { kind: 'volume', value: 20.1 },
      potVolume: { kind: 'volume', value: 12 },
    },
  };

  it("fills every hole with what the caller's units make of it", () => {
    const gallons = (quantity: DecoctionQuantity) =>
      `${(quantity.value / 3.785_411_784).toFixed(2)} gal`;
    expect(renderDecoctionIssue(issue, gallons)).toBe(
      'The pull is 5.31 gal and the decoction pot holds 3.17 gal.',
    );
  });

  it('hands back the message untouched when there is nothing to fill', () => {
    const plain = {
      code: 'scorch-risk',
      severity: 'note',
      short: 'Stir it while it heats',
      message: 'A pull this thick scorches on a direct flame.',
    } as const;
    expect(renderDecoctionIssue(plain, () => 'never called')).toBe(plain.message);
  });

  it('falls back to the message rather than printing a hole', () => {
    // Canonical units aren't the brewer's units, but they're better than half
    // a sentence.
    const broken: DecoctionIssue = {
      ...issue,
      template: 'The pull is {pullVolume} and the decoction pot holds {missing}.',
    };
    expect(renderDecoctionIssue(broken, canonical)).toBe(issue.message);
  });
});
