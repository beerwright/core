import { describe, expect, it } from 'vitest';
import { pearsonSquare, pearsonSquareExplained, pearsonSquareRefusal } from './pearson';

describe('pearsonSquare', () => {
  // 14 % and 9 % blended to 12 % is (12 − 9) / (14 − 9) = 0.6, so 19 L comes
  // out as 11.4 L of the strong lot and 7.6 L of the weak one.
  const SIXTY_FORTY = { a: 14, b: 9, target: 12, totalVolumeL: 19 } as const;

  it('splits the worked blend sixty–forty', () => {
    const result = pearsonSquare(SIXTY_FORTY);
    expect(result?.volumeAL).toBeCloseTo(11.4, 9);
    expect(result?.volumeBL).toBeCloseTo(7.6, 9);
  });

  it('always hands back the whole volume', () => {
    const result = pearsonSquare(SIXTY_FORTY);
    expect((result?.volumeAL ?? 0) + (result?.volumeBL ?? 0)).toBeCloseTo(19, 9);
  });

  it('blends back to the target it was asked for', () => {
    const result = pearsonSquare(SIXTY_FORTY);
    const blended =
      ((result?.volumeAL ?? 0) * 14 + (result?.volumeBL ?? 0) * 9) /
      ((result?.volumeAL ?? 0) + (result?.volumeBL ?? 0));
    expect(blended).toBeCloseTo(12, 9);
  });

  it('does not care which component is the stronger one', () => {
    const swapped = pearsonSquare({ a: 9, b: 14, target: 12, totalVolumeL: 19 });
    expect(swapped?.volumeAL).toBeCloseTo(7.6, 9);
    expect(swapped?.volumeBL).toBeCloseTo(11.4, 9);
  });

  it('takes a target that is one of the components whole', () => {
    expect(pearsonSquare({ ...SIXTY_FORTY, target: 14 })?.volumeAL).toBeCloseTo(19, 9);
    expect(pearsonSquare({ ...SIXTY_FORTY, target: 9 })?.volumeAL).toBeCloseTo(0, 9);
  });

  it('refuses a target outside the two components, either side', () => {
    expect(pearsonSquare({ ...SIXTY_FORTY, target: 15 })).toBeNull();
    expect(pearsonSquare({ ...SIXTY_FORTY, target: 8 })).toBeNull();
  });

  it('refuses two components that are already the same', () => {
    expect(pearsonSquare({ a: 12, b: 12, target: 12, totalVolumeL: 19 })).toBeNull();
  });

  it('works on gravity points as readily as on alcohol, because it is arithmetic', () => {
    const points = pearsonSquare({ a: 110, b: 10, target: 60, totalVolumeL: 20 });
    expect(points?.volumeAL).toBeCloseTo(10, 9);
    expect(points?.volumeBL).toBeCloseTo(10, 9);
  });
});

describe('pearsonSquareExplained', () => {
  const explanation = pearsonSquareExplained({ a: 14, b: 9, target: 12, totalVolumeL: 19 });

  it('files itself under the cellar, citing Margalit', () => {
    expect(explanation?.family).toBe('cellar');
    expect(explanation?.sources?.[0]?.author).toContain('Margalit');
  });

  it('publishes the first component’s volume and names the second’s', () => {
    expect(explanation?.value).toBeCloseTo(11.4, 6);
    expect(explanation?.inputs.secondLotVolumeL).toBeCloseTo(7.6, 2);
  });

  it('says it is arithmetic, and says what it is not for', () => {
    expect(explanation?.notes?.join(' ')).toContain('weighted average');
    expect(explanation?.notes?.join(' ')).toContain('pH');
  });

  it('declines along with the function it wraps, rather than explaining a non-number', () => {
    expect(pearsonSquareExplained({ a: 14, b: 9, target: 15, totalVolumeL: 19 })).toBeNull();
    expect(pearsonSquareExplained({ a: 12, b: 12, target: 12, totalVolumeL: 19 })).toBeNull();
  });
});

describe('pearsonSquareRefusal', () => {
  it('says nothing when the square answered', () => {
    expect(pearsonSquareRefusal({ a: 14, b: 9, target: 12, totalVolumeL: 19 })).toBeNull();
  });

  it('tells a target outside the two lots apart from two identical lots', () => {
    // Two reasons need two sentences: with an unreachable target the blender
    // moves the target, and with two identical lots they don't.
    expect(pearsonSquareRefusal({ a: 14, b: 9, target: 15, totalVolumeL: 19 })).toContain(
      'outside the two lots',
    );
    expect(pearsonSquareRefusal({ a: 12, b: 12, target: 12, totalVolumeL: 19 })).toContain(
      'Both lots are the same',
    );
  });

  it('answers for every refusal the square can make', () => {
    // Callers rely on every refusal having a sentence, so they never have to
    // write their own.
    for (const input of [
      { a: 14, b: 9, target: 15, totalVolumeL: 19 },
      { a: 14, b: 9, target: 8, totalVolumeL: 19 },
      { a: 12, b: 12, target: 12, totalVolumeL: 19 },
      { a: 12, b: 12, target: 13, totalVolumeL: 19 },
    ]) {
      expect(pearsonSquare(input)).toBeNull();
      expect(pearsonSquareRefusal(input)).not.toBeNull();
    }
  });
});
