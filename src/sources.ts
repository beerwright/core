/**
 * The bibliography, as data.
 *
 * Each citation here is also named in the docstring above the function that
 * implements the model. A calculator reference is generated from the
 * {@link Explanation} payload, though, so a source that's only in a comment
 * never reaches a reader. These constants go into that payload, and each one
 * is used by the module whose docstring names the work.
 *
 * Two rules for the entries:
 *
 * - No invented attribution. Several curves homebrewing relies on, like the
 *   CO₂ solubility tables and the residual-CO₂ fit, have been copied from
 *   calculator to calculator with no first author anyone can point to. Those
 *   get a title and nothing else, so we don't make up a plausible name.
 * - Only give a `url` if the work is actually at that address. Most of these
 *   are the same links the docstrings use.
 */

import type { Source } from './explain';

// ---------------------------------------------------------------------------
// Bitterness
// ---------------------------------------------------------------------------

/**
 * Tinseth's utilisation model. This is the engine's default bitterness formula.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TINSETH_1997: Source = {
  title: 'Hop Utilization',
  author: 'Glenn Tinseth',
  year: 1997,
  url: 'http://realbeer.com/hops/research.html',
};

/**
 * Rager's utilisation model, from the 1990 Zymurgy hops issue.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const RAGER_1990: Source = {
  title: 'Calculating Hop Bitterness in Beer',
  author: 'Jackie Rager, Zymurgy Special Issue',
  year: 1990,
};

/**
 * Garetz's utilisation model and its three multiplicative penalties.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const GARETZ_USING_HOPS_1994: Source = {
  title: 'Using Hops: The Complete Guide to Hops for the Craft Brewer',
  author: 'Mark Garetz',
  year: 1994,
};

/**
 * The isomerisation kinetics behind the whirlpool and hop-stand models.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const MALOWICKI_2005: Source = {
  title: 'Hop bitter acid isomerization and degradation kinetics in a model wort-boiling system',
  author: 'Mark G. Malowicki, MSc thesis, Oregon State University',
  year: 2005,
};

/**
 * The mIBU treatment of a cooling hop stand.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const HOSOM_MIBU_2018: Source = {
  title: 'A Modified IBU Calculation, especially for late hopping and whirlpool hops',
  author: 'John-Paul Hosom (alchemyoverlord)',
  year: 2018,
  url: 'https://alchemyoverlord.wordpress.com/',
};

/**
 * BU:GU as the measure of balance brewers use.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const DANIELS_DESIGNING_1996: Source = {
  title: 'Designing Great Beers',
  author: 'Ray Daniels',
  year: 1996,
};

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Morey's MCU → SRM fit. This is the engine default.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const MOREY_1999: Source = {
  title: 'Approximating SRM Beer Color',
  author: 'Dan Morey',
  year: 1999,
};

/**
 * Mosher's MCU → SRM fit.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const MOSHER_COMPANION_1994: Source = {
  title: "The Brewer's Companion",
  author: 'Randy Mosher',
  year: 1994,
};

/**
 * The SRM colour chart the swatch interpolates.
 *
 * It has no single author. It's the standard beer-colour reference that the
 * BJCP guide and every homebrew calculator reproduce.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const SRM_COLOUR_CHART: Source = {
  title: 'The SRM beer-color reference chart, as reproduced by the BJCP color guide',
};

// ---------------------------------------------------------------------------
// Gravity, extract and alcohol
// ---------------------------------------------------------------------------

/**
 * Palmer is the standard reference for the extract, strike and infusion arithmetic.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const PALMER_HOW_TO_BREW: Source = {
  title: 'How to Brew',
  author: 'John J. Palmer, Brewers Publications',
  year: 2017,
};

/**
 * The Plato cubic, real extract and the caloric formula.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const ASBC_METHODS: Source = {
  title: 'Methods of Analysis',
  author: 'American Society of Brewing Chemists',
};

/**
 * The "advanced" ABV formula.
 *
 * Widely attributed to a 1995 *Zymurgy* article and implemented unchanged by
 * BeerSmith, Brewer's Friend and Brewfather. Everyone repeats the attribution
 * but nobody gives a source for it, so we record the publication and no
 * author.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const ZYMURGY_ABV_1995: Source = {
  title: 'Alcohol by volume from the gravity drop, the "advanced" formula (Zymurgy)',
  year: 1995,
};

// ---------------------------------------------------------------------------
// Carbonation
// ---------------------------------------------------------------------------

/**
 * The CO₂ solubility tables every keg calculator fits.
 *
 * This only has a title. The polynomial is a fit of published solubility
 * tables, and the homebrewing literature doesn't agree on a first author.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const CO2_SOLUBILITY_TABLES: Source = {
  title: 'CO₂ solubility in beer: the standard temperature and pressure carbonation tables',
};

/**
 * Braukaiser's derivation of the priming dose and the residual-CO₂ curve.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const BRAUKAISER_CARBONATION: Source = {
  title: 'Accurately Calculating Sugar Additions for Carbonation',
  author: 'Kai Troester (Braukaiser)',
  url: 'http://braukaiser.com/wiki/index.php/Accurately_Calculating_Sugar_Additions_for_Carbonation',
};

/**
 * The Mr. Wizard answer that gives the keg rule of thumb and also says not to trust it.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const BYO_MR_WIZARD_KEG_PRIMING: Source = {
  title: 'Priming When Kegging',
  author: 'Brew Your Own, Mr. Wizard',
  url: 'https://byo.com/mr-wizard/priming-when-keg/',
};

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

/**
 * Terrill's regression for a refractometer reading taken after fermentation started.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TERRILL_REFRACTOMETER_2011: Source = {
  title: 'Refractometer FG Results',
  author: 'Sean Terrill',
  year: 2011,
  url: 'http://seanterrill.com/2011/04/07/refractometer-fg-results/',
};

/**
 * Kell's equation for the density of water, behind the volume correction.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const KELL_1975: Source = {
  title:
    'Density, thermal expansivity, and compressibility of liquid water from 0° to 150 °C, J. Chem. Eng. Data 20(1), 97–105',
  author: 'George S. Kell',
  year: 1975,
};

/**
 * The cubic water-density fit in °F that every homebrew hydrometer-correction
 * calculator uses. We use it so our numbers match theirs, and cite it as that
 * fit.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const HYDROMETER_CORRECTION_POLYNOMIAL: Source = {
  title: 'The homebrewing hydrometer temperature-correction polynomial (water density in °F)',
};

// ---------------------------------------------------------------------------
// Water and mash pH
// ---------------------------------------------------------------------------

/**
 * Kolbach's residual alkalinity.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const KOLBACH_1953: Source = {
  title:
    'Der Einfluss des Brauwassers auf den pH-Wert der Würze und des Bieres, Monatsschrift für Brauerei 6',
  author: 'Paul Kolbach',
  year: 1953,
};

/**
 * Troester's DI-pH and buffering-capacity mash model, which this engine implements.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TROESTER_MASH_PH: Source = {
  title: 'Understanding Mash pH',
  author: 'Kai Troester (Braukaiser)',
  url: 'http://braukaiser.com/wiki/index.php/Understanding_Mash_pH',
};

/**
 * Troester's water write-up, the other half of the charge-balance lineage.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TROESTER_BREWING_WATER: Source = {
  title: 'A general approach to brewing water',
  author: 'Kai Troester (Braukaiser)',
};

/**
 * Palmer & Kaminski, for the acid strength tables and the ion advisory ranges.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const PALMER_KAMINSKI_WATER_2013: Source = {
  title: 'Water: A Comprehensive Guide for Brewers',
  author: 'John Palmer & Colin Kaminski, Brewers Publications',
  year: 2013,
};

/**
 * The carbonic-acid dissociation constants the speciation runs on.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const HARNED_DAVIS_1943: Source = {
  title: 'The Ionization Constant of Carbonic Acid in Water, J. Am. Chem. Soc. 65',
  author: 'Herbert S. Harned & Raymond Davis Jr.',
  year: 1943,
};

/**
 * The non-negative least squares the salt solver enumerates subsets of.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const LAWSON_HANSON_1974: Source = {
  title: 'Solving Least Squares Problems',
  author: 'Charles L. Lawson & Richard J. Hanson',
  year: 1974,
};

// ---------------------------------------------------------------------------
// Yeast
// ---------------------------------------------------------------------------

/**
 * The pitch rates, and the reason a lager gets double an ale's.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const WHITE_ZAINASHEFF_2010: Source = {
  title: 'Yeast: The Practical Guide to Beer Fermentation',
  author: 'Chris White & Jamil Zainasheff, Brewers Publications',
  year: 2010,
};

/**
 * The liquid-pack viability decay this engine uses.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const MR_MALTY_VIABILITY: Source = {
  title: 'Pitching Rate Calculator',
  author: 'Jamil Zainasheff (Mr Malty)',
  url: 'http://www.mrmalty.com/calc/calc.html',
};

/**
 * Braukaiser's stirred-starter growth model.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TROESTER_YEAST_GROWTH_2012: Source = {
  title: 'Estimating yeast growth',
  author: 'Kai Troester (Braukaiser)',
  year: 2012,
  url: 'http://braukaiser.com/blog/blog/2012/11/03/estimating-yeast-growth/',
};

/**
 * The NHC deck the unstirred bands are read off.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TROESTER_NHC_2013: Source = {
  title: 'Step Up Your Starter (NHC 2013)',
  author: 'Kai Troester (Braukaiser)',
  year: 2013,
  url: 'https://braukaiser.com/documents/Troester_NHC_2013_Step_Up_Your_Starter.pdf',
};

// ---------------------------------------------------------------------------
// Hop freshness
// ---------------------------------------------------------------------------

/**
 * Garetz's storage model: the curve, the rate constants and the storage factors.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const GARETZ_HOP_STORAGE_1994: Source = {
  title: "Hop Storage: How to Get — and Keep — Your Hops' Optimum Value, Brewing Techniques 2(1)",
  author: 'Mark Garetz',
  year: 1994,
  url: 'https://www.morebeer.com/blogs/articles/hop-storage',
};

/**
 * The implementation the modern nitrogen-flushed storage factor comes from.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const ALCHEMY_OVERLORD_HOP_STORAGE: Source = {
  title: 'Hop storage factors for modern packaging',
  author: 'alchemyoverlord',
  url: 'https://alchemyoverlord.wordpress.com/',
};

/**
 * The spectrophotometric hop storage index, for brewers holding a lab number.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const NICKERSON_LIKENS_HSI: Source = {
  title: 'Hop storage index (absorbance ratio 275/325 nm in alkaline methanol)',
  author: 'Gail B. Nickerson & S. T. Likens',
};

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------

/**
 * Tonsmeire's priming spreadsheet, and the barrel-ageing residual factor.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TONSMEIRE_BLENDING_2014: Source = {
  title: 'Priming Barrel-Aged and Blended Sour Beer',
  author: 'Michael Tonsmeire (The Mad Fermentationist)',
  year: 2014,
  url: 'https://www.themadfermentationist.com/2014/07/priming-barrel-aged-and-blended-sour.html',
};

/**
 * Crane's extension of Tonsmeire's sheet: the extract term, the TA sheet and the acid-shock starter.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const CRANE_BLENDING_SHEET: Source = {
  title: 'Blending and priming spreadsheet for mixed-fermentation beer',
  author: 'Curtis Crane, Council Brewing (NHC)',
};

/**
 * The pH-blending approximation Crane cites.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const TECHNIQUES_HOME_WINEMAKING_PH: Source = {
  title: 'How does blending impact pH?',
  author: 'Techniques in Home Winemaking',
  url: 'http://www.techniquesinhomewinemaking.com/blog/how-does-blending-impact-ph/',
};

/**
 * Milk the Funk's packaging page, the other rule of thumb for the acid-shock pitch.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const MILK_THE_FUNK_PACKAGING: Source = {
  title: 'Packaging',
  author: 'Milk the Funk wiki',
  url: 'https://www.milkthefunk.com/wiki/Packaging',
};

// ---------------------------------------------------------------------------
// Must, nutrients and stabilising
// ---------------------------------------------------------------------------

/**
 * Schramm's honey yield, and the mead-making practice the must arithmetic serves.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const SCHRAMM_COMPLEAT_MEADMAKER_2003: Source = {
  title: 'The Compleat Meadmaker',
  author: 'Ken Schramm, Brewers Publications',
  year: 2003,
};

/**
 * TOSNA, as its author publishes it.
 *
 * It's a calculator and not a paper, so it's cited as one. The `url` is the
 * page that prints the formula, the nitrogen-requirement factors and the four
 * addition points. `/tosna` returns 404 (as of this writing) and
 * `/tosna-calculator` is the tool itself, which doesn't state any of the
 * coefficients. Per the rule at the top of this file, the link goes where the
 * work is.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const MOUTELA_TOSNA: Source = {
  title: 'Nutrient Additions: TOSNA, the Tailored Organic Staggered Nutrient Addition',
  author: 'Sergio Moutela (Mead Made Right)',
  url: 'https://www.meadmaderight.com/nutrient-additions',
};

/**
 * The SO₂ dissociation constant and the molecular-SO₂ argument behind the sulfite dose.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const BOULTON_WINEMAKING_1996: Source = {
  title: 'Principles and Practices of Winemaking',
  author: 'Roger B. Boulton, Vernon L. Singleton, Linda F. Bisson & Ralph E. Kunkee',
  year: 1996,
};

/**
 * Lea on cider pH, and why sulfite alone stops working above 3.8.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const LEA_CRAFT_CIDER_2008: Source = {
  title: 'Craft Cider Making',
  author: 'Andrew Lea',
  year: 2008,
};

/**
 * Peynaud's sorbic-acid-by-alcohol table.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const PEYNAUD_KNOWING_WINE_1984: Source = {
  title: 'Knowing and Making Wine',
  author: 'Émile Peynaud',
  year: 1984,
};

/**
 * The acid equivalent weights, and TA expressed as tartaric.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const ILAND_GRAPES_AND_WINE_2004: Source = {
  title: 'Chemical Analysis of Grapes and Wine: Techniques and Concepts',
  author: 'Patrick Iland, Nick Bruer, Greg Edwards, Sue Weeks & Eric Wilkes',
  year: 2004,
};

/**
 * Margalit, for the Pearson square as winemaking states it.
 *
 * @category Explanations and sources
 * @group Constants and defaults
 */
export const MARGALIT_WINE_CHEMISTRY_2004: Source = {
  title: 'Concepts in Wine Chemistry',
  author: 'Yair Margalit',
  year: 2004,
};
