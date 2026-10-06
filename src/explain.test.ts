import { describe, expect, it } from 'vitest';
import { explain, explained, withNotes } from './explain';

const spec = {
  label: 'Color',
  formula: 'morey-1999',
  expression: 'SRM = 1.4922 × MCU^0.6859',
  inputs: { mcu: 14.53, volumeL: 21.54 },
  unit: 'SRM',
};

describe('explain', () => {
  it('carries the value, the formula name and the inputs', () => {
    const result = explain(9.354, spec);
    expect(result.value).toBe(9.354);
    expect(result.formula).toBe('morey-1999');
    expect(result.expression).toBe('SRM = 1.4922 × MCU^0.6859');
    expect(result.inputs.mcu).toBe(14.53);
    expect(result.unit).toBe('SRM');
  });

  it('omits notes entirely rather than setting them undefined', () => {
    const result = explain(9.354, spec);
    expect('notes' in result).toBe(false);
  });

  it('omits an empty notes array too', () => {
    expect('notes' in explain(9.354, { ...spec, notes: [] })).toBe(false);
  });

  it('keeps notes that were given', () => {
    const result = explain(9.354, { ...spec, notes: ['EBC = SRM × 1.97'] });
    expect(result.notes).toEqual(['EBC = SRM × 1.97']);
  });

  it('tolerates an explicitly undefined notes field', () => {
    expect('notes' in explain(9.354, { ...spec, notes: undefined })).toBe(false);
  });
});

describe('explained', () => {
  it('pairs the value with its breakdown', () => {
    const result = explained(9.354, spec);
    expect(result.value).toBe(9.354);
    expect(result.explain.value).toBe(9.354);
  });
});

describe('withNotes', () => {
  it('appends to an explanation with no notes', () => {
    expect(withNotes(explain(1, spec), 'first').notes).toEqual(['first']);
  });

  it('appends to existing notes without mutating the original', () => {
    const original = explain(1, { ...spec, notes: ['first'] });
    const extended = withNotes(original, 'second', 'third');
    expect(extended.notes).toEqual(['first', 'second', 'third']);
    expect(original.notes).toEqual(['first']);
  });
});
