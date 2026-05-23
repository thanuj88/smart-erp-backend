const express = require('express');
const router = express.Router();
const rbacController = require('../controllers/rbacController');
const platformController = require('../controllers/platformController');
const { authenticate } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { PERMISSIONS } = require('../config/permissions');

const platform = [
  PERMISSIONS.PLATFORM_MANAGE,
  PERMISSIONS.TENANTS_VIEW,
  PERMISSIONS.TENANTS_MANAGE,
  PERMISSIONS.ROLES_MANAGE,
];

router.use(authenticate);

// Reports & dashboard
router.get('/reports', requirePermission(...platform), platformController.getReports);

// Tenants
router.get('/tenants', requirePermission(PERMISSIONS.TENANTS_VIEW, PERMISSIONS.PLATFORM_MANAGE), platformController.listTenants);
router.get('/tenants/:id', requirePermission(PERMISSIONS.TENANTS_VIEW, PERMISSIONS.PLATFORM_MANAGE), platformController.getTenant);
router.post('/tenants', requirePermission(PERMISSIONS.TENANTS_MANAGE), platformController.createTenant);
router.put('/tenants/:id/plan', requirePermission(PERMISSIONS.TENANTS_MANAGE), platformController.assignTenantPlan);
router.patch('/tenants/:id/status', requirePermission(PERMISSIONS.TENANTS_MANAGE), platformController.updateTenantStatus);

// SaaS plans
router.get('/plans', requirePermission(...platform), platformController.listPlans);
router.post('/plans', requirePermission(PERMISSIONS.PLATFORM_MANAGE), platformController.createPlan);
router.put('/plans/:code', requirePermission(PERMISSIONS.PLATFORM_MANAGE), platformController.updatePlan);

// Platform users (all tenants)
router.get('/users', requirePermission(PERMISSIONS.PLATFORM_MANAGE, PERMISSIONS.USERS_MANAGE), platformController.listUsers);
router.post('/users', requirePermission(PERMISSIONS.PLATFORM_MANAGE), platformController.createUser);
router.put('/users/:id', requirePermission(PERMISSIONS.PLATFORM_MANAGE), platformController.updateUser);

// Roles & capabilities (RBAC)
router.get('/permissions', requirePermission(PERMISSIONS.ROLES_MANAGE, PERMISSIONS.PLATFORM_MANAGE), rbacController.listPermissions);
router.post('/permissions', requirePermission(PERMISSIONS.ROLES_MANAGE), rbacController.createPermission);
router.get('/roles', requirePermission(PERMISSIONS.ROLES_MANAGE, PERMISSIONS.PLATFORM_MANAGE), rbacController.listRoles);
router.post('/roles', requirePermission(PERMISSIONS.ROLES_MANAGE), rbacController.createRole);
router.get('/roles/:code', requirePermission(PERMISSIONS.ROLES_MANAGE, PERMISSIONS.PLATFORM_MANAGE), rbacController.getRolePermissions);
router.put('/roles/:code/permissions', requirePermission(PERMISSIONS.ROLES_MANAGE), rbacController.updateRolePermissions);

module.exports = router;
