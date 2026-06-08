const fs = require('fs');
const path = require('path');
const { formatDate, formatDateTime, printTable, printSuccess, printError, printWarning, printInfo, printHeader, printSection, calculateReorderRate, generateTraceCode } = require('../utils');

function exportCommand(args, storage) {
  if (!storage.isInitialized()) {
    printError('项目未初始化，请先运行 garment-trace init');
    return 1;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const opts = parseArgs(args);

  if (opts.validate) {
    return validateRecords(storage, opts.orderNo);
  }

  if (opts.traceCodes) {
    return generateTraceCodes(storage, opts.orderNo, opts.count, opts.output);
  }

  if (opts.printBox) {
    return printBoxLabel(storage, opts.printBox);
  }

  return exportInspectionPackage(storage, opts);
}

function exportInspectionPackage(storage, opts) {
  const orderNo = opts.orderNo;
  if (!orderNo) {
    printError('请指定 --orderNo <订单号> 或使用其他选项');
    printInfo('使用 --help 查看帮助');
    return 1;
  }

  const order = storage.findOrder(orderNo);
  if (!order) {
    printError(`订单 ${orderNo} 不存在`);
    return 1;
  }

  const outputDir = opts.output
    ? path.resolve(opts.output, `inspection-package-${orderNo}`)
    : path.resolve(storage.projectPath, `inspection-package-${orderNo}`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  printHeader(`生成客户验货包: ${orderNo}`);
  printInfo(`输出目录: ${outputDir}`);

  const project = storage.getProject();
  const materials = storage.findMaterialsByOrder(orderNo);
  const cuts = storage.findCuttingByOrder(orderNo);
  const sewing = storage.findSewingByOrder(orderNo);
  const inspections = storage.findInspectionsByOrder(orderNo);
  const boxes = storage.findBoxesByOrder(orderNo);
  const traceCodes = storage.findTraceCodesByOrder(orderNo);
  const stats = calculateReorderRate(inspections);

  const defectMap = {};
  inspections.forEach(i => {
    Object.entries(i.defects || {}).forEach(([d, n]) => {
      defectMap[d] = (defectMap[d] || 0) + n;
    });
  });
  const defectTotal = Object.values(defectMap).reduce((s, n) => s + n, 0);
  const defectRanking = Object.entries(defectMap)
    .sort((a, b) => b[1] - a[1])
    .map(([d, n]) => ({ type: d, count: n, ratio: defectTotal > 0 ? ((n / defectTotal) * 100).toFixed(1) + '%' : '0%' }));

  const summary = {
    project: { name: project?.name, factory: project?.factoryName, code: project?.factoryCode, contact: project?.contact, phone: project?.phone, address: project?.address },
    order: { ...order, createdAt: undefined, updatedAt: undefined },
    materials: materials.map(m => ({ ...m, id: undefined, linkedAt: undefined })),
    cuttingSummary: {
      totalBeds: cuts.length,
      totalQty: cuts.reduce((s, c) => s + (c.totalQty || 0), 0),
      cutters: [...new Set(cuts.map(c => c.cutter).filter(Boolean))],
      beds: cuts.map(c => ({ bedNo: c.bedNo, fabricLot: c.fabricLot, layers: c.layers, spreads: c.spreads, totalQty: c.totalQty, cutter: c.cutter, cutDate: c.cutDate }))
    },
    sewingSummary: {
      groups: sewing.filter(s => s.process !== '整烫包装').map(s => ({
        groupNo: s.groupNo,
        leader: s.leader,
        members: s.members?.length || 0,
        assigned: s.assignedQty,
        completed: s.completedQty,
        defects: s.defectQty
      })),
      ironPack: sewing.find(s => s.process === '整烫包装') || null
    },
    inspection: {
      totalInspections: inspections.length,
      totalInspected: stats.total,
      totalRework: stats.rework,
      totalPass: inspections.reduce((s, i) => s + (i.passQty || 0), 0),
      totalReject: inspections.reduce((s, i) => s + (i.rejectQty || 0), 0),
      reworkRate: stats.rate,
      finalJudgment: determineFinalJudgment(inspections),
      records: inspections.map(i => ({ ...i, id: undefined, recordedAt: undefined })),
      defectRanking
    },
    packaging: {
      totalBoxes: boxes.length,
      totalQty: boxes.reduce((s, b) => s + (b.qty || 0), 0),
      totalGW: parseFloat(boxes.reduce((s, b) => s + (b.grossWeight || 0), 0).toFixed(2)),
      totalNW: parseFloat(boxes.reduce((s, b) => s + (b.netWeight || 0), 0).toFixed(2)),
      boxes: boxes.map(b => ({ ...b, id: undefined }))
    },
    traceability: {
      totalTraceCodes: traceCodes.length,
      traceCodes: traceCodes.map(c => ({ ...c, id: undefined })),
      missingTraceCodeBoxes: boxes.filter(b => !traceCodes.find(c => c.boxNo === b.boxNo)).map(b => b.boxNo)
    },
    generatedAt: new Date().toISOString()
  };

  const jsonPath = path.join(outputDir, `inspection-report-${orderNo}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf-8');
  printSuccess(`[1/8] 检验报告 JSON: ${path.basename(jsonPath)}`);

  const csvContent = generateInspectionCSV(summary);
  const csvPath = path.join(outputDir, `inspection-report-${orderNo}.csv`);
  fs.writeFileSync(csvPath, '\uFEFF' + csvContent, 'utf-8');
  printSuccess(`[2/8] 检验数据 CSV: ${path.basename(csvPath)}`);

  const boxesCSV = generateBoxesCSV(boxes);
  const boxesCsvPath = path.join(outputDir, `packing-list-${orderNo}.csv`);
  fs.writeFileSync(boxesCsvPath, '\uFEFF' + boxesCSV, 'utf-8');
  printSuccess(`[3/8] 装箱单 CSV: ${path.basename(boxesCsvPath)}`);

  const defectsCSV = generateDefectsCSV(inspections);
  const defectsCsvPath = path.join(outputDir, `defect-summary-${orderNo}.csv`);
  fs.writeFileSync(defectsCsvPath, '\uFEFF' + defectsCSV, 'utf-8');
  printSuccess(`[4/8] 疵点汇总 CSV: ${path.basename(defectsCsvPath)}`);

  const chainCSV = generateBatchTraceChainCSV(summary, materials, cuts, boxes, traceCodes);
  const chainCsvPath = path.join(outputDir, `batch-tracechain-${orderNo}.csv`);
  fs.writeFileSync(chainCsvPath, '\uFEFF' + chainCSV, 'utf-8');
  printSuccess(`[5/8] 批次追溯链 CSV: ${path.basename(chainCsvPath)}`);

  const reworkCSV = generateReworkAnalysisCSV(summary, inspections, order);
  const reworkCsvPath = path.join(outputDir, `rework-analysis-${orderNo}.csv`);
  fs.writeFileSync(reworkCsvPath, '\uFEFF' + reworkCSV, 'utf-8');
  printSuccess(`[6/8] 返工率分析 CSV: ${path.basename(reworkCsvPath)}`);

  if (traceCodes.length === 0 && opts.generateCodes) {
    printInfo('批量生成追溯码...');
    boxes.forEach(b => {
      const code = generateTraceCode(orderNo, order.styleNo, b.boxNo);
      storage.addTraceCode({
        code, orderNo, styleNo: order.styleNo,
        boxNo: b.boxNo, type: 'BOX',
        createdAt: new Date().toISOString(), scanned: false
      });
    });
  }

  const latestCodes = storage.findTraceCodesByOrder(orderNo);
  if (latestCodes.length > 0) {
    const codesTsvPath = path.join(outputDir, `trace-codes-${orderNo}.tsv`);
    let tsv = '追溯码\t订单号\t款号\t箱号\t生成时间\n';
    latestCodes.forEach(c => {
      tsv += `${c.code}\t${c.orderNo}\t${c.styleNo}\t${c.boxNo}\t${formatDateTime(c.createdAt)}\n`;
    });
    fs.writeFileSync(codesTsvPath, tsv, 'utf-8');
    printSuccess(`[7/8] 追溯码清单 TSV: ${path.basename(codesTsvPath)}`);
    summary.traceability.totalTraceCodes = latestCodes.length;
    summary.traceability.traceCodes = latestCodes.map(c => ({ ...c, id: undefined }));
    summary.traceability.missingTraceCodeBoxes = boxes.filter(b => !latestCodes.find(c => c.boxNo === b.boxNo)).map(b => b.boxNo);
  } else {
    printWarning(`[7/8] 追溯码清单: 暂无追溯码 (使用 --generateCodes 自动生成)`);
  }

  const readme = generateClientSummary(summary, order, latestCodes, project);
  const readmePath = path.join(outputDir, '客户验货摘要.txt');
  fs.writeFileSync(readmePath, readme, 'utf-8');
  printSuccess(`[8/8] 客户验货摘要: ${path.basename(readmePath)}`);

  console.log();
  printSection('验货包汇总');
  printTable(
    ['项目', '内容'],
    [
      ['订单号', order.orderNo],
      ['款号', order.styleNo],
      ['客户', order.customer],
      ['订单数量', order.qty],
      ['检验次数', inspections.length],
      ['抽检总数', stats.total],
      ['返工总数', stats.rework],
      ['返工率', `${stats.rate}%`],
      ['最终判定', renderJudgment(summary.inspection.finalJudgment)],
      ['已包装箱数', boxes.length],
      ['已包装件数', summary.packaging.totalQty],
      ['追溯码数', `${latestCodes.length}/${boxes.length}${latestCodes.length < boxes.length ? ' (有缺失!)' : ''}`],
      ['输出目录', outputDir]
    ]
  );

  if (summary.traceability.missingTraceCodeBoxes.length > 0) {
    console.log();
    printWarning(`提醒: 以下 ${summary.traceability.missingTraceCodeBoxes.length} 个箱子缺少追溯码:`);
    summary.traceability.missingTraceCodeBoxes.forEach(b => console.log(`  · ${b}`));
    printInfo(`补全命令: gt export --traceCodes --orderNo ${orderNo}`);
  }

  return 0;
}

function determineFinalJudgment(inspections) {
  if (inspections.length === 0) return 'PENDING';
  if (inspections.some(i => i.judgment === 'REJECT')) return 'REJECT';
  if (inspections.some(i => i.judgment === 'REWORK')) return 'REWORK';
  return 'PASS';
}

function generateInspectionCSV(s) {
  let csv = '服装成衣检验报告\n';
  csv += `工厂名称,${s.project.factory || ''}\n`;
  csv += `工厂代码,${s.project.code || ''}\n`;
  csv += `联系人,${s.project.contact || ''}\n`;
  csv += `联系电话,${s.project.phone || ''}\n`;
  csv += `客户,${s.order.customer}\n`;
  csv += `订单号,${s.order.orderNo}\n`;
  csv += `款号,${s.order.styleNo}\n`;
  csv += `款式名称,${s.order.styleName}\n`;
  csv += `数量,${s.order.qty}\n`;
  csv += `颜色,${s.order.color}\n`;
  csv += `交期,${s.order.deliveryDate ? formatDate(s.order.deliveryDate) : ''}\n`;
  csv += '\n';

  csv += '=== 面辅料清单 ===\n';
  csv += '类型,分类,名称,编码,缸号/批次,颜色,数量,单位,供应商\n';
  s.materials.forEach(m => {
    csv += `${m.type},${m.category},${m.name},${m.code},${m.lotNo || m.batchNo || ''},${m.color},${m.qty},${m.unit},${m.supplier}\n`;
  });
  csv += '\n';

  csv += '=== 裁剪床次 ===\n';
  csv += '床次号,关联面料缸号,层数,拉布匹数,总件数,裁剪员,裁剪日期\n';
  s.cuttingSummary.beds.forEach(c => {
    csv += `${c.bedNo},${c.fabricLot || ''},${c.layers || ''},${c.spreads || ''},${c.totalQty},${c.cutter || ''},${formatDate(c.cutDate)}\n`;
  });
  csv += '\n';

  csv += '=== 检验记录 ===\n';
  csv += '箱号/批次,检验员,检验日期,抽检数,合格数,返工数,退货数,疵点明细,判定结果\n';
  s.inspection.records.forEach(r => {
    const defects = Object.entries(r.defects || {}).map(([d, n]) => `${d}:${n}`).join('|');
    csv += `${r.boxNo || r.batchNo || ''},${r.inspector || ''},${formatDate(r.inspectDate)},${r.inspectedQty},${r.passQty},${r.reworkQty},${r.rejectQty},${defects},${r.judgment}\n`;
  });
  csv += '\n';

  csv += '=== 检验汇总 ===\n';
  csv += `检验次数,${s.inspection.totalInspections}\n`;
  csv += `抽检总数,${s.inspection.totalInspected}\n`;
  csv += `合格总数,${s.inspection.totalPass}\n`;
  csv += `返工总数,${s.inspection.totalRework}\n`;
  csv += `退货总数,${s.inspection.totalReject}\n`;
  csv += `返工率,${s.inspection.reworkRate}%\n`;
  csv += `最终判定,${s.inspection.finalJudgment}\n`;

  return csv;
}

function generateBoxesCSV(boxes) {
  let csv = '箱唛编号,订单号,款号,第N箱,颜色,尺码分配,件数,毛重(kg),净重(kg),外箱尺寸,封箱号,栈板号,包装员,包装日期\n';
  boxes.forEach(b => {
    const sizes = Object.entries(b.sizes || {}).map(([s, n]) => `${s}:${n}`).join('|');
    csv += `${b.boxNo},${b.orderNo},${b.styleNo},${b.sequence},${b.color},${sizes},${b.qty},${b.grossWeight},${b.netWeight},${b.measure},${b.sealNo},${b.palletNo},${b.packedBy},${formatDate(b.packDate)}\n`;
  });
  return csv;
}

function generateDefectsCSV(inspections) {
  const defectMap = {};
  inspections.forEach(i => {
    Object.entries(i.defects || {}).forEach(([d, n]) => {
      defectMap[d] = (defectMap[d] || 0) + n;
    });
  });
  let csv = '疵点类型,累计数量,占比\n';
  const total = Object.values(defectMap).reduce((s, n) => s + n, 0);
  Object.entries(defectMap)
    .sort((a, b) => b[1] - a[1])
    .forEach(([d, n]) => {
      csv += `${d},${n},${total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0%'}\n`;
    });
  return csv;
}

function generateBatchTraceChainCSV(summary, materials, cuts, boxes, traceCodes) {
  let csv = '';
  csv += '==============================\n';
  csv += '批次追溯链 - 完整生产链路\n';
  csv += `订单号: ${summary.order.orderNo}\n`;
  csv += `款号: ${summary.order.styleNo}\n`;
  csv += '==============================\n\n';

  csv += '【第一部分: 面辅料批次 (Fabric & Accessory Lots)】\n';
  csv += '类型,物料名称,分类,编码,缸号/批次号,颜色,供应商,入库数量,单位\n';
  materials.forEach(m => {
    csv += `${m.type},${m.name},${m.category || ''},${m.code || ''},${m.lotNo || m.batchNo || '(未绑定!)'},${m.color || ''},${m.supplier || ''},${m.qty},${m.unit || ''}\n`;
  });
  csv += '\n';

  csv += '【第二部分: 裁剪床次关联 (Cutting Beds)】\n';
  csv += '床次号,关联面料缸号,层数,拉布匹数,裁剪件数,裁剪员,裁剪日期,关联订单\n';
  cuts.forEach(c => {
    csv += `${c.bedNo},${c.fabricLot || '(未关联!)'},${c.layers || ''},${c.spreads || ''},${c.totalQty},${c.cutter || ''},${formatDate(c.cutDate)},${c.orderNo}\n`;
  });
  csv += '\n';

  csv += '【第三部分: 包装出货箱唛 (Packed Boxes)】\n';
  csv += '箱唛编号,第N箱,颜色,尺码分配,本箱件数,追溯码,包装员,包装日期\n';
  boxes.forEach(b => {
    const sizes = Object.entries(b.sizes || {}).map(([s, n]) => `${s}:${n}`).join('|');
    const tc = traceCodes.find(c => c.boxNo === b.boxNo);
    csv += `${b.boxNo},${b.sequence},${b.color || ''},${sizes},${b.qty},${tc ? tc.code : '(未绑定!)'},${b.packedBy || ''},${formatDate(b.packDate)}\n`;
  });
  csv += '\n';

  csv += '【第四部分: 面辅料 → 裁剪 → 箱唛 链路透视】\n';
  csv += '物料批次/缸号,用在哪些裁剪床次,共裁出件数,最终装了多少箱,箱号明细\n';
  const fabricLots = materials.filter(m => m.type === '面料' && m.lotNo);
  const accBatches = materials.filter(m => m.type === '辅料' && m.batchNo);
  const allBatches = [...fabricLots.map(m => ({ key: m.lotNo, name: m.name, type: '面料缸号' })),
                     ...accBatches.map(m => ({ key: m.batchNo, name: m.name, type: '辅料批次' }))];
  if (allBatches.length === 0) {
    csv += '(暂无已绑定的面辅料批次号)\n';
  } else {
    allBatches.forEach(batch => {
      const linkedCuts = cuts.filter(c => c.fabricLot === batch.key || c.linkedMaterials?.includes(batch.key));
      const cutNos = linkedCuts.map(c => c.bedNo).join('/') || '(无关联裁剪)';
      const cutQty = linkedCuts.reduce((s, c) => s + (c.totalQty || 0), 0);
      const boxNos = boxes.map(b => b.boxNo).join('/');
      csv += `${batch.type}:${batch.key}(${batch.name}),${cutNos},${cutQty},${boxes.length},${boxNos || '(无箱唛)'}\n`;
    });
  }

  return csv;
}

function generateReworkAnalysisCSV(summary, inspections, order) {
  let csv = '';
  csv += '==============================\n';
  csv += '返工率分析报告\n';
  csv += `订单号: ${order.orderNo}\n`;
  csv += `款号: ${order.styleNo}\n`;
  csv += `生成时间: ${formatDateTime(new Date())}\n`;
  csv += '==============================\n\n';

  csv += '【一、总体质量指标】\n';
  csv += '指标,数值\n';
  csv += `检验次数,${summary.inspection.totalInspections}\n`;
  csv += `抽检总数,${summary.inspection.totalInspected}\n`;
  csv += `合格数,${summary.inspection.totalPass}\n`;
  csv += `返工数,${summary.inspection.totalRework}\n`;
  csv += `退货数,${summary.inspection.totalReject}\n`;
  csv += `返工率,${summary.inspection.reworkRate}%\n`;
  csv += `最终判定,${summary.inspection.finalJudgment}\n`;
  csv += `订单数量,${order.qty}\n`;
  csv += `抽检覆盖率,${order.qty > 0 ? ((summary.inspection.totalInspected / order.qty) * 100).toFixed(1) + '%' : 'N/A'}\n`;
  csv += '\n';

  csv += '【二、按检验批次细分】\n';
  csv += '序号,箱号/批次,检验员,检验日期,抽检,合格,返工,退货,返工率,判定\n';
  inspections.forEach((i, idx) => {
    const r = i.inspectedQty > 0 ? ((i.reworkQty / i.inspectedQty) * 100).toFixed(1) + '%' : '0%';
    csv += `${idx + 1},${i.boxNo || i.batchNo || ''},${i.inspector || ''},${formatDate(i.inspectDate)},${i.inspectedQty},${i.passQty},${i.reworkQty},${i.rejectQty},${r},${i.judgment}\n`;
  });
  csv += '\n';

  csv += '【三、疵点类型排行 (Top Defects)】\n';
  csv += '排名,疵点类型,累计数量,占比\n';
  summary.inspection.defectRanking.forEach((d, idx) => {
    csv += `${idx + 1},${d.type},${d.count},${d.ratio}\n`;
  });
  if (summary.inspection.defectRanking.length === 0) {
    csv += '(暂无疵点记录)\n';
  }
  csv += '\n';

  csv += '【四、质量评估与建议】\n';
  const rate = summary.inspection.reworkRate;
  let level, comment, action;
  if (inspections.length === 0) {
    level = '未评估';
    comment = '尚无抽检记录，建议尽快安排质检';
    action = '使用 gt inspect 录入首次质检数据';
  } else if (rate < 1) {
    level = '优秀 (A)';
    comment = '返工率低于1%，品质管控良好，请保持';
    action = '维持现有工艺标准，可作为标杆订单';
  } else if (rate < 3) {
    level = '合格 (B)';
    comment = '返工率处于正常区间，关注高发疵点即可';
    action = `针对Top3疵点(${summary.inspection.defectRanking.slice(0,3).map(d=>d.type).join('/') || '无'})加强巡检`;
  } else if (rate < 5) {
    level = '预警 (C)';
    comment = '返工率偏高，建议分析具体原因并采取改善措施';
    action = '组织产前复盘，加强过程检验，必要时增加抽检频次';
  } else {
    level = '严重 (D)';
    comment = '返工率过高，存在重大品质风险，需立即干预';
    action = '停产整顿，追溯问题根源(面辅料/缝制/工艺)，重新制定品质标准';
  }
  csv += `质量等级,${level}\n`;
  csv += `综合评价,${comment}\n`;
  csv += `建议行动,${action}\n`;

  return csv;
}

function generateClientSummary(s, order, codes, project) {
  const j = s.inspection.finalJudgment;
  const jCn = { PASS: '放行合格', REWORK: '需返工处理', REJECT: '不合格退货', PENDING: '待检验' }[j] || j;
  const jEmoji = { PASS: '✅', REWORK: '⚠️', REJECT: '❌', PENDING: '⏳' }[j] || '';

  let text = '';
  text += '╔' + '═'.repeat(62) + '╗\n';
  text += '║' + ' '.repeat(18) + ' 服 装 成 衣 验 货 报 告 ' + ' '.repeat(18) + '║\n';
  text += '╚' + '═'.repeat(62) + '╝\n\n';
  text += `尊敬的 ${order.customer} 采购团队：\n\n`;
  text += `感谢贵司的订单支持。现将 ${order.styleName || order.styleNo} 的生产及质检资料整理如下，供贵司验收参考。\n\n`;

  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '  一、基本订单信息\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += `  订单编号:   ${order.orderNo}\n`;
  text += `  款号/款名:  ${order.styleNo}${order.styleName ? ' / ' + order.styleName : ''}\n`;
  text += `  客户名称:   ${order.customer}\n`;
  text += `  颜色:       ${order.color || '-'}\n`;
  text += `  订单数量:   ${order.qty} 件\n`;
  text += `  约定交期:   ${order.deliveryDate ? formatDate(order.deliveryDate) : '-'}\n`;
  if (order.remark) text += `  订单备注:   ${order.remark}\n`;
  text += '\n';

  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '  二、品质检验结论\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += `  ${jEmoji} 最终判定: 【 ${jCn} 】\n\n`;
  text += `  累计质检次数:    ${s.inspection.totalInspections} 次\n`;
  text += `  品质抽检总数:    ${s.inspection.totalInspected} 件\n`;
  text += `  ├ 合格件数:      ${s.inspection.totalPass} 件\n`;
  text += `  ├ 返工件数:      ${s.inspection.totalRework} 件\n`;
  text += `  └ 退货件数:      ${s.inspection.totalReject} 件\n`;
  text += `  综合返工率:      ${s.inspection.reworkRate}%\n`;
  text += `  抽检覆盖率:      ${order.qty > 0 ? ((s.inspection.totalInspected / order.qty) * 100).toFixed(1) : '0'}%\n`;
  if (s.inspection.defectRanking.length > 0) {
    text += `\n  主要疵点分布 (Top 3):\n`;
    s.inspection.defectRanking.slice(0, 3).forEach((d, i) => {
      text += `    ${i + 1}. ${d.type.padEnd(8)} ${String(d.count).padStart(4)}件  占比 ${d.ratio}\n`;
    });
  }
  text += '\n';

  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '  三、包装出货信息\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += `  总包装箱数:    ${s.packaging.totalBoxes} 箱\n`;
  text += `  累计包装件数:  ${s.packaging.totalQty} 件\n`;
  text += `  总毛重:        ${s.packaging.totalGW} kg\n`;
  text += `  总净重:        ${s.packaging.totalNW} kg\n`;
  text += `  追溯码绑定:    ${s.traceability.totalTraceCodes}/${s.packaging.totalBoxes} 个箱子`;
  if (s.traceability.missingTraceCodeBoxes.length > 0) {
    text += ` (缺 ${s.traceability.missingTraceCodeBoxes.length} 个)`;
  } else if (s.traceability.totalTraceCodes > 0) {
    text += ` (已全部绑定)`;
  }
  text += '\n\n';

  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '  四、本资料包文件清单\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += `  1. inspection-report-${order.orderNo}.json   完整检验数据 (JSON格式，系统对接用)\n`;
  text += `  2. inspection-report-${order.orderNo}.csv    检验报告 (Excel可直接打开)\n`;
  text += `  3. packing-list-${order.orderNo}.csv         详细装箱单 (每箱明细)\n`;
  text += `  4. defect-summary-${order.orderNo}.csv       疵点类型统计汇总\n`;
  text += `  5. batch-tracechain-${order.orderNo}.csv     批次追溯链 (面辅料→裁剪→箱唛)\n`;
  text += `  6. rework-analysis-${order.orderNo}.csv      返工率分析与质量评估\n`;
  text += `  7. trace-codes-${order.orderNo}.tsv          追溯码清单 (贴箱用)\n`;
  text += `  8. 客户验货摘要.txt                            本摘要文件\n\n`;

  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '  五、追溯说明\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '  每个外箱粘贴唯一追溯码标签，扫码或在系统中输入追溯码可查询：\n';
  text += '  · 该箱订单信息、款号、尺码分配\n';
  text += '  · 使用的面料缸号 / 辅料批次号\n';
  text += '  · 裁剪床次、缝制组别\n';
  text += '  · 整烫包装时间、包装员\n';
  text += '  · 对应质检记录与疵点明细\n\n';

  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += '  六、工厂联系方式\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += `  工厂名称:   ${project?.factoryName || s.project.factory || '(未设置)'}\n`;
  text += `  工厂代码:   ${project?.factoryCode || s.project.code || '-'}\n`;
  text += `  负责人:     ${project?.contact || s.project.contact || '-'}\n`;
  text += `  联系电话:   ${project?.phone || s.project.phone || '-'}\n`;
  text += `  工厂地址:   ${project?.address || s.project.address || '-'}\n\n`;

  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  text += `  报告生成时间: ${formatDateTime(new Date())}\n`;
  text += '  本报告由 服装质检追溯器 (Garment Trace) 自动生成，所有数据真实可追溯\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  return text;
}

function validateRecords(storage, orderNo) {
  printHeader('漏填记录校验');

  const orders = orderNo ? [storage.findOrder(orderNo)].filter(Boolean) : storage.getOrders();
  if (orders.length === 0) {
    printWarning('无订单数据');
    return 0;
  }

  const allIssues = [];

  for (const order of orders) {
    const on = order.orderNo;
    const issues = [];
    const suggest = [];

    if (!order.styleNo) issues.push({ msg: '缺少款号', cmd: `gt import-order --orderNo ${on} --styleNo <款号>` });
    if (!order.qty || order.qty <= 0) issues.push({ msg: '缺少订单数量', cmd: `gt import-order --orderNo ${on} --qty <数量>` });
    if (!order.customer) issues.push({ msg: '缺少客户信息', cmd: `gt import-order --orderNo ${on} --customer <客户名>` });
    if (!order.deliveryDate) issues.push({ msg: '缺少交期', cmd: `gt import-order --orderNo ${on} --deliveryDate YYYY-MM-DD` });

    const materials = storage.findMaterialsByOrder(on);
    if (materials.length === 0) {
      issues.push({ msg: '未绑定任何面辅料', cmd: `gt link-material --orderNo ${on} --type 面料 ...` });
    } else {
      const fabrics = materials.filter(m => m.type === '面料');
      const accs = materials.filter(m => m.type === '辅料');
      if (fabrics.length === 0) issues.push({ msg: '未绑定面料', cmd: `gt link-material --orderNo ${on} --type 面料 --name 主面料 --lotNo <缸号>` });
      if (accs.length === 0) issues.push({ msg: '未绑定辅料', cmd: `gt link-material --orderNo ${on} --type 辅料 --name 拉链 --batchNo <批次>` });

      fabrics.forEach(m => {
        if (!m.lotNo) {
          issues.push({
            msg: `[面料] ${m.name}${m.code ? '(' + m.code + ')' : ''} 缺少缸号(lotNo)`,
            cmd: `gt link-material --orderNo ${on} --type 面料 --name "${m.name}" --category ${m.category || '面料'} --lotNo <缸号值> --color "${m.color || ''}" --supplier "${m.supplier || ''}"`
          });
        }
      });
      accs.forEach(m => {
        if (!m.batchNo) {
          issues.push({
            msg: `[辅料] ${m.name}${m.code ? '(' + m.code + ')' : ''} 缺少批次号(batchNo)`,
            cmd: `gt link-material --orderNo ${on} --type 辅料 --name "${m.name}" --category ${m.category || '辅料'} --batchNo <批次值> --color "${m.color || ''}" --supplier "${m.supplier || ''}"`
          });
        }
      });
    }

    const cuts = storage.findCuttingByOrder(on);
    const cutQty = cuts.reduce((s, c) => s + (c.totalQty || 0), 0);
    if (cuts.length === 0) {
      issues.push({ msg: '无裁剪记录', cmd: `gt record-cut --orderNo ${on} --layers <层数> --totalQty <件数>` });
    } else {
      if (cutQty < order.qty) {
        issues.push({ msg: `裁剪数量不足 (裁剪${cutQty}件 / 订单${order.qty}件，差${order.qty - cutQty}件)`, cmd: `gt record-cut --orderNo ${on} 继续补裁` });
      }
      cuts.forEach((c, idx) => {
        if (!c.fabricLot) {
          issues.push({
            msg: `[裁剪] 第${idx + 1}床 ${c.bedNo} 未关联面料缸号`,
            cmd: `裁剪记录中补上 fabricLot 字段，或通过 gt query --batchNo 确认面料缸号后重新录入`
          });
        }
      });
    }

    const sewing = storage.findSewingByOrder(on);
    const sewGroups = sewing.filter(s => s.process !== '整烫包装');
    const sewQty = sewGroups.reduce((s, r) => s + (r.completedQty || 0), 0);
    if (sewGroups.length === 0) {
      issues.push({ msg: '无缝制组别记录', cmd: `gt record-sew --orderNo ${on} --groupNo G01 --leader <组长> --assignedQty <分配数>` });
    } else if (sewQty < order.qty) {
      issues.push({ msg: `缝制完成数量不足 (完成${sewQty}件 / 订单${order.qty}件，差${order.qty - sewQty}件)`, cmd: `gt record-sew --orderNo ${on} 更新各组别完成数` });
    }

    const ironPack = sewing.find(s => s.process === '整烫包装');
    const boxes = storage.findBoxesByOrder(on);
    const boxQty = boxes.reduce((s, b) => s + (b.qty || 0), 0);
    if (!ironPack) {
      issues.push({ msg: '无整烫包装记录', cmd: `gt record-sew --orderNo ${on} --ironDate YYYY-MM-DD --packDate YYYY-MM-DD --packQty ${order.qty}` });
    } else {
      if (!ironPack.ironDate) issues.push({ msg: '缺少整烫日期', cmd: `gt record-sew --orderNo ${on} --ironDate YYYY-MM-DD` });
      if (!ironPack.packDate) issues.push({ msg: '缺少包装日期', cmd: `gt record-sew --orderNo ${on} --packDate YYYY-MM-DD` });
      const packQty = ironPack.packQty || 0;
      if (packQty > 0 && boxQty > 0 && packQty !== boxQty) {
        issues.push({
          msg: `⚠️ 包装数量与箱唛件数对不上！(整烫包装记录 packQty=${packQty}件 / 箱唛表合计 ${boxQty}件，差异 ${Math.abs(packQty - boxQty)}件)`,
          cmd: packQty > boxQty
            ? `箱唛少了 ${packQty - boxQty} 件，请用 gt inspect --newBox --orderNo ${on} 补开剩余箱唛`
            : `整烫包装记录少了 ${boxQty - packQty} 件，请用 gt record-sew --orderNo ${on} --packQty ${boxQty} 更新`
        });
      }
    }

    const inspections = storage.findInspectionsByOrder(on);
    const inspQty = inspections.reduce((s, i) => s + i.inspectedQty, 0);
    if (inspections.length === 0) {
      issues.push({ msg: '无质检抽检记录', cmd: `gt inspect --orderNo ${on} --inspectedQty <抽检数> --judgment PASS` });
    } else {
      if (inspQty < order.qty) {
        issues.push({ msg: `抽检覆盖不足 (抽检${inspQty}件 / 订单${order.qty}件，建议覆盖${Math.min(order.qty, Math.ceil(order.qty * 0.1))}件以上)`, cmd: `gt inspect --orderNo ${on} 继续补检` });
      }
      inspections.forEach((i, idx) => {
        if (!i.inspector) {
          issues.push({
            msg: `[质检] 第${idx + 1}次质检 (${i.boxNo || i.batchNo || '无箱号'}) 缺少检验员姓名`,
            cmd: `补录请参考: gt inspect --orderNo ${on} ${i.boxNo ? '--boxNo ' + i.boxNo : ''} --inspector <姓名> --judgment ${i.judgment || 'PASS'}`
          });
        }
        if (!i.judgment) {
          issues.push({
            msg: `[质检] 第${idx + 1}次质检 (${i.boxNo || i.batchNo || '无箱号'}) 缺少判定结果 (应为 PASS/REWORK/REJECT)`,
            cmd: `补录请参考: gt inspect --orderNo ${on} ${i.boxNo ? '--boxNo ' + i.boxNo : ''} --inspector "${i.inspector || '检验员'}" --judgment <PASS|REWORK|REJECT>`
          });
        }
      });
    }

    if (boxes.length === 0) {
      issues.push({ msg: '无箱唛记录', cmd: `gt inspect --newBox --orderNo ${on} --qty <每箱件数> --gw <毛重> --nw <净重>` });
    } else {
      if (boxQty < order.qty) {
        issues.push({ msg: `装箱数量不足 (装箱${boxQty}件 / 订单${order.qty}件，差${order.qty - boxQty}件)`, cmd: `gt inspect --newBox --orderNo ${on} 补开剩余箱唛` });
      }
      const codes = storage.findTraceCodesByOrder(on);
      const boxesNoCode = boxes.filter(b => !codes.find(c => c.boxNo === b.boxNo)).map(b => b.boxNo);
      if (boxesNoCode.length > 0) {
        issues.push({
          msg: `[追溯码] 以下 ${boxesNoCode.length} 个箱子未绑定追溯码: ${boxesNoCode.join(', ')}`,
          cmd: `gt export --traceCodes --orderNo ${on}  (一键为所有缺码箱子生成并绑定)`
        });
      }
    }

    if (issues.length > 0) {
      allIssues.push({ orderNo: on, styleNo: order.styleNo, issues });
    }
  }

  if (allIssues.length === 0) {
    printSuccess('🎉 恭喜！所有记录完整，无漏填项。');
    return 0;
  }

  printWarning(`发现 ${allIssues.length} 个订单存在 ${allIssues.reduce((s, i) => s + i.issues.length, 0)} 项问题，详情如下:\n`);

  for (const item of allIssues) {
    printSection(`📋 订单 ${item.orderNo} (款号: ${item.styleNo || '-'})  共 ${item.issues.length} 项问题`);
    item.issues.forEach((issue, idx) => {
      console.log(`  ${String(idx + 1).padStart(2, ' ')}. ⚠  ${issue.msg}`);
      console.log(`      → 补录命令: ${issue.cmd}`);
      console.log();
    });
  }

  const totalIssues = allIssues.reduce((s, i) => s + i.issues.length, 0);
  console.log();
  printWarning(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  printWarning(`  合计 ${allIssues.length} 个订单 / ${totalIssues} 项问题`);
  printWarning(`  请车间文员按上面的「补录命令」逐条补全后再次校验`);
  printWarning(`  全部通过后可用 gt export --orderNo XXX 生成客户验货包`);
  printWarning(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  return 1;
}

function generateTraceCodes(storage, orderNo, count, outputPath) {
  printHeader('生成/导出追溯码');

  let targets = [];

  if (orderNo) {
    const boxes = storage.findBoxesByOrder(orderNo);
    if (boxes.length === 0) {
      printError(`订单 ${orderNo} 无箱唛记录，请先生成箱唛`);
      return 1;
    }
    targets = boxes.map(b => ({ orderNo, styleNo: b.styleNo, boxNo: b.boxNo }));
  } else {
    const allBoxes = storage.getBoxes();
    if (allBoxes.length === 0) {
      printError('暂无箱唛记录，请先生成箱唛');
      return 1;
    }
    targets = allBoxes.slice(0, count || allBoxes.length).map(b => ({
      orderNo: b.orderNo, styleNo: b.styleNo, boxNo: b.boxNo
    }));
  }

  let newCount = 0;
  let existingCount = 0;
  const codes = [];

  for (const t of targets) {
    const existing = storage.findTraceCodesByOrder(t.orderNo).find(c => c.boxNo === t.boxNo);
    if (existing) {
      existingCount++;
      codes.push(existing);
    } else {
      const code = generateTraceCode(t.orderNo, t.styleNo, t.boxNo);
      storage.addTraceCode({
        code, orderNo: t.orderNo, styleNo: t.styleNo,
        boxNo: t.boxNo, type: 'BOX',
        createdAt: new Date().toISOString(), scanned: false
      });
      codes.push({ code, boxNo: t.boxNo, orderNo: t.orderNo, styleNo: t.styleNo, createdAt: new Date().toISOString() });
      newCount++;
    }
  }

  printTable(
    ['追溯码', '订单号', '款号', '箱号'],
    codes.map(c => [c.code, c.orderNo, c.styleNo, c.boxNo])
  );

  console.log();
  printSuccess(`新增追溯码: ${newCount}个, 已存在: ${existingCount}个, 合计: ${codes.length}个`);

  if (outputPath) {
    const absPath = path.resolve(outputPath);
    let content = '追溯码\t订单号\t款号\t箱号\n';
    codes.forEach(c => {
      content += `${c.code}\t${c.orderNo}\t${c.styleNo}\t${c.boxNo}\n`;
    });
    fs.writeFileSync(absPath, content, 'utf-8');
    printSuccess(`追溯码已导出到: ${absPath}`);
  }

  return 0;
}

function printBoxLabel(storage, boxNo) {
  const box = storage.findBoxByNo(boxNo);
  if (!box) {
    printError(`未找到箱唛: ${boxNo}`);
    return 1;
  }

  const code = storage.findTraceCodesByOrder(box.orderNo).find(c => c.boxNo === boxNo);
  const order = storage.findOrder(box.orderNo);

  printHeader(`箱唛标签: ${boxNo}`);

  const w = 50;
  const line = '+'.padEnd(w - 1, '-') + '+';
  const pad = (s, len = w - 2) => {
    s = String(s);
    return s.length > len ? s.substring(0, len) : s.padEnd(len);
  };

  console.log(line);
  console.log(`|${pad(`${order?.customer || ''} 客户箱唛`, w - 2)}|`);
  console.log(line);
  console.log(`|${pad(`款号: ${box.styleNo}`)}|`);
  console.log(`|${pad(`订单号: ${box.orderNo}`)}|`);
  console.log(`|${pad(`颜色: ${box.color}  |  第 ${box.sequence} 箱`)}|`);
  console.log(line);
  const sizes = Object.entries(box.sizes || {});
  if (sizes.length > 0) {
    const sizeLine = sizes.map(([s, n]) => `${s}:${n}`).join('  ');
    console.log(`|${pad(`尺码/数量: ${sizeLine}`)}|`);
  }
  console.log(`|${pad(`本箱件数: ${box.qty} PCS`)}|`);
  console.log(line);
  if (box.grossWeight || box.netWeight) {
    console.log(`|${pad(`G.W: ${box.grossWeight}kg   N.W: ${box.netWeight}kg`)}|`);
  }
  if (box.measure) {
    console.log(`|${pad(`尺寸: ${box.measure} cm`)}|`);
  }
  console.log(line);
  if (code) {
    console.log(`|${pad(`追溯码: ${code.code}`)}|`);
  }
  console.log(`|${pad(`出厂日期: ${formatDate(box.packDate)}`)}|`);
  console.log(line);
  console.log();

  if (code) {
    printInfo(`可使用追溯码查询完整信息: garment-trace query --traceCode ${code.code}`);
  } else {
    printWarning(`该箱尚未绑定追溯码，生成命令: gt export --traceCodes --orderNo ${box.orderNo}`);
  }

  return 0;
}

function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--output': 'output',
    '--count': 'count',
    '--boxNo': 'boxNo', '--box-no': 'boxNo',
    '--printBox': 'printBox', '--print-box': 'printBox'
  };
  const boolFlags = ['--validate', '--traceCodes', '--trace-codes', '--generateCodes', '--generate-codes'];

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
        if (keyMap[key]) opts[keyMap[key]] = val;
      }
    }
  }
  if (args.includes('--validate')) opts.validate = true;
  if (args.includes('--traceCodes') || args.includes('--trace-codes')) opts.traceCodes = true;
  if (args.includes('--generateCodes') || args.includes('--generate-codes')) opts.generateCodes = true;
  return opts;
}

function renderJudgment(j) {
  const map = {
    PASS: '\x1b[32m放行(PASS) ✅\x1b[0m',
    REWORK: '\x1b[33m返工(REWORK) ⚠️\x1b[0m',
    REJECT: '\x1b[31m退货(REJECT) ❌\x1b[0m',
    PENDING: '待检验 ⏳'
  };
  return map[j] || j;
}

function printHelp() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║          garment-trace export - 客户验货包 & 数据导出             ║
╚══════════════════════════════════════════════════════════════════╝

用法: garment-trace export [选项]

📦 客户验货包 (默认行为，最常用):
  --orderNo <订单号>        指定订单号 (必填)
  --output <目录>           输出目录 (默认: 项目根目录下)
  --generateCodes           如无追溯码则自动生成并绑定

  👉 生成的资料包内包含 8 个文件:
     1. inspection-report-*.json  完整数据 (系统对接用)
     2. inspection-report-*.csv   检验报告 (Excel打开)
     3. packing-list-*.csv        装箱单 (每箱明细)
     4. defect-summary-*.csv      疵点类型统计
     5. batch-tracechain-*.csv    批次追溯链(面辅料→裁剪→箱唛)
     6. rework-analysis-*.csv     返工率分析与质量等级
     7. trace-codes-*.tsv         追溯码清单 (贴箱用)
     8. 客户验货摘要.txt          给客户看的专业文字摘要

🏷 追溯码管理:
  --traceCodes              生成/导出追溯码列表
  --traceCodes --orderNo <单号>  指定订单的箱唛追溯码
  --traceCodes --count <N>       前N个箱子
  --traceCodes --output <文件>   导出到指定文件 (txt/tsv)

🖨 箱唛标签:
  --printBox <箱号>         打印指定箱号的箱唛标签 (终端显示)

✅ 数据校验 (车间文员日常用):
  --validate                校验所有订单是否有漏填记录
  --validate --orderNo <单号>   校验指定订单
  👉 会精确指出:
     · 哪条面料缺缸号 / 哪条辅料缺批次号
     · 哪些箱子缺追溯码
     · 包装记录数量 vs 箱唛合计数量对账差异
     · 每次质检缺检验员 / 缺判定
     · 并给出每条的补录命令，直接复制粘贴执行

示例:
  gt export --orderNo PO2026001 --generateCodes
  gt export --orderNo PO2026001 --output ./客户-优衣库-验货资料
  gt export --validate
  gt export --validate --orderNo PO2026001
  gt export --traceCodes
  gt export --traceCodes --orderNo PO2026001 --output ./追溯码导出.txt
  gt export --printBox JXA001-6001-0001
`);
}

module.exports = { run: exportCommand, help: printHelp };
