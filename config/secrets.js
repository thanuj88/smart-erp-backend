/**
 * Refuse to run a real deployment on demo secrets.
 *
 * "Local" means NODE_ENV is development or test. Anything else (production, staging, unset)
 * is treated as deployed, the same rule the captcha and dev-token switches use.
 * Anyone who knows the JWT secret can mint SUPER_ADMIN tokens, so a placeholder there is a
 * full takeover, not a cosmetic warning.
 */

const MIN_SECRET_LENGTH = 32;
const MIN_ADMIN_PASSWORD_LENGTH = 12;
const DEFAULT_SUPER_ADMIN_PASSWORD = 'superadmin123';

const PLACEHOLDER_PATTERN = /(change[_-]?(this|me|it)|default_secret|your[_-]|placeholder|example|replace[_-]?me|todo)/i;

function isLocalEnvironment(env = process.env) {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

function isWeakSecret(value) {
  const secret = String(value || '');
  return secret.length < MIN_SECRET_LENGTH || PLACEHOLDER_PATTERN.test(secret);
}

function isStrongAdminPassword(value) {
  const password = String(value || '');
  return password.length >= MIN_ADMIN_PASSWORD_LENGTH && password !== DEFAULT_SUPER_ADMIN_PASSWORD;
}

/** Returns a list of problems. Empty means this environment is safe to start. */
function findSecretProblems(env = process.env) {
  if (isLocalEnvironment(env)) return [];

  const problems = [];
  if (isWeakSecret(env.JWT_SECRET)) {
    problems.push(
      `JWT_SECRET must be set to a unique random value of at least ${MIN_SECRET_LENGTH} characters (not a placeholder).`
    );
  }
  if (!env.JWT_REFRESH_SECRET || isWeakSecret(env.JWT_REFRESH_SECRET)) {
    problems.push(
      `JWT_REFRESH_SECRET must be set to its own unique random value of at least ${MIN_SECRET_LENGTH} characters (not a placeholder).`
    );
  } else if (env.JWT_REFRESH_SECRET === env.JWT_SECRET) {
    problems.push('JWT_REFRESH_SECRET must differ from JWT_SECRET.');
  }
  return problems;
}

function assertSecureConfig(env = process.env) {
  const problems = findSecretProblems(env);
  if (!problems.length) return;
  const shown = env.NODE_ENV === undefined ? '(unset)' : JSON.stringify(env.NODE_ENV);
  throw new Error(
    [
      `Refusing to start with NODE_ENV=${shown}: insecure configuration.`,
      ...problems.map((problem) => `  - ${problem}`),
      'Set NODE_ENV=development only for local work.',
    ].join('\n')
  );
}

module.exports = {
  MIN_SECRET_LENGTH,
  DEFAULT_SUPER_ADMIN_PASSWORD,
  isLocalEnvironment,
  isWeakSecret,
  isStrongAdminPassword,
  findSecretProblems,
  assertSecureConfig,
};
