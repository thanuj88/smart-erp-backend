const { getPlatformRepository, getAuthRepository } = require('../repositories/factory');
const staffUserService = require('../services/staffUserService');
const tokenService = require('../services/tokenService');
const { ROLES } = require('../config/permissions');

const listTenants = async (req, res) => {
  try {
    const tenants = await getPlatformRepository().listTenants();
    res.json(tenants);
  } catch (error) {
    console.error('List tenants error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getTenant = async (req, res) => {
  try {
    const tenant = await getPlatformRepository().getTenant(req.params.id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const createTenant = async (req, res) => {
  try {
    const { name, slug, planCode, adminUsername, adminEmail, adminPassword, adminFullName } =
      req.body;
    if (!name || !adminUsername || !adminPassword) {
      return res.status(400).json({
        error: 'name, adminUsername, and adminPassword are required',
      });
    }
    if (adminPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const result = await getPlatformRepository().createTenant({
      name,
      slug,
      planCode: planCode || 'trial',
      adminUsername,
      adminEmail,
      adminPassword,
      adminFullName,
    });
    const tenant = await getPlatformRepository().getTenant(result.tenantId);
    res.status(201).json({ message: 'Tenant created', tenant, ...result });
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(400).json({ error: error.message || 'Server error' });
  }
};

const assignTenantPlan = async (req, res) => {
  try {
    const { planCode } = req.body;
    if (!planCode) return res.status(400).json({ error: 'planCode is required' });
    const tenant = await getPlatformRepository().assignTenantPlan(req.params.id, planCode);
    res.json(tenant);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Server error' });
  }
};

const updateTenantStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const tenant = await getPlatformRepository().updateTenantStatus(req.params.id, status);
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const listPlans = async (req, res) => {
  try {
    res.json(await getPlatformRepository().listPlans());
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const createPlan = async (req, res) => {
  try {
    const {
      code,
      name,
      description,
      priceMonthly,
      maxUsers,
      maxTellers,
      maxManagers,
      maxAccountants,
    } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
    const plan = await getPlatformRepository().createPlan({
      code,
      name,
      description,
      priceMonthly,
      maxUsers,
      maxTellers,
      maxManagers,
      maxAccountants,
    });
    res.status(201).json(plan);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Server error' });
  }
};

const updatePlan = async (req, res) => {
  try {
    const plan = await getPlatformRepository().updatePlan(req.params.code, req.body);
    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const listUsers = async (req, res) => {
  try {
    res.json(await getPlatformRepository().listPlatformUsers());
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

const createUser = async (req, res) => {
  try {
    const { tenantId, username, email, password, role, fullName, branchId, pin } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ error: 'username, password, and role are required' });
    }

    const resolvedTenantId =
      tenantId === '' || tenantId === null || tenantId === undefined ? null : String(tenantId);

    let prepared;
    try {
      prepared = await staffUserService.prepareStaffUserCreate({
        tenantId: resolvedTenantId,
        username,
        role,
      });
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message });
    }

    let pinHash = null;
    if (pin && prepared.normalizedRole === ROLES.TELLER) {
      pinHash = await tokenService.hashPin(pin);
    }

    const user = await getPlatformRepository().createPlatformUser({
      tenantId: prepared.normalizedRole === ROLES.SUPER_ADMIN ? null : prepared.tenantId,
      username: prepared.finalUsername,
      email,
      password,
      role: prepared.normalizedRole,
      fullName,
      branchId,
      pinHash,
    });
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Server error' });
  }
};

const updateUser = async (req, res) => {
  try {
    const { role } = req.body;
    if (role) {
      const existing = await getAuthRepository().findUserById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'User not found' });
      }
      try {
        await staffUserService.assertStaffRoleChange(existing.tenant_id, role, existing.role);
      } catch (err) {
        return res.status(err.statusCode || 403).json({ error: err.message });
      }
    }

    const user = await getPlatformRepository().updatePlatformUser(req.params.id, req.body);
    res.json(user);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Server error' });
  }
};

const getReports = async (req, res) => {
  try {
    res.json(await getPlatformRepository().getReports());
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  listTenants,
  getTenant,
  createTenant,
  assignTenantPlan,
  updateTenantStatus,
  listPlans,
  createPlan,
  updatePlan,
  listUsers,
  createUser,
  updateUser,
  getReports,
};
