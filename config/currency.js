/** Supported store currencies */
const CURRENCIES = {
  USD: { code: 'USD', symbol: '$', label: 'USD ($)' },
  EUR: { code: 'EUR', symbol: '€', label: 'EUR (€)' },
  LKR: { code: 'LKR', symbol: 'Rs', label: 'LKR (Rs)' },
};

const DEFAULT_CURRENCY_CODE = 'USD';

function getCurrencyByCode(code) {
  return CURRENCIES[code] || CURRENCIES[DEFAULT_CURRENCY_CODE];
}

function parseCurrencyLabel(label) {
  if (!label || typeof label !== 'string') return null;
  const upper = label.toUpperCase();
  if (upper.startsWith('USD')) return CURRENCIES.USD;
  if (upper.startsWith('EUR')) return CURRENCIES.EUR;
  if (upper.startsWith('LKR')) return CURRENCIES.LKR;
  return null;
}

module.exports = {
  CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  getCurrencyByCode,
  parseCurrencyLabel,
};
