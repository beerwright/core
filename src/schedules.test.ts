import { describe, expect, it } from 'vitest';
import { co2VolumesFromPressure, scheduleResidualCo2 } from './carbonation';
import {
  MASH_SACCHARIFICATION_MIN_C,
  MASH_TEMP_ATTENUATION_MAX_SHIFT,
  MASH_TEMP_ATTENUATION_REFERENCE_C,
} from './defaults';
import { REFERENCE_EQUIPMENT, REFERENCE_RECIPE_A } from './fixtures/reference-recipes';
import { effectiveMashTempC } from './gravity';
import { calculateRecipe } from './recipe';
import type { NamedSchedule } from './schedules';
import {
  BODY_MASH_SCHEDULES,
  bodyAttenuationShift,
  FERMENTATION_SCHEDULES,
  FULL_BODY_TEMP_C,
  findNamedSchedule,
  LIGHT_BODY_TEMP_C,
  MASH_SCHEDULES,
  MEDIUM_BODY_TEMP_C,
  PRESSURE_LAGER_CRASH_PSI,
  PRESSURE_LAGER_PRIMARY_PSI,
  TECHNIQUE_MASH_SCHEDULES,
} from './schedules';
import type { FermentationStep, MashStep } from './types';

const byId = (id: string) => MASH_SCHEDULES.find((s) => s.id === id);

/** One fermentation schedule by id. Throws with the id if it's missing. */
function fermentById(id: string): NamedSchedule<FermentationStep> {
  const schedule = FERMENTATION_SCHEDULES.find((s) => s.id === id);
  if (schedule === undefined) throw new Error(`no fermentation schedule "${id}"`);
  return schedule;
}

/** The saccharification rest a schedule is built on, which is what body depends on. */
function saccTemp(schedule: NamedSchedule<MashStep>): number {
  const step = schedule.steps.find((s) => s.name === 'Saccharification');
  if (step === undefined) throw new Error(`${schedule.id} has no saccharification rest`);
  return step.targetTempC;
}

describe('the shipped set', () => {
  it('gives every schedule a unique id', () => {
    const ids = [...MASH_SCHEDULES, ...FERMENTATION_SCHEDULES].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds one by id, and nothing by a bad one', () => {
    expect(findNamedSchedule('mash-body-full')?.name).toBe('Full body');
    expect(findNamedSchedule('ferment-kveik')?.name).toBe('Kveik');
    expect(findNamedSchedule('nope')).toBeUndefined();
  });

  it('keeps the two mash axes apart', () => {
    // Body and technique are separate choices, and no schedule tries to be
    // both.
    expect(BODY_MASH_SCHEDULES.every((s) => s.kind === 'body')).toBe(true);
    expect(TECHNIQUE_MASH_SCHEDULES.every((s) => s.kind === 'technique')).toBe(true);
    expect(FERMENTATION_SCHEDULES.every((s) => s.kind === 'fermentation')).toBe(true);
  });

  it('gives every schedule steps in rising temperature order', () => {
    for (const schedule of MASH_SCHEDULES) {
      const temps = schedule.steps.map((s) => s.targetTempC);
      expect(
        [...temps].sort((a, b) => a - b),
        schedule.id,
      ).toEqual(temps);
    }
  });
});

describe('the body vocabulary', () => {
  it('sits on the engine’s own reference in the middle', () => {
    // Medium is the temperature the attenuation heuristic is built around, so
    // it shifts the prediction by zero.
    expect(MEDIUM_BODY_TEMP_C).toBe(MASH_TEMP_ATTENUATION_REFERENCE_C);
    expect(bodyAttenuationShift(MEDIUM_BODY_TEMP_C)).toBeCloseTo(0, 9);
  });

  it('states the shift each name promises', () => {
    // 148 °F and 156 °F are ±4 °F around the model's 152 °F reference, so the
    // two shifts are close to mirror images.
    expect(bodyAttenuationShift(LIGHT_BODY_TEMP_C)).toBeCloseTo(2.71, 2);
    expect(bodyAttenuationShift(FULL_BODY_TEMP_C)).toBeCloseTo(-2.63, 2);
  });

  it('stays inside the shift the engine will actually apply', () => {
    // A label shouldn't show a shift that the prediction then clamps.
    for (const schedule of BODY_MASH_SCHEDULES) {
      expect(Math.abs(bodyAttenuationShift(saccTemp(schedule))), schedule.id).toBeLessThan(
        MASH_TEMP_ATTENUATION_MAX_SHIFT,
      );
    }
  });

  it('moves a real recipe in the direction the name promises', () => {
    // Applying a body profile should change the predicted beer.
    const withMash = (id: string) => {
      const schedule = byId(id);
      expect(schedule, id).toBeDefined();
      return calculateRecipe(
        { ...REFERENCE_RECIPE_A, mashSteps: schedule?.steps ?? [] },
        REFERENCE_EQUIPMENT,
      );
    };

    const light = withMash('mash-body-light');
    const medium = withMash('mash-body-medium');
    const full = withMash('mash-body-full');

    // Drier means a lower final gravity and more alcohol.
    expect(light.vitals.fg).toBeLessThan(medium.vitals.fg);
    expect(medium.vitals.fg).toBeLessThan(full.vitals.fg);
    expect(light.vitals.abv).toBeGreaterThan(full.vitals.abv);
    expect(light.vitals.apparentAttenuationPercent).toBeGreaterThan(
      full.vitals.apparentAttenuationPercent,
    );
  });
});

describe('the technique vocabulary', () => {
  it('offers both hefeweizens, and they differ where the argument says they do', () => {
    const traditional = byId('mash-hefeweizen-ferulic');
    const ester = byId('mash-hefeweizen-ester');
    expect(traditional).toBeDefined();
    expect(ester).toBeDefined();
    if (traditional === undefined || ester === undefined) return;

    // Both start with the clove rest, so that isn't the difference.
    expect(traditional.steps[0]?.name).toBe('Ferulic acid rest');
    expect(ester.steps[0]?.name).toBe('Ferulic acid rest');

    // The traditional one steps through a maltose rest and the other doesn't.
    // That's the only difference. Less maltose means glucose is a larger share
    // of the sugars, at the cost of fermentability.
    expect(traditional.steps.some((step) => step.name === 'Maltose rest')).toBe(true);
    expect(ester.steps.some((step) => step.name === 'Maltose rest')).toBe(false);

    const effective = (schedule: NamedSchedule<MashStep>) =>
      effectiveMashTempC(schedule.steps) ?? 0;
    expect(effective(ester)).toBeGreaterThan(effective(traditional));
  });

  it('gives a hefeweizen its ferulic acid rest', () => {
    // The clove starts in the mash, not only in the yeast, and the rest for it
    // is below the saccharification range, so the engine's fermentability
    // calculation ignores it.
    const hefe = byId('mash-hefeweizen-ferulic');
    const first = hefe?.steps[0];
    expect(first?.name).toBe('Ferulic acid rest');
    expect(first?.targetTempC).toBeLessThan(MASH_SACCHARIFICATION_MIN_C);
  });

  it('carries the decoction schedules across rather than restating them', () => {
    for (const id of ['mash-hochkurz-single', 'mash-double', 'mash-triple-bohemian']) {
      expect(byId(id), id).toBeDefined();
    }
    // The steps are unchanged by the adaptation. It's the same data, renamed.
    const triple = byId('mash-triple-bohemian');
    const pulls = triple?.steps.filter((s) => s.type === 'decoction') ?? [];
    expect(pulls).toHaveLength(3);
    expect(pulls.at(-1)?.decoction?.thickness).toBe('thin');
  });

  it('offers a plain single infusion at the reference temperature', () => {
    expect(saccTemp(byId('mash-single-infusion') as NamedSchedule<MashStep>)).toBe(
      MEDIUM_BODY_TEMP_C,
    );
  });
});

describe('the fermentation set', () => {
  it('takes a lager cold, warm, then cold again', () => {
    const lager = FERMENTATION_SCHEDULES.find((s) => s.id === 'ferment-lager-diacetyl');
    const temps = lager?.steps.map((s) => s.tempC) ?? [];
    expect(temps).toHaveLength(3);
    // The diacetyl rest is the only warm step in a cold schedule.
    expect(temps[1]).toBeGreaterThan(temps[0] ?? 0);
    expect(temps[2]).toBeLessThan(temps[1] ?? 0);
  });

  it('gives every schedule at least one step and a positive duration', () => {
    for (const schedule of FERMENTATION_SCHEDULES) {
      expect(schedule.steps.length, schedule.id).toBeGreaterThan(0);
      for (const step of schedule.steps) expect(step.days, schedule.id).toBeGreaterThan(0);
    }
  });

  it('names every step with a phase the type union actually has', () => {
    // These schedules only use the existing step types. A free rise is still
    // primary fermentation, and a crash is conditioning or lagering depending
    // on the beer. Adding a type would affect everything that reads
    // `FermentationStepType`.
    const phases = new Set(['primary', 'secondary', 'conditioning', 'lagering']);
    for (const schedule of FERMENTATION_SCHEDULES) {
      for (const step of schedule.steps) expect(phases.has(step.type), schedule.id).toBe(true);
    }
  });

  it('holds the cool-then-move shape everywhere it claims one', () => {
    // The first days set the character and the days after do something else,
    // so a free-rise schedule has to actually rise.
    for (const id of [
      'ferment-hazy-free-rise',
      'ferment-belgian-free-rise',
      'ferment-saison-hot',
    ]) {
      const schedule = fermentById(id);
      const [first, second] = schedule.steps;
      expect(schedule.steps, id).toHaveLength(2);
      expect(second?.name, id).toBe('Free rise');
      expect(second?.tempC ?? 0, id).toBeGreaterThan(first?.tempC ?? 0);
      // Short and cool first, long and warm after.
      expect(second?.days ?? 0, id).toBeGreaterThan(first?.days ?? 0);
    }
  });

  it('drops rather than rises where the name says so', () => {
    for (const id of ['ferment-english-ale', 'ferment-clean-ale-crashed']) {
      const schedule = fermentById(id);
      const [first, second] = schedule.steps;
      expect(schedule.steps, id).toHaveLength(2);
      expect(second?.tempC ?? 99, id).toBeLessThan(first?.tempC ?? 0);
    }
  });

  it('keeps the crashed clean ale a sibling rather than a rewrite', () => {
    // Adding the crash to `ferment-clean-ale` would change a schedule whose
    // description says two weeks at one temperature.
    const plain = fermentById('ferment-clean-ale');
    const crashed = fermentById('ferment-clean-ale-crashed');
    expect(plain.steps).toHaveLength(1);
    expect(plain.steps[0]?.days).toBe(14);
    // The same two weeks, split differently.
    const total = (schedule: NamedSchedule<FermentationStep>) =>
      schedule.steps.reduce((sum, step) => sum + step.days, 0);
    expect(total(crashed)).toBe(total(plain));
  });

  it('takes the fast lager cold, warm, then cold, in half the time', () => {
    const fast = fermentById('ferment-fast-lager');
    const classic = fermentById('ferment-lager-diacetyl');
    const temps = fast.steps.map((s) => s.tempC);
    expect(temps).toHaveLength(3);
    expect(temps[1]).toBeGreaterThan(temps[0] ?? 0);
    expect(temps[2]).toBeLessThan(temps[1] ?? 0);

    const total = (schedule: NamedSchedule<FermentationStep>) =>
      schedule.steps.reduce((sum, step) => sum + step.days, 0);
    // The reason to pick it is that the fermenter is free again in two weeks.
    expect(total(fast)).toBeLessThan(total(classic) / 2);
  });

  it('leaves every schedule but the pressure one open to the air', () => {
    for (const schedule of FERMENTATION_SCHEDULES) {
      if (schedule.id === 'ferment-pressure-lager') continue;
      for (const step of schedule.steps) {
        expect(step.pressurePsi, schedule.id).toBeUndefined();
      }
    }
  });
});

describe('the pressure lager', () => {
  const schedule = fermentById('ferment-pressure-lager');

  it('spunds a warm primary and holds the crash under pressure', () => {
    const [primary, crash] = schedule.steps;
    expect(primary?.pressurePsi).toBe(PRESSURE_LAGER_PRIMARY_PSI);
    expect(crash?.pressurePsi).toBe(PRESSURE_LAGER_CRASH_PSI);
    // Warmer than the classic lager's primary, which is what the pressure allows.
    const classic = fermentById('ferment-lager-diacetyl');
    expect(primary?.tempC ?? 0).toBeGreaterThan(classic.steps[0]?.tempC ?? 0);
  });

  it('backs the valve down for the crash, and that is what saves the beer', () => {
    // Checks the claim in schedules.ts against the engine: 15 psi held through
    // a 2 °C crash overshoots the usual lager carbonation range, and 10 psi
    // lands in it.
    const crash = schedule.steps[1];
    if (crash === undefined) throw new Error('no crash step');
    const held = scheduleResidualCo2([...schedule.steps]);
    expect(held?.pressurePsi).toBe(PRESSURE_LAGER_CRASH_PSI);
    expect(held?.volumes ?? 0).toBeGreaterThan(2.4);
    expect(held?.volumes ?? 0).toBeLessThan(2.6);

    const unvented = co2VolumesFromPressure(crash.tempC, PRESSURE_LAGER_PRIMARY_PSI);
    expect(unvented).toBeGreaterThan(2.8);
  });

  it('arrives at packaging holding far more CO₂ than an open ferment would', () => {
    const open = scheduleResidualCo2([...fermentById('ferment-fast-lager').steps]);
    const spunded = scheduleResidualCo2([...schedule.steps]);
    expect(open?.pressurePsi).toBeNull();
    expect(spunded?.volumes ?? 0).toBeGreaterThan((open?.volumes ?? 0) * 2);
  });
});
