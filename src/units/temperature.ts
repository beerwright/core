/**
 * Temperature conversions.
 *
 * Canonical unit inside the engine: degrees Celsius.
 */

/**
 * Convert degrees Celsius to degrees Fahrenheit.
 *
 * @category Units
 * @group Calculations
 */
export function celsiusToFahrenheit(celsius: number): number {
  return celsius * (9 / 5) + 32;
}

/**
 * Convert degrees Fahrenheit to degrees Celsius.
 *
 * @category Units
 * @group Calculations
 */
export function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) * (5 / 9);
}

/**
 * Convert a temperature *difference* (not an absolute reading) from °C to °F.
 *
 * @category Units
 * @group Calculations
 */
export function celsiusDeltaToFahrenheit(delta: number): number {
  return delta * (9 / 5);
}

/**
 * Convert a temperature *difference* (not an absolute reading) from °F to °C.
 *
 * @category Units
 * @group Calculations
 */
export function fahrenheitDeltaToCelsius(delta: number): number {
  return delta * (5 / 9);
}
