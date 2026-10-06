import { describe, expect, it } from 'vitest';
import type { FlavorInput, StyleFlavorBands, WheelValues } from './flavor';
import {
  bandFor,
  FIT_WORST_WHEEL_LEAD,
  FLAVOR_AXES,
  flavorFit,
  flavorProfile,
  hopUseFactor,
} from './flavor';

/** Every axis at zero. */
function zeros(): WheelValues {
  return {
    hop: Object.fromEntries(FLAVOR_AXES.hop.map((a) => [a, 0])),
    malt: Object.fromEntries(FLAVOR_AXES.malt.map((a) => [a, 0])),
    fermentation: Object.fromEntries(FLAVOR_AXES.fermentation.map((a) => [a, 0])),
  } as WheelValues;
}

const PILS: StyleFlavorBands = {
  hop: { floral: [2, 4], herbal: [1, 3] },
  malt: { grainy: [3, 5] },
  fermentation: { clean: [4, 5] },
  weights: { hop: 0.5, malt: 0.3, fermentation: 0.2 },
  basis: 'test',
};

describe('bandFor', () => {
  it('reads an authored band', () => {
    expect(bandFor(PILS, 'hop', 'floral')).toEqual([2, 4]);
  });
  it('treats an unnamed axis as not characteristic', () => {
    expect(bandFor(PILS, 'hop', 'tropical')).toEqual([0, 1]);
  });
});

describe('flavorFit', () => {
  it('scores 100 when every axis sits in its band', () => {
    const values = zeros();
    values.hop.floral = 3;
    values.hop.herbal = 2;
    values.malt.grainy = 4;
    values.fermentation.clean = 4.5;
    const fit = flavorFit(values, PILS);
    expect(fit.overall).toBe(100);
    expect(fit.wheels).toEqual({ hop: 100, malt: 100, fermentation: 100 });
    expect(fit.misses).toEqual([]);
  });

  it('costs more the further an axis sits outside its band', () => {
    const near = zeros();
    const far = zeros();
    Object.assign(near.malt, { grainy: 4 });
    Object.assign(far.malt, { grainy: 4 });
    Object.assign(near.fermentation, { clean: 4 });
    Object.assign(far.fermentation, { clean: 4 });
    Object.assign(near.hop, { floral: 3, herbal: 2, tropical: 2 });
    Object.assign(far.hop, { floral: 3, herbal: 2, tropical: 4 });
    expect(flavorFit(near, PILS).wheels.hop).toBeGreaterThan(flavorFit(far, PILS).wheels.hop);
    expect(flavorFit(far, PILS).wheels.hop).toBeGreaterThan(0);
  });

  it('weights the overall by the style', () => {
    const values = zeros();
    Object.assign(values.malt, { grainy: 4 });
    Object.assign(values.fermentation, { clean: 4 });
    // No hops at all, so floral and herbal are both below their bands.
    const fit = flavorFit(values, PILS);
    expect(fit.wheels.malt).toBe(100);
    // Hop scores 37. The weighted mean is 68.5, but the worst wheel caps it at 37 + 30.
    expect(fit.wheels.hop).toBe(37);
    expect(fit.overall).toBe(67);
  });

  const LIGHT_LAGER: StyleFlavorBands = {
    hop: { floral: [0, 2] },
    malt: { grainy: [2, 4] },
    fermentation: { clean: [4, 5] },
    weights: { hop: 0.15, malt: 0.45, fermentation: 0.4 },
    basis: 'test',
  };

  it('holds the overall to the worst wheel plus the lead when one wheel is far out', () => {
    const values = zeros();
    for (const axis of FLAVOR_AXES.hop) values.hop[axis] = 5;
    values.malt.grainy = 3;
    values.fermentation.clean = 4.5;
    const fit = flavorFit(values, LIGHT_LAGER);
    expect(fit.wheels).toEqual({ hop: 0, malt: 100, fermentation: 100 });
    // The weighted mean would be 85, but the hop wheel caps it at 0 + 30.
    expect(fit.overall).toBe(FIT_WORST_WHEEL_LEAD);
    expect(fit.overall).toBe(30);
  });

  it('leaves a beer in every band at 100', () => {
    const values = zeros();
    values.hop.floral = 1;
    values.malt.grainy = 3;
    values.fermentation.clean = 4.5;
    const fit = flavorFit(values, LIGHT_LAGER);
    expect(fit.wheels).toEqual({ hop: 100, malt: 100, fermentation: 100 });
    expect(fit.overall).toBe(100);
  });

  it('leaves a mild miss at its weighted mean', () => {
    const values = zeros();
    Object.assign(values.hop, { floral: 3, herbal: 2, tropical: 2 });
    Object.assign(values.malt, { grainy: 4 });
    Object.assign(values.fermentation, { clean: 4 });
    const fit = flavorFit(values, PILS);
    // Tropical is a point over its band, so hop is 72 and the mean is
    // 0.5·72 + 30 + 20 = 86, well under the 72 + 30 cap.
    expect(fit.wheels).toEqual({ hop: 72, malt: 100, fermentation: 100 });
    expect(fit.overall).toBe(86);
  });

  it('ranks misses by cost, largest first, and returns whole numbers', () => {
    const values = zeros();
    Object.assign(values.hop, { floral: 3, herbal: 2, resinPine: 4 });
    Object.assign(values.malt, { grainy: 4 });
    Object.assign(values.fermentation, { clean: 3 });
    const fit = flavorFit(values, PILS);
    expect(fit.misses.map((m) => `${m.wheel}.${m.axis}`)).toEqual([
      'hop.resinPine',
      'fermentation.clean',
    ]);
    expect(fit.misses[0]).toMatchObject({ value: 4, band: [0, 1], cost: 3 });
    for (const n of [fit.overall, ...Object.values(fit.wheels)]) {
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

const SAAZ = { floral: 4, herbal: 3, spice: 3, grassy: 2, citrus: 1 };
const PILSNER = { grainy: 4, sweet: 1 };
const LAGER = { clean: 4, sulfur: 1 };

function pils(overrides: Partial<FlavorInput> = {}): FlavorInput {
  return {
    volumeL: 20,
    hops: [
      {
        name: 'Saaz',
        amountKg: 0.03,
        use: 'whirlpool',
        timeMinutes: 10,
        whirlpoolTempC: 80,
        scores: SAAZ,
      },
    ],
    malts: [{ name: 'Pilsner', amountKg: 4.5, potency: 1, scores: PILSNER }],
    yeasts: [{ name: 'W-34/70', scores: LAGER, rangeC: { min: 9, max: 15 } }],
    fermentTempC: 12,
    ...overrides,
  };
}

describe('hopUseFactor', () => {
  it('counts dry hop and keg in full', () => {
    expect(hopUseFactor({ use: 'dry-hop', timeMinutes: 0 })).toBe(1);
    expect(hopUseFactor({ use: 'keg', timeMinutes: 0 })).toBe(1);
  });
  it('leaves almost nothing of a 60 minute addition', () => {
    expect(hopUseFactor({ use: 'boil', timeMinutes: 60 })).toBeLessThan(0.03);
  });
  it('keeps more of a cooler whirlpool', () => {
    expect(hopUseFactor({ use: 'whirlpool', timeMinutes: 20, whirlpoolTempC: 70 })).toBeGreaterThan(
      hopUseFactor({ use: 'whirlpool', timeMinutes: 20, whirlpoolTempC: 95 }),
    );
  });
});

describe('flavorProfile', () => {
  it('gives an empty recipe all-zero wheels, not NaN', () => {
    const empty = flavorProfile({
      volumeL: 0,
      hops: [],
      malts: [],
      yeasts: [],
      fermentTempC: null,
    });
    for (const wheel of ['hop', 'malt', 'fermentation'] as const) {
      for (const value of Object.values(empty.values[wheel])) expect(value).toBe(0);
    }
  });

  it('raises the hop axes when the dry hop doubles', () => {
    const single = pils({
      hops: [{ name: 'Saaz', amountKg: 0.05, use: 'dry-hop', timeMinutes: 0, scores: SAAZ }],
    });
    const double = pils({
      hops: [{ name: 'Saaz', amountKg: 0.1, use: 'dry-hop', timeMinutes: 0, scores: SAAZ }],
    });
    expect(flavorProfile(double).values.hop.floral).toBeGreaterThan(
      flavorProfile(single).values.hop.floral,
    );
  });

  it('draws the same wheel at twice the volume with twice the hops', () => {
    const small = flavorProfile(pils());
    const big = flavorProfile(
      pils({
        volumeL: 40,
        hops: [
          {
            name: 'Saaz',
            amountKg: 0.06,
            use: 'whirlpool',
            timeMinutes: 10,
            whirlpoolTempC: 80,
            scores: SAAZ,
          },
        ],
        malts: [{ name: 'Pilsner', amountKg: 9, potency: 1, scores: PILSNER }],
      }),
    );
    expect(big.values).toEqual(small.values);
  });

  it('adds almost nothing for a 60 minute bittering charge', () => {
    const bitter = flavorProfile(
      pils({
        hops: [{ name: 'Saaz', amountKg: 0.05, use: 'boil', timeMinutes: 60, scores: SAAZ }],
      }),
    );
    expect(bitter.values.hop.floral).toBeLessThan(0.3);
  });

  it('lets a small share of a potent malt show', () => {
    const stout = flavorProfile(
      pils({
        malts: [
          { name: 'Pale', amountKg: 3.6, potency: 1, scores: { grainy: 3, bready: 2 } },
          { name: 'Roasted barley', amountKg: 0.4, potency: 8, scores: { roast: 5, chocolate: 2 } },
        ],
      }),
    );
    expect(stout.values.malt.roast).toBeGreaterThan(3);
    expect(stout.causes.malt.roast?.[0]?.name).toBe('Roasted barley');
  });

  it('raises esters and cuts clean when a strain ferments warm', () => {
    const hefe = { banana: 3, clove: 2, fruity: 2, clean: 1 };
    const cool = flavorProfile(
      pils({
        yeasts: [{ name: 'WB-06', scores: hefe, rangeC: { min: 17, max: 24 } }],
        fermentTempC: 17,
      }),
    );
    const warm = flavorProfile(
      pils({
        yeasts: [{ name: 'WB-06', scores: hefe, rangeC: { min: 17, max: 24 } }],
        fermentTempC: 24,
      }),
    );
    expect(warm.values.fermentation.banana).toBeGreaterThan(cool.values.fermentation.banana);
    expect(warm.values.fermentation.clean).toBeLessThan(cool.values.fermentation.clean);
  });

  it('takes the per-axis maximum across yeasts, not the sum', () => {
    const both = flavorProfile(
      pils({
        yeasts: [
          { name: 'Saison', scores: { pepper: 3, fruity: 3 }, rangeC: null },
          { name: 'Brett', scores: { funk: 4, fruity: 2 }, rangeC: null },
        ],
        fermentTempC: null,
      }),
    );
    expect(both.values.fermentation.fruity).toBe(3);
    expect(both.values.fermentation.funk).toBe(4);
  });

  it('lists ingredients with no scores', () => {
    const profile = flavorProfile(
      pils({
        hops: [{ name: 'Mystery', amountKg: 0.02, use: 'dry-hop', timeMinutes: 0, scores: null }],
      }),
    );
    expect(profile.unscored).toEqual(['Mystery']);
  });
});
