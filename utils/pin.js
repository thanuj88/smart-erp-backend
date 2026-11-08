const PIN_MIN_LENGTH = 6;
const PIN_MAX_LENGTH = 8;

/**
 * Rules for a PIN that is being set or changed. Existing shorter PINs still sign in; they simply
 * cannot be created again. Returns a message, or null when the PIN is acceptable.
 */
function pinProblem(pin) {
  if (typeof pin !== 'string' && typeof pin !== 'number') return 'PIN must be digits only';
  const value = String(pin);
  if (!/^\d+$/.test(value)) return 'PIN must be digits only';
  if (value.length < PIN_MIN_LENGTH || value.length > PIN_MAX_LENGTH) {
    return `PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`;
  }
  if (/^(\d)\1+$/.test(value)) return 'PIN is too easy to guess (repeated digit)';
  const digits = [...value].map(Number);
  const step = digits[1] - digits[0];
  const isSequence = Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step);
  if (isSequence) return 'PIN is too easy to guess (sequence)';
  return null;
}

module.exports = { PIN_MIN_LENGTH, PIN_MAX_LENGTH, pinProblem };
