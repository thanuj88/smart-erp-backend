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
const returnDynamoRepository = require('./returnDynamoRepository');
const { resolveOrderNumber, normalizeOrderNumber } = require('../../utils/orderId');

const RETURN_TYPES = ['cash', 'defect', 'warranty'];

class OrderDynamoRepository extends BaseDynamoRepository {
  constructor() {
    super(ENTITY.ORDER);
  }

  _inRange(saleDate, range) {
    const d = new Date(saleDate);
    const now = new Date();
    if (range === '1D' || range === 'day') return this._today(saleDate);
    if (range === 'week' || range === '1W') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 6);
      return d >= start;
    }
    if (range === 'month' || range === '1M') return d >= new Date(now.getFullYear(), now.getMonth(), 1);
    if (range === '3M') return d >= new Date(now.getFullYear(), now.getMonth() - 2, 1);
    if (range === '6M') return d >= new Date(now.getFullYear(), now.getMonth() - 5, 1);
    return d >= new Date(now.getFullYear(), now.getMonth() - 11, 1);
  }

  _saleCost(sale) {
    const qty = Number(sale.quantity) || 0;
    const buy = Number(sale.buying_price) || 0;
    if (buy > 0) return buy * qty;
    const total = Number(sale.total) || 0;
    const profit = Number(sale.profit) || 0;
    return Math.max(0, total - profit);
  }

  _saleRevenue(sale) {
    if (this._isReturnSale(sale)) return 0;
    return Number(sale.total) || 0;
  }

  _enumerateTrendBuckets(range) {
    const now = new Date();
    const buckets = [];
    const push = (start, end, label) => {
      buckets.push({ start, end, label, sales: 0, purchase: 0 });
    };

    if (range === '1D') {
      for (let hour = 8; hour <= 19; hour += 1) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour + 1, 0, 0, 0);
        push(start, end, start.toLocaleTimeString(undefined, { hour: 'numeric' }));
      }
      return buckets;
    }

    if (range === '1W') {
      for (let i = 6; i >= 0; i -= 1) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1, 0, 0, 0, 0);
        push(start, end, start.toLocaleDateString(undefined, { weekday: 'short' }));
      }
      return buckets;
    }

    if (range === '1M') {
      const lastDay = now.getDate();
      for (let day = 1; day <= lastDay; day += 1) {
        const start = new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), day + 1, 0, 0, 0, 0);
        push(start, end, String(day));
      }
      return buckets;
    }

    if (range === '3M') {
      const cursor = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0, 0);
      while (cursor <= now) {
        const start = new Date(cursor);
        const end = new Date(cursor);
        end.setDate(end.getDate() + 7);
        push(
          start,
          end,
          start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        );
        cursor.setDate(cursor.getDate() + 7);
      }
      return buckets;
    }

    const monthCount = range === '6M' ? 6 : 12;
    for (let i = monthCount - 1; i >= 0; i -= 1) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1, 0, 0, 0, 0);
      push(start, end, start.toLocaleDateString(undefined, { month: 'short' }));
    }
    return buckets;
  }

  _today(saleDate) {
    const d = new Date(saleDate);
    const n = new Date();
    return d.toDateString() === n.toDateString();
  }

  _categoryFromProduct(product, fallback = {}) {
    return {
      category_id: fallback.category_id || product?.category_id || product?.categoryId || null,
      category_name:
        fallback.category_name ||
        fallback.category ||
        product?.category_name ||
        product?.category ||
        '',
    };
  }

  async getAll(tenantId) {
    const [items, products] = await Promise.all([
      this.queryByTenant(tenantId, {
        sort: (a, b) => new Date(b.sale_date) - new Date(a.sale_date),
      }),
      productDynamoRepository.getAll(tenantId),
    ]);
    const byId = new Map(products.map((product) => [String(product.id), product]));
    return items.map((sale) => {
      if (sale.category_name || sale.category) {
        return { ...sale, category_name: sale.category_name || sale.category || '' };
      }
      const product = sale.item_id ? byId.get(String(sale.item_id)) : null;
      return { ...sale, ...this._categoryFromProduct(product, sale) };
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
      returned_qty: 0,
      ...this._categoryFromProduct(item),
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
      returned_qty: 0,
      ...this._categoryFromProduct(item),
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

  _isReturnSale(sale) {
    return Boolean(sale?.is_return || sale?.return_flag);
  }

  _isCashSale(sale) {
    if (this._isReturnSale(sale)) return false;
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
    const regularSales = salesInPeriod.filter((s) => !this._isReturnSale(s));
    const cashSales = regularSales.filter((s) => this._isCashSale(s));
    const cashReturnTotal = salesInPeriod
      .filter((s) => this._isReturnSale(s))
      .reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    const cashReturnProfit = salesInPeriod
      .filter((s) => this._isReturnSale(s))
      .reduce((sum, sale) => sum + (Number(sale.profit) || 0), 0);
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

    const cashRevenue =
      cashSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0) + cashReturnTotal;
    const totalPurchase = regularSales.reduce((sum, sale) => sum + this._saleCost(sale), 0);

    return {
      total_sales: cashSales.length,
      total_revenue: cashRevenue,
      total_purchase: totalPurchase,
      total_items_sold: regularSales.reduce((sum, sale) => sum + (sale.quantity || 0), 0),
      total_profit:
        cashSales.reduce((sum, sale) => sum + (Number(sale.profit) || 0), 0) + cashReturnProfit,
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
      if (this._isReturnSale(s)) return;
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
    const summary = await this._buildIncomeSummary(tenantId, (d) => this._inRange(d, range), null, true);
    const all = await this.getAll(tenantId);
    const inRange = all.filter((s) => this._inRange(s.sale_date, range) && !this._isReturnSale(s));
    return {
      ...summary,
      total_revenue: inRange.reduce((sum, sale) => sum + this._saleRevenue(sale), 0),
      total_purchase: inRange.reduce((sum, sale) => sum + this._saleCost(sale), 0),
    };
  }

  async getSalesTrend(tenantId, range) {
    const all = await this.getAll(tenantId);
    const buckets = this._enumerateTrendBuckets(range);
    all.forEach((sale) => {
      if (this._isReturnSale(sale)) return;
      const when = new Date(sale.sale_date);
      const bucket = buckets.find((item) => when >= item.start && when < item.end);
      if (!bucket) return;
      bucket.sales += this._saleRevenue(sale);
      bucket.purchase += this._saleCost(sale);
    });
    return buckets.map(({ label, sales, purchase }) => ({ label, sales, purchase }));
  }

  _mapSaleLine(sale) {
    const qty = Number(sale.quantity) || 0;
    const returned = Number(sale.returned_qty) || 0;
    const unit = Number(sale.selling_price ?? sale.price) || 0;
    return {
      ...sale,
      returned_qty: returned,
      returnable_qty: Math.max(0, qty - returned),
      unit_price: unit,
    };
  }

  async findByOrderNumber(tenantId, orderNumber) {
    const normalized = normalizeOrderNumber(orderNumber);
    if (!normalized) return [];
    const all = await this.getAll(tenantId);
    return all.filter((sale) => normalizeOrderNumber(sale.order_number) === normalized);
  }

  async getOrderByNumber(tenantId, orderNumber) {
    const lines = (await this.findByOrderNumber(tenantId, orderNumber))
      .filter((sale) => !this._isReturnSale(sale))
      .map((sale) => this._mapSaleLine(sale));
    if (!lines.length) return null;

    const paymentType = lines[0].payment_type || 'cash';
    let plan = null;
    if (paymentType === 'installment') {
      const normalized = normalizeOrderNumber(orderNumber);
      const plans = await installmentPlanDynamoRepository.queryByTenant(tenantId, {
        filter: (row) => normalizeOrderNumber(row.order_number) === normalized,
      });
      plan = plans[0] || null;
      if (plan) {
        plan = await installmentPlanDynamoRepository.enrich(tenantId, plan);
        plan.payments = await installmentPaymentDynamoRepository.getByPlanId(tenantId, plan.id);
      }
    }

    return {
      order_number: normalizeOrderNumber(orderNumber),
      payment_type: paymentType,
      sale_date: lines[0].sale_date,
      teller_name: lines[0].teller_name,
      customer_id: lines[0].customer_id || plan?.customer_id || null,
      lines,
      plan,
      returnable: lines.some((line) => line.returnable_qty > 0),
    };
  }

  async listReturns(tenantId) {
    return returnDynamoRepository.getAll(tenantId);
  }

  async _adjustInstallmentForReturn(tenantId, order, refundValue, isFullReturn) {
    const plan = order.plan;
    if (!plan) {
      return { refund_cash: refundValue, status: null };
    }

    const payments = plan.payments || [];
    const pending = payments.filter((p) => p.status === 'pending');
    const paidAmount = Number(plan.paid_amount) || 0;
    const downPayment = Number(plan.down_payment) || 0;
    const unpaidBalance = Math.max(0, Number(plan.total_with_interest || 0) - paidAmount);

    if (isFullReturn) {
      for (const payment of pending) {
        await installmentPaymentDynamoRepository.update(tenantId, payment.id, { status: 'cancelled' });
      }
      await installmentPlanDynamoRepository.update(tenantId, plan.id, {
        remaining_amount: 0,
        monthly_payment: 0,
        status: 'cancelled',
      });
      return {
        refund_cash: downPayment + paidAmount,
        unpaid_after: 0,
        status: 'cancelled',
        plan_id: plan.id,
      };
    }

    let refundCash = 0;
    let unpaidAfter = unpaidBalance;
    if (refundValue <= unpaidBalance) {
      unpaidAfter = unpaidBalance - refundValue;
    } else {
      refundCash = refundValue - unpaidBalance;
      unpaidAfter = 0;
    }

    if (!pending.length || unpaidAfter <= 0.009) {
      for (const payment of pending) {
        await installmentPaymentDynamoRepository.update(tenantId, payment.id, { status: 'cancelled' });
      }
      await installmentPlanDynamoRepository.update(tenantId, plan.id, {
        remaining_amount: 0,
        monthly_payment: 0,
        status: paidAmount + downPayment > 0 ? 'completed' : 'cancelled',
      });
      return {
        refund_cash: refundCash,
        unpaid_after: 0,
        status: paidAmount + downPayment > 0 ? 'completed' : 'cancelled',
        plan_id: plan.id,
      };
    }

    const monthly = unpaidAfter / pending.length;
    for (const payment of pending) {
      await installmentPaymentDynamoRepository.update(tenantId, payment.id, { amount_due: monthly });
    }
    await installmentPlanDynamoRepository.update(tenantId, plan.id, {
      remaining_amount: unpaidAfter,
      monthly_payment: monthly,
      status: 'adjusted',
    });
    return {
      refund_cash: refundCash,
      unpaid_after: unpaidAfter,
      monthly_payment: monthly,
      status: 'adjusted',
      plan_id: plan.id,
    };
  }

  async processReturn(tenantId, user, { orderNumber, lines, reason, returnType }) {
    const order = await this.getOrderByNumber(tenantId, orderNumber);
    if (!order) {
      throw Object.assign(new Error('Order not found'), { status: 404 });
    }

    const type = RETURN_TYPES.includes(returnType) ? returnType : 'cash';
    const requested = Array.isArray(lines) ? lines : [];
    const returnLines = [];
    for (const row of requested) {
      const sale = order.lines.find((line) => String(line.id) === String(row.saleId || row.sale_id));
      if (!sale) {
        throw Object.assign(new Error('Sale line not found on this order'), { status: 400 });
      }
      const qty = Number(row.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        throw Object.assign(new Error('Each return line needs a quantity of at least 1'), { status: 400 });
      }
      if (qty > sale.returnable_qty) {
        throw Object.assign(new Error(`Only ${sale.returnable_qty} left to return for ${sale.item_name}`), {
          status: 400,
        });
      }
      returnLines.push({
        sale_id: sale.id,
        item_id: sale.item_id,
        item_name: sale.item_name,
        qty,
        unit_price: sale.unit_price,
        line_total: sale.unit_price * qty,
        previous_returned: sale.returned_qty,
        buying_price: sale.buying_price,
        selling_price: sale.selling_price ?? sale.price ?? sale.unit_price,
        category_id: sale.category_id || null,
        category_name: sale.category_name || sale.category || '',
      });
    }

    if (!returnLines.length) {
      throw Object.assign(new Error('Select at least one item to return'), { status: 400 });
    }

    if (type === 'warranty') {
      for (const line of returnLines) {
        if (!line.item_id) continue;
        const product = await productDynamoRepository.getById(tenantId, line.item_id);
        if (!product || (product.quantity ?? 0) < line.qty) {
          throw Object.assign(
            new Error(`Not enough sellable stock to replace ${line.item_name}`),
            { status: 400, available: product?.quantity ?? 0 }
          );
        }
      }
    }

    const refundValue = returnLines.reduce((sum, line) => sum + line.line_total, 0);
    const remainingAfter = order.lines.map((line) => {
      const returning = returnLines.find((row) => String(row.sale_id) === String(line.id));
      return (line.returnable_qty || 0) - (returning?.qty || 0);
    });
    const isFullReturn = remainingAfter.every((qty) => qty <= 0);

    let refundCash = 0;
    let installmentAdjustment = null;
    if (type === 'cash') {
      refundCash = refundValue;
      if (order.payment_type === 'installment') {
        installmentAdjustment = await this._adjustInstallmentForReturn(
          tenantId,
          order,
          refundValue,
          isFullReturn
        );
        refundCash = installmentAdjustment.refund_cash;
      }
    }

    for (const line of returnLines) {
      await this.update(tenantId, line.sale_id, {
        returned_qty: line.previous_returned + line.qty,
      });
      if (!line.item_id) continue;
      await productDynamoRepository.incrementReturnQuantity(tenantId, line.item_id, line.qty);
      if (type === 'warranty') {
        await productDynamoRepository.decrementQuantity(tenantId, line.item_id, line.qty);
      }
    }

    const returnId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const returnNumber = `RET${String(Date.now()).slice(-6)}`;
    const tellerName = user.full_name || user.fullName || user.username;
    const record = await returnDynamoRepository.put(tenantId, returnId, {
      return_number: returnNumber,
      order_number: order.order_number,
      payment_type: order.payment_type,
      return_type: type,
      reason: reason ? String(reason).trim() : null,
      refund_cash: refundCash,
      refund_value: refundValue,
      replacement_qty: type === 'warranty' ? returnLines.reduce((sum, line) => sum + line.qty, 0) : 0,
      installment_adjustment: installmentAdjustment,
      lines: returnLines.map(({ previous_returned, ...line }) => line),
      teller_id: user.id,
      teller_name: tellerName,
    });

    await this._recordReturnSales(tenantId, user, {
      orderNumber: order.order_number,
      returnNumber,
      returnType: type,
      returnLines,
      refundValue,
      refundCash,
      tellerName,
    });

    return {
      ...record,
      order: await this.getOrderByNumber(tenantId, order.order_number),
    };
  }

  async _recordReturnSales(tenantId, user, {
    orderNumber,
    returnNumber,
    returnType,
    returnLines,
    refundValue,
    refundCash,
    tellerName,
  }) {
    const saleDate = new Date().toISOString();
    for (let i = 0; i < returnLines.length; i += 1) {
      const line = returnLines[i];
      const lineTotal = Number(line.line_total) || 0;
      const cashOut =
        returnType === 'cash' && refundValue > 0 ? (refundCash * lineTotal) / refundValue : 0;
      const unitProfit =
        (Number(line.selling_price) || 0) - (Number(line.buying_price) || 0);
      let category = {
        category_id: line.category_id || null,
        category_name: line.category_name || '',
      };
      if (!category.category_name && line.item_id) {
        const product = await productDynamoRepository.getById(tenantId, line.item_id);
        category = this._categoryFromProduct(product, line);
      }
      const saleId = `${Date.now()}${Math.floor(Math.random() * 1000)}${i}`;
      await this.put(tenantId, saleId, {
        item_id: line.item_id ? String(line.item_id) : null,
        item_name: line.item_name,
        quantity: line.qty,
        buying_price: line.buying_price,
        selling_price: line.selling_price,
        price: line.unit_price,
        total: -cashOut,
        profit: lineTotal > 0 && cashOut ? -((unitProfit * line.qty * cashOut) / lineTotal) : 0,
        payment_type: returnType === 'cash' ? 'cash' : 'return',
        is_return: true,
        return_flag: true,
        return_type: returnType,
        return_number: returnNumber,
        original_sale_id: line.sale_id,
        returned_qty: line.qty,
        ...category,
        order_number: orderNumber,
        teller_id: user.id,
        teller_name: tellerName,
        sale_date: saleDate,
        tenant_id: tenantId,
      });
    }
  }
}

module.exports = new OrderDynamoRepository();
