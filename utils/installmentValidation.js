function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeId(value) {
  return String(value || '').trim().replace(/[\s-]/g, '').toUpperCase();
}

const OLD_NIC = /^[0-9]{9}[VX]$/;
const NEW_NIC = /^[0-9]{12}$/;

function normalizeNic(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isValidNic(value) {
  const nic = normalizeNic(value);
  return OLD_NIC.test(nic) || NEW_NIC.test(nic);
}

const NIC_FORMAT_MESSAGE =
  'Enter a valid NIC (901234567V / 901234567X, or 12 digits e.g. 199012345678)';

function validateNicNumbers(customer, witness, { requireWitness = true } = {}) {
  const customerNic = customer?.idCardNo ?? customer?.id_card_no;
  if (!normalizeNic(customerNic)) return 'Customer NIC is required';
  if (!isValidNic(customerNic)) return `Customer: ${NIC_FORMAT_MESSAGE}`;
  if (!requireWitness) return null;
  const witnessNic = witness?.idCardNo ?? witness?.id_card_no;
  if (!normalizeNic(witnessNic)) return 'Witness NIC is required';
  if (!isValidNic(witnessNic)) return `Witness: ${NIC_FORMAT_MESSAGE}`;
  return null;
}

function getCustomerWitnessDuplicates(customer, witness) {
  const duplicates = [];
  const customerName = normalizeName(customer?.name);
  const witnessName = normalizeName(witness?.name);
  if (customerName && witnessName && customerName === witnessName) {
    duplicates.push('name');
  }

  const customerPhone = normalizePhone(customer?.phone);
  const witnessPhone = normalizePhone(witness?.phone);
  if (customerPhone && witnessPhone && customerPhone === witnessPhone) {
    duplicates.push('phone');
  }

  const customerId = normalizeId(customer?.idCardNo ?? customer?.id_card_no);
  const witnessId = normalizeId(witness?.idCardNo ?? witness?.id_card_no);
  if (customerId && witnessId && customerId === witnessId) {
    duplicates.push('id');
  }

  return duplicates;
}

function validateDistinctCustomerAndWitness(customer, witness) {
  const duplicates = getCustomerWitnessDuplicates(customer, witness);
  if (duplicates.length === 0) return null;

  const labels = {
    name: 'name',
    phone: 'phone number',
    id: 'ID number',
  };
  const fields = duplicates.map((field) => labels[field]).join(', ');
  return `Customer and witness cannot use the same ${fields}.`;
}

module.exports = {
  normalizeName,
  normalizePhone,
  normalizeId,
  normalizeNic,
  isValidNic,
  NIC_FORMAT_MESSAGE,
  getCustomerWitnessDuplicates,
  validateDistinctCustomerAndWitness,
  validateNicNumbers,
};
