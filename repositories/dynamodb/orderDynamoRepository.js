const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const BaseDynamoRepository = require('./baseDynamoRepository');
const ENTITY = require('../entityTypes');
const databaseConfig = require('../../config/dataStore');
const productDynamoRepository = require('./productDynamoRepository');
const { validateDistinctCustomerAndWitness } = require('../../utils/installmentValidation');
const customerDynamoRepository = require('./customerDynamoRepository');
const witnessDynamoRepository = require('./witnessDynamoRepository');
const installmentPlanDynamoRepository = require('./installmentPlanDynamoRepository');
const installmentPaymentDynamoRepository = require('./installmentPaymentDynamoRepository');
const installmentSettingDynamoRepository = require('./installmentSettingDynamoRepository');
const { resolveOrderNumber } = require('../../utils/orderId');

class OrderDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.ORDER);
  }

  _inRange(saleDate, range) {
    const d = new Date(saleDate);
    const now = new Date();
    if (range === 'week' || range === '1W') return d >= new Date(now.getTime() - 7 * 86400000);
    if (range === 'month' || range === '1M') return d >= new Date(now.getFullYear(), now.getMonth(), 1);
    if (range === '3M') return d >= new Date(now.getFullYear(), now.getMonth() - 3, 1);
    if (range === '6M') return d >= new Date(now.getFullYear(), now.getMonth() - 6, 1);
    return d >= new Date(now.getFullYear() - 1, now.getMonth(), 1);
  }

  _today(saleDate) {
    const d = new Date(saleDate);
    const n = new Date();
    return d.toDateString() === n.toDateString();
  }

  async getAll(tenantId) {
    return this.queryByTenant(tenantId, {
      sort: (a, b) => new Date(b.sale_date) - new Date(a.sale_date),
    });
  }

  async getToday(tenantId, tellerId, isAdmin) {
    const all = await this.getAll(tenantId);
    return all.filter(
      (s) =>
        this._today(s.sale_date) &&
        (isAdmin || String(s.teller_id) === String(tellerId))
    );
  }

  async getRecent(tenantId, tellerId, isAdmin, days = 7) {
    const all = await this.getAll(tenantId);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (Math.max(1, Number(days) || 7) - 1));
    return all.filter((s) => {
      const d = new Date(s.sale_date);
      return d >= cutoff && (isAdmin || String(s.teller_id) === String(tellerId));
    });
  }

  async getByDateRange(tenantId, startDate, endDate) {
    const all = await this.getAll(tenantId);
    const start = new Date(startDate);
    const end = new Date(endDate);
    return all.filter((s) => {
      const d = new Date(s.sale_date);
      return d >= start && d <= end;
    });
  }

  async processCashSale(tenantId, user, { itemId, quantity, orderNumber }) {
    const item = await productDynamoRepository.getById(tenantId, itemId);
    if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
    if ((item.quantity ?? 0) < quantity) {
      throw Object.assign(new Error('Insufficient stock'), { status: 400, available: item.quantity });
    }

    const saleId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const total = item.selling_price * quantity;
    const profit = (item.selling_price - item.buying_price) * quantity;
    const saleDate = new Date().toISOString();
    const resolvedOrderNumber = resolveOrderNumber(orderNumber, saleId);
    const saleItem = this.toRecord(tenantId, saleId, {
      item_id: String(itemId),
      item_name: item.name,
      quantity,
      buying_price: item.buying_price,
      selling_price: item.selling_price,
      price: item.price,
      total,
      profit,
      payment_type: 'cash',
      order_number: resolvedOrderNumber,
      teller_id: user.id,
      teller_name: user.username,
      sale_date: saleDate,
      tenant_id: tenantId,
    });

    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: databaseConfig.dynamodb.tableName,
              Item: saleItem,
            },
          },
          {
            Update: {
              TableName: databaseConfig.dynamodb.tableName,
              Key: {
                PK: productDynamoRepository.pk(tenantId),
                SK: productDynamoRepository.sk(itemId),
              },
              UpdateExpression: 'SET quantity = quantity - :qty, updatedAt = :now',
              ConditionExpression: 'quantity >= :qty',
              ExpressionAttributeValues: {
                ':qty': quantity,
                ':now': saleDate,
              },
            },
          },
        ],
      })
    );

    return this.fromRecord(saleItem);
  }

  async processInstallmentSale(tenantId, user, payload, saveImage) {
    const { itemId, quantity, customer, witness, downPayment, installmentMonths, orderNumber } = payload;
    const includeWitness = payload.includeWitness !== false && Boolean(witness);
    if (includeWitness) {
      const witnessError = validateDistinctCustomerAndWitness(customer, witness);
      if (witnessError) {
        throw Object.assign(new Error(witnessError), { status: 400 });
      }
    }

    const item = await productDynamoRepository.getById(tenantId, itemId);
    if (!item) throw Object.assign(new Error('Item not found'), { status: 404 });
    if ((item.quantity ?? 0) < quantity) {
      throw Object.assign(new Error('Insufficient stock'), { status: 400, available: item.quantity });
    }

    const totalAmount = item.selling_price * quantity;
    if (downPayment >= totalAmount) {
      throw Object.assign(new Error('Down payment must be less than total amount'), { status: 400 });
    }

    const settings = await installmentSettingDynamoRepository.getByMonths(tenantId, installmentMonths);
    if (!settings) throw Object.assign(new Error('Invalid installment months'), { status: 400 });

    const remainingAmount = totalAmount - downPayment;
    const interestAmount = (remainingAmount * settings.interest_rate) / 100;
    const totalWithInterest = remainingAmount + interestAmount;
    const monthlyPayment = totalWithInterest / installmentMonths;
    const profit = (item.selling_price - item.buying_price) * quantity;

    let customerIdImage = null;
    if (customer.idImage) {
      const customerFilename = `customer_${Date.now()}_${customer.idCardNo}.jpg`;
      customerIdImage = saveImage(customer.idImage, 'customers', customerFilename);
    }

    let existingCustomer = await customerDynamoRepository.getByIdCardNo(tenantId, customer.idCardNo);
    let customerId;
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const created = await customerDynamoRepository.create(tenantId, {
        ...customer,
        idCardNo: customer.idCardNo,
        idImagePath: customerIdImage,
      });
      customerId = created.id;
    }

    let witnessId = null;
    if (includeWitness && witness) {
      let witnessIdImage = null;
      if (witness.idImage) {
        const witnessFilename = `witness_${Date.now()}_${witness.idCardNo}.jpg`;
        witnessIdImage = saveImage(witness.idImage, 'witnesses', witnessFilename);
      }

      const createdWitness = await witnessDynamoRepository.create(tenantId, {
        ...witness,
        idImagePath: witnessIdImage,
      });
      witnessId = createdWitness.id;
    }

    const saleId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const saleDate = new Date().toISOString();
    const resolvedOrderNumber = resolveOrderNumber(orderNumber, saleId);
    const sale = await this.put(tenantId, saleId, {
      item_id: String(itemId),
      item_name: item.name,
      quantity,
      buying_price: item.buying_price,
      selling_price: item.selling_price,
      price: item.price,
      total: totalAmount,
      profit,
      payment_type: 'installment',
      order_number: resolvedOrderNumber,
      customer_id: customerId,
      teller_id: user.id,
      teller_name: user.username,
      sale_date: saleDate,
    });

    const plan = await installmentPlanDynamoRepository.create(tenantId, {
      sale_id: saleId,
      order_number: resolvedOrderNumber,
      customer_id: customerId,
      witness_id: witnessId,
      total_amount: totalAmount,
      down_payment: downPayment,
      remaining_amount: remainingAmount,
      interest_rate: settings.interest_rate,
      interest_amount: interestAmount,
      total_with_interest: totalWithInterest,
      installment_months: installmentMonths,
      monthly_payment: monthlyPayment,
    });

    const payments = [];
    const startDate = new Date();
    for (let i = 1; i <= installmentMonths; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      const payment = await installmentPaymentDynamoRepository.create(tenantId, {
        installment_plan_id: plan.id,
        payment_number: i,
        amount_due: monthlyPayment,
        due_date: dueDate.toISOString().split('T')[0],
      });
      payments.push(payment);
    }

    await productDynamoRepository.decrementQuantity(tenantId, itemId, quantity);

    return { sale, plan, payments };
  }

  _isCashSale(sale) {
    return (sale.payment_type || 'cash') === 'cash';
  }

  async _buildIncomeSummary(tenantId, dateFilter, tellerId, isAdmin = true) {
    const [allSales, plans, payments] = await Promise.all([
      this.getAll(tenantId),
      installmentPlanDynamoRepository.queryByTenant(tenantId),
      installmentPaymentDynamoRepository.getAll(tenantId),
    ]);

    const matchesTeller = (sale) => isAdmin || String(sale.teller_id) === String(tellerId);
    const salesInPeriod = allSales.filter((s) => dateFilter(s.sale_date) && matchesTeller(s));
    const cashSales = salesInPeriod.filter((s) => this._isCashSale(s));
    const tellerSaleIds = new Set(allSales.filter(matchesTeller).map((s) => String(s.id)));

    const downPaymentIncome = plans.reduce((sum, plan) => {
      if (!dateFilter(plan.created_at || plan.createdAt)) return sum;
      if (!isAdmin && !tellerSaleIds.has(String(plan.sale_id))) return sum;
      return sum + (Number(plan.down_payment) || 0);
    }, 0);

    const planById = new Map(plans.map((p) => [String(p.id), p]));
    const installmentIncome = payments.reduce((sum, payment) => {
      if (payment.status !== 'paid' || !dateFilter(payment.paid_date)) return sum;
      if (!isAdmin) {
        const plan = planById.get(String(payment.installment_plan_id));
        if (!plan || !tellerSaleIds.has(String(plan.sale_id))) return sum;
      }
      return sum + (Number(payment.amount_paid) || 0);
    }, 0);

    const cashRevenue = cashSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);

    return {
      total_sales: cashSales.length,
      total_revenue: cashRevenue,
      total_items_sold: salesInPeriod.reduce((sum, sale) => sum + (sale.quantity || 0), 0),
      total_profit: cashSales.reduce((sum, sale) => sum + (Number(sale.profit) || 0), 0),
      down_payment_income: downPaymentIncome,
      installment_income: installmentIncome,
      total_actual_income: cashRevenue + downPaymentIncome + installmentIncome,
    };
  }

  async getTopProducts(tenantId, range, limit) {
    const all = await this.getAll(tenantId);
    const filtered = all.filter((s) => this._inRange(s.sale_date, range));
    const map = {};
    filtered.forEach((s) => {
      if (!map[s.item_name]) map[s.item_name] = { name: s.item_name, qty: 0, total_sales: 0, sale_count: 0 };
      map[s.item_name].qty += s.quantity || 0;
      map[s.item_name].total_sales += s.total || 0;
      map[s.item_name].sale_count += 1;
    });
    return Object.values(map)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);
  }

  async getDailySummary(tenantId, tellerId, isAdmin) {
    return this._buildIncomeSummary(tenantId, (d) => this._today(d), tellerId, isAdmin);
  }

  async getWeeklySummary(tenantId, tellerId, isAdmin) {
    return this._buildIncomeSummary(tenantId, (d) => this._inRange(d, 'week'), tellerId, isAdmin);
  }

  async getMonthlySummary(tenantId, tellerId, isAdmin) {
    return this._buildIncomeSummary(tenantId, (d) => this._inRange(d, 'month'), tellerId, isAdmin);
  }

  async getOverallSummary(tenantId) {
    return this._buildIncomeSummary(tenantId, () => true, null, true);
  }

  async getSummaryByRange(tenantId, range) {
    return this._buildIncomeSummary(tenantId, (d) => this._inRange(d, range), null, true);
  }

  async getSalesTrend(tenantId, range) {
    const all = await this.getAll(tenantId);
    const buckets = {};
    all.filter((s) => this._inRange(s.sale_date, range)).forEach((s) => {
      const d = new Date(s.sale_date);
      const key =
        range === '1W' ? d.toISOString().slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets[key]) buckets[key] = { period: key, revenue: 0, profit: 0, sales: 0 };
      buckets[key].revenue += s.total || 0;
      buckets[key].profit += s.profit || 0;
      buckets[key].sales += 1;
    });
    return Object.values(buckets);
  }
}

module.exports = new OrderDynamoRepository();
