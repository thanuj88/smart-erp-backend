const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { getDynamoClient } = require('../config/dynamodb');
const databaseConfig = require('../config/dataStore');
const { tenantPk } = require('../utils/tenant');
const authDynamo = require('../repositories/dynamodb/authDynamoRepository');
const {
  CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  getCurrencyByCode,
  parseCurrencyLabel,
} = require('../config/currency');
const { DEFAULT_COUNTRY_CODE, getCountry } = require('../utils/phone');
const { DEFAULT_RECEIPT, normalizeReceipt, mergeReceipt, saveReceiptLogo } = require('../config/receipt');

const SETTINGS_SK = 'SETTINGS';

const DEFAULTS = {
  businessName: '',
  currencyCode: DEFAULT_CURRENCY_CODE,
  currencySymbol: getCurrencyByCode(DEFAULT_CURRENCY_CODE).symbol,
  countryCode: DEFAULT_COUNTRY_CODE,
  taxRate: 0,
  lowStockThreshold: 15,
  receiptFooter: DEFAULT_RECEIPT.footer,
};

function normalizeSettings(item, tenantMeta) {
  const code = item?.currency_code || item?.currencyCode || DEFAULT_CURRENCY_CODE;
  const preset = getCurrencyByCode(code);
  const symbol =
    item?.currency_symbol || item?.currencySymbol || preset.symbol;
  const country = getCountry(
    item?.country_code || item?.countryCode || tenantMeta?.country_code || DEFAULTS.countryCode
  );
  const receipt = normalizeReceipt(
    item?.receipt,
    item?.receipt_footer || item?.receiptFooter || DEFAULTS.receiptFooter
  );

  return {
    businessName: item?.business_name || item?.businessName || tenantMeta?.name || '',
    currencyCode: preset.code,
    currencySymbol: symbol,
    currencyLabel: preset.label,
    countryCode: country.code,
    countryName: country.name,
    countryDialCode: country.dialCode,
    taxRate: Number(item?.tax_rate ?? item?.taxRate ?? DEFAULTS.taxRate),
    lowStockThreshold: Number(
      item?.low_stock_threshold ?? item?.lowStockThreshold ?? DEFAULTS.lowStockThreshold
    ),
    receipt,
    receiptFooter: receipt.footer,
    currency: { code: preset.code, symbol },
  };
}

async function getForTenant(tenantId) {
  if (tenantId == null || tenantId === '') {
    return { ...normalizeSettings(null, null), currency: getCurrencyByCode(DEFAULT_CURRENCY_CODE) };
  }

  const client = getDynamoClient();
  const tenantMeta = await authDynamo.getTenantMeta(tenantId);

  const res = await client.send(
    new GetCommand({
      TableName: databaseConfig.dynamodb.tableName,
      Key: { PK: tenantPk(tenantId), SK: SETTINGS_SK },
    })
  );

  return normalizeSettings(res.Item, tenantMeta);
}

async function updateForTenant(tenantId, payload) {
  if (tenantId == null || tenantId === '') {
    throw Object.assign(new Error('Tenant is required'), { status: 400 });
  }

  const current = await getForTenant(tenantId);
  let currencyCode = current.currencyCode;
  let currencySymbol = current.currencySymbol;

  if (payload.currencyCode) {
    currencyCode = getCurrencyByCode(payload.currencyCode).code;
    currencySymbol = getCurrencyByCode(currencyCode).symbol;
  } else if (payload.currencyLabel) {
    const parsed = parseCurrencyLabel(payload.currencyLabel);
    if (parsed) {
      currencyCode = parsed.code;
      currencySymbol = parsed.symbol;
    }
  }

  if (payload.currencySymbol != null && String(payload.currencySymbol).trim()) {
    currencySymbol = String(payload.currencySymbol).trim();
  }

  let countryCode = current.countryCode;
  if (payload.countryCode != null && String(payload.countryCode).trim()) {
    countryCode = getCountry(String(payload.countryCode).trim()).code;
  }

  const taxRate = payload.taxRate != null ? Number(payload.taxRate) : current.taxRate;
  const lowStockThreshold =
    payload.lowStockThreshold != null
      ? Number(payload.lowStockThreshold)
      : current.lowStockThreshold;

  const receipt = mergeReceipt(current.receipt || DEFAULT_RECEIPT, payload);
  if (payload.removeReceiptLogo) {
    receipt.logo = null;
  } else if (payload.receipt?.logo && String(payload.receipt.logo).startsWith('data:')) {
    receipt.logo = saveReceiptLogo(payload.receipt.logo, tenantId);
  } else {
    receipt.logo = current.receipt?.logo || null;
  }

  const item = {
    PK: tenantPk(tenantId),
    SK: SETTINGS_SK,
    entityType: 'TENANT_SETTINGS',
    tenant_id: String(tenantId),
    business_name:
      payload.businessName != null ? String(payload.businessName).trim() : current.businessName,
    currency_code: currencyCode,
    currency_symbol: currencySymbol,
    country_code: countryCode,
    tax_rate: Number.isFinite(taxRate) ? taxRate : 0,
    low_stock_threshold: Number.isFinite(lowStockThreshold) ? lowStockThreshold : DEFAULTS.lowStockThreshold,
    receipt,
    receipt_footer: receipt.footer,
    updatedAt: new Date().toISOString(),
  };

  await getDynamoClient().send(
    new PutCommand({
      TableName: databaseConfig.dynamodb.tableName,
      Item: item,
    })
  );

  const nextName = item.business_name;
  if (payload.businessName != null && nextName) {
    await authDynamo.updateTenantDisplayName(tenantId, nextName);
  }

  return getForTenant(tenantId);
}

module.exports = {
  CURRENCIES,
  getForTenant,
  updateForTenant,
};
