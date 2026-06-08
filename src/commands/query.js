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

  // ═══════════════════════════════════════
  // 路由逻辑：带筛选条件的统计类命令优先
  // ═══════════════════════════════════════
  if (opts.reworkRate) {
    return showReworkRate(storage, opts);
  }

  if (opts.uninspected) {
    return listUninspected(storage);
  }

  if (opts.orders) {
    return listOrders(storage, opts.status);
  }

  // ═══════════════════════════════════════
  // 路由逻辑：精确查询类命令
  // ═══════════════════════════════════════
  if (opts.traceCode) {
    return queryByTraceCode(storage, opts.traceCode);
  }

  if (opts.boxNo) {
    return queryByBox(storage, opts.boxNo);
  }

  if (opts.batchNo) {
    return queryByBatch(storage, opts.batchNo);
  }

  if (opts.lotNo || opts.materialBatch) {
    return queryByMaterialBatch(storage, opts);
  }

  // ═══════════════════════════════════════
  // 路由逻辑：聚合类查询（可能同时带style/order）
  // ═══════════════════════════════════════
  if (opts.orderNo && !opts.styleNo) {
    return queryByOrder(storage, opts.orderNo, opts.withDetails);
  }

  if (opts.styleNo && !opts.orderNo) {
    return queryByStyle(storage, opts.styleNo);
  }

  if (opts.styleNo && opts.orderNo) {
    return queryByOrder(storage, opts.orderNo, opts.withDetails);
  }

  // 默认：项目总览
  return showSummary(storage);
}

// ═══════════════════════════════════════════════════════════════
// 批次追踪：面料缸号 / 辅料批次 / 质检批次 三维合一
// ═══════════════════════════════════════════════════════════════
function queryByBatch(storage, batchNo) {
  printHeader(`批次完整追踪: ${batchNo}`);

  // 1) 在面辅料里找：面料缸号(lotNo) 或 辅料批次(batchNo)
  const matchedMaterials = storage.getMaterials().filter(m =>
    (m.lotNo && m.lotNo.toLowerCase().includes(batchNo.toLowerCase())) ||
    (m.batchNo && m.batchNo.toLowerCase().includes(batchNo.toLowerCase()))
  );

  // 2) 在质检里找：质检批次号
  const matchedInspections = storage.getInspections().filter(i =>
    i.batchNo && i.batchNo.toLowerCase().includes(batchNo.toLowerCase())
  );

  // 3) 汇总关联订单号
  const orderNos = new Set();
  matchedMaterials.forEach(m => orderNos.add(m.orderNo));
  matchedInspections.forEach(i => orderNos.add(i.orderNo));

  if (orderNos.size === 0 && matchedMaterials.length === 0 && matchedInspections.length === 0) {
    printWarning(`未找到任何匹配 "${batchNo}" 的批次信息`);
    printInfo('可匹配的来源：面料缸号(lotNo)、辅料批次(batchNo)、质检批次(batchNo)');
    return 1;
  }

  printSection('批次匹配来源');
  const sourceRows = [];
  if (matchedMaterials.length > 0) {
    const fabricCount = matchedMaterials.filter(m => m.type === '面料').length;
    const accCount = matchedMaterials.filter(m => m.type === '辅料').length;
    sourceRows.push(['面辅料记录', `${matchedMaterials.length}条 (面料${fabricCount} / 辅料${accCount})`]);
  }
  if (matchedInspections.length > 0) {
    sourceRows.push(['质检记录', `${matchedInspections.length}条`]);
  }
  sourceRows.push(['关联订单', `${orderNos.size}个: ${[...orderNos].join(', ')}`]);
  printTable(['匹配来源', '详情'], sourceRows);

  // ════════ 关联订单 ════════
  printSection(`关联订单 & 款号 (共${orderNos.size}个)`);
  const orders = [...orderNos].map(on => storage.findOrder(on)).filter(Boolean);
  printTable(
    ['订单号', '款号', '款式名称', '客户', '数量', '颜色', '交期', '状态'],
    orders.map(o => [
      o.orderNo, o.styleNo, o.styleName, o.customer, o.qty,
      o.color, o.deliveryDate ? formatDate(o.deliveryDate) : '-',
      renderStatus(o.status)
    ])
  );

  // ════════ 面辅料明细 ════════
  if (matchedMaterials.length > 0) {
    printSection('匹配的面辅料明细');
    printTable(
      ['订单号', '类型', '分类', '名称', '面料缸号', '辅料批次', '颜色', '数量', '单位', '供应商'],
      matchedMaterials.map(m => [
        m.orderNo, m.type, m.category, m.name,
        m.lotNo || '-', m.batchNo || '-', m.color,
        m.qty, m.unit, m.supplier
      ])
    );
  }

  // ════════ 关联裁剪床次 ════════
  const matchedCuts = storage.getCutting().filter(c =>
    (c.fabricLot && c.fabricLot.toLowerCase().includes(batchNo.toLowerCase())) ||
    orderNos.has(c.orderNo)
  );

  if (matchedCuts.length > 0) {
    const cutQty = matchedCuts.reduce((s, c) => s + (c.totalQty || 0), 0);
    printSection(`关联的裁剪床次 (共${matchedCuts.length}床, ${cutQty}件)`);
    printTable(
      ['订单号', '床次', '层数', '拉布匹数', '裁剪数', '裁剪员', '裁剪日期', '面料缸号'],
      matchedCuts.map(c => [
        c.orderNo, `第${c.bedNo}床`, c.layerCount, c.spreads, c.totalQty,
        c.cutter || '-', formatDate(c.cutDate), c.fabricLot || '-'
      ])
    );
  }

  // ════════ 关联箱唛 ════════
  const relatedBoxes = [];
  for (const orderNo of orderNos) {
    relatedBoxes.push(...storage.findBoxesByOrder(orderNo));
  }
  matchedInspections.forEach(i => {
    if (i.boxNo) {
      const b = storage.findBoxByNo(i.boxNo);
      if (b && !relatedBoxes.find(rb => rb.boxNo === b.boxNo)) relatedBoxes.push(b);
    }
  });

  if (relatedBoxes.length > 0) {
    const totalQty = relatedBoxes.reduce((s, b) => s + (b.qty || 0), 0);
    printSection(`关联的出货箱 (共${relatedBoxes.length}箱, ${totalQty}件)`);
    printTable(
      ['箱唛编号', '订单号', '款号', '颜色', '件数', '毛重(kg)', '净重(kg)', '包装日期'],
      relatedBoxes.map(b => [
        b.boxNo, b.orderNo, b.styleNo, b.color, b.qty,
        b.grossWeight || '-', b.netWeight || '-', formatDate(b.packDate)
      ])
    );
    console.log();
    printInfo('按箱号查看完整追溯链:');
    relatedBoxes.slice(0, 5).forEach(b => {
      console.log(`  ➜ gt query --boxNo ${b.boxNo}`);
    });
    if (relatedBoxes.length > 5) {
      console.log(`  ... (还有 ${relatedBoxes.length - 5} 箱)`);
    }
  }

  // ════════ 关联质检 ════════
  if (matchedInspections.length > 0) {
    const inspStats = calculateReorderRate(matchedInspections);
    printSection(`关联的质检记录 (${matchedInspections.length}次, 返工率${inspStats.rate}%)`);
    printTable(
      ['订单号', '箱号', '检验员', '日期', '抽检', '合格', '返工', '退货', '判定'],
      matchedInspections.map(i => [
        i.orderNo, i.boxNo || i.batchNo || '-', i.inspector || '-',
        formatDate(i.inspectDate), i.inspectedQty, i.passQty,
        i.reworkQty, i.rejectQty, renderJudgment(i.judgment)
      ])
    );
  }

  console.log();
  printInfo('进一步查询：');
  orders.slice(0, 3).forEach(o => {
    console.log(`  ➜ 订单追溯: gt query --orderNo ${o.orderNo}`);
  });

  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 新：面料缸号/辅料批次专用查询入口 (支持直接指定 --lotNo 或 --materialBatch)
// ═══════════════════════════════════════════════════════════════
function queryByMaterialBatch(storage, opts) {
  const searchTerm = opts.lotNo || opts.materialBatch;
  const typeLabel = opts.lotNo ? '面料缸号' : '辅料批次';
  printHeader(`${typeLabel}追踪: ${searchTerm}`);
  printInfo(`注意: 也可以直接使用 gt query --batchNo "${searchTerm}" 查询`);
  console.log();
  return queryByBatch(storage, searchTerm);
}

// ═══════════════════════════════════════════════════════════════
// 返工率分析：支持按客户/款号/订单/时间范围筛选
// ═══════════════════════════════════════════════════════════════
function showReworkRate(storage, opts = {}) {
  printHeader('返工率统计分析');

  // ── 显示当前应用的筛选条件 ──
  const filters = [];
  if (opts.customer) filters.push(`客户="${opts.customer}"`);
  if (opts.styleNo) filters.push(`款号包含"${opts.styleNo}"`);
  if (opts.orderNo) filters.push(`订单号="${opts.orderNo}"`);
  if (opts.fromDate) filters.push(`日期≥${opts.fromDate}`);
  if (opts.toDate) filters.push(`日期≤${opts.toDate}`);
  if (filters.length > 0) {
    printInfo(`当前筛选: ${filters.join('  AND  ')}`);
    console.log();
  }

  // ── 取得订单级匹配，先筛订单 ──
  let matchedOrders = storage.getOrders();
  if (opts.customer) {
    matchedOrders = matchedOrders.filter(o =>
      (o.customer || '').toLowerCase().includes(opts.customer.toLowerCase())
    );
  }
  if (opts.styleNo) {
    matchedOrders = matchedOrders.filter(o =>
      (o.styleNo || '').toLowerCase().includes(opts.styleNo.toLowerCase())
    );
  }
  if (opts.orderNo) {
    matchedOrders = matchedOrders.filter(o => o.orderNo === opts.orderNo);
  }
  const matchedOrderNos = new Set(matchedOrders.map(o => o.orderNo));

  // ── 按质检日期 + 订单过滤 ──
  let inspections = storage.getInspections().filter(i => matchedOrderNos.has(i.orderNo));
  if (opts.fromDate) {
    const from = new Date(opts.fromDate).getTime();
    inspections = inspections.filter(i => new Date(i.inspectDate).getTime() >= from);
  }
  if (opts.toDate) {
    const to = new Date(opts.toDate).getTime();
    inspections = inspections.filter(i => new Date(i.inspectDate).getTime() <= to);
  }

  if (inspections.length === 0) {
    printWarning('筛选条件下暂无质检记录数据');
    if (matchedOrders.length === 0 && filters.length > 0) {
      printWarning('提示：没有匹配到任何订单，请调整筛选条件');
    }
    return 0;
  }

  // ── 总体指标 ──
  const overall = calculateReorderRate(inspections);
  printSection('总体指标');
  const matchOrderCount = new Set(inspections.map(i => i.orderNo)).size;
  printTable(
    ['指标', '数值'],
    [
      ['匹配订单数', matchOrderCount],
      ['质检总次数', inspections.length],
      ['抽检总数量', overall.total],
      ['返工总数量', overall.rework],
      ['总体返工率', `${overall.rate}%`]
    ]
  );

  // ── 按订单维度排序 ──
  const orderStats = {};
  inspections.forEach(i => {
    if (!orderStats[i.orderNo]) {
      const o = storage.findOrder(i.orderNo) || {};
      orderStats[i.orderNo] = {
        style: i.styleNo,
        customer: o.customer || '',
        orderQty: o.qty || 0,
        totalInsp: 0,
        reworkQty: 0,
        count: 0,
        rejectQty: 0
      };
    }
    orderStats[i.orderNo].count++;
    orderStats[i.orderNo].totalInsp += i.inspectedQty;
    orderStats[i.orderNo].reworkQty += i.reworkQty;
    orderStats[i.orderNo].rejectQty += i.rejectQty;
  });

  const orderRows = Object.entries(orderStats).map(([orderNo, s]) => {
    const rate = s.totalInsp > 0 ? ((s.reworkQty / s.totalInsp) * 100).toFixed(2) : '0.00';
    return [orderNo, s.style, s.customer, s.count, s.totalInsp, s.reworkQty, s.rejectQty, `${rate}%`];
  }).sort((a, b) => {
    // 综合排序：返工率降序 + 返工数降序
    const ra = parseFloat(a[7]);
    const rb = parseFloat(b[7]);
    if (rb !== ra) return rb - ra;
    return b[5] - a[5];
  });

  printSection(`按订单返工率排序 (Top ${Math.min(10, orderRows.length)})`);
  printTable(
    ['订单号', '款号', '客户', '质检次数', '抽检数', '返工数', '退货数', '返工率'],
    orderRows.slice(0, 10)
  );

  // ── 重点关注订单 ──
  const highRisk = orderRows.filter(r => parseFloat(r[7]) >= 3 || r[5] >= 20);
  if (highRisk.length > 0) {
    printSection(`⚠ 重点关注订单 (返工率≥3% 或 返工数≥20, 共${highRisk.length}个)`);
    highRisk.forEach((r, idx) => {
      const advice = parseFloat(r[7]) >= 5
        ? '严重：立即停线排查'
        : parseFloat(r[7]) >= 3
          ? '警告：加强抽检'
          : '观察：关注返工趋势';
      console.log(`  ${idx + 1}. [${advice}] 订单 ${r[0]} (款号 ${r[1]})  返工率 ${r[7]}  返工 ${r[5]}件 / 退货 ${r[6]}件`);
      console.log(`     ➜ 查看详情: gt query --orderNo ${r[0]}`);
    });
  }

  // ── 按客户维度 ──
  printSection('按客户维度汇总');
  const customerStats = {};
  inspections.forEach(i => {
    const o = storage.findOrder(i.orderNo) || {};
    const c = o.customer || '(未填)';
    if (!customerStats[c]) customerStats[c] = { orders: new Set(), insp: 0, total: 0, rework: 0 };
    customerStats[c].orders.add(i.orderNo);
    customerStats[c].insp++;
    customerStats[c].total += i.inspectedQty;
    customerStats[c].rework += i.reworkQty;
  });
  const customerRows = Object.entries(customerStats)
    .map(([customer, s]) => {
      const rate = s.total > 0 ? ((s.rework / s.total) * 100).toFixed(2) : '0.00';
      return [customer, s.orders.size, s.insp, s.total, s.rework, `${rate}%`];
    })
    .sort((a, b) => parseFloat(b[5]) - parseFloat(a[5]));
  printTable(['客户', '订单数', '质检次数', '抽检数', '返工数', '返工率'], customerRows);

  // ── 疵点 TOP ──
  const defectSummary = {};
  inspections.forEach(i => {
    Object.entries(i.defects || {}).forEach(([d, n]) => {
      defectSummary[d] = (defectSummary[d] || 0) + n;
    });
  });
  if (Object.keys(defectSummary).length > 0) {
    const totalDefects = Object.values(defectSummary).reduce((s, n) => s + n, 0);
    printSection(`疵点类型分布 TOP10 (合计 ${totalDefects} 个疵点)`);
    const defectRows = Object.entries(defectSummary)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([d, n], idx) => {
        const pct = ((n / totalDefects) * 100).toFixed(1);
        const bar = '█'.repeat(Math.round(parseFloat(pct) / 2)) + '░'.repeat(50 - Math.round(parseFloat(pct) / 2));
        return [idx + 1, d, n, `${pct}%`, bar];
      });
    printTable(['排名', '疵点类型', '数量', '占比', '分布图'], defectRows);

    // 最严重的疵点给出建议
    const topDefect = Object.entries(defectSummary).sort((a, b) => b[1] - a[1])[0];
    if (topDefect) {
      console.log();
      printInfo(`最多发疵点是「${topDefect[0]}」(${topDefect[1]}个)，建议：`);
      const suggestion = getDefectSuggestion(topDefect[0]);
      console.log(`  ${suggestion}`);
    }
  }

  return 0;
}

function getDefectSuggestion(defect) {
  const s = {
    '跳线': '检查缝纫机针板/压脚磨损情况，调整线张力，加强工人手势培训',
    '断线': '检查面线/底线质量，调整缝纫机针距和机针型号',
    '污渍': '加强车间5S管理，规范面料转运托盘，工人佩戴无粉手套',
    '色差': '核对面料缸号混裁情况，同一件必须同缸，检验对照标准色卡',
    '尺寸超差': '重新校准模板，检查整烫温度压力，首件必须全检尺寸',
    '线头未清': '增加专剪线工位，改用全自动剪线机，QC逐件摸查',
    '破洞': '检查机针是否有毛刺，面料展开验布，裁片过灯检',
    '拉链不良': '更换供应商批次，上线前100%试拉，检查拉链长度与门襟匹配',
    '纽扣脱落': '改用双线交叉钉扣，增加线尾打结，检验时做拉力测试',
    '烫黄': '降低整烫温度，更换新型烫布，检查熨斗温控器',
    '面料疵点': '退回面料仓换片，加强验布环节漏检考核',
    '辅料不良': '整批退回供应商，来料加严IQC抽检',
    '缝制不良': '组长停线培训，前30件全检，质检增加巡检频次',
    '对位不准': '重新制作对位剪口模具，工人定位划线作业',
    '针孔': '更换细一号机针，检查送布牙磨损',
    '包装不良': '更新包装SOP，增加包装后抽查重量核对箱规'
  };
  return s[defect] || '从源头工序排查，加强对应工位自检互检';
}

// ═══════════════════════════════════════════════════════════════
// 其他查询函数（保持兼容，略作增强）
// ═══════════════════════════════════════════════════════════════
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
      ['综合返工率', `${rate.rate}%`],
      ['客户数', new Set(orders.map(o => o.customer).filter(Boolean)).size]
    ]
  );

  printInfo('更详细质量分析: gt query --reworkRate --styleNo ' + styleNo);

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
      ['类型', '分类', '名称', '编码', '面料缸号', '辅料批次', '颜色', '数量', '单位', '供应商', '检验'],
      materials.map(m => [
        m.type, m.category, m.name, m.code,
        m.lotNo || '-', m.batchNo || '-', m.color, m.qty, m.unit, m.supplier,
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
    const traceCodes = storage.findTraceCodesByOrder(orderNo);
    printSection(`箱唛信息 (共${boxes.length}箱, 追溯码${traceCodes.length}个)`);
    printTable(
      ['箱唛编号', '第N箱', '颜色', '件数', '毛重(kg)', '净重(kg)', '包装日期', '追溯码绑定'],
      boxes.map(b => {
        const hasCode = traceCodes.find(t => t.boxNo === b.boxNo);
        return [
          b.boxNo, b.sequence, b.color, b.qty,
          b.grossWeight || '-', b.netWeight || '-', formatDate(b.packDate),
          hasCode ? `\x1b[32m是\x1b[0m` : `\x1b[31m否\x1b[0m`
        ];
      })
    );
    printInfo('查看某箱详情: gt query --boxNo <箱号>');
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

  if (trace.boxNo) {
    console.log();
    printInfo('关联箱唛：');
    queryByBox(storage, trace.boxNo);
    return 0;
  }

  console.log();
  queryByOrder(storage, trace.orderNo, false);
  return 0;
}

function queryByBox(storage, boxNo) {
  const box = storage.findBoxByNo(boxNo);
  if (!box) {
    printWarning(`未找到箱唛: ${boxNo}`);
    printInfo('查看箱唛清单: gt inspect --listBoxes');
    return 1;
  }

  printHeader(`箱唛完整追溯: ${boxNo}`);
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
      ['尺码分配', Object.entries(box.sizes || {}).map(([s, q]) => `${s}:${q}`).join(', ') || '-'],
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

  // 追溯码
  const codes = storage.findTraceCodesByOrder(box.orderNo).filter(c => c.boxNo === boxNo);
  if (codes.length > 0) {
    printSection('关联追溯码');
    codes.forEach(c => console.log(`  ${c.code}  (生成于 ${formatDateTime(c.createdAt)})`));
  } else {
    printWarning('此箱暂无追溯码，建议生成: gt export --traceCodes --orderNo ' + box.orderNo);
  }

  // 本箱质检
  const inspections = storage.findInspectionsByBox(boxNo);
  if (inspections.length > 0) {
    const stats = calculateReorderRate(inspections);
    printSection(`本箱质检记录 (${inspections.length}次, 返工率${stats.rate}%)`);
    inspections.forEach(i => {
      console.log(`  检验员: ${i.inspector || '-'} | 日期: ${formatDate(i.inspectDate)}`);
      console.log(`    抽检:${i.inspectedQty}  合格:${i.passQty}  返工:${i.reworkQty}  退货:${i.rejectQty}  判定:${renderJudgment(i.judgment)}`);
      if (Object.keys(i.defects || {}).length > 0) {
        const d = Object.entries(i.defects).map(([x, n]) => `${x}×${n}`).join('，');
        console.log(`    疵点: ${d}`);
      }
    });
  }

  // 继续跳转到订单
  console.log();
  printInfo(`➜ 查看所属订单完整信息: gt query --orderNo ${box.orderNo}`);

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
    const lastInsp = insp.length > 0
      ? formatDate(insp[insp.length - 1].inspectDate)
      : '\x1b[31m从未质检\x1b[0m';
    return [o.orderNo, o.styleNo, o.customer, o.qty, totalInsp, remaining, `${pct}%`, lastInsp, renderStatus(o.status)];
  });

  printTable(
    ['订单号', '款号', '客户', '总数量', '已检', '待检', '完成率', '最近质检', '状态'],
    rows
  );

  printWarning(`共 ${orders.length} 个订单尚未完成质检，合计待检 ${rows.reduce((s, r) => s + r[5], 0)} 件`);
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
        ['电话', project.phone || '-'],
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
  const codes = storage.getTraceCodes();
  const materials = storage.getMaterials();

  printSection('核心指标');
  printTable(
    ['指标', '数值'],
    [
      ['订单总数', orders.length],
      ['订单总件数', totalOrderQty],
      ['订单总金额', totalAmount.toFixed(2)],
      ['客户数', new Set(orders.map(o => o.customer).filter(Boolean)).size],
      ['面辅料绑定记录', materials.length],
      ['裁剪床次数', storage.getCutting().length],
      ['缝制/包装记录', storage.getSewing().length],
      ['质检记录数', inspections.length],
      ['累计抽检数', stats.total],
      ['累计返工数', stats.rework],
      ['总体返工率', `${stats.rate}%`],
      ['已生成箱数', boxes.length],
      ['已包装件数', totalBoxQty],
      ['追溯码数量', codes.length],
      ['无追溯码箱数', boxes.length - new Set(codes.map(c => c.boxNo)).size]
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

  console.log();
  printInfo('常用查询:');
  console.log('  ➜ 返工率分析:  gt query --reworkRate');
  console.log('  ➜ 未检订单:    gt query --uninspected');
  console.log('  ➜ 漏填校验:    gt export --validate');
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 参数解析（新增 --customer / --fromDate / --toDate / --lotNo / --materialBatch）
// ═══════════════════════════════════════════════════════════════
function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--styleNo': 'styleNo', '--style-no': 'styleNo',
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--traceCode': 'traceCode', '--trace-code': 'traceCode',
    '--boxNo': 'boxNo', '--box-no': 'boxNo',
    '--batchNo': 'batchNo', '--batch-no': 'batchNo',
    '--lotNo': 'lotNo', '--lot-no': 'lotNo',
    '--materialBatch': 'materialBatch', '--material-batch': 'materialBatch',
    '--status': 'status',
    '--customer': 'customer',
    '--fromDate': 'fromDate', '--from-date': 'fromDate',
    '--toDate': 'toDate', '--to-date': 'toDate'
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
\x1b[1m用法: garment-trace query [选项]\x1b[0m

多维度查询追溯信息，支持批次追踪和质量分析。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 批次追溯（三维合一：面料缸号 / 辅料批次 / 质检批次）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --batchNo <批次号>        自动匹配面料缸号、辅料批次、质检批次，输出:
                              关联订单+款号 / 用在哪些裁剪床次 / 出了哪些箱
                              / 箱号和数量 / 质检记录 / 跳箱号查完整追溯
  --lotNo <面料缸号>        同上，专用入口（面料缸号）
  --materialBatch <批次>    同上，专用入口（辅料批次）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 返工率分析（多条件筛选）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --reworkRate                        全量返工率分析
  --reworkRate --customer <客户>      按客户筛选
  --reworkRate --styleNo <款号>       按款号筛选
  --reworkRate --orderNo <订单号>     按订单筛选
  --reworkRate --fromDate <YYYY-MM-DD>   质检日期起
  --reworkRate --toDate   <YYYY-MM-DD>   质检日期止

  输出内容: 总体指标 / 订单返工率Top10 / 重点关注订单预警(带行动建议)
           / 按客户维度汇总 / 疵点TOP10(含分布图+改进建议)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 精确查询
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --orderNo <订单号>        订单全链路追溯
  --styleNo <款号>          款号聚合追溯（所有关联订单 + 综合统计）
  --boxNo <箱号>            箱唛完整追溯（质检+追溯码+跳转订单）
  --traceCode <追溯码>      追溯码解码查询

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 列表类查询
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --uninspected             未完成质检的订单 (含最近质检日期)
  --orders                  所有订单清单
  --orders --status <状态>  按状态筛选订单
  --summary                 项目总览（默认）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
示例:
  # 批次追踪 (查面料缸号/辅料批次/质检批次，任何一种都可以)
  gt query --batchNo DYE20260608
  gt query --batchNo B20260605-Z

  # 返工率分析（各种筛选组合）
  gt query --reworkRate
  gt query --reworkRate --customer 优衣库 --fromDate 2026-06-01
  gt query --reworkRate --styleNo JX-A001
  gt query --reworkRate --orderNo PO2026001

  # 精确查询
  gt query --orderNo PO2026001
  gt query --boxNo JXA001-6001-0001
  gt query --traceCode GT-ABCD1234EFGH5678
`);
}

module.exports = { run: queryCommand, help: printHelp };
