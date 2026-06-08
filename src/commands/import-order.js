const fs = require('fs');
const path = require('path');
const { generateId, formatDate, formatDateTime, validateRequired, printTable, printSuccess, printError, printWarning, printInfo, printHeader, printSection } = require('../utils');

function importOrderCommand(args, storage) {
  if (!storage.isInitialized()) {
    printError('项目未初始化，请先运行 garment-trace init');
    return 1;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const opts = parseArgs(args);

  if (opts.file) {
    return importFromFile(storage, opts.file, opts.overwrite);
  }

  return importSingle(storage, opts);
}

function importSingle(storage, opts) {
  if (!opts.orderNo) {
    printError('缺少必填参数 --orderNo (订单号)');
    printInfo('使用 --help 查看帮助');
    return 1;
  }

  const existing = storage.findOrder(opts.orderNo);
  if (existing) {
    printError(`订单号 ${opts.orderNo} 已存在！`);
    printInfo('使用 --overwrite 覆盖或使用其他订单号');
    return 1;
  }

  const order = {
    id: generateId('ORD-'),
    orderNo: opts.orderNo,
    styleNo: opts.styleNo || '',
    styleName: opts.styleName || '',
    customer: opts.customer || '',
    customerPo: opts.customerPo || '',
    qty: parseInt(opts.qty) || 0,
    unitPrice: parseFloat(opts.unitPrice) || 0,
    amount: (parseInt(opts.qty) || 0) * (parseFloat(opts.unitPrice) || 0),
    color: opts.color || '',
    sizeRange: opts.sizeRange || '',
    sizes: parseSizes(opts.sizes),
    deliveryDate: opts.deliveryDate ? new Date(opts.deliveryDate).toISOString() : null,
    orderDate: opts.orderDate ? new Date(opts.orderDate).toISOString() : new Date().toISOString(),
    season: opts.season || '',
    remark: opts.remark || '',
    status: 'CREATED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const missing = validateRequired(order, ['orderNo', 'styleNo', 'qty']);
  if (missing.length > 0) {
    printError(`缺少必填字段: ${missing.join(', ')}`);
    return 1;
  }

  storage.addOrder(order);

  printHeader('订单导入成功');
  printSection('订单信息');
  printTable(
    ['字段', '值'],
    [
      ['订单ID', order.id],
      ['订单号', order.orderNo],
      ['款号', order.styleNo],
      ['款式名称', order.styleName],
      ['客户', order.customer],
      ['客户PO', order.customerPo],
      ['数量', order.qty],
      ['单价', order.unitPrice.toFixed(2)],
      ['金额', order.amount.toFixed(2)],
      ['颜色', order.color],
      ['尺码范围', order.sizeRange],
      ['交期', order.deliveryDate ? formatDate(order.deliveryDate) : '-'],
      ['下单日期', formatDate(order.orderDate)],
      ['季节', order.season],
      ['状态', order.status]
    ]
  );

  if (order.sizes && Object.keys(order.sizes).length > 0) {
    printSection('尺码分配');
    const sizeRows = Object.entries(order.sizes).map(([size, qty]) => [size, qty]);
    printTable(['尺码', '数量'], sizeRows);
  }

  return 0;
}

function importFromFile(storage, filePath, overwrite) {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    printError(`文件不存在: ${absPath}`);
    return 1;
  }

  const ext = path.extname(absPath).toLowerCase();
  let orders = [];

  try {
    if (ext === '.json') {
      const content = fs.readFileSync(absPath, 'utf-8');
      orders = JSON.parse(content);
      if (!Array.isArray(orders)) {
        orders = [orders];
      }
    } else if (ext === '.csv') {
      orders = parseCSV(fs.readFileSync(absPath, 'utf-8'));
    } else {
      printError('不支持的文件格式，请使用 .json 或 .csv');
      return 1;
    }
  } catch (e) {
    printError(`解析文件失败: ${e.message}`);
    return 1;
  }

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const errors = [];

  for (const raw of orders) {
    try {
      const orderNo = raw.orderNo || raw['订单号'];
      if (!orderNo) {
        errorCount++;
        errors.push(`行缺少订单号: ${JSON.stringify(raw)}`);
        continue;
      }

      const existing = storage.findOrder(orderNo);
      if (existing && !overwrite) {
        skipCount++;
        continue;
      }

      const order = {
        id: generateId('ORD-'),
        orderNo: orderNo,
        styleNo: raw.styleNo || raw['款号'] || '',
        styleName: raw.styleName || raw['款式名称'] || '',
        customer: raw.customer || raw['客户'] || '',
        customerPo: raw.customerPo || raw['客户PO'] || '',
        qty: parseInt(raw.qty || raw['数量']) || 0,
        unitPrice: parseFloat(raw.unitPrice || raw['单价']) || 0,
        color: raw.color || raw['颜色'] || '',
        sizeRange: raw.sizeRange || raw['尺码范围'] || '',
        sizes: parseSizes(raw.sizes || raw['尺码分配']),
        deliveryDate: (raw.deliveryDate || raw['交期']) ? new Date(raw.deliveryDate || raw['交期']).toISOString() : null,
        orderDate: (raw.orderDate || raw['下单日期']) ? new Date(raw.orderDate || raw['下单日期']).toISOString() : new Date().toISOString(),
        season: raw.season || raw['季节'] || '',
        remark: raw.remark || raw['备注'] || '',
        status: 'CREATED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      order.amount = order.qty * order.unitPrice;

      const missing = validateRequired(order, ['orderNo', 'styleNo', 'qty']);
      if (missing.length > 0) {
        errorCount++;
        errors.push(`订单 ${orderNo} 缺少字段: ${missing.join(', ')}`);
        continue;
      }

      if (existing) {
        const idx = storage.getOrders().findIndex(o => o.orderNo === orderNo);
        const allOrders = storage.getOrders();
        order.id = existing.id;
        order.createdAt = existing.createdAt;
        allOrders[idx] = order;
        storage.saveOrders(allOrders);
      } else {
        storage.addOrder(order);
      }
      successCount++;
    } catch (e) {
      errorCount++;
      errors.push(`处理失败: ${e.message}`);
    }
  }

  printHeader('批量导入结果');
  printTable(
    ['状态', '数量'],
    [
      ['成功导入', successCount],
      ['跳过(已存在)', skipCount],
      ['失败', errorCount]
    ]
  );

  if (errors.length > 0) {
    printSection('错误明细');
    errors.slice(0, 10).forEach(e => printWarning(e));
    if (errors.length > 10) {
      printWarning(`...还有 ${errors.length - 10} 条错误`);
    }
  }

  return errorCount > 0 ? 1 : 0;
}

function parseSizes(str) {
  if (!str) return {};
  if (typeof str === 'object') return str;
  const result = {};
  const parts = String(str).split(/[,;，；]/);
  for (const part of parts) {
    const [size, qty] = part.split(/[:：=]/);
    if (size && qty) {
      result[size.trim()] = parseInt(qty) || 0;
    }
  }
  return result;
}

function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.some(v => v)) {
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });
      rows.push(row);
    }
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--styleNo': 'styleNo', '--style-no': 'styleNo',
    '--styleName': 'styleName', '--style-name': 'styleName',
    '--customer': 'customer',
    '--customerPo': 'customerPo', '--customer-po': 'customerPo',
    '--qty': 'qty',
    '--unitPrice': 'unitPrice', '--unit-price': 'unitPrice',
    '--color': 'color',
    '--sizeRange': 'sizeRange', '--size-range': 'sizeRange',
    '--sizes': 'sizes',
    '--deliveryDate': 'deliveryDate', '--delivery-date': 'deliveryDate',
    '--orderDate': 'orderDate', '--order-date': 'orderDate',
    '--season': 'season',
    '--remark': 'remark',
    '--file': 'file',
    '--overwrite': 'overwrite'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (keyMap[arg] && args[i + 1]) {
      opts[keyMap[arg]] = args[++i];
    } else if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        const key = arg.substring(0, eqIdx);
        const val = arg.substring(eqIdx + 1);
        if (keyMap[key]) {
          opts[keyMap[key]] = val;
        }
      }
    }
  }
  if (args.includes('--overwrite')) opts.overwrite = true;
  return opts;
}

function printHelp() {
  console.log(`
用法: garment-trace import-order [选项]

导入订单清单，支持单条录入或从 CSV/JSON 文件批量导入。

单条录入选项:
  --orderNo <订单号>        订单号 (必填)
  --styleNo <款号>          款号 (必填)
  --styleName <款式名>      款式名称
  --customer <客户>         客户名称
  --customerPo <PO号>       客户PO号
  --qty <数量>              订单总数量 (必填)
  --unitPrice <单价>        单价
  --color <颜色>            颜色
  --sizeRange <范围>        尺码范围 (如 S-XXL)
  --sizes <分配>            尺码分配 (如 S:100,M:200,L:150)
  --deliveryDate <日期>     交期 (YYYY-MM-DD)
  --orderDate <日期>        下单日期 (YYYY-MM-DD)
  --season <季节>           季节 (如 2026SS)
  --remark <备注>           备注
  --overwrite               覆盖已存在的订单

批量导入选项:
  --file <路径>             从 CSV 或 JSON 文件导入
  --overwrite               覆盖已存在的同订单号记录

示例:
  garment-trace import-order --orderNo PO2026001 --styleNo JX-A001 --styleName "男士T恤" --customer 优衣库 --qty 5000 --unitPrice 25.5 --color 白色 --sizeRange S-XXL --sizes "S:800,M:1200,L:1500,XL:1000,XXL:500" --deliveryDate 2026-08-15
  garment-trace import-order --file ./orders.csv
  garment-trace import-order --file ./orders.json --overwrite

CSV 文件表头字段:
  orderNo,styleNo,styleName,customer,customerPo,qty,unitPrice,color,sizeRange,sizes,deliveryDate,orderDate,season,remark
  (或使用中文表头: 订单号,款号,款式名称,客户,客户PO,数量,单价,颜色,尺码范围,尺码分配,交期,下单日期,季节,备注)
`);
}

module.exports = { run: importOrderCommand, help: printHelp };
