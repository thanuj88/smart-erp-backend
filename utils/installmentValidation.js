function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeId(value) {
  return String(value || '').trim().replace(/[\s-]/g, '').toUpperCase();
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
  getCustomerWitnessDuplicates,
  validateDistinctCustomerAndWitness,
};
