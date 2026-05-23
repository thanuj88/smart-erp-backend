const productDynamo = require('./dynamodb/productDynamoRepository');
const categoryDynamo = require('./dynamodb/categoryDynamoRepository');
const customerDynamo = require('./dynamodb/customerDynamoRepository');
const orderDynamo = require('./dynamodb/orderDynamoRepository');
const installmentPlanDynamo = require('./dynamodb/installmentPlanDynamoRepository');
const installmentPaymentDynamo = require('./dynamodb/installmentPaymentDynamoRepository');
const installmentSettingDynamo = require('./dynamodb/installmentSettingDynamoRepository');
const authDynamo = require('./dynamodb/authDynamoRepository');
const rbacDynamo = require('./dynamodb/rbacDynamoRepository');
const platformDynamo = require('./dynamodb/platformDynamoRepository');

let authRepositoryInstance;

module.exports = {
  getAuthRepository: () => {
    if (!authRepositoryInstance) authRepositoryInstance = authDynamo;
    return authRepositoryInstance;
  },
  getProductRepository: () => productDynamo,
  getCategoryRepository: () => categoryDynamo,
  getCustomerRepository: () => customerDynamo,
  getOrderRepository: () => orderDynamo,
  getInstallmentPlanRepository: () => installmentPlanDynamo,
  getInstallmentPaymentRepository: () => installmentPaymentDynamo,
  getInstallmentSettingRepository: () => installmentSettingDynamo,
  getRbacRepository: () => rbacDynamo,
  getPlatformRepository: () => platformDynamo,
};
