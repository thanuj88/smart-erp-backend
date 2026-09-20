const COUNTRIES = [
  {
    code: 'LK',
    name: 'Sri Lanka',
    dialCode: '94',
    flag: '🇱🇰',
    example: '077 123 4567',
    nsnMin: 9,
    nsnMax: 9,
    nsnPattern: /^(?:7\d{8}|[1-9]\d{8})$/,
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    dialCode: '44',
    flag: '🇬🇧',
    example: '07700 900000',
    nsnMin: 10,
    nsnMax: 10,
    nsnPattern: /^7\d{9}$/,
  },
  {
    code: 'DE',
    name: 'Germany',
    dialCode: '49',
    flag: '🇩🇪',
    example: '01512 3456789',
    nsnMin: 10,
    nsnMax: 11,
  },
  {
    code: 'FR',
    name: 'France',
    dialCode: '33',
    flag: '🇫🇷',
    example: '06 12 34 56 78',
    nsnMin: 9,
    nsnMax: 9,
    nsnPattern: /^[67]\d{8}$/,
  },
  {
    code: 'IT',
    name: 'Italy',
    dialCode: '39',
    flag: '🇮🇹',
    example: '312 345 6789',
    nsnMin: 9,
    nsnMax: 10,
  },
  {
    code: 'ES',
    name: 'Spain',
    dialCode: '34',
    flag: '🇪🇸',
    example: '612 345 678',
    nsnMin: 9,
    nsnMax: 9,
    nsnPattern: /^[67]\d{8}$/,
  },
  {
    code: 'NL',
    name: 'Netherlands',
    dialCode: '31',
    flag: '🇳🇱',
    example: '06 12345678',
    nsnMin: 9,
    nsnMax: 9,
    nsnPattern: /^6\d{8}$/,
  },
  {
    code: 'BE',
    name: 'Belgium',
    dialCode: '32',
    flag: '🇧🇪',
    example: '0470 12 34 56',
    nsnMin: 8,
    nsnMax: 9,
  },
  {
    code: 'PT',
    name: 'Portugal',
    dialCode: '351',
    flag: '🇵🇹',
    example: '912 345 678',
    nsnMin: 9,
    nsnMax: 9,
    nsnPattern: /^9\d{8}$/,
  },
  {
    code: 'IE',
    name: 'Ireland',
    dialCode: '353',
    flag: '🇮🇪',
    example: '085 123 4567',
    nsnMin: 9,
    nsnMax: 9,
  },
  {
    code: 'AT',
    name: 'Austria',
    dialCode: '43',
    flag: '🇦🇹',
    example: '0664 1234567',
    nsnMin: 10,
    nsnMax: 13,
  },
  {
    code: 'CH',
    name: 'Switzerland',
    dialCode: '41',
    flag: '🇨🇭',
    example: '078 123 45 67',
    nsnMin: 9,
    nsnMax: 9,
  },
  {
    code: 'SE',
    name: 'Sweden',
    dialCode: '46',
    flag: '🇸🇪',
    example: '070 123 45 67',
    nsnMin: 9,
    nsnMax: 10,
  },
  {
    code: 'NO',
    name: 'Norway',
    dialCode: '47',
    flag: '🇳🇴',
    example: '406 12 345',
    nsnMin: 8,
    nsnMax: 8,
  },
  {
    code: 'DK',
    name: 'Denmark',
    dialCode: '45',
    flag: '🇩🇰',
    example: '20 12 34 56',
    nsnMin: 8,
    nsnMax: 8,
  },
  {
    code: 'FI',
    name: 'Finland',
    dialCode: '358',
    flag: '🇫🇮',
    example: '040 123 4567',
    nsnMin: 9,
    nsnMax: 10,
  },
  {
    code: 'PL',
    name: 'Poland',
    dialCode: '48',
    flag: '🇵🇱',
    example: '512 345 678',
    nsnMin: 9,
    nsnMax: 9,
  },
  {
    code: 'GR',
    name: 'Greece',
    dialCode: '30',
    flag: '🇬🇷',
    example: '691 234 5678',
    nsnMin: 10,
    nsnMax: 10,
  },
  {
    code: 'RO',
    name: 'Romania',
    dialCode: '40',
    flag: '🇷🇴',
    example: '0712 345 678',
    nsnMin: 9,
    nsnMax: 9,
  },
];

const DEFAULT_COUNTRY_CODE = 'LK';

function getCountry(code) {
  return COUNTRIES.find((c) => c.code === code) || COUNTRIES.find((c) => c.code === DEFAULT_COUNTRY_CODE);
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function toNationalNumber(phone, country) {
  let digits = digitsOnly(phone);
  if (!digits) return '';
  if (digits.startsWith(country.dialCode)) {
    digits = digits.slice(country.dialCode.length);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

function sanitizePhoneInput(value, country) {
  const cleaned = String(value || '').replace(/[^\d+\s-]/g, '');
  const max = country.nsnMax + 1 + country.dialCode.length;
  return cleaned.slice(0, max + 4);
}

function isValidPhoneForCountry(phone, countryCode) {
  const country = getCountry(countryCode);
  if (!country) return false;
  const nsn = toNationalNumber(phone, country);
  if (nsn.length < country.nsnMin || nsn.length > country.nsnMax) return false;
  if (country.nsnPattern && !country.nsnPattern.test(nsn)) return false;
  return true;
}

function phoneValidationMessage(phone, countryCode) {
  const country = getCountry(countryCode);
  const trimmed = String(phone || '').trim();
  if (!trimmed) return 'Phone number is required.';
  if (!isValidPhoneForCountry(phone, country.code)) {
    return `Enter a valid ${country.name} phone number (e.g. ${country.example}).`;
  }
  return null;
}

function toE164(phone, countryCode) {
  const country = getCountry(countryCode);
  const nsn = toNationalNumber(phone, country);
  if (!nsn) return '';
  return `+${country.dialCode}${nsn}`;
}

/** Digit key for matching members without requiring a country code. */
function memberPhoneKey(phone, countryCode) {
  const country = getCountry(countryCode);
  return toNationalNumber(phone, country);
}

function sanitizeLocalPhoneInput(value, countryCode) {
  const country = getCountry(countryCode);
  const cleaned = String(value || '').replace(/[^\d\s-]/g, '');
  const maxDigits = (country.nsnMax || 10) + 1;
  let digits = 0;
  let out = '';
  for (const ch of cleaned) {
    if (/\d/.test(ch)) {
      if (digits >= maxDigits) continue;
      digits += 1;
    }
    out += ch;
  }
  return out;
}

module.exports = {
  COUNTRIES,
  DEFAULT_COUNTRY_CODE,
  getCountry,
  digitsOnly,
  toNationalNumber,
  sanitizePhoneInput,
  sanitizeLocalPhoneInput,
  isValidPhoneForCountry,
  phoneValidationMessage,
  toE164,
  memberPhoneKey,
};
