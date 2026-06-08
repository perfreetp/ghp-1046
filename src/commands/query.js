const { formatDate, formatDateTime, printTable, printSuccess, printError, printWarning, printInfo, printHeader, printSection, calculateReorderRate } = require('../utils');

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
  // 路由逻辑：统计/看板类命令最优先
  // ═══════════════════════════════════════
  if (opts.handleStatus) {
    return handleRiskHandling(storage, opts);
  }

  if (opts.alert) {
    return showQualityAlert(storage, opts);
  }

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
    return queryByTraceCode(storage, opts.traceCode, opts.scanNote);
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
  // 路由逻辑：聚合类查询
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

  return showSummary(storage);
}

// ═══════════════════════════════════════════════════════════════
// 质量预警看板 (新增)
// ═══════════════════════════════════════════════════════════════
function showQualityAlert(storage, opts = {}) {
  const days = parseInt(opts.days || '7', 10);
  const today = opts.toDate ? new Date(opts.toDate) : new Date();
  today.setHours(23, 59, 59, 999);
  const todayTs = today.getTime();
  const curStart = new Date(today.getTime() - (days - 1) * 86400000);
  curStart.setHours(0, 0, 0, 0);
  const curStartTs = curStart.getTime();

  const prevEnd = new Date(curStartTs - 1);
  prevEnd.setHours(23, 59, 59, 999);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  prevStart.setHours(0, 0, 0, 0);

  printHeader(`质量预警看板 (最近 ${days} 天 · ${formatDate(curStart)} ~ ${formatDate(today)})`);

  const allInsp = storage.getInspections();
  const recentInsp = allInsp.filter(i => {
    const t = new Date(i.inspectDate).getTime();
    return t >= curStartTs && t <= todayTs;
  });
  const orders = storage.getOrders();

  const prevInsp = allInsp.filter(i => {
    const t = new Date(i.inspectDate).getTime();
    return t >= prevStart.getTime() && t <= prevEnd.getTime();
  });

  // ── 1. 统计窗口确认表 ──
  let actualFirst = null, actualLast = null, hitCount = 0;
  if (recentInsp.length > 0) {
    const sorted = recentInsp.slice().sort((a, b) => new Date(a.inspectDate) - new Date(b.inspectDate));
    actualFirst = sorted[0].inspectDate;
    actualLast = sorted[sorted.length - 1].inspectDate;
    hitCount = sorted.length;
  }

  printSection('统计窗口确认');
  printTable(
    ['项目', '起', '止', '备注'],
    [
      ['当前统计窗口', formatDateTime(curStart), formatDateTime(today), `最近${days}天（不含未来日期）`],
      ['实际命中质检', actualFirst ? formatDateTime(actualFirst) : '—', actualLast ? formatDateTime(actualLast) : '—', `共${hitCount}次记录`],
      ['环比对比窗口', formatDateTime(prevStart), formatDateTime(prevEnd), `前${days}天（平移对照）`]
    ]
  );

  if (recentInsp.length === 0) {
    console.log();
    printWarning(`最近 ${days} 天暂无质检记录，建议先录入数据`);
    printInfo(`录入命令: gt inspect --orderNo <订单号> --inspectedQty <数量> --judgment PASS`);
    return 0;
  }

  // ── 2. 指标：对比前一段（环比） ──
  const curStats = calculateReorderRate(recentInsp);
  const prevStats = calculateReorderRate(prevInsp);
  const rateDelta = (curStats.rate - prevStats.rate).toFixed(2);
  const deltaColor = parseFloat(rateDelta) >= 1 ? '\x1b[31m' : parseFloat(rateDelta) > 0 ? '\x1b[33m' : '\x1b[32m';
  const deltaSign = parseFloat(rateDelta) > 0 ? '+' : '';

  printSection(`总体趋势 (对比前${days}天)`);
  printTable(
    ['指标', `最近${days}天`, `前${days}天`, '变化'],
    [
      ['质检次数', recentInsp.length, prevInsp.length, (recentInsp.length - prevInsp.length) >= 0 ? '+' + (recentInsp.length - prevInsp.length) : (recentInsp.length - prevInsp.length)],
      ['抽检总数', curStats.total, prevStats.total, ''],
      ['返工总数', curStats.rework, prevStats.rework, (curStats.rework - prevStats.rework) >= 0 ? '+' + (curStats.rework - prevStats.rework) : (curStats.rework - prevStats.rework)],
      ['返工率', `${curStats.rate}%`, `${prevStats.rate}%`, `${deltaColor}${deltaSign}${rateDelta}%\x1b[0m`]
    ]
  );

  // ── 3. 按订单维度统计：返工率、退货数、疵点爆发 ──
  const orderMap = {};
  recentInsp.forEach(i => {
    if (!orderMap[i.orderNo]) {
      const o = storage.findOrder(i.orderNo) || {};
      orderMap[i.orderNo] = {
        orderNo: i.orderNo,
        styleNo: i.styleNo || o.styleNo || '',
        customer: o.customer || '',
        inspCount: 0,
        totalInsp: 0,
        reworkQty: 0,
        rejectQty: 0,
        defects: {},
        firstInsp: i.inspectDate,
        lastInsp: i.inspectDate
      };
    }
    const s = orderMap[i.orderNo];
    s.inspCount++;
    s.totalInsp += i.inspectedQty;
    s.reworkQty += i.reworkQty;
    s.rejectQty += i.rejectQty;
    Object.entries(i.defects || {}).forEach(([d, n]) => { s.defects[d] = (s.defects[d] || 0) + n; });
    if (new Date(i.inspectDate) < new Date(s.firstInsp)) s.firstInsp = i.inspectDate;
    if (new Date(i.inspectDate) > new Date(s.lastInsp)) s.lastInsp = i.inspectDate;
  });

  // 处置状态表（所有订单最新处置）
  const latestHandlingMap = storage.getAllLatestRiskHandlings();

  // ── 4. 计算每条风险评分 ──
  const alerts = [];
  Object.values(orderMap).forEach(s => {
    const reworkRate = s.totalInsp > 0 ? (s.reworkQty / s.totalInsp) * 100 : 0;
    s.reworkRate = reworkRate;
    s.rejectRate = s.totalInsp > 0 ? (s.rejectQty / s.totalInsp) * 100 : 0;
    s.topDefect = Object.entries(s.defects).sort((a, b) => b[1] - a[1])[0];

    // 环比返工率对比
    const prevOrderInsp = prevInsp.filter(i => i.orderNo === s.orderNo);
    const prev = calculateReorderRate(prevOrderInsp);
    s.rateDelta = reworkRate - prev.rate;

    const reasons = [];
    let score = 0;

    if (reworkRate >= 5) { reasons.push('🔴 返工率≥5% 严重'); score += 100; }
    else if (reworkRate >= 3) { reasons.push('🟠 返工率≥3% 偏高'); score += 50; }
    else if (reworkRate >= 1) { reasons.push('🟡 返工率≥1% 观察'); score += 20; }

    if (s.rateDelta >= 3) { reasons.push(`📈 返工率环比上升 ${s.rateDelta.toFixed(1)}%`); score += 60; }
    else if (s.rateDelta >= 1) { reasons.push(`📈 返工率环比上升 ${s.rateDelta.toFixed(1)}%`); score += 30; }

    if (s.rejectQty >= 10) { reasons.push(`🔴 退货数偏高(${s.rejectQty}件)`); score += 80; }
    else if (s.rejectQty >= 5) { reasons.push(`🟠 退货数较多(${s.rejectQty}件)`); score += 40; }
    else if (s.rejectQty >= 1) { reasons.push(`🟡 有退货记录(${s.rejectQty}件)`); score += 10; }

    if (s.topDefect && s.topDefect[1] >= 10) { reasons.push(`🔥 [${s.topDefect[0]}] 疵点爆发(${s.topDefect[1]}个)`); score += 70; }
    else if (s.topDefect && s.topDefect[1] >= 5) { reasons.push(`⚠️ [${s.topDefect[0]}] 疵点较多(${s.topDefect[1]}个)`); score += 30; }

    s.reasons = reasons;
    s.score = score;

    // 附加上最新处置记录
    s.latestHandling = latestHandlingMap[s.orderNo] || null;

    if (score > 0) alerts.push(s);
  });

  alerts.sort((a, b) => b.score - a.score);

  // 隐藏已关闭
  let displayAlerts = alerts;
  let closedCount = 0;
  if (opts.hideClosed) {
    displayAlerts = alerts.filter(s => !s.latestHandling || s.latestHandling.status !== 'CLOSED');
    closedCount = alerts.length - displayAlerts.length;
  }

  if (displayAlerts.length === 0) {
    console.log();
    if (closedCount > 0) {
      printSuccess(`✅ 共 ${alerts.length} 条风险，已全部处理关闭！(已隐藏 ${closedCount} 条已关闭)`);
    } else {
      printSuccess(`✅ 最近 ${days} 天暂无高风险订单，品质表现稳定！`);
    }
    return 0;
  }

  const statusRender = (st) => ({
    PENDING: '\x1b[35m🟣 待处理\x1b[0m',
    NOTIFIED: '\x1b[36m🔵 已通知组长\x1b[0m',
    REINSPECTED: '\x1b[33m🟡 已复检\x1b[0m',
    CLOSED: '\x1b[32m🟢 已关闭\x1b[0m'
  }[st] || '\x1b[35m🟣 待处理\x1b[0m');

  const totalPending = alerts.filter(s => !s.latestHandling || s.latestHandling.status === 'PENDING').length;
  const totalNotified = alerts.filter(s => s.latestHandling && s.latestHandling.status === 'NOTIFIED').length;
  const totalReinspected = alerts.filter(s => s.latestHandling && s.latestHandling.status === 'REINSPECTED').length;
  const totalClosed = alerts.filter(s => s.latestHandling && s.latestHandling.status === 'CLOSED').length;

  printSection(`需要关注的订单 (共显示 ${displayAlerts.length}/${alerts.length} 个 · 待处理${totalPending} 已通知${totalNotified} 已复检${totalReinspected} 已关闭${totalClosed} · 按风险优先级排序)`);
  if (closedCount > 0) {
    printInfo(`已隐藏 ${closedCount} 条已关闭订单，不加 --hideClosed 可查看全部`);
  }

  displayAlerts.forEach((s, idx) => {
    const badge = s.score >= 100 ? '\x1b[31m🔴 紧急\x1b[0m'
      : s.score >= 60 ? '\x1b[33m🟠 高\x1b[0m'
        : s.score >= 30 ? '\x1b[33m🟡 中\x1b[0m'
          : '\x1b[36m🔵 低\x1b[0m';
    console.log();
    console.log(`${String(idx + 1).padStart(2, ' ')}. ${badge}  [风险分 ${s.score}]  订单 ${s.orderNo}  款号 ${s.styleNo || '-'}  客户 ${s.customer || '-'}`);
    console.log(`      返工率: ${s.reworkRate.toFixed(2)}%  |  返工: ${s.reworkQty}件  |  退货: ${s.rejectQty}件  |  质检: ${s.inspCount}次 / ${s.totalInsp}件`);
    if (s.rateDelta !== 0) {
      const arrow = s.rateDelta > 0 ? '↑' : '↓';
      const color = s.rateDelta > 0 ? '\x1b[31m' : '\x1b[32m';
      console.log(`      环比变化: ${color}${arrow} ${Math.abs(s.rateDelta).toFixed(1)}%\x1b[0m  (前${days}天 ${(s.reworkRate - s.rateDelta).toFixed(2)}%)`);
    }
    console.log(`      质检日期: ${formatDate(s.firstInsp)} ~ ${formatDate(s.lastInsp)}`);
    console.log(`      风险原因: ${s.reasons.join('  ')}`);
    if (s.topDefect) console.log(`      最高发疵点: ${s.topDefect[0]} × ${s.topDefect[1]}  → 建议: ${getDefectSuggestion(s.topDefect[0])}`);

    // 处置状态闭环
    if (s.latestHandling) {
      console.log(`      处置状态: ${statusRender(s.latestHandling.status)}  |  负责人: ${s.latestHandling.handledBy || '-'}  |  处理时间: ${formatDateTime(s.latestHandling.handledAt)}`);
      if (s.latestHandling.note) console.log(`      最近备注: "${s.latestHandling.note}"`);
    } else {
      console.log(`      处置状态: ${statusRender('PENDING')}  (尚未登记处置)`);
    }
    console.log(`      处置命令: gt query --alert --handleStatus PENDING|NOTIFIED|REINSPECTED|CLOSED --orderNo ${s.orderNo} --handleBy <姓名> --handleNote "备注"`);
    console.log(`      ➜ 查看详情: gt query --orderNo ${s.orderNo}`);
    console.log(`      ➜ 返工率分析: gt query --reworkRate --orderNo ${s.orderNo}`);
  });

  // ── 5. 全维度疵点爆发汇总 ──
  const allDefects = {};
  recentInsp.forEach(i => {
    Object.entries(i.defects || {}).forEach(([d, n]) => {
      if (!allDefects[d]) allDefects[d] = { cur: 0, prev: 0 };
      allDefects[d].cur += n;
    });
  });
  prevInsp.forEach(i => {
    Object.entries(i.defects || {}).forEach(([d, n]) => {
      if (!allDefects[d]) allDefects[d] = { cur: 0, prev: 0 };
      allDefects[d].prev += n;
    });
  });
  const defectAlerts = Object.entries(allDefects)
    .map(([d, v]) => ({ name: d, cur: v.cur, prev: v.prev, delta: v.cur - v.prev, deltaPct: v.prev > 0 ? ((v.cur - v.prev) / v.prev * 100) : v.cur > 0 ? 999 : 0 }))
    .filter(v => v.cur >= 3 && (v.delta >= 2 || v.deltaPct >= 50))
    .sort((a, b) => b.cur - a.cur);

  if (defectAlerts.length > 0) {
    console.log();
    printSection(`疵点异常波动 (最近${days}天 vs 前${days}天, 共${defectAlerts.length}类)`);
    printTable(
      ['疵点类型', `最近${days}天`, `前${days}天`, '增长数', '增幅'],
      defectAlerts.map(d => [
        d.name, d.cur, d.prev,
        d.delta > 0 ? '+' + d.delta : d.delta,
        d.deltaPct >= 999 ? '新增爆发' : (d.deltaPct > 0 ? '+' + d.deltaPct.toFixed(0) + '%' : d.deltaPct.toFixed(0) + '%')
      ])
    );
    defectAlerts.forEach(d => {
      console.log(`  💡 [${d.name}] ${getDefectSuggestion(d.name)}`);
    });
  }

  // ── 6. 客户维度TOP5 ──
  const custMap = {};
  recentInsp.forEach(i => {
    const o = storage.findOrder(i.orderNo) || {};
    const c = o.customer || '(未填)';
    if (!custMap[c]) custMap[c] = { total: 0, rework: 0, reject: 0, orders: new Set() };
    custMap[c].total += i.inspectedQty;
    custMap[c].rework += i.reworkQty;
    custMap[c].reject += i.rejectQty;
    custMap[c].orders.add(i.orderNo);
  });
  const custRank = Object.entries(custMap)
    .map(([c, v]) => [c, v.orders.size, v.total, v.rework, v.reject, v.total > 0 ? ((v.rework / v.total) * 100).toFixed(2) + '%' : '0.00%'])
    .sort((a, b) => parseFloat(b[5]) - parseFloat(a[5]))
    .slice(0, 5);

  if (custRank.length > 1) {
    console.log();
    printSection('按客户维度返工率排名 (Top 5)');
    printTable(['客户', '订单数', '抽检数', '返工数', '退货数', '返工率'], custRank);
  }

  console.log();
  printInfo('快捷操作:');
  console.log(`  ➜ 调整窗口: gt query --alert --days 30`);
  console.log(`  ➜ 隐藏已关闭: gt query --alert --days ${days} --hideClosed`);
  console.log(`  ➜ 整体返工率: gt query --reworkRate --fromDate ${formatDate(curStart)} --toDate ${formatDate(today)}`);

  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 批次追踪：面料缸号 / 辅料批次 / 质检批次 三维合一
// ═══════════════════════════════════════════════════════════════
function queryByBatch(storage, batchNo) {
  printHeader(`批次完整追踪: ${batchNo}`);

  const matchedMaterials = storage.getMaterials().filter(m =>
    (m.lotNo && m.lotNo.toLowerCase().includes(batchNo.toLowerCase())) ||
    (m.batchNo && m.batchNo.toLowerCase().includes(batchNo.toLowerCase()))
  );

  const matchedInspections = storage.getInspections().filter(i =>
    i.batchNo && i.batchNo.toLowerCase().includes(batchNo.toLowerCase())
  );

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

  if (matchedMaterials.length > 0) {
    printSection(`匹配的面辅料明细 (共${matchedMaterials.length}条)`);
    printTable(
      ['订单号', '类型', '分类', '名称', '面料缸号', '辅料批次', '颜色', '数量', '单位', '供应商'],
      matchedMaterials.map(m => [
        m.orderNo, m.type, m.category || '-', m.name,
        m.lotNo || '-', m.batchNo || '-', m.color || '-',
        m.qty, m.unit || '-', m.supplier || '-'
      ])
    );
  }

  const allCuts = [];
  const allBoxes = [];
  orders.forEach(o => {
    storage.findCuttingByOrder(o.orderNo).forEach(c => allCuts.push(c));
    storage.findBoxesByOrder(o.orderNo).forEach(b => allBoxes.push(b));
  });

  if (allCuts.length > 0) {
    const linkedFabricLots = new Set(matchedMaterials.filter(m => m.type === '面料').map(m => m.lotNo).filter(Boolean));
    const matchedCuts = allCuts.filter(c => !c.fabricLot || linkedFabricLots.has(c.fabricLot) || matchedMaterials.length === 0 ? true : linkedFabricLots.has(c.fabricLot));
    const displayCuts = matchedMaterials.some(m => m.type === '面料' && m.lotNo) ? matchedCuts : allCuts;
    const totalCut = displayCuts.reduce((s, c) => s + (c.totalQty || 0), 0);
    printSection(`关联的裁剪床次 (共${displayCuts.length}床, ${totalCut}件)`);
    printTable(
      ['订单号', '床次', '层数', '拉布匹数', '裁剪数', '裁剪员', '裁剪日期', '面料缸号'],
      displayCuts.map(c => [
        c.orderNo, c.bedNo, c.layerCount || '-', c.spreads || '-',
        c.totalQty, c.cutter || '-', formatDate(c.cutDate), c.fabricLot || '-'
      ])
    );
  }

  if (allBoxes.length > 0) {
    const totalQty = allBoxes.reduce((s, b) => s + (b.qty || 0), 0);
    printSection(`关联的出货箱 (共${allBoxes.length}箱, ${totalQty}件)`);
    printTable(
      ['箱唛编号', '订单号', '款号', '颜色', '件数', '毛重(kg)', '净重(kg)', '包装日期'],
      allBoxes.map(b => [
        b.boxNo, b.orderNo, b.styleNo, b.color || '-',
        b.qty, b.grossWeight || '-', b.netWeight || '-', formatDate(b.packDate)
      ])
    );
    console.log();
    printInfo('按箱号查看完整追溯链:');
    allBoxes.forEach(b => console.log(`  ➜ gt query --boxNo ${b.boxNo}`));
  }

  const allInsp = [];
  orders.forEach(o => storage.findInspectionsByOrder(o.orderNo).forEach(i => allInsp.push(i)));
  if (allInsp.length > 0) {
    const totalInsp = allInsp.reduce((s, i) => s + i.inspectedQty, 0);
    const totalRework = allInsp.reduce((s, i) => s + i.reworkQty, 0);
    const rr = totalInsp > 0 ? ((totalRework / totalInsp) * 100).toFixed(2) : '0.00';
    printSection(`关联质检记录 (共${allInsp.length}次, 返工率${rr}%)`);
    printTable(
      ['订单号', '箱号/批次', '检验员', '日期', '抽检', '合格', '返工', '退货', '判定'],
      allInsp.map(i => [
        i.orderNo, i.boxNo || i.batchNo || '-', i.inspector || '-', formatDate(i.inspectDate),
        i.inspectedQty, i.passQty, i.reworkQty, i.rejectQty, renderJudgment(i.judgment)
      ])
    );
  }

  console.log();
  orders.forEach(o => printInfo(`➜ 订单追溯: gt query --orderNo ${o.orderNo}`));

  return 0;
}

function queryByMaterialBatch(storage, opts) {
  const key = opts.lotNo
    ? `面料缸号 ${opts.lotNo}`
    : `辅料批次 ${opts.materialBatch}`;
  const batch = opts.lotNo || opts.materialBatch;
  printSection(`精确查询入口: ${key}`);
  return queryByBatch(storage, batch);
}

// ═══════════════════════════════════════════════════════════════
// 返工率分析（含日期闭区间 + 命中范围显示）
// ═══════════════════════════════════════════════════════════════
function showReworkRate(storage, opts = {}) {
  printHeader('返工率统计分析');

  const filters = [];
  if (opts.customer) filters.push(`客户="${opts.customer}"`);
  if (opts.styleNo) filters.push(`款号包含"${opts.styleNo}"`);
  if (opts.orderNo) filters.push(`订单号="${opts.orderNo}"`);
  let fromTs = null, toTs = null;
  if (opts.fromDate) {
    const d = new Date(opts.fromDate);
    d.setHours(0, 0, 0, 0);
    fromTs = d.getTime();
    filters.push(`日期≥${opts.fromDate} (含全天)`);
  }
  if (opts.toDate) {
    const d = new Date(opts.toDate);
    d.setHours(23, 59, 59, 999);
    toTs = d.getTime();
    filters.push(`日期≤${opts.toDate} (含全天)`);
  }
  if (filters.length > 0) {
    printInfo(`当前筛选: ${filters.join('  AND  ')}`);
    console.log();
  }

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

  let inspections = storage.getInspections().filter(i => matchedOrderNos.has(i.orderNo));
  if (fromTs !== null) {
    inspections = inspections.filter(i => new Date(i.inspectDate).getTime() >= fromTs);
  }
  if (toTs !== null) {
    inspections = inspections.filter(i => new Date(i.inspectDate).getTime() <= toTs);
  }

  if (inspections.length === 0) {
    printWarning('筛选条件下暂无质检记录数据');
    if (matchedOrders.length === 0 && filters.length > 0) {
      printWarning('提示：没有匹配到任何订单，请调整筛选条件');
    }
    return 0;
  }

  // 实际命中的日期范围
  const tsArr = inspections.map(i => new Date(i.inspectDate).getTime());
  const earliest = new Date(Math.min(...tsArr));
  const latest = new Date(Math.max(...tsArr));
  printSection('时间范围确认');
  printTable(
    ['项目', '日期时间'],
    [
      ['筛选条件区间', `${opts.fromDate || '不限'}  ~  ${opts.toDate || '不限'}`],
      ['实际最早质检', formatDateTime(earliest)],
      ['实际最晚质检', formatDateTime(latest)],
      ['命中记录数', inspections.length + ' 次']
    ]
  );

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

  const highRisk = orderRows.filter(r => parseFloat(r[7]) >= 3 || r[5] >= 20);
  if (highRisk.length > 0) {
    printSection(`⚠ 重点关注订单 (返工率≥3% 或 返工数≥20, 共${highRisk.length}个)`);
    highRisk.forEach((r, idx) => {
      const advice = parseFloat(r[7]) >= 5
        ? '🔴 严重：立即停线排查'
        : parseFloat(r[7]) >= 3
          ? '🟠 警告：加强抽检'
          : '🟡 观察：关注返工趋势';
      console.log(`  ${idx + 1}. [${advice}] 订单 ${r[0]} (款号 ${r[1]})  返工率 ${r[7]}  返工 ${r[5]}件 / 退货 ${r[6]}件`);
      console.log(`     ➜ 查看详情: gt query --orderNo ${r[0]}`);
    });
  }

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

    const topDefect = Object.entries(defectSummary).sort((a, b) => b[1] - a[1])[0];
    if (topDefect) {
      console.log();
      printInfo(`最多发疵点是「${topDefect[0]}」(${topDefect[1]}个)，建议：`);
      console.log(`  ${getDefectSuggestion(topDefect[0])}`);
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
// 聚合查询类
// ═══════════════════════════════════════════════════════════════
function queryByStyle(storage, styleNo) {
  const orders = storage.getOrders().filter(o => o.styleNo.toLowerCase().includes(styleNo.toLowerCase()));
  if (orders.length === 0) {
    printWarning(`未找到款号包含 "${styleNo}" 的订单`);
    return 1;
  }
  printHeader(`款号聚合追溯: ${styleNo} (共匹配 ${orders.length} 个订单)`);
  orders.forEach(o => {
    const insp = storage.findInspectionsByOrder(o.orderNo);
    const stats = calculateReorderRate(insp);
    const cuts = storage.findCuttingByOrder(o.orderNo);
    const boxes = storage.findBoxesByOrder(o.orderNo);
    printSection(`[${o.orderNo}] ${o.styleName || ''}  客户: ${o.customer}  数量: ${o.qty}`);
    printTable(
      ['项目', '数值'],
      [
        ['交期', o.deliveryDate ? formatDate(o.deliveryDate) : '-'],
        ['裁剪床次', `${cuts.length}床 / ${cuts.reduce((s, c) => s + (c.totalQty || 0), 0)}件`],
        ['出货箱数', `${boxes.length}箱 / ${boxes.reduce((s, b) => s + (b.qty || 0), 0)}件`],
        ['质检次数', `${insp.length}次 / ${stats.total}件`],
        ['返工率', `${stats.rate}%`],
        ['订单状态', renderStatus(o.status)]
      ]
    );
    printInfo(`  ➜ 详细追溯: gt query --orderNo ${o.orderNo}`);
  });
  return 0;
}

function queryByOrder(storage, orderNo, withDetails) {
  const order = storage.findOrder(orderNo);
  if (!order) {
    printError(`订单不存在: ${orderNo}`);
    return 1;
  }
  printHeader(`订单完整追溯: ${orderNo}`);
  printSection('基本信息');
  printTable(
    ['字段', '值'],
    [
      ['订单号', order.orderNo],
      ['款号', order.styleNo],
      ['款式名称', order.styleName || '-'],
      ['客户', order.customer],
      ['数量', order.qty],
      ['颜色', order.color || '-'],
      ['单价/金额', order.unitPrice ? `${order.unitPrice}元 / ${order.amount ? order.amount.toFixed(2) + '元' : '-'}` : '-'],
      ['交期', order.deliveryDate ? formatDate(order.deliveryDate) : '-'],
      ['创建时间', formatDateTime(order.createdAt)],
      ['状态', renderStatus(order.status)]
    ]
  );

  const materials = storage.findMaterialsByOrder(orderNo);
  printSection(`面辅料绑定 (${materials.length}条)`);
  if (materials.length === 0) {
    printWarning('  未绑定任何面辅料');
  } else {
    printTable(
      ['类型', '分类', '名称', '编码', '缸号/批次', '颜色', '数量', '单位', '供应商', 'IQC结果'],
      materials.map(m => [
        m.type, m.category || '-', m.name, m.code || '-',
        m.lotNo || m.batchNo || '(缺!)', m.color || '-',
        m.qty, m.unit || '-', m.supplier || '-',
        renderMaterialResult(m.inspectionResult || 'PENDING')
      ])
    );
  }

  const cuts = storage.findCuttingByOrder(orderNo);
  const cutQty = cuts.reduce((s, c) => s + (c.totalQty || 0), 0);
  printSection(`裁剪床次 (${cuts.length}床, 合计${cutQty}件)`);
  if (cuts.length === 0) {
    printWarning('  无裁剪记录');
  } else {
    printTable(
      ['床次', '面料缸号', '层数', '拉布', '件数', '裁剪员', '裁剪日期'],
      cuts.map(c => [
        c.bedNo, c.fabricLot || '-', c.layerCount || '-', c.spreads || '-',
        c.totalQty, c.cutter || '-', formatDate(c.cutDate)
      ])
    );
  }

  const sewing = storage.findSewingByOrder(orderNo);
  const groups = sewing.filter(s => s.process !== '整烫包装');
  const ironPack = sewing.find(s => s.process === '整烫包装');
  printSection(`缝制组别 (${groups.length}组)`);
  if (groups.length === 0) {
    printWarning('  无缝制组别记录');
  } else {
    const sewDone = groups.reduce((s, g) => s + (g.completedQty || 0), 0);
    const sewAssigned = groups.reduce((s, g) => s + (g.assignedQty || 0), 0);
    printTable(
      ['组别', '组长', '人数', '分配', '完成', '不良数', '开始', '结束'],
      groups.map(g => [
        g.groupNo, g.leader || '-', g.members?.length || 0,
        g.assignedQty || '-', g.completedQty || '-', g.defectQty || 0,
        formatDate(g.startDate), formatDate(g.endDate)
      ])
    );
    printInfo(`  累计完成: ${sewDone}/${sewAssigned || order.qty} 件`);
  }

  if (ironPack) {
    printSection('整烫包装记录');
    printTable(
      ['项目', '内容'],
      [
        ['整烫日期/整烫员', `${formatDate(ironPack.ironDate) || '-'} / ${ironPack.ironedBy || '-'}`],
        ['整烫数量', ironPack.ironQty || '-'],
        ['包装日期/包装员', `${formatDate(ironPack.packDate) || '-'} / ${ironPack.packedBy || '-'}`],
        ['包装数量', ironPack.packQty || '-'],
        ['应装总箱数', ironPack.boxCount || '-']
      ]
    );
  } else {
    printSection('整烫包装记录');
    printWarning('  无整烫包装记录');
  }

  const inspections = storage.findInspectionsByOrder(orderNo);
  const stats = calculateReorderRate(inspections);
  printSection(`质检抽检 (${inspections.length}次, 返工率${stats.rate}%)`);
  if (inspections.length === 0) {
    printWarning('  无质检记录');
  } else {
    printTable(
      ['#', '箱号/批次', '检验员', '日期', '抽检', '合格', '返工', '退货', '判定'],
      inspections.map((i, idx) => [
        idx + 1, i.boxNo || i.batchNo || '-', i.inspector || '-', formatDate(i.inspectDate),
        i.inspectedQty, i.passQty, i.reworkQty, i.rejectQty, renderJudgment(i.judgment)
      ])
    );
  }

  const boxes = storage.findBoxesByOrder(orderNo);
  const codes = storage.findTraceCodesByOrder(orderNo);
  const boxQty = boxes.reduce((s, b) => s + (b.qty || 0), 0);
  printSection(`出货箱唛 (${boxes.length}箱, 合计${boxQty}件)`);
  if (boxes.length === 0) {
    printWarning('  无箱唛记录');
  } else {
    const rows = boxes.map(b => {
      const bound = codes.find(c => c.boxNo === b.boxNo);
      return [
        b.boxNo, b.sequence, b.color || '-',
        Object.entries(b.sizes || {}).map(([s, n]) => `${s}:${n}`).join(' '),
        b.qty, `${b.grossWeight || '-'}/${b.netWeight || '-'}`,
        formatDate(b.packDate),
        bound ? `\x1b[32m✅ ${bound.code}\x1b[0m` : '\x1b[31m❌ 未绑定\x1b[0m'
      ];
    });
    printTable(
      ['箱唛编号', '序', '颜色', '尺码', '件数', '毛/净重(kg)', '包装日期', '追溯码'],
      rows
    );
    const missing = boxes.filter(b => !codes.find(c => c.boxNo === b.boxNo)).length;
    if (missing > 0) {
      printWarning(`  ⚠ 有 ${missing} 个箱子未绑定追溯码，补录: gt export --traceCodes --orderNo ${orderNo}`);
    }
    boxes.slice(0, 3).forEach(b => printInfo(`  ➜ 箱号追溯: gt query --boxNo ${b.boxNo}`));
    if (boxes.length > 3) printInfo(`  ... 共 ${boxes.length} 箱，按需单独查询`);
  }

  const scanLogs = storage.findScanLogsByOrder(orderNo);
  if (scanLogs.length > 0) {
    printSection(`追溯码扫码记录 (${scanLogs.length}次)`);
    const scanRows = scanLogs.slice(0, 10).map(l => [
      formatDateTime(l.scannedAt), l.traceCode, l.boxNo, l.note || '(无备注)'
    ]);
    printTable(['扫码时间', '追溯码', '箱号', '备注'], scanRows);
    if (scanLogs.length > 10) printInfo(`  仅展示最近 10 条，共 ${scanLogs.length} 条`);
  }

  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 追溯码查询 (支持扫码备注记录)
// ═══════════════════════════════════════════════════════════════
function queryByTraceCode(storage, code, scanNote) {
  const trace = storage.findTraceCode(code);
  if (!trace) {
    printWarning(`未找到追溯码: ${code}`);
    return 1;
  }

  if (scanNote !== undefined || true) {
    const scanLog = {
      traceCode: code,
      orderNo: trace.orderNo,
      styleNo: trace.styleNo,
      boxNo: trace.boxNo,
      note: scanNote || '（系统自动记录一次查询）',
      scannedAt: new Date().toISOString()
    };
    storage.addScanLog(scanLog);
  }

  const history = storage.findScanLogsByTraceCode(code);
  const lastScan = history.length > 0 ? history[history.length - 1] : null;

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
      ['累计查询次数', history.length + ' 次'],
      ['最近查询时间', lastScan ? formatDateTime(lastScan.scannedAt) : '（本次首次）']
    ]
  );

  if (scanNote) {
    console.log();
    printSuccess(`✅ 已记录本次扫码备注: "${scanNote}"`);
  } else if (history.length > 0) {
    printInfo(`ℹ 本次查询已自动计入扫码历史（累计${history.length}次），带备注: --traceCode XXX --scanNote "客户验收"`);
  }

  if (history.length > 0) {
    printSection(`扫码历史记录 (最近 ${Math.min(10, history.length)} 条)`);
    const display = history.slice(-10).reverse();
    printTable(
      ['时间', '备注'],
      display.map(h => [formatDateTime(h.scannedAt), h.note || '-'])
    );
  }

  if (trace.boxNo) {
    console.log();
    printInfo('═══════════════════════════════════════════════════════');
    printInfo('📦 以下是该追溯码对应箱子的完整生产链路：');
    printInfo('═══════════════════════════════════════════════════════');
    queryByBox(storage, trace.boxNo);
    return 0;
  }

  console.log();
  queryByOrder(storage, trace.orderNo, false);
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 箱号完整追溯 (串联全链路)
// ═══════════════════════════════════════════════════════════════
function queryByBox(storage, boxNo) {
  const box = storage.findBoxByNo(boxNo);
  if (!box) {
    printWarning(`未找到箱唛: ${boxNo}`);
    printInfo('查看箱唛清单: gt inspect --listBoxes');
    return 1;
  }

  const on = box.orderNo;
  const order = storage.findOrder(on) || {};
  const materials = storage.findMaterialsByOrder(on);
  const cuts = storage.findCuttingByOrder(on);
  const sewing = storage.findSewingByOrder(on);
  const groups = sewing.filter(s => s.process !== '整烫包装');
  const ironPack = sewing.find(s => s.process === '整烫包装');
  const inspections = storage.findInspectionsByBox(boxNo);
  const boxInspStats = calculateReorderRate(inspections);
  const allInsp = storage.findInspectionsByOrder(on);
  const orderInspStats = calculateReorderRate(allInsp);
  const codes = storage.findTraceCodesByOrder(on).filter(c => c.boxNo === boxNo);
  const scanLogs = codes.length > 0 ? storage.findScanLogsByTraceCode(codes[0].code) : [];

  printHeader(`📦 箱唛完整追溯链: ${boxNo}`);

  printSection('① 箱唛基本信息');
  printTable(
    ['字段', '值'],
    [
      ['箱唛编号', box.boxNo],
      ['第 N 箱', box.sequence + ' 箱'],
      ['订单号', on],
      ['款号', box.styleNo],
      ['款式名称', order.styleName || '-'],
      ['客户', order.customer || '-'],
      ['颜色', box.color || '-'],
      ['本箱件数', box.qty + ' 件'],
      ['尺码分配', Object.entries(box.sizes || {}).map(([s, q]) => `${s}:${q}`).join('  ') || '-'],
      ['毛重/净重', `${box.grossWeight || '-'}kg / ${box.netWeight || '-'}kg`],
      ['外箱尺寸', box.measure || '-'],
      ['封箱号/栈板号', `${box.sealNo || '-'} / ${box.palletNo || '-'}`],
      ['包装员/包装日期', `${box.packedBy || '-'} / ${formatDate(box.packDate)}`]
    ]
  );

  printSection(`② 关联追溯码 (${codes.length}个) + 扫码记录 (${scanLogs.length}次)`);
  if (codes.length === 0) {
    printWarning('  ⚠ 此箱暂无追溯码，建议生成: gt export --traceCodes --orderNo ' + on);
  } else {
    const code = codes[0];
    printTable(
      ['字段', '值'],
      [
        ['追溯码', code.code],
        ['生成时间', formatDateTime(code.createdAt)],
        ['累计查询次数', scanLogs.length + ' 次'],
        ['最近查询时间', scanLogs.length > 0 ? formatDateTime(scanLogs[scanLogs.length - 1].scannedAt) : '尚未查询']
      ]
    );
    if (scanLogs.length > 0) {
      const recent = scanLogs.slice(-5).reverse();
      console.log('  最近扫码:');
      recent.forEach(h => console.log(`    · ${formatDateTime(h.scannedAt)}  ${h.note || ''}`));
    }
  }

  printSection(`③ 所属订单概况 (${on})`);
  const codesAll = storage.findTraceCodesByOrder(on);
  const boxesAll = storage.findBoxesByOrder(on);
  printTable(
    ['字段', '值'],
    [
      ['订单号 / 款号', `${on} / ${order.styleNo}`],
      ['款式 / 客户', `${order.styleName || '-'} / ${order.customer || '-'}`],
      ['订单数量 / 交期', `${order.qty}件 / ${order.deliveryDate ? formatDate(order.deliveryDate) : '-'}`],
      ['订单状态', renderStatus(order.status)],
      ['裁剪床次', `${cuts.length}床 / ${cuts.reduce((s, c) => s + (c.totalQty || 0), 0)}件`],
      ['缝制组别', `${groups.length}组`],
      ['出货箱数', `${boxesAll.length}箱 / ${boxesAll.reduce((s, b) => s + (b.qty || 0), 0)}件`],
      ['整订单返工率', `${orderInspStats.rate}% (${allInsp.length}次质检/${orderInspStats.total}件抽检/${orderInspStats.rework}件返工)`],
      ['追溯码绑定率', `${codesAll.length}/${boxesAll.length} 箱${codesAll.length < boxesAll.length ? ' ⚠有缺失' : ' ✅齐全'}`]
    ]
  );

  if (materials.length > 0) {
    printSection(`④ 本订单使用的面辅料批次 (${materials.length}条，全箱共用)`);
    printTable(
      ['类型', '分类', '名称', '编码', '缸号/批次', '颜色', '数量', '供应商'],
      materials.map(m => [
        m.type, m.category || '-', m.name, m.code || '-',
        m.lotNo || m.batchNo || '\x1b[31m⚠缺号\x1b[0m',
        m.color || '-', m.qty, m.supplier || '-'
      ])
    );
  }

  if (cuts.length > 0) {
    printSection(`⑤ 关联裁剪床次 (${cuts.length}床)`);
    printTable(
      ['床次', '关联面料缸号', '层数', '拉布', '件数', '裁剪员', '日期'],
      cuts.map(c => [
        c.bedNo, c.fabricLot || '-', c.layerCount || '-', c.spreads || '-',
        c.totalQty, c.cutter || '-', formatDate(c.cutDate)
      ])
    );
  }

  if (groups.length > 0) {
    const sewDone = groups.reduce((s, g) => s + (g.completedQty || 0), 0);
    printSection(`⑥ 缝制组别 (${groups.length}组, 累计完成${sewDone}件)`);
    printTable(
      ['组别', '组长', '人数', '分配', '完成', '不良数', '开线', '结束'],
      groups.map(g => [
        g.groupNo, g.leader || '-', g.members?.length || 0,
        g.assignedQty || '-', g.completedQty || '-', g.defectQty || 0,
        formatDate(g.startDate), formatDate(g.endDate)
      ])
    );
  }

  if (ironPack) {
    printSection('⑦ 整烫包装记录');
    printTable(
      ['项目', '内容'],
      [
        ['整烫', `${formatDate(ironPack.ironDate) || '-'}  by ${ironPack.ironedBy || '-'}  (${ironPack.ironQty || '-'}件)`],
        ['包装', `${formatDate(ironPack.packDate) || '-'}  by ${ironPack.packedBy || '-'}  (${ironPack.packQty || '-'}件)`],
        ['计划总箱数', ironPack.boxCount || '-']
      ]
    );
  }

  printSection(`⑧ 本箱质检记录 (${inspections.length}次, 返工率${boxInspStats.rate}%)`);
  if (inspections.length === 0) {
    printWarning('  ⚠ 此箱暂无单独质检记录（可能是整批质检），可查看整订单质检: gt query --orderNo ' + on);
  } else {
    inspections.forEach((i, idx) => {
      console.log(`  第 ${idx + 1} 次 | 检验员: ${i.inspector || '-'} | 日期: ${formatDate(i.inspectDate)} | 判定: ${renderJudgment(i.judgment)}`);
      console.log(`    抽检:${i.inspectedQty}  合格:${i.passQty}  返工:${i.reworkQty}  退货:${i.rejectQty}`);
      if (Object.keys(i.defects || {}).length > 0) {
        const d = Object.entries(i.defects).map(([x, n]) => `${x}×${n}`).join('，');
        console.log(`    疵点: ${d}`);
      }
      if (i.level) console.log(`    检验标准: ${i.level}`);
      if (i.note) console.log(`    备注: ${i.note}`);
      console.log();
    });
  }

  const allBoxesOfOrder = storage.findBoxesByOrder(on);
  const totalQtyOfBoxes = allBoxesOfOrder.reduce((s, b) => s + (b.qty || 0), 0);
  const packQty = ironPack ? (ironPack.packQty || 0) : 0;
  if (packQty > 0 && totalQtyOfBoxes > 0 && packQty !== totalQtyOfBoxes) {
    printSection('⚠️ 对账差异提醒');
    printWarning(`  整烫包装记录 packQty=${packQty}件 vs 箱唛表合计=${totalQtyOfBoxes}件，差异 ${Math.abs(packQty - totalQtyOfBoxes)} 件`);
    printInfo(`  补录建议: ${packQty > totalQtyOfBoxes ? '用 gt inspect --newBox 补开剩余箱唛' : '用 gt record-sew 更新 packQty'}`);
  }

  console.log();
  printInfo('快捷跳转:');
  printInfo(`  ➜ 整订单追溯: gt query --orderNo ${on}`);
  printInfo(`  ➜ 整订单返工率: gt query --reworkRate --orderNo ${on}`);
  printInfo(`  ➜ 查看下一箱/上一箱: gt query --boxNo ${generateNearbyBoxNo(allBoxesOfOrder, boxNo, -1) || '（已是第一箱）'}`);
  printInfo(`  ➜ 打印箱唛标签: gt export --printBox ${boxNo}`);

  return 0;
}

function generateNearbyBoxNo(boxes, cur, delta) {
  const list = boxes.map(b => b.boxNo).sort();
  const idx = list.indexOf(cur);
  if (idx === -1) return null;
  const target = idx + delta;
  if (target < 0 || target >= list.length) return null;
  return list[target];
}

// ═══════════════════════════════════════════════════════════════
// 列表 & 总览
// ═══════════════════════════════════════════════════════════════
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
  const scanCount = storage.getScanLogs().length;

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
      ['扫码查询次数', scanCount + ' 次'],
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
  console.log('  ➜ 质量预警看板: gt query --alert --days 7');
  console.log('  ➜ 返工率分析:  gt query --reworkRate');
  console.log('  ➜ 未检订单:    gt query --uninspected');
  console.log('  ➜ 漏填校验:    gt export --validate');
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 风险处置：标记状态 + 备注 + 负责人
// ═══════════════════════════════════════════════════════════════
function handleRiskHandling(storage, opts) {
  const validStatuses = ['PENDING', 'NOTIFIED', 'REINSPECTED', 'CLOSED'];
  const statusCnMap = { PENDING: '🟣 待处理', NOTIFIED: '🔵 已通知组长', REINSPECTED: '🟡 已复检', CLOSED: '🟢 已关闭' };

  let status = String(opts.handleStatus || '').toUpperCase();
  if (!validStatuses.includes(status)) {
    printError(`--handleStatus 必须是: ${validStatuses.join(' / ')}`);
    printInfo(`示例: gt query --alert --handleStatus NOTIFIED --orderNo PO2026001 --handleBy "质检主管" --handleNote "已通知李组长排查跳线问题"`);
    return 1;
  }
  if (!opts.orderNo) {
    printError('处置标记必须指定 --orderNo <订单号>');
    return 1;
  }
  const order = storage.findOrder(opts.orderNo);
  if (!order) {
    printError(`订单 ${opts.orderNo} 不存在`);
    return 1;
  }

  const record = {
    id: 'RH-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase(),
    orderNo: opts.orderNo,
    styleNo: order.styleNo || '',
    customer: order.customer || '',
    status: status,
    handledBy: opts.handleBy || '',
    note: opts.handleNote || '',
    handledAt: new Date().toISOString()
  };

  storage.addRiskHandling(record);

  printHeader(`风险处置记录成功`);
  printTable(
    ['字段', '值'],
    [
      ['处置ID', record.id],
      ['订单号 / 款号', `${record.orderNo} / ${record.styleNo || '-'}`],
      ['客户', record.customer || '-'],
      ['处置状态', statusCnMap[status] + ` (${status})`],
      ['负责人', record.handledBy || '(未填)'],
      ['处理备注', record.note || '(未填)'],
      ['处理时间', formatDateTime(record.handledAt)]
    ]
  );

  const prevList = storage.findRiskHandlingsByOrder(opts.orderNo).sort((a, b) => new Date(b.handledAt) - new Date(a.handledAt));
  if (prevList.length > 1) {
    console.log();
    printSection('该订单历史处置记录');
    printTable(
      ['时间', '状态', '负责人', '备注'],
      prevList.slice(0, 10).map(r => [
        formatDateTime(r.handledAt),
        statusCnMap[r.status] || r.status,
        r.handledBy || '-',
        r.note || '-'
      ])
    );
  }

  console.log();
  printInfo('快捷操作:');
  printInfo(`  ➜ 查看预警看板: gt query --alert --days 7`);
  printInfo(`  ➜ 隐藏已关闭订单: gt query --alert --days 7 --hideClosed`);
  printInfo(`  ➜ 查看订单详情: gt query --orderNo ${opts.orderNo}`);
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 参数解析 (新增: --alert / --days / --scanNote / --handle* / --hideClosed)
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
    '--toDate': 'toDate', '--to-date': 'toDate',
    '--days': 'days',
    '--scanNote': 'scanNote', '--scan-note': 'scanNote',
    '--handleStatus': 'handleStatus', '--handle-status': 'handleStatus',
    '--handleBy': 'handleBy', '--handle-by': 'handleBy',
    '--handleNote': 'handleNote', '--handle-note': 'handleNote'
  };

  const boolFlags = ['--uninspected', '--reworkRate', '--orders', '--summary', '--details', '--alert', '--hideClosed', '--hide-closed'];

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
  if (args.includes('--alert')) opts.alert = true;
  if (args.includes('--hideClosed') || args.includes('--hide-closed')) opts.hideClosed = true;
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
🚨 质量预警看板 (车间晨会用)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --alert                     最近7天质量预警 (默认)
  --alert --days <N>          最近N天质量预警 (7/30常用)
  --alert --days <N> --hideClosed   隐藏已关闭的风险订单
  输出:
    · 统计窗口确认 (当前窗口/实际命中最早最晚质检/环比窗口)
    · 总体趋势 (环比前N天变化)
    · 风险订单排名 (🔴紧急/🟠高/🟡中/🔵低 + 风险评分 + 处置状态)
    · 疵点异常波动爆发提醒
    · 按客户维度返工率排名
    · 每条附: 环比变化↑↓、高发疵点建议、处置命令、跳转命令

  🏷 风险处置闭环 (新增):
  --handleStatus PENDING       标记: 🟣 待处理
  --handleStatus NOTIFIED      标记: 🔵 已通知组长
  --handleStatus REINSPECTED   标记: 🟡 已复检
  --handleStatus CLOSED        标记: 🟢 已关闭
  需配套: --orderNo <订单号> --handleBy <负责人> --handleNote "备注"
  示例:
    gt query --alert --handleStatus NOTIFIED --orderNo PO2026001 --handleBy 质检主管 --handleNote "已通知李组长排查跳线"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 批次追溯（三维合一：面料缸号 / 辅料批次 / 质检批次）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --batchNo <批次号>        自动匹配面料缸号、辅料批次、质检批次，输出:
                              关联订单+款号 / 用在哪些裁剪床次 / 出了哪些箱
                              / 箱号和数量 / 质检记录 / 跳箱号查完整追溯
  --lotNo <面料缸号>        同上，专用入口（面料缸号）
  --materialBatch <批次>    同上，专用入口（辅料批次）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 返工率分析（多条件筛选 + 日期闭区间）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --reworkRate                        全量返工率分析
  --reworkRate --customer <客户>      按客户筛选
  --reworkRate --styleNo <款号>       按款号筛选
  --reworkRate --orderNo <订单号>     按订单筛选
  --reworkRate --fromDate <YYYY-MM-DD>   质检日期起 (含当天全天)
  --reworkRate --toDate   <YYYY-MM-DD>   质检日期止 (含当天全天)
  ✨ 额外显示: 实际命中最早/最晚质检日期，方便核对

  输出内容: 时间范围确认 / 总体指标 / 订单返工率Top10 / 重点关注订单预警
           / 按客户维度汇总 / 疵点TOP10(含分布图+改进建议)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 精确查询
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --orderNo <订单号>        订单全链路追溯 (含扫码记录)
  --styleNo <款号>          款号聚合追溯
  --boxNo <箱号>            ✨箱唛完整追溯链(8段式):
                              ①箱唛基本 ②追溯码+扫码 ③订单概况
                              ④面辅料批次 ⑤裁剪床次 ⑥缝制组别
                              ⑦整烫包装 ⑧质检记录 + 对账差异提醒
  --traceCode <追溯码>                  追溯码解码 (自动记录扫码)
  --traceCode XXX --scanNote "备注"     扫码时附加备注 (如:客户验收/仓管入库)
  ✨ 每次查询自动记录扫码时间+次数+最近查询时间

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 列表类查询
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  --uninspected             未完成质检的订单
  --orders                  所有订单清单
  --orders --status <状态>  按状态筛选订单
  --summary                 项目总览（默认，含扫码次数）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
示例:
  # 质量预警
  gt query --alert --days 7
  gt query --alert --days 30

  # 批次追踪 (查面料缸号/辅料批次/质检批次，任何一种都行)
  gt query --batchNo DYE20260608
  gt query --lotNo DYE20260608A

  # 返工率分析（各种筛选 + 日期全天闭区间）
  gt query --reworkRate
  gt query --reworkRate --customer 优衣库 --fromDate 2026-06-01 --toDate 2026-06-30
  gt query --reworkRate --styleNo JX-A001

  # 精确查询
  gt query --boxNo JXA001-6001-0001        (一次看全链路)
  gt query --traceCode GT-ABCD1234 --scanNote "客户QC现场扫码"
`);
}

module.exports = { run: queryCommand, help: printHelp };