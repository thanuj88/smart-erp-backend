const { saveImage } = require('../utils/saveImage');

const PAPER_SIZES = ['58mm', '80mm', '112mm', 'A5', 'A4'];
const DEFAULT_PAPER_SIZE = '80mm';

const DEFAULT_RECEIPT = {
  logo: null,
  slogan: "We're here to help.",
  registrationNumber: '',
  address: '',
  email: '',
  website: '',
  phone: '',
  headerMessage: '',
  invoiceTitle: 'Tax Invoice / Receipt',
  returnPolicy: 'A receipt or proof of purchase must accompany goods for exchange.',
  footer: 'Thank you for shopping with us!',
  paperSize: DEFAULT_PAPER_SIZE,
  showQrCode: true,
  showVoucher: false,
  voucherTitle: 'Our Gift To You...',
  voucherOfferType: 'percent',
  voucherOfferValue: '10',
  voucherOfferText: 'off your next purchase with us.',
  voucherLoyaltyText: 'Double your reward and join our loyalty club today.',
  voucherTerms:
    'Cannot be redeemed for layby items. One voucher per transaction. Not redeemable for cash.',
};

const STRING_KEYS = [
  'slogan',
  'registrationNumber',
  'address',
  'email',
  'website',
  'phone',
  'headerMessage',
  'invoiceTitle',
  'returnPolicy',
  'footer',
  'voucherTitle',
  'voucherOfferValue',
  'voucherOfferText',
  'voucherLoyaltyText',
  'voucherTerms',
];

const BOOL_KEYS = ['showQrCode', 'showVoucher'];
const MAX_LEN = 400;

const LOGO_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const LOGO_MAX_BYTES = 1024 * 1024;

function clampText(value, fallback) {
  const text = value == null ? fallback : String(value);
  return text.slice(0, MAX_LEN);
}

function saveReceiptLogo(dataUrl, tenantId) {
  const match = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match || !LOGO_TYPES[match[1]]) {
    throw Object.assign(new Error('Logo must be a PNG, JPG, or WebP image.'), { status: 400 });
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > LOGO_MAX_BYTES) {
    throw Object.assign(new Error('Logo must be 1MB or smaller.'), { status: 400 });
  }
  return saveImage(dataUrl, 'receipts', `logo_${tenantId}_${Date.now()}.${LOGO_TYPES[match[1]]}`);
}

function normalizeReceipt(raw = {}, footerFallback) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const receipt = {
    logo: source.logo || source.receipt_logo || DEFAULT_RECEIPT.logo,
    paperSize: PAPER_SIZES.includes(source.paperSize) ? source.paperSize : DEFAULT_PAPER_SIZE,
    voucherOfferType: source.voucherOfferType === 'value' ? 'value' : 'percent',
    showQrCode:
      source.showQrCode != null
        ? Boolean(source.showQrCode)
        : source.showBarcode != null
          ? Boolean(source.showBarcode)
          : DEFAULT_RECEIPT.showQrCode,
    showVoucher:
      source.showVoucher != null ? Boolean(source.showVoucher) : DEFAULT_RECEIPT.showVoucher,
  };

  STRING_KEYS.forEach((key) => {
    const fallback = key === 'footer' && footerFallback != null ? footerFallback : DEFAULT_RECEIPT[key];
    receipt[key] = clampText(source[key], fallback);
  });

  if (!receipt.logo) receipt.logo = null;
  return receipt;
}

function mergeReceipt(currentReceipt, payload = {}) {
  const incoming = payload.receipt && typeof payload.receipt === 'object' ? payload.receipt : {};
  const next = { ...currentReceipt };

  STRING_KEYS.forEach((key) => {
    if (incoming[key] != null) next[key] = clampText(incoming[key], '');
  });
  BOOL_KEYS.forEach((key) => {
    if (incoming[key] != null) next[key] = Boolean(incoming[key]);
  });

  if (incoming.paperSize != null) {
    next.paperSize = PAPER_SIZES.includes(String(incoming.paperSize))
      ? String(incoming.paperSize)
      : DEFAULT_PAPER_SIZE;
  }

  if (incoming.voucherOfferType != null) {
    next.voucherOfferType = incoming.voucherOfferType === 'value' ? 'value' : 'percent';
  }

  if (payload.receiptFooter != null && incoming.footer == null) {
    next.footer = clampText(payload.receiptFooter, currentReceipt.footer);
  }

  if (incoming.showQrCode == null && incoming.showBarcode != null) {
    next.showQrCode = Boolean(incoming.showBarcode);
  }

  delete next.fax;
  delete next.showBarcode;
  return next;
}

module.exports = {
  DEFAULT_RECEIPT,
  STRING_KEYS,
  BOOL_KEYS,
  normalizeReceipt,
  mergeReceipt,
  saveReceiptLogo,
};
