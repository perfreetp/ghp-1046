const { formatDate, formatDateTime, printTable, printError, printWarning, printInfo, printHeader, printSection, calculateReorderRate } = require('../utils');

function queryCommand(args, storage) {
  if (!storage.isInitialized()) {
    printError('项目未初始化，请先运行 garment-trace init');
    return 1;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const opts = parseArgs(args);

  if (opts.styleNo) {
    return queryByStyle(storage, opts.styleNo);
  }

  if (opts.orderNo) {
    return queryByOrder(storage, opts.orderNo, opts.withDetails);
  }

  if (opts.traceCode) {
    return queryByTraceCode(storage, opts.traceCode);
  }

  if (opts.boxNo) {
    return queryByBox(storage, opts.boxNo);
  }

  if (opts.batchNo) {
    return queryByBatch(storage, opts.batchNo);
  }

  if (opts.uninspected) {
    return listUninspected(storage);
  }

  if (opts.reworkRate) {
    return showReworkRate(storage, opts.styleNo, opts.orderNo);
  }

  if (opts.orders) {
    return listOrders(storage, opts.status);
  }

  if (opts.summary) {
    return showSummary(storage);
  }

  return showSummary(storage);
}

function queryByStyle(storage, styleNo) {
  const orders = storage.getOrders().filter(o => o.styleNo.toLowerCase().includes(styleNo.toLowerCase()));
  if (orders.length === 0) {
    printWarning(`未找到款号包含 "${styleNo}" 的订单`);
    return 1;
  }

  printHeader(`款号追溯查询: ${styleNo}`);
  printInfo(`找到 ${orders.length} 个关联订单`);

  for (const order of orders) {
    printSection(`订单 ${order.orderNo}`);
    queryByOrder(storage, order.orderNo, false);
  }

  const allInspections = [];
  orders.forEach(o => allInspections.push(...storage.findInspectionsByOrder(o.orderNo)));
  const rate = calculateReorderRate(allInspections);

  printSection('综合统计');
  printTable(
    ['指标', '数值'],
    [
      ['关联订单数', orders.length],
      ['订单总数量', orders.reduce((s, o) => s + o.qty, 0)],
      ['累计抽检数', rate.total],
      ['累计返工数', rate.rework],
      ['综合返工率', `${rate.rate}%`]
    ]
  );

  return 0;
}

function queryByOrder(storage, orderNo, withDetails) {
  const order = storage.findOrder(orderNo);
  if (!order) {
    printWarning(`未找到订单: ${orderNo}`);
    return 1;
  }

  printHeader(`订单追溯查询: ${orderNo}`);

  printSection('订单基本信息');
  printTable(
    ['字段', '值'],
    [
      ['订单号', order.orderNo],
      ['款号', order.styleNo],
      ['款式名称', order.styleName],
      ['客户', order.customer],
      ['客户PO', order.customerPo],
      ['数量', order.qty],
      ['单价/金额', `${order.unitPrice.toFixed(2)} / ${order.amount.toFixed(2)}`],
      ['颜色', order.color],
      ['尺码范围', order.sizeRange],
      ['交期', order.deliveryDate ? formatDate(order.deliveryDate) : '-'],
      ['下单日期', formatDate(order.orderDate)],
      ['季节', order.season],
      ['当前状态', renderStatus(order.status)],
      ['创建时间', formatDateTime(order.createdAt)]
    ]
  );

  if (Object.keys(order.sizes || {}).length > 0) {
    printSection('尺码分配');
    printTable(
      ['尺码', '数量'],
      Object.entries(order.sizes).map(([s, q]) => [s, q])
    );
  }

  const materials = storage.findMaterialsByOrder(orderNo);
  if (materials.length > 0) {
    printSection('面辅料信息');
    printTable(
      ['类型', '分类', '名称', '编码', '缸号/批次', '颜色', '数量', '单位', '供应商', '检验'],
      materials.map(m => [
        m.type, m.category, m.name, m.code,
        m.lotNo || m.batchNo, m.color, m.qty, m.unit, m.supplier,
        renderMaterialResult(m.inspectionResult)
      ])
    );
  } else {
    printWarning('未绑定面辅料信息');
  }

  const cuts = storage.findCuttingByOrder(orderNo);
  if (cuts.length > 0) {
    const cutTotal = cuts.reduce((s, c) => s + (c.totalQty || 0), 0);
    printSection(`裁剪记录 (共${cuts.length}床, 合计${cutTotal}件)`);
    printTable(
      ['床次', '层数', '拉布匹数', '裁剪数', '裁剪员', '日期', '面料缸号'],
      cuts.map(c => [
        `第${c.bedNo}床`, c.layerCount, c.spreads, c.totalQty,
        c.cutter || '-', formatDate(c.cutDate), c.fabricLot || '-'
      ])
    );
  } else {
    printWarning('无裁剪记录');
  }

  const sewing = storage.findSewingByOrder(orderNo);
  if (sewing.length > 0) {
    printSection(`缝制与包装记录 (共${sewing.length}条)`);
    printTable(
      ['工序', '组别/标识', '负责人', '分配/完成', '次品', '开始', '结束'],
      sewing.map(s => [
        s.process,
        s.process === '整烫包装' ? '整烫包装' : `第${s.groupNo}组`,
        s.leader || s.ironedBy || s.packedBy || '-',
        `${s.assignedQty || s.ironQty || s.packQty || '-'}/${s.completedQty || s.packQty || '-'}`,
        s.defectQty || '-',
        formatDate(s.startDate || s.ironDate || s.packDate),
        s.endDate ? formatDate(s.endDate) : (s.packDate ? formatDate(s.packDate) : '进行中')
      ])
    );
  } else {
    printWarning('无缝制/包装记录');
  }

  const inspections = storage.findInspectionsByOrder(orderNo);
  if (inspections.length > 0) {
    const stats = calculateReorderRate(inspections);
    printSection(`质检记录 (共${inspections.length}次, 返工率${stats.rate}%)`);
    printTable(
      ['箱号/批次', '检验员', '日期', '抽检', '合格', '返工', '退货', '判定'],
      inspections.map(i => [
        i.boxNo || i.batchNo || '-', i.inspector || '-',
        formatDate(i.inspectDate), i.inspectedQty, i.passQty,
        i.reworkQty, i.rejectQty, renderJudgment(i.judgment)
      ])
    );

    const allDefects = {};
    inspections.forEach(i => {
      Object.entries(i.defects || {}).forEach(([d, n]) => {
        allDefects[d] = (allDefects[d] || 0) + n;
      });
    });
    if (Object.keys(allDefects).length > 0) {
      printSection('疵点汇总');
      const defectRows = Object.entries(allDefects)
        .sort((a, b) => b[1] - a[1])
        .map(([d, n]) => [d, n]);
      printTable(['疵点类型', '累计数量'], defectRows);
    }
  } else {
    printWarning('无质检记录');
  }

  const boxes = storage.findBoxesByOrder(orderNo);
  if (boxes.length > 0) {
    printSection(`箱唛信息 (共${boxes.length}箱)`);
    printTable(
      ['箱唛编号', '第N箱', '颜色', '件数', '毛重(kg)', '净重(kg)', '包装日期'],
      boxes.map(b => [
        b.boxNo, b.sequence, b.color, b.qty,
        b.grossWeight || '-', b.netWeight || '-', formatDate(b.packDate)
      ])
    );
  }

  return 0;
}

function queryByTraceCode(storage, code) {
  const trace = storage.findTraceCode(code);
  if (!trace) {
    printWarning(`未找到追溯码: ${code}`);
    return 1;
  }

  printHeader(`追溯码查询: ${code}`);
  printTable(
    ['字段', '值'],
    [
      ['追溯码', trace.code],
      ['类型', trace.type],
      ['订单号', trace.orderNo],
      ['款号', trace.styleNo],
      ['箱号', trace.boxNo],
      ['生成时间', formatDateTime(trace.createdAt)],
      ['扫描状态', trace.scanned ? '\x1b[32m已扫描\x1b[0m' : '未扫描']
    ]
  );

  console.log();
  queryByOrder(storage, trace.orderNo, false);
  return 0;
}

function queryByBox(storage, boxNo) {
  const box = storage.findBoxByNo(boxNo);
  if (!box) {
    printWarning(`未找到箱唛: ${boxNo}`);
    return 1;
  }

  printHeader(`箱唛追踪: ${boxNo}`);
  printTable(
    ['字段', '值'],
    [
      ['箱唛编号', box.boxNo],
      ['订单号', box.orderNo],
      ['款号', box.styleNo],
      ['客户', box.customer],
      ['颜色', box.color],
      ['第N箱', box.sequence],
      ['件数', box.qty],
      ['尺码分配', Object.entries(box.sizes).map(([s, q]) => `${s}:${q}`).join(',') || '-'],
      ['毛重(kg)', box.grossWeight || '-'],
      ['净重(kg)', box.netWeight || '-'],
      ['外箱尺寸', box.measure || '-'],
      ['封箱号', box.sealNo || '-'],
      ['栈板号', box.palletNo || '-'],
      ['包装员', box.packedBy || '-'],
      ['包装日期', formatDate(box.packDate)],
      ['状态', box.status]
    ]
  );

  const codes = storage.findTraceCodesByOrder(box.orderNo).filter(c => c.boxNo === boxNo);
  if (codes.length > 0) {
    printSection('关联追溯码');
    codes.forEach(c => console.log(`  ${c.code}`));
  }

  const inspections = storage.findInspectionsByBox(boxNo);
  if (inspections.length > 0) {
    printSection('关联质检记录');
    inspections.forEach(i => {
      console.log(`  检验员: ${i.inspector || '-'} | 日期: ${formatDate(i.inspectDate)} | 抽检: ${i.inspectedQty} | 判定: ${renderJudgment(i.judgment)}`);
    });
  }

  return 0;
}

function queryByBatch(storage, batchNo) {
  printHeader(`批次追踪: ${batchNo}`);

  const inspections = storage.getInspections().filter(i => i.batchNo === batchNo);
  if (inspections.length === 0) {
    printWarning(`未找到批次号为 "${batchNo}" 的质检记录`);
    return 1;
  }

  const orderNos = [...new Set(inspections.map(i => i.orderNo))];
  printInfo(`关联订单: ${orderNos.join(', ')}`);
  printInfo(`质检次数: ${inspections.length}`);

  printTable(
    ['订单号', '款号', '箱号', '检验员', '日期', '抽检', '合格', '返工', '退货', '判定'],
    inspections.map(i => [
      i.orderNo, i.styleNo, i.boxNo || '-', i.inspector || '-',
      formatDate(i.inspectDate), i.inspectedQty, i.passQty,
      i.reworkQty, i.rejectQty, renderJudgment(i.judgment)
    ])
  );

  for (const orderNo of orderNos) {
    const boxes = storage.findBoxesByOrder(orderNo).filter(b => b.boxNo.startsWith(batchNo) || batchNo.includes(b.sequence));
    if (boxes.length > 0) {
      printSection(`订单 ${orderNo} - 出货箱明细`);
      printTable(
        ['箱唛编号', '件数', '颜色', '毛重', '净重', '包装日期'],
        boxes.map(b => [b.boxNo, b.qty, b.color, b.grossWeight || '-', b.netWeight || '-', formatDate(b.packDate)])
      );
    }
  }

  return 0;
}

function listUninspected(storage) {
  printHeader('未完成质检的订单');

  const orders = storage.getOrders().filter(o => {
    const insp = storage.findInspectionsByOrder(o.orderNo);
    const totalInsp = insp.reduce((s, i) => s + i.inspectedQty, 0);
    return totalInsp < o.qty;
  });

  if (orders.length === 0) {
    printSuccess('所有订单均已完成质检！');
    return 0;
  }

  const rows = orders.map(o => {
    const insp = storage.findInspectionsByOrder(o.orderNo);
    const totalInsp = insp.reduce((s, i) => s + i.inspectedQty, 0);
    const remaining = o.qty - totalInsp;
    const pct = ((totalInsp / o.qty) * 100).toFixed(1);
    return [o.orderNo, o.styleNo, o.customer, o.qty, totalInsp, remaining, `${pct}%`, renderStatus(o.status)];
  });

  printTable(
    ['订单号', '款号', '客户', '总数量', '已检', '待检', '完成率', '状态'],
    rows
  );

  printWarning(`共 ${orders.length} 个订单尚未完成质检，合计待检 ${rows.reduce((s, r) => s + r[5], 0)} 件`);
  return 0;
}

function showReworkRate(storage, styleFilter, orderFilter) {
  printHeader('返工率统计分析');

  let inspections = storage.getInspections();
  if (orderFilter) {
    inspections = inspections.filter(i => i.orderNo === orderFilter);
  }
  if (styleFilter) {
    inspections = inspections.filter(i => i.styleNo.toLowerCase().includes(styleFilter.toLowerCase()));
  }

  if (inspections.length === 0) {
    printWarning('暂无质检记录数据');
    return 0;
  }

  const orderStats = {};
  inspections.forEach(i => {
    if (!orderStats[i.orderNo]) {
      orderStats[i.orderNo] = { style: i.styleNo, total: 0, rework: 0, count: 0 };
    }
    orderStats[i.orderNo].total += i.inspectedQty;
    orderStats[i.orderNo].rework += i.reworkQty;
    orderStats[i.orderNo].count++;
  });

  const rows = Object.entries(orderStats).map(([orderNo, s]) => {
    const rate = s.total > 0 ? ((s.rework / s.total) * 100).toFixed(2) : 0;
    return [orderNo, s.style, s.count, s.total, s.rework, `${rate}%`];
  }).sort((a, b) => parseFloat(b[5]) - parseFloat(a[5]));

  printTable(
    ['订单号', '款号', '质检次数', '抽检总数', '返工数', '返工率'],
    rows
  );

  const overall = calculateReorderRate(inspections);
  printSection('总体返工率');
  printTable(
    ['指标', '数值'],
    [
      ['质检总次数', inspections.length],
      ['抽检总数量', overall.total],
      ['返工总数量', overall.rework],
      ['总体返工率', `${overall.rate}%`]
    ]
  );

  const defectSummary = {};
  inspections.forEach(i => {
    Object.entries(i.defects || {}).forEach(([d, n]) => {
      defectSummary[d] = (defectSummary[d] || 0) + n;
    });
  });
  if (Object.keys(defectSummary).length > 0) {
    printSection('疵点类型分布 (Top 10)');
    const defectRows = Object.entries(defectSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([d, n]) => {
        const total = Object.values(defectSummary).reduce((s, x) => s + x, 0);
        return [d, n, `${((n / total) * 100).toFixed(1)}%`];
      });
    printTable(['疵点类型', '数量', '占比'], defectRows);
  }

  return 0;
}

function listOrders(storage, statusFilter) {
  let orders = storage.getOrders();
  if (statusFilter) {
    orders = orders.filter(o => o.status === statusFilter || o.status.includes(statusFilter));
  }

  if (orders.length === 0) {
    printWarning('暂无订单数据');
    return 0;
  }

  printHeader(`订单清单 (共${orders.length}个)`);
  printTable(
    ['订单号', '款号', '款式名称', '客户', '数量', '交期', '状态'],
    orders.map(o => [
      o.orderNo, o.styleNo, o.styleName, o.customer, o.qty,
      o.deliveryDate ? formatDate(o.deliveryDate) : '-',
      renderStatus(o.status)
    ])
  );
  return 0;
}

function showSummary(storage) {
  printHeader('项目总览');

  const project = storage.getProject();
  if (project) {
    printSection('项目档案');
    printTable(
      ['字段', '值'],
      [
        ['项目名称', project.name],
        ['工厂名称', project.factoryName || '-'],
        ['工厂代码', project.factoryCode || '-'],
        ['联系人', project.contact || '-'],
        ['创建时间', formatDateTime(project.createdAt)]
      ]
    );
  }

  const orders = storage.getOrders();
  const totalOrderQty = orders.reduce((s, o) => s + o.qty, 0);
  const totalAmount = orders.reduce((s, o) => s + o.amount, 0);

  const inspections = storage.getInspections();
  const stats = calculateReorderRate(inspections);

  const boxes = storage.getBoxes();
  const totalBoxQty = boxes.reduce((s, b) => s + b.qty, 0);

  printSection('核心指标');
  printTable(
    ['指标', '数值'],
    [
      ['订单总数', orders.length],
      ['订单总件数', totalOrderQty],
      ['订单总金额', totalAmount.toFixed(2)],
      ['面辅料绑定数', storage.getMaterials().length],
      ['裁剪床次数', storage.getCutting().length],
      ['缝制/包装记录', storage.getSewing().length],
      ['质检记录数', inspections.length],
      ['累计抽检数', stats.total],
      ['累计返工数', stats.rework],
      ['总体返工率', `${stats.rate}%`],
      ['已生成箱数', boxes.length],
      ['已包装件数', totalBoxQty],
      ['追溯码数量', storage.getTraceCodes().length]
    ]
  );

  if (orders.length > 0) {
    printSection('订单状态分布');
    const statusCount = {};
    orders.forEach(o => {
      statusCount[o.status] = (statusCount[o.status] || 0) + 1;
    });
    printTable(
      ['状态', '订单数'],
      Object.entries(statusCount).map(([s, c]) => [renderStatus(s), c])
    );
  }

  return 0;
}

function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--styleNo': 'styleNo', '--style-no': 'styleNo',
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--traceCode': 'traceCode', '--trace-code': 'traceCode',
    '--boxNo': 'boxNo', '--box-no': 'boxNo',
    '--batchNo': 'batchNo', '--batch-no': 'batchNo',
    '--status': 'status'
  };

  const boolFlags = ['--uninspected', '--reworkRate', '--orders', '--summary', '--details'];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (boolFlags.includes(arg)) continue;
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
  if (args.includes('--uninspected')) opts.uninspected = true;
  if (args.includes('--reworkRate')) opts.reworkRate = true;
  if (args.includes('--orders')) opts.orders = true;
  if (args.includes('--summary')) opts.summary = true;
  if (args.includes('--details')) opts.withDetails = true;

  return opts;
}

function renderJudgment(j) {
  const map = {
    PASS: '\x1b[32m放行\x1b[0m',
    REWORK: '\x1b[33m返工\x1b[0m',
    REJECT: '\x1b[31m退货\x1b[0m'
  };
  return map[j] || j;
}

function renderStatus(s) {
  const map = {
    CREATED: '\x1b[37m已创建\x1b[0m',
    MATERIAL_LINKED: '\x1b[36m已备料\x1b[0m',
    CUTTING: '\x1b[35m裁剪中\x1b[0m',
    CUTTING_DONE: '\x1b[35m裁剪完成\x1b[0m',
    SEWING: '\x1b[34m缝制中\x1b[0m',
    SEWING_DONE: '\x1b[34m缝制完成\x1b[0m',
    PACKING_DONE: '\x1b[36m包装完成\x1b[0m',
    INSPECTING: '\x1b[33m质检中\x1b[0m',
    INSPECTION_DONE: '\x1b[32m质检完成\x1b[0m',
    REWORKING: '\x1b[33m返工中\x1b[0m',
    QUALITY_ISSUE: '\x1b[31m品质异常\x1b[0m',
    SHIPPED: '\x1b[32m已出货\x1b[0m'
  };
  return map[s] || s;
}

function renderMaterialResult(r) {
  const map = { PASS: '\x1b[32m合格\x1b[0m', FAIL: '\x1b[31m不合格\x1b[0m', PENDING: '待检' };
  return map[r] || r;
}

function printHelp() {
  console.log(`
用法: garment-trace query [选项]

多维度查询追溯信息。

查询维度 (选其一):
  --orderNo <订单号>        按订单号查询完整追溯链
  --styleNo <款号>          按款号查询所有关联订单和问题来源
  --boxNo <箱号>            按箱唛号追踪出货箱详情
  --batchNo <批次号>        按批次号追踪出货箱和质检记录
  --traceCode <追溯码>      按追溯码查询完整信息

统计查询:
  --uninspected             列出所有未完成质检的订单
  --reworkRate              汇总返工率分析，含疵点分布
  --reworkRate --styleNo <款号>   指定款号的返工率
  --reworkRate --orderNo <订单号> 指定订单的返工率
  --orders                  列出所有订单
  --orders --status <状态>  按状态筛选订单
  --summary                 项目总览（默认）

附加选项:
  --details                 显示更详细的信息

状态值参考:
  CREATED, MATERIAL_LINKED, CUTTING, CUTTING_DONE, SEWING,
  SEWING_DONE, PACKING_DONE, INSPECTING, INSPECTION_DONE,
  REWORKING, QUALITY_ISSUE, SHIPPED

示例:
  garment-trace query                                # 项目总览
  garment-trace query --orderNo PO2026001           # 订单追溯
  garment-trace query --styleNo JX-A001             # 款号追溯，查问题来源
  garment-trace query --boxNo JXA001-6001-0001      # 箱唛追踪
  garment-trace query --uninspected                 # 未检订单
  garment-trace query --reworkRate                  # 返工率汇总
  garment-trace query --traceCode GT-ABCD1234EFGH5678
`);
}

module.exports = { run: queryCommand, help: printHelp };
