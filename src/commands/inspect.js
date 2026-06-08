const { generateId, generateBoxNo, generateTraceCode, formatDate, formatDateTime, getNextSequence, printTable, printSuccess, printError, printWarning, printInfo, printHeader, printSection, calculateReorderRate } = require('../utils');

const DEFECT_TYPES = [
  '破洞', '污渍', '跳线', '断线', '针孔', '色差', '尺寸超差',
  '对位不准', '拉链不良', '纽扣脱落', '线头未清', '烫黄', '面料疵点',
  '辅料不良', '缝制不良', '包装不良', '其他'
];

function inspectCommand(args, storage) {
  if (!storage.isInitialized()) {
    printError('项目未初始化，请先运行 garment-trace init');
    return 1;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const opts = parseArgs(args);

  if (opts.list) {
    return listInspections(storage, opts.orderNo);
  }

  if (opts.listBoxes) {
    return listBoxes(storage, opts.orderNo);
  }

  if (opts.defectTypes) {
    printDefectTypes();
    return 0;
  }

  if (opts.newBox) {
    return createBox(storage, opts);
  }

  if (!opts.orderNo) {
    printError('缺少必填参数 --orderNo (订单号)');
    printInfo('使用 --help 查看帮助');
    return 1;
  }

  const order = storage.findOrder(opts.orderNo);
  if (!order) {
    printError(`订单 ${opts.orderNo} 不存在，请先导入订单`);
    return 1;
  }

  if (!opts.inspectedQty && !opts.defects && !opts.judgment) {
    printError('请提供至少一个质检相关参数 (--inspectedQty / --defects / --judgment)');
    return 1;
  }

  const defects = parseDefects(opts.defects);
  const defectTotal = Object.values(defects).reduce((sum, n) => sum + n, 0);
  const inspectedQty = parseInt(opts.inspectedQty) || Math.max(defectTotal, parseInt(opts.reworkQty) || 0, parseInt(opts.passQty) || 0);
  const reworkQty = parseInt(opts.reworkQty) || defectTotal;
  const passQty = parseInt(opts.passQty) || Math.max(inspectedQty - reworkQty - (parseInt(opts.rejectQty) || 0), 0);
  const rejectQty = parseInt(opts.rejectQty) || 0;

  let judgment = opts.judgment;
  if (!judgment) {
    judgment = reworkQty > 0 ? 'REWORK' : (rejectQty > 0 ? 'REJECT' : 'PASS');
  }

  const inspection = {
    id: generateId('INS-'),
    orderNo: opts.orderNo,
    styleNo: order.styleNo,
    boxNo: opts.boxNo || '',
    batchNo: opts.batchNo || '',
    inspector: opts.inspector || '',
    inspectDate: opts.date ? new Date(opts.date).toISOString() : new Date().toISOString(),
    inspectedQty,
    passQty,
    reworkQty,
    rejectQty,
    defects,
    defectTotal,
    judgment,
    level: opts.level || 'AQL2.5',
    remark: opts.remark || '',
    recordedAt: new Date().toISOString()
  };

  storage.addInspection(inspection);

  const allInsp = storage.findInspectionsByOrder(opts.orderNo);
  const stats = calculateReorderRate(allInsp);

  let newStatus = order.status;
  if (judgment === 'REJECT') {
    newStatus = 'QUALITY_ISSUE';
  } else if (judgment === 'REWORK') {
    newStatus = 'REWORKING';
  } else {
    const totalInsp = allInsp.reduce((s, i) => s + i.inspectedQty, 0);
    if (totalInsp >= order.qty) {
      newStatus = 'INSPECTION_DONE';
    } else if (totalInsp > 0) {
      newStatus = 'INSPECTING';
    }
  }
  if (newStatus !== order.status) {
    storage.updateOrder(opts.orderNo, { status: newStatus });
  }

  printHeader('质检记录录入成功');
  printSection(`订单: ${order.orderNo} / 款号: ${order.styleNo}`);
  printTable(
    ['项目', '内容'],
    [
      ['质检ID', inspection.id],
      ['关联箱号', inspection.boxNo || '-'],
      ['关联批次', inspection.batchNo || '-'],
      ['检验员', inspection.inspector || '-'],
      ['检验日期', formatDate(inspection.inspectDate)],
      ['检验标准', inspection.level],
      ['抽检数量', inspection.inspectedQty],
      ['合格数量', inspection.passQty],
      ['返工数量', inspection.reworkQty],
      ['退货数量', inspection.rejectQty],
      ['疵点总数', inspection.defectTotal],
      ['判定结果', renderJudgment(inspection.judgment)],
      ['订单状态', renderStatus(newStatus)]
    ]
  );

  if (Object.keys(inspection.defects).length > 0) {
    printSection('疵点明细');
    printTable(
      ['疵点类型', '数量'],
      Object.entries(inspection.defects).map(([type, qty]) => [type, qty])
    );
  }

  printSection('累计质检统计');
  printTable(
    ['指标', '数值'],
    [
      ['累计抽检数', stats.total],
      ['累计返工数', stats.rework],
      ['累计返工率', `${stats.rate}%`]
    ]
  );

  return 0;
}

function createBox(storage, opts) {
  const orderNo = opts.orderNo;
  if (!orderNo) {
    printError('创建箱唛需要 --orderNo (订单号)');
    return 1;
  }

  const order = storage.findOrder(orderNo);
  if (!order) {
    printError(`订单 ${orderNo} 不存在`);
    return 1;
  }

  const seq = opts.sequence || getNextSequence(storage, orderNo, 'box');
  const boxNo = opts.boxNo || generateBoxNo(orderNo, order.styleNo, seq);

  const existing = storage.findBoxByNo(boxNo);
  if (existing) {
    printError(`箱号 ${boxNo} 已存在`);
    return 1;
  }

  const sizes = parseSizes(opts.sizes);
  const qty = parseInt(opts.qty) || Object.values(sizes).reduce((s, n) => s + n, 0);
  const grossWeight = parseFloat(opts.gw) || 0;
  const netWeight = parseFloat(opts.nw) || 0;

  const box = {
    id: generateId('BOX-'),
    boxNo,
    orderNo,
    styleNo: order.styleNo,
    sequence: seq,
    customer: order.customer,
    color: opts.color || order.color,
    sizes,
    qty,
    grossWeight,
    netWeight,
    measure: opts.measure || '',
    sealNo: opts.sealNo || '',
    palletNo: opts.palletNo || '',
    packedBy: opts.packedBy || '',
    packDate: opts.date ? new Date(opts.date).toISOString() : new Date().toISOString(),
    status: opts.status || 'PACKED',
    remark: opts.remark || ''
  };

  storage.addBox(box);

  const traceCode = opts.traceCode || generateTraceCode(orderNo, order.styleNo, boxNo);
  storage.addTraceCode({
    code: traceCode,
    orderNo,
    styleNo: order.styleNo,
    boxNo,
    type: 'BOX',
    createdAt: new Date().toISOString(),
    scanned: false
  });

  printHeader('箱唛创建成功');
  printSection('箱唛信息');
  printTable(
    ['项目', '内容'],
    [
      ['箱唛编号', box.boxNo],
      ['订单号', box.orderNo],
      ['款号', box.styleNo],
      ['客户', box.customer],
      ['颜色', box.color],
      ['第N箱', `第${box.sequence}箱`],
      ['件数', box.qty],
      ['毛重(kg)', box.grossWeight || '-'],
      ['净重(kg)', box.netWeight || '-'],
      ['尺码', opts.sizes || '-'],
      ['外箱尺寸', box.measure || '-'],
      ['封箱号', box.sealNo || '-'],
      ['栈板号', box.palletNo || '-'],
      ['包装员', box.packedBy || '-'],
      ['包装日期', formatDate(box.packDate)],
      ['追溯码', traceCode]
    ]
  );

  printInfo(`使用追溯码追踪: garment-trace query --traceCode ${traceCode}`);
  return 0;
}

function listInspections(storage, orderNo) {
  let records = storage.getInspections();
  if (orderNo) {
    records = records.filter(i => i.orderNo === orderNo);
  }

  if (records.length === 0) {
    printWarning('暂无质检记录');
    return 0;
  }

  printHeader('质检记录清单');
  printTable(
    ['订单号', '款号', '箱号', '检验员', '日期', '抽检', '合格', '返工', '退货', '判定'],
    records.map(r => [
      r.orderNo,
      r.styleNo,
      r.boxNo || '-',
      r.inspector || '-',
      formatDate(r.inspectDate),
      r.inspectedQty,
      r.passQty,
      r.reworkQty,
      r.rejectQty,
      renderJudgment(r.judgment)
    ])
  );
  return 0;
}

function listBoxes(storage, orderNo) {
  let records = storage.getBoxes();
  if (orderNo) {
    records = records.filter(b => b.orderNo === orderNo);
  }

  if (records.length === 0) {
    printWarning('暂无箱唛记录');
    return 0;
  }

  printHeader('箱唛清单');
  printTable(
    ['箱唛编号', '订单号', '款号', '序号', '颜色', '件数', '毛重', '净重', '日期'],
    records.map(r => [
      r.boxNo,
      r.orderNo,
      r.styleNo,
      r.sequence,
      r.color,
      r.qty,
      r.grossWeight,
      r.netWeight,
      formatDate(r.packDate)
    ])
  );
  return 0;
}

function parseDefects(str) {
  if (!str) return {};
  if (typeof str === 'object') return str;
  const result = {};
  const parts = String(str).split(/[,;，；]/);
  for (const part of parts) {
    const [type, qty] = part.split(/[:：=]/);
    if (type && qty) {
      const t = type.trim();
      if (DEFECT_TYPES.includes(t) || !isNaN(parseInt(qty))) {
        result[t] = parseInt(qty) || 0;
      }
    }
  }
  return result;
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

function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--boxNo': 'boxNo', '--box-no': 'boxNo',
    '--batchNo': 'batchNo', '--batch-no': 'batchNo',
    '--inspector': 'inspector',
    '--date': 'date',
    '--inspectedQty': 'inspectedQty', '--inspected-qty': 'inspectedQty',
    '--passQty': 'passQty', '--pass-qty': 'passQty',
    '--reworkQty': 'reworkQty', '--rework-qty': 'reworkQty',
    '--rejectQty': 'rejectQty', '--reject-qty': 'rejectQty',
    '--defects': 'defects',
    '--judgment': 'judgment',
    '--level': 'level',
    '--remark': 'remark',
    '--sequence': 'sequence',
    '--color': 'color',
    '--sizes': 'sizes',
    '--qty': 'qty',
    '--gw': 'gw',
    '--nw': 'nw',
    '--measure': 'measure',
    '--sealNo': 'sealNo', '--seal-no': 'sealNo',
    '--palletNo': 'palletNo', '--pallet-no': 'palletNo',
    '--packedBy': 'packedBy', '--packed-by': 'packedBy',
    '--status': 'status',
    '--traceCode': 'traceCode'
  };

  const boolFlags = ['--list', '--listBoxes', '--list-boxes', '--defectTypes', '--defect-types', '--newBox', '--new-box'];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (boolFlags.includes(arg)) {
      continue;
    }
    if (keyMap[arg] && args[i + 1] && !args[i + 1].startsWith('--')) {
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
  if (args.includes('--list')) opts.list = true;
  if (args.includes('--listBoxes') || args.includes('--list-boxes')) opts.listBoxes = true;
  if (args.includes('--defectTypes') || args.includes('--defect-types')) opts.defectTypes = true;
  if (args.includes('--newBox') || args.includes('--new-box')) opts.newBox = true;
  return opts;
}

function renderJudgment(j) {
  const map = { PASS: '\x1b[32m放行(PASS)\x1b[0m', REWORK: '\x1b[33m返工(REWORK)\x1b[0m', REJECT: '\x1b[31m退货(REJECT)\x1b[0m' };
  return map[j] || j;
}

function renderStatus(s) {
  const map = {
    CREATED: '已创建', MATERIAL_LINKED: '已备料',
    CUTTING: '裁剪中', CUTTING_DONE: '裁剪完成',
    SEWING: '缝制中', SEWING_DONE: '缝制完成',
    PACKING_DONE: '包装完成',
    INSPECTING: '质检中', INSPECTION_DONE: '质检完成',
    REWORKING: '返工中', QUALITY_ISSUE: '品质异常',
    SHIPPED: '已出货'
  };
  return map[s] || s;
}

function printDefectTypes() {
  printHeader('支持的疵点类型');
  const rows = DEFECT_TYPES.map((t, i) => [i + 1, t]);
  printTable(['序号', '疵点类型'], rows);
  console.log();
  printInfo('使用方式: --defects "跳线:3,污渍:2,色差:1"');
}

function printHelp() {
  console.log(`
用法: garment-trace inspect [选项]

录入质检抽检记录，标记疵点，判定返工/放行，生成箱唛编号。

质检录入选项:
  --orderNo <订单号>        订单号 (必填)
  --boxNo <箱号>            关联箱唛号
  --batchNo <批次号>        关联批次号
  --inspector <检验员>      检验员姓名
  --date <日期>             检验日期 (YYYY-MM-DD)
  --inspectedQty <数量>     抽检数量
  --passQty <数量>          合格数量
  --reworkQty <数量>        返工数量
  --rejectQty <数量>        退货/报废数量
  --defects <疵点>          疵点明细 (如 跳线:3,污渍:2,色差:1)
  --judgment <结果>         判定结果: PASS / REWORK / REJECT
  --level <标准>            检验标准 (如 AQL2.5, AQL4.0)
  --remark <备注>           备注信息

箱唛生成选项 (--newBox):
  --newBox                  创建新箱唛
  --orderNo <订单号>        订单号 (必填)
  --boxNo <箱号>            自定义箱号 (默认自动生成)
  --sequence <序号>         第几箱 (默认自动递增)
  --color <颜色>            颜色
  --sizes <分配>            尺码分配 (如 S:12,M:12,L:12)
  --qty <数量>              本箱件数
  --gw <重量>               毛重(kg)
  --nw <重量>               净重(kg)
  --measure <尺寸>          外箱尺寸 (如 60x40x30)
  --sealNo <封箱号>         封箱条编号
  --palletNo <栈板号>       栈板/托盘编号
  --packedBy <包装员>       包装员
  --date <日期>             包装日期
  --status <状态>           状态: PACKED / INSPECTED / SHIPPED
  --traceCode <码>          自定义追溯码

辅助选项:
  --list                    列出所有质检记录
  --list --orderNo <单号>   列出指定订单的质检
  --listBoxes               列出所有箱唛
  --listBoxes --orderNo <单号>
  --defectTypes             查看所有疵点类型

示例:
  garment-trace inspect --orderNo PO2026001 --inspectedQty 200 --passQty 192 --reworkQty 8 --defects "跳线:3,污渍:2,线头未清:3" --judgment REWORK --inspector 王质检
  garment-trace inspect --orderNo PO2026001 --boxNo JXA001-6001-0001 --inspectedQty 50 --passQty 50 --judgment PASS
  garment-trace inspect --newBox --orderNo PO2026001 --qty 24 --sizes "S:6,M:6,L:6,XL:6" --gw 18.5 --nw 16.2 --measure "60x40x30" --packedBy 王霞
  garment-trace inspect --defectTypes
`);
}

module.exports = { run: inspectCommand, help: printHelp };
