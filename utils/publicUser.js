const SECRET_USER_FIELDS = ['password', 'password_hash', 'passwordHash', 'pin_hash', 'pinHash'];

function withoutCredentialFields(value) {
  if (Array.isArray(value)) return value.map(withoutCredentialFields);
  if (!value || typeof value !== 'object') return value;
  const safe = { ...value };
  for (const key of SECRET_USER_FIELDS) delete safe[key];
  return safe;
}

module.exports = { withoutCredentialFields };
