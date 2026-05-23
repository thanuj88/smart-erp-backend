const bcrypt = require('bcryptjs');
const { getAuthRepository } = require('../repositories/factory');
const authConfig = require('../config/auth');
const { ROLES, normalizeRole } = require('../config/permissions');
const permissionService = require('../services/permissionService');
const { logAuthEvent } = require('../services/auditService');
const tokenService = require('../services/tokenService');
const { verifyCaptcha } = require('../utils/captcha');

function clientMeta(req) {
  return {
    ipAddress: req.ip || req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent'],
    deviceName: req.body.deviceName || req.headers['x-device-name'],
    deviceInfo: req.body.deviceInfo,
  };
}

async function formatUserResponse(user, trialEndsAt) {
  const role = normalizeRole(user.role);
  const permissions = await permissionService.getPermissionsForRole(role);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    role,
    tenantId: user.tenant_id,
    branchId: user.branch_id,
    permissions,
    trialEndsAt: trialEndsAt || null,
  };
}

async function issueTokenPair(user, req, trialEndsAt) {
  const role = normalizeRole(user.role);
  const permissions = await permissionService.getPermissionsForRole(role);
  const accessToken = tokenService.signAccessToken(user, trialEndsAt, permissions);
  const refreshToken = tokenService.signRefreshToken(user);
  await tokenService.storeRefreshToken(user.id, refreshToken, clientMeta(req));
  return { accessToken, refreshToken };
}

async function assertAccountActive(user, tenantId) {
  if (user.deleted_at) {
    return 'Account not found';
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return 'Account temporarily locked. Try again later.';
  }
  if (user.role !== ROLES.SUPER_ADMIN) {
    const isActive =
      user.is_active === 1 || user.is_active === true || user.is_active === '1';
    if (!isActive || !user.email_verified_at) {
      return 'Please verify your email before signing in.';
    }
    if (tenantId && (await getAuthRepository().isTrialExpired(tenantId))) {
      return 'Your free trial has expired. Please upgrade your subscription.';
    }
  }
  return null;
}

const register = async (req, res) => {
  try {
    const { email, password, fullName, businessName, username, captchaToken } = req.body;

    if (!email || !password || !fullName || !businessName) {
      return res.status(400).json({ error: 'Email, password, full name, and business name are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const captchaOk = await verifyCaptcha(captchaToken);
    if (!captchaOk) {
      return res.status(400).json({ error: 'CAPTCHA verification failed' });
    }

    const loginName = username || email.split('@')[0];
    const existingEmail = await getAuthRepository().findUserByUsernameOrEmail(email);
    const existingUser = await getAuthRepository().findUserByUsernameOrEmail(loginName);
    if (existingEmail || existingUser) {
      return res.status(409).json({ error: 'An account with this email or username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, authConfig.bcryptRounds);
    const { userId, tenantId, trialEndsAt } = await getAuthRepository().registerTenantOwner({
      businessName,
      fullName,
      email,
      username: loginName,
      passwordHash,
    });

    const rawVerifyToken = tokenService.generateSecureToken();
    await getAuthRepository().createVerificationToken(userId, rawVerifyToken, tenantId);

    await logAuthEvent({
      tenantId: null,
      userId,
      eventType: 'REGISTER',
      eventData: { email },
      ...clientMeta(req),
    });

    const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/verify-email?token=${rawVerifyToken}`;
    if (authConfig.exposeDevTokens) {
      console.log(`[DEV] Email verification link: ${verifyUrl}`);
    }

    res.status(201).json({
      message: 'Registration successful. Please verify your email to activate your account.',
      ...(authConfig.exposeDevTokens ? { verificationToken: rawVerifyToken, verifyUrl } : {}),
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const token = req.query.token || req.body.token;
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }
    const row = await getAuthRepository().consumeVerificationToken(token);
    if (!row) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }
    await logAuthEvent({
      userId: row.user_id,
      eventType: 'EMAIL_VERIFIED',
      ...clientMeta(req),
    });
    res.json({ message: 'Email verified successfully. You can now sign in.' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const login = async (req, res) => {
  try {
    const { username, email, password, tenantId } = req.body;
    const identifier = username || email;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    const user = await getAuthRepository().findUserByUsernameOrEmail(identifier, tenantId || null);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const blockReason = await assertAccountActive(user, user.tenant_id);
    if (blockReason) {
      return res.status(403).json({ error: blockReason });
    }

    if (!user.password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      await getAuthRepository().recordFailedLogin(user.id);
      await logAuthEvent({
        tenantId: user.tenant_id,
        userId: user.id,
        eventType: 'LOGIN_FAILED',
        ...clientMeta(req),
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await getAuthRepository().clearFailedLogins(user.id);
    const trial = user.tenant_id ? await getAuthRepository().getTrialForTenant(user.tenant_id) : null;
    const { accessToken, refreshToken } = await issueTokenPair(user, req, trial?.ends_at);

    await logAuthEvent({
      tenantId: user.tenant_id,
      userId: user.id,
      eventType: 'LOGIN_SUCCESS',
      ...clientMeta(req),
    });

    res.json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: await formatUserResponse(user, trial?.ends_at),
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

const loginPin = async (req, res) => {
  try {
    const { username, pin, tenantId, branchId } = req.body;
    if (!username || !pin) {
      return res.status(400).json({ error: 'Username and PIN are required' });
    }

    const user = await getAuthRepository().findUserForPinLogin(username, tenantId, branchId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const blockReason = await assertAccountActive(user, user.tenant_id);
    if (blockReason) {
      return res.status(403).json({ error: blockReason });
    }

    const pinOk = await tokenService.comparePin(pin, user.pin_hash);
    if (!pinOk) {
      await getAuthRepository().recordFailedLogin(user.id);
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    await getAuthRepository().clearFailedLogins(user.id);
    const trial = user.tenant_id ? await getAuthRepository().getTrialForTenant(user.tenant_id) : null;
    const { accessToken, refreshToken } = await issueTokenPair(user, req, trial?.ends_at);

    await logAuthEvent({
      tenantId: user.tenant_id,
      userId: user.id,
      eventType: 'PIN_LOGIN_SUCCESS',
      ...clientMeta(req),
    });

    res.json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: await formatUserResponse(user, trial?.ends_at),
    });
  } catch (error) {
    console.error('PIN login error:', error);
    res.status(500).json({ error: 'Server error during PIN login' });
  }
};

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    let decoded;
    try {
      decoded = tokenService.verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const stored = await tokenService.findRefreshToken(refreshToken);
    if (!stored || stored.user_id !== decoded.sub) {
      return res.status(401).json({ error: 'Refresh token revoked or expired' });
    }

    const user = await getAuthRepository().findUserWithPassword(stored.user_id);
    const blockReason = await assertAccountActive(user, user.tenant_id);
    if (blockReason) {
      return res.status(403).json({ error: blockReason });
    }

    await tokenService.revokeRefreshToken(refreshToken);
    const trial = user.tenant_id ? await getAuthRepository().getTrialForTenant(user.tenant_id) : null;
    const tokens = await issueTokenPair(user, req, trial?.ends_at);

    res.json({
      token: tokens.accessToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: await formatUserResponse(user, trial?.ends_at),
    });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await tokenService.revokeRefreshToken(refreshToken);
    }
    await logAuthEvent({
      tenantId: req.user?.tenantId,
      userId: req.user?.id,
      eventType: 'LOGOUT',
      ...clientMeta(req),
    });
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await getAuthRepository().findUserByUsernameOrEmail(email);
    if (user && user.email) {
      const rawToken = tokenService.generateSecureToken();
      await getAuthRepository().createPasswordResetToken(user.id, rawToken, user.tenant_id);
      const resetUrl = `${process.env.APP_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
      if (authConfig.exposeDevTokens) {
        console.log(`[DEV] Password reset link: ${resetUrl}`);
      }
      await logAuthEvent({
        tenantId: user.tenant_id,
        userId: user.id,
        eventType: 'PASSWORD_RESET_REQUESTED',
        ...clientMeta(req),
      });
    }

    res.json({
      message: 'If an account exists for this email, a reset link has been sent.',
      ...(authConfig.exposeDevTokens && user
        ? { resetToken: 'check server console in development' }
        : {}),
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const row = await getAuthRepository().consumePasswordResetToken(token);
    if (!row) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const hash = await bcrypt.hash(newPassword, authConfig.bcryptRounds);
    await getAuthRepository().updatePassword(row.user_id, hash);

    await logAuthEvent({
      userId: row.user_id,
      eventType: 'PASSWORD_RESET',
      ...clientMeta(req),
    });

    res.json({ message: 'Password reset successfully. You can sign in with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await getAuthRepository().findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const trial = user.tenant_id ? await getAuthRepository().getTrialForTenant(user.tenant_id) : null;
    res.json(await formatUserResponse(user, trial?.ends_at));
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await getAuthRepository().findUserWithPassword(req.user.id);
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, authConfig.bcryptRounds);
    await getAuthRepository().updatePassword(req.user.id, hash);

    await logAuthEvent({
      tenantId: user.tenant_id,
      userId: user.id,
      eventType: 'PASSWORD_CHANGED',
      ...clientMeta(req),
    });

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const listSessions = async (req, res) => {
  try {
    const sessions = await tokenService.listUserSessions(req.user.id);
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const revokeSession = async (req, res) => {
  try {
    await tokenService.revokeRefreshTokenById(req.params.id, req.user.id);
    res.json({ message: 'Session revoked' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const listBranches = async (req, res) => {
  try {
    const tenantId = req.query.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId is required for branch listing' });
    }
    const branches = await getAuthRepository().listBranchesForTenant(tenantId);
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  register,
  verifyEmail,
  login,
  loginPin,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  getProfile,
  changePassword,
  listSessions,
  revokeSession,
  listBranches,
};
