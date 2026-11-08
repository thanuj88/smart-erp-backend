const fs = require('fs');
const { TransactWriteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
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
const promotionDynamoRepository = require('./promotionDynamoRepository');
const { resolveOrderNumber, normalizeOrderNumber } = require('../../utils/orderId');
const { savePrivateWitnessImage, resolveWitnessImageFile } = require('../../utils/privateUpload');
const { MAX_INSTALLMENT_LINES, mergeInstallmentLines } = require('../../utils/installmentLines');
const { priceBill, bookedUnitPrice, saleChargeFields, readChargeInput, roundMoney } = require('../../utils/salePricing');

const RETURN_TYPES = ['cash', 'defect', 'warranty'];
// DynamoDB deletes the marker after this. While the item still exists, a repeat key replays the sale.
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;
// Sale put + stock update per line, one plan, up to 12 payments, optional witness.
const DYNAMO_TRANSACT_LIMIT = 100;

function idempotencyExpiresAt(isoDate) {
  const createdMs = Date.parse(isoDate);
  const createdSeconds = Number.isFinite(createdMs)
    ? Math.floor(createdMs / 1000)
    : Math.floor(Date.now() / 1000);
  return createdSeconds + IDEMPOTENCY_TTL_SECONDS;
}

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

  _idempotencyKeys(tenantId, idempotencyKey) {
    return {
      PK: this.pk(tenantId),
      SK: `${ENTITY.IDEMPOTENCY}#cash#${idempotencyKey}`,
    };
  }

  async _replayCashSale(tenantId, idempotencyKey) {
    const marker = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this._idempotencyKeys(tenantId, idempotencyKey),
      })
    );
    if (!marker.Item) return null;

    const sales = [];
    for (const saleId of marker.Item.sale_ids || []) {
      const sale = await this.getById(tenantId, saleId);
      if (sale) sales.push(sale);
    }
    const total = sales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
    const first = sales[0] || {};
    return {
      order_number: marker.Item.order_number,
      sale: sales[0] || null,
      sales,
      total,
      charges: {
        itemsTotal: sales.reduce((sum, sale) => sum + (Number(sale.list_total) || 0), 0) || total,
        shippingAmount: Number(first.shipping_amount) || 0,
        discountAmount: Number(first.discount_amount) || 0,
        grandTotal: total,
      },
      replayed: true,
    };
  }

  async _priceLines(tenantId, resolvedLines, chargeInput) {
    const promotions = await promotionDynamoRepository.getActive(
      tenantId,
      promotionDynamoRepository.localToday()
    );
    return priceBill(resolvedLines, promotions, chargeInput);
  }

  /**
   * One cash bill = one DynamoDB transaction: every sale row, every stock deduction,
   * and an idempotency marker. Either the whole bill is booked or nothing is.
   * Retrying with the same idempotencyKey returns the original sale instead of selling again.
   */
  async processCashSale(
    tenantId,
    user,
    { lines, orderNumber, idempotencyKey, customerId = null, customerName = null, customerPhone = null, ...chargeInput }
  ) {
    if (!Array.isArray(lines) || !lines.length) {
      throw Object.assign(new Error('At least one bill line is required'), { status: 400 });
    }
    if (!idempotencyKey) {
      throw Object.assign(new Error('idempotencyKey is required'), { status: 400 });
    }

    const already = await this._replayCashSale(tenantId, idempotencyKey);
    if (already) return already;

    const resolvedLines = [];
    for (const line of lines) {
      const item = await productDynamoRepository.getById(tenantId, line.itemId);
      if (!item) {
        throw Object.assign(new Error(`Item not found: ${line.itemId}`), { status: 404 });
      }
      if ((item.quantity ?? 0) < line.quantity) {
        throw Object.assign(new Error(`Insufficient stock for ${item.name}`), {
          status: 400,
          available: item.quantity,
        });
      }
      resolvedLines.push({ itemId: line.itemId, quantity: line.quantity, item });
    }

    const priced = await this._priceLines(tenantId, resolvedLines, readChargeInput(chargeInput));

    const saleDate = new Date().toISOString();
    const firstSaleId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const resolvedOrderNumber = resolveOrderNumber(orderNumber, firstSaleId);
    const tableName = databaseConfig.dynamodb.tableName;

    const saleRecords = priced.lines.map((line, index) => {
      const saleId = index === 0 ? firstSaleId : `${Date.now()}${index}${Math.floor(Math.random() * 10000)}`;
      const { item, quantity, itemId } = line;
      return this.toRecord(tenantId, saleId, {
        item_id: String(itemId),
        item_name: item.name,
        quantity,
        buying_price: item.buying_price,
        ...saleChargeFields(line, priced),
        payment_type: 'cash',
        returned_qty: 0,
        ...this._categoryFromProduct(item),
        order_number: resolvedOrderNumber,
        teller_id: user.id,
        teller_name: user.username,
        sale_date: saleDate,
        tenant_id: tenantId,
        ...(customerId
          ? {
              customer_id: String(customerId),
              customer_name: customerName || null,
              customer_phone: customerPhone || null,
            }
          : {}),
      });
    });

    const marker = {
      ...this._idempotencyKeys(tenantId, idempotencyKey),
      entityType: ENTITY.IDEMPOTENCY,
      tenantId,
      order_number: resolvedOrderNumber,
      sale_ids: saleRecords.map((record) => record.entityId),
      createdAt: saleDate,
      ttl: idempotencyExpiresAt(saleDate),
    };

    const transactItems = [
      {
        Put: {
          TableName: tableName,
          Item: marker,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ];
    priced.lines.forEach((line, index) => {
      transactItems.push({
        Put: {
          TableName: tableName,
          Item: saleRecords[index],
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      });
      transactItems.push({
        Update: {
          TableName: tableName,
          Key: {
            PK: productDynamoRepository.pk(tenantId),
            SK: productDynamoRepository.sk(line.itemId),
          },
          UpdateExpression: 'SET quantity = quantity - :qty, updatedAt = :now',
          ConditionExpression: 'quantity >= :qty',
          ExpressionAttributeValues: { ':qty': line.quantity, ':now': saleDate },
        },
      });
    });

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (error) {
      if (error.name !== 'TransactionCanceledException') throw error;
      const reasons = error.CancellationReasons || [];

      // Same key committed between our check and our write (double click / lost response retry).
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        const replay = await this._replayCashSale(tenantId, idempotencyKey);
        if (replay) return replay;
      }

      // Stock changed since the pre-check: name the product that ran out. Nothing was written.
      for (let index = 0; index < priced.lines.length; index += 1) {
        if (reasons[2 + index * 2]?.Code === 'ConditionalCheckFailed') {
          const fresh = await productDynamoRepository.getById(tenantId, priced.lines[index].itemId);
          throw Object.assign(
            new Error(`Insufficient stock for ${priced.lines[index].item.name}`),
            { status: 400, available: fresh?.quantity ?? 0 }
          );
        }
      }
      throw error;
    }

    const sales = saleRecords.map((record) => this.fromRecord(record));
    return {
      order_number: resolvedOrderNumber,
      sale: sales[0],
      sales,
      total: priced.grandTotal,
      charges: {
        itemsTotal: priced.itemsTotal,
        shippingAmount: priced.shippingAmount,
        discountAmount: priced.discountAmount,
        grandTotal: priced.grandTotal,
      },
      replayed: false,
    };
  }

  _planMatchesTeller(plan, tellerSaleIds) {
    const ids = [
      ...(Array.isArray(plan.sale_ids) ? plan.sale_ids : []),
      plan.sale_id,
    ]
      .filter(Boolean)
      .map(String);
    return ids.some((id) => tellerSaleIds.has(id));
  }

  _putIfAbsent(tableName, item) {
    return {
      Put: {
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    };
  }

  async _discardWitnessImage(storedPath) {
    const full = resolveWitnessImageFile(storedPath);
    if (!full) return;
    await fs.promises.unlink(full).catch(() => {});
  }

  async processInstallmentSale(tenantId, user, payload) {
    const { customer, witness, downPayment, installmentMonths, orderNumber } = payload;
    const lines = mergeInstallmentLines(Array.isArray(payload.lines) ? payload.lines : []);
    if (lines.length > MAX_INSTALLMENT_LINES) {
      throw Object.assign(
        new Error(`An installment sale can have at most ${MAX_INSTALLMENT_LINES} different products`),
        { status: 400 }
      );
    }

    const includeWitness = payload.includeWitness !== false && Boolean(witness);
    if (includeWitness) {
      const witnessError = validateDistinctCustomerAndWitness(customer, witness);
      if (witnessError) {
        throw Object.assign(new Error(witnessError), { status: 400 });
      }
    }

    const resolvedLines = [];
    for (const line of lines) {
      const item = await productDynamoRepository.getById(tenantId, line.itemId);
      if (!item) {
        throw Object.assign(new Error(`Item not found: ${line.itemId}`), { status: 404 });
      }
      if ((item.quantity ?? 0) < line.quantity) {
        throw Object.assign(
          new Error(`Insufficient stock for ${item.name}`),
          { status: 400, available: item.quantity }
        );
      }
      resolvedLines.push({
        itemId: line.itemId,
        quantity: line.quantity,
        item,
      });
    }

    const priced = await this._priceLines(tenantId, resolvedLines, readChargeInput(payload));
    const totalAmount = priced.grandTotal;
    if (downPayment >= totalAmount) {
      throw Object.assign(new Error('Down payment must be less than total amount'), { status: 400 });
    }

    const settings = await installmentSettingDynamoRepository.getByMonths(tenantId, installmentMonths);
    if (!settings) throw Object.assign(new Error('Invalid installment months'), { status: 400 });

    const remainingAmount = totalAmount - downPayment;
    const interestAmount = (remainingAmount * settings.interest_rate) / 100;
    const totalWithInterest = remainingAmount + interestAmount;
    const monthlyPayment = totalWithInterest / installmentMonths;
    const paymentCount = Math.floor(Number(installmentMonths));
    const witnessInBill = includeWitness && Boolean(witness);
    const actionCount = priced.lines.length * 2 + 1 + paymentCount + (witnessInBill ? 1 : 0);
    if (!Number.isInteger(paymentCount) || paymentCount < 1 || actionCount > DYNAMO_TRANSACT_LIMIT) {
      throw Object.assign(new Error('Installment bill is too large to book in one transaction'), { status: 400 });
    }

    const existingCustomer = customer.memberId
      ? await customerDynamoRepository.getById(tenantId, customer.memberId)
      : null;
    const customerId = existingCustomer ? existingCustomer.id : null;
    const customerName = existingCustomer?.name || String(customer.name || '').trim() || null;
    const customerPhone = existingCustomer?.phone || String(customer.phone || '').trim() || null;

    let witnessIdImage = null;
    if (witnessInBill && witness.idImage) {
      witnessIdImage = savePrivateWitnessImage(witness.idImage);
    }

    const saleDate = new Date().toISOString();
    const stamp = Date.now();
    const firstSaleId = `${stamp}${Math.floor(Math.random() * 1000)}`;
    const resolvedOrderNumber = resolveOrderNumber(orderNumber, firstSaleId);
    const tableName = databaseConfig.dynamodb.tableName;

    const saleRecords = priced.lines.map((line, index) => {
      const saleId = index === 0 ? firstSaleId : `${stamp}${index}${Math.floor(Math.random() * 10000)}`;
      return this.toRecord(tenantId, saleId, {
        id: String(saleId),
        item_id: String(line.itemId),
        item_name: line.item.name,
        quantity: line.quantity,
        buying_price: line.item.buying_price,
        ...saleChargeFields(line, priced),
        payment_type: 'installment',
        returned_qty: 0,
        ...this._categoryFromProduct(line.item),
        order_number: resolvedOrderNumber,
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        teller_id: user.id,
        teller_name: user.username,
        sale_date: saleDate,
        createdAt: saleDate,
      });
    });

    const saleIds = saleRecords.map((record) => record.entityId);
    const planId = `${stamp}p${Math.floor(Math.random() * 10000)}`;
    const witnessId = witnessInBill ? `${stamp}w${Math.floor(Math.random() * 10000)}` : null;
    const planRecord = installmentPlanDynamoRepository.toRecord(tenantId, planId, {
      id: String(planId),
      sale_id: saleIds[0],
      sale_ids: saleIds,
      order_number: resolvedOrderNumber,
      customer_id: customerId,
      customer_name: customerName,
      customer_phone: customerPhone,
      witness_id: witnessId,
      total_amount: totalAmount,
      down_payment: downPayment,
      remaining_amount: remainingAmount,
      interest_rate: settings.interest_rate,
      interest_amount: interestAmount,
      total_with_interest: totalWithInterest,
      installment_months: installmentMonths,
      monthly_payment: monthlyPayment,
      paid_amount: 0,
      status: 'active',
      tenant_id: tenantId,
      createdAt: saleDate,
    });

    const paymentRecords = [];
    const startDate = new Date();
    for (let i = 1; i <= paymentCount; i += 1) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      const paymentId = `${stamp}pay${i}${Math.floor(Math.random() * 10000)}`;
      paymentRecords.push(
        installmentPaymentDynamoRepository.toRecord(tenantId, paymentId, {
          id: String(paymentId),
          installment_plan_id: String(planId),
          payment_number: i,
          amount_due: monthlyPayment,
          amount_paid: 0,
          due_date: dueDate.toISOString().split('T')[0],
          status: 'pending',
          tenant_id: tenantId,
          createdAt: saleDate,
        })
      );
    }

    const witnessRecord = witnessInBill
      ? witnessDynamoRepository.toRecord(tenantId, witnessId, {
          id: String(witnessId),
          name: witness.name,
          phone: witness.phone,
          id_card_no: witness.idCardNo ?? witness.id_card_no,
          address: witness.address,
          id_image_path: witnessIdImage,
          tenant_id: tenantId,
          createdAt: saleDate,
        })
      : null;

    // One transaction: every sale, the plan, the schedule, the witness, and every
    // stock deduction. A failed quantity check cancels the whole bill.
    const transactItems = [];
    priced.lines.forEach((line, index) => {
      transactItems.push(this._putIfAbsent(tableName, saleRecords[index]));
      transactItems.push({
        Update: {
          TableName: tableName,
          Key: {
            PK: productDynamoRepository.pk(tenantId),
            SK: productDynamoRepository.sk(line.itemId),
          },
          UpdateExpression: 'SET quantity = quantity - :qty, updatedAt = :now',
          ConditionExpression: 'quantity >= :qty',
          ExpressionAttributeValues: { ':qty': line.quantity, ':now': saleDate },
        },
      });
    });
    transactItems.push(this._putIfAbsent(tableName, planRecord));
    paymentRecords.forEach((record) => transactItems.push(this._putIfAbsent(tableName, record)));
    if (witnessRecord) transactItems.push(this._putIfAbsent(tableName, witnessRecord));

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (error) {
      await this._discardWitnessImage(witnessIdImage);
      if (error.name !== 'TransactionCanceledException') throw error;
      const reasons = error.CancellationReasons || [];
      for (let index = 0; index < priced.lines.length; index += 1) {
        if (reasons[index * 2 + 1]?.Code === 'ConditionalCheckFailed') {
          const fresh = await productDynamoRepository.getById(tenantId, priced.lines[index].itemId);
          throw Object.assign(
            new Error(`Insufficient stock for ${priced.lines[index].item.name}`),
            { status: 400, available: fresh?.quantity ?? 0 }
          );
        }
      }
      throw error;
    }

    const sales = saleRecords.map((record) => this.fromRecord(record));
    return {
      sale: sales[0],
      sales,
      plan: installmentPlanDynamoRepository.fromRecord(planRecord),
      payments: paymentRecords.map((record) => installmentPaymentDynamoRepository.fromRecord(record)),
      total: priced.grandTotal,
      charges: {
        itemsTotal: priced.itemsTotal,
        shippingAmount: priced.shippingAmount,
        discountAmount: priced.discountAmount,
        grandTotal: priced.grandTotal,
      },
    };
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
      if (!isAdmin && !this._planMatchesTeller(plan, tellerSaleIds)) return sum;
      return sum + (Number(plan.down_payment) || 0);
    }, 0);

    const planById = new Map(plans.map((p) => [String(p.id), p]));
    const installmentIncome = payments.reduce((sum, payment) => {
      const collected = Number(payment.amount_paid) || 0;
      if (payment.status === 'cancelled' || collected <= 0 || !dateFilter(payment.paid_date)) return sum;
      if (!isAdmin) {
        const plan = planById.get(String(payment.installment_plan_id));
        if (!plan || !this._planMatchesTeller(plan, tellerSaleIds)) return sum;
      }
      return sum + collected;
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
    const unit = bookedUnitPrice(sale);
    const soldQty = qty || 0;
    const unitProfit = soldQty > 0 ? (Number(sale.profit) || 0) / soldQty : 0;
    return {
      ...sale,
      returned_qty: returned,
      returnable_qty: Math.max(0, qty - returned),
      unit_price: unit,
      unit_profit: unitProfit,
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

  /**
   * Works out what a return does to an installment plan, without writing anything.
   * The updates are returned as transaction actions so they commit with the stock and the return.
   *   cash   - money goes back to the customer, first against the unpaid balance.
   *   defect - no cash, but the customer stops owing for the item (unpaid balance drops).
   * Warranty is a 1-for-1 replacement, so the plan never calls this.
   */
  _planInstallmentReturn(tenantId, order, refundValue, isFullReturn, { paysCash }) {
    const plan = order.plan;
    if (!plan) {
      return { adjustment: { refund_cash: paysCash ? refundValue : 0, status: null }, actions: [] };
    }

    const tableName = databaseConfig.dynamodb.tableName;
    const now = new Date().toISOString();
    const payments = plan.payments || [];
    const pending = payments.filter((p) => p.status === 'pending');
    const paidAmount = Number(plan.paid_amount) || 0;
    const downPayment = Number(plan.down_payment) || 0;
    const unpaidBalance = Math.max(0, Number(plan.total_with_interest || 0) - paidAmount);
    const actions = [];

    const planKey = {
      PK: installmentPlanDynamoRepository.pk(tenantId),
      SK: installmentPlanDynamoRepository.sk(plan.id),
    };
    // Payments can be collected while a return is being keyed in. Both writes only apply
    // if the plan and its open installments are still as we read them.
    const planAction = (data) => ({
      Update: {
        TableName: tableName,
        Key: planKey,
        UpdateExpression:
          'SET remaining_amount = :remaining, monthly_payment = :monthly, #st = :status, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(paid_amount) OR paid_amount = :paid)',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':remaining': data.remaining_amount,
          ':monthly': data.monthly_payment,
          ':status': data.status,
          ':paid': paidAmount,
          ':now': now,
        },
      },
    });
    const paymentAction = (payment, set, values) => ({
      Update: {
        TableName: tableName,
        Key: {
          PK: installmentPaymentDynamoRepository.pk(tenantId),
          SK: installmentPaymentDynamoRepository.sk(payment.id),
        },
        UpdateExpression: `SET ${set}, updatedAt = :now`,
        ConditionExpression: '#st = :pending',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: { ':pending': 'pending', ':now': now, ...values },
      },
    });
    const cancelPending = () =>
      pending.forEach((payment) =>
        actions.push(paymentAction(payment, '#st = :cancelled', { ':cancelled': 'cancelled' }))
      );

    if (isFullReturn) {
      cancelPending();
      actions.push(planAction({ remaining_amount: 0, monthly_payment: 0, status: 'cancelled' }));
      return {
        adjustment: {
          refund_cash: paysCash ? downPayment + paidAmount : 0,
          unpaid_after: 0,
          status: 'cancelled',
          plan_id: plan.id,
        },
        actions,
      };
    }

    let refundCash = 0;
    let unpaidAfter = unpaidBalance;
    if (refundValue <= unpaidBalance) {
      unpaidAfter = unpaidBalance - refundValue;
    } else {
      refundCash = paysCash ? refundValue - unpaidBalance : 0;
      unpaidAfter = 0;
    }

    if (!pending.length || unpaidAfter <= 0.009) {
      const status = paidAmount + downPayment > 0 ? 'completed' : 'cancelled';
      cancelPending();
      actions.push(planAction({ remaining_amount: 0, monthly_payment: 0, status }));
      return {
        adjustment: { refund_cash: refundCash, unpaid_after: 0, status, plan_id: plan.id },
        actions,
      };
    }

    const monthly = unpaidAfter / pending.length;
    pending.forEach((payment) =>
      actions.push(paymentAction(payment, 'amount_due = :monthly', { ':monthly': monthly }))
    );
    actions.push(planAction({ remaining_amount: unpaidAfter, monthly_payment: monthly, status: 'adjusted' }));
    return {
      adjustment: {
        refund_cash: refundCash,
        unpaid_after: unpaidAfter,
        monthly_payment: monthly,
        status: 'adjusted',
        plan_id: plan.id,
      },
      actions,
    };
  }

  /**
   * A return is one DynamoDB transaction: every sale line's returned_qty, the return stock
   * (and, for warranty, the sellable stock), the installment plan, the return record and the
   * ledger rows. Each sale line only moves if returned_qty is still what we read, so the same
   * unit cannot be returned twice and a failure leaves nothing half-applied.
   */
  async processReturn(tenantId, user, { orderNumber, lines, reason, returnType }) {
    const order = await this.getOrderByNumber(tenantId, orderNumber);
    if (!order) {
      throw Object.assign(new Error('Order not found'), { status: 404 });
    }

    const type = RETURN_TYPES.includes(returnType) ? returnType : 'cash';
    const requested = Array.isArray(lines) ? lines : [];
    const returnLines = [];
    const seenSales = new Set();
    for (const row of requested) {
      const sale = order.lines.find((line) => String(line.id) === String(row.saleId || row.sale_id));
      if (!sale) {
        throw Object.assign(new Error('Sale line not found on this order'), { status: 400 });
      }
      if (seenSales.has(String(sale.id))) {
        throw Object.assign(new Error('Each sale line can only appear once in a return'), { status: 400 });
      }
      seenSales.add(String(sale.id));
      const qty = Number(row.quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        throw Object.assign(new Error('Each return line needs a quantity of at least 1'), { status: 400 });
      }
      if (qty > sale.returnable_qty) {
        throw Object.assign(new Error(`Only ${sale.returnable_qty} left to return for ${sale.item_name}`), {
          status: 400,
        });
      }
      const fullLine =
        qty === Number(sale.quantity) &&
        !(Number(sale.returned_qty) > 0) &&
        Number.isFinite(Number(sale.total));
      const lineTotal = fullLine ? roundMoney(Number(sale.total)) : roundMoney(sale.unit_price * qty);
      returnLines.push({
        sale_id: sale.id,
        item_id: sale.item_id,
        item_name: sale.item_name,
        qty,
        unit_price: sale.unit_price,
        unit_profit: sale.unit_profit,
        line_total: lineTotal,
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

    // Two sale lines can be the same product; one transaction may only touch an item once.
    const qtyByProduct = new Map();
    for (const line of returnLines) {
      if (!line.item_id) continue;
      const key = String(line.item_id);
      qtyByProduct.set(key, (qtyByProduct.get(key) || 0) + line.qty);
    }
    const products = new Map();
    for (const itemId of qtyByProduct.keys()) {
      const product = await productDynamoRepository.getById(tenantId, itemId);
      if (product) products.set(itemId, product);
    }

    if (type === 'warranty') {
      for (const [itemId, qty] of qtyByProduct) {
        const product = products.get(itemId);
        if (!product || (product.quantity ?? 0) < qty) {
          const name = returnLines.find((line) => String(line.item_id) === itemId)?.item_name;
          throw Object.assign(new Error(`Not enough sellable stock to replace ${name}`), {
            status: 400,
            available: product?.quantity ?? 0,
          });
        }
      }
    }

    const refundValue = returnLines.reduce((sum, line) => sum + line.line_total, 0);
    const remainingAfter = order.lines.map((line) => {
      const returning = returnLines.find((row) => String(row.sale_id) === String(line.id));
      return (line.returnable_qty || 0) - (returning?.qty || 0);
    });
    const isFullReturn = remainingAfter.every((qty) => qty <= 0);

    let refundCash = type === 'cash' ? refundValue : 0;
    let installmentAdjustment = null;
    let planActions = [];
    if (order.payment_type === 'installment' && (type === 'cash' || type === 'defect')) {
      const planned = this._planInstallmentReturn(tenantId, order, refundValue, isFullReturn, {
        paysCash: type === 'cash',
      });
      installmentAdjustment = planned.adjustment;
      planActions = planned.actions;
      refundCash = planned.adjustment.refund_cash;
    }

    const tableName = databaseConfig.dynamodb.tableName;
    const now = new Date().toISOString();
    const returnId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const returnNumber = `RET${String(Date.now()).slice(-6)}`;
    const tellerName = user.full_name || user.fullName || user.username;

    const returnRecord = returnDynamoRepository.toRecord(tenantId, returnId, {
      id: String(returnId),
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

    const ledgerRecords = await this._buildReturnSaleRecords(tenantId, user, {
      orderNumber: order.order_number,
      returnNumber,
      returnType: type,
      returnLines,
      refundValue,
      refundCash,
      tellerName,
      products,
    });

    const transactItems = [];
    // 1. Sale lines: only move if nobody returned against them since we read them.
    returnLines.forEach((line) => {
      transactItems.push({
        Update: {
          TableName: tableName,
          Key: { PK: this.pk(tenantId), SK: this.sk(line.sale_id) },
          UpdateExpression: 'SET returned_qty = :next, updatedAt = :now',
          ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(returned_qty) OR returned_qty = :prev)',
          ExpressionAttributeValues: {
            ':next': line.previous_returned + line.qty,
            ':prev': line.previous_returned,
            ':now': now,
          },
        },
      });
    });
    // 2. Product stock: returned units go to return stock; warranty also takes a sellable replacement.
    const stockSlots = [];
    for (const [itemId, qty] of qtyByProduct) {
      if (!products.has(itemId)) continue; // product was deleted; nothing to restock
      stockSlots.push(itemId);
      transactItems.push({
        Update: {
          TableName: tableName,
          Key: { PK: productDynamoRepository.pk(tenantId), SK: productDynamoRepository.sk(itemId) },
          UpdateExpression:
            type === 'warranty'
              ? 'SET return_quantity = if_not_exists(return_quantity, :zero) + :q, quantity = quantity - :q, updatedAt = :now'
              : 'SET return_quantity = if_not_exists(return_quantity, :zero) + :q, updatedAt = :now',
          ConditionExpression: type === 'warranty' ? 'attribute_exists(PK) AND quantity >= :q' : 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':q': qty, ':zero': 0, ':now': now },
        },
      });
    }
    // 3. Installment plan, the return record, and the ledger rows.
    const planStart = transactItems.length;
    planActions.forEach((action) => transactItems.push(action));
    transactItems.push(this._putIfAbsent(tableName, returnRecord));
    ledgerRecords.forEach((record) => transactItems.push(this._putIfAbsent(tableName, record)));

    if (transactItems.length > DYNAMO_TRANSACT_LIMIT) {
      throw Object.assign(
        new Error('This return touches too many lines at once. Return fewer lines per request.'),
        { status: 400 }
      );
    }

    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: transactItems }));
    } catch (error) {
      if (error.name !== 'TransactionCanceledException') throw error;
      const reasons = error.CancellationReasons || [];
      const failed = reasons.findIndex((reason) => reason?.Code === 'ConditionalCheckFailed');
      if (failed >= 0 && failed >= returnLines.length && failed < returnLines.length + stockSlots.length && type === 'warranty') {
        const name = returnLines.find((line) => String(line.item_id) === stockSlots[failed - returnLines.length])?.item_name;
        throw Object.assign(new Error(`Not enough sellable stock to replace ${name}`), { status: 400 });
      }
      if (failed >= 0) {
        const where = failed < returnLines.length ? 'sale' : failed < planStart ? 'stock' : 'plan';
        throw Object.assign(
          new Error(
            where === 'sale'
              ? 'This order was already returned against. Reload the order and try again.'
              : 'Stock or the installment plan changed while returning. Reload the order and try again.'
          ),
          { status: 409 }
        );
      }
      throw error;
    }

    return {
      ...returnDynamoRepository.fromRecord(returnRecord),
      order: await this.getOrderByNumber(tenantId, order.order_number),
    };
  }

  async _buildReturnSaleRecords(tenantId, user, {
    orderNumber,
    returnNumber,
    returnType,
    returnLines,
    refundValue,
    refundCash,
    tellerName,
    products = new Map(),
  }) {
    const saleDate = new Date().toISOString();
    const records = [];
    for (let i = 0; i < returnLines.length; i += 1) {
      const line = returnLines[i];
      const lineTotal = Number(line.line_total) || 0;
      const cashOut =
        returnType === 'cash' && refundValue > 0 ? (refundCash * lineTotal) / refundValue : 0;
      const unitProfit = Number.isFinite(Number(line.unit_profit))
        ? Number(line.unit_profit)
        : (Number(line.selling_price) || 0) - (Number(line.buying_price) || 0);
      let category = {
        category_id: line.category_id || null,
        category_name: line.category_name || '',
      };
      if (!category.category_name && line.item_id) {
        const product =
          products.get(String(line.item_id)) ||
          (await productDynamoRepository.getById(tenantId, line.item_id));
        category = this._categoryFromProduct(product, line);
      }
      const saleId = `${Date.now()}${Math.floor(Math.random() * 1000)}${i}`;
      records.push(
        this.toRecord(tenantId, saleId, {
          id: String(saleId),
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
        })
      );
    }
    return records;
  }
}

module.exports = new OrderDynamoRepository();
