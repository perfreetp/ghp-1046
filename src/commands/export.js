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

  const summary = {
    project: { name: project?.name, factory: project?.factoryName, code: project?.factoryCode },
    order: { ...order, createdAt: undefined, updatedAt: undefined },
    materials: materials.map(m => ({ ...m, id: undefined, linkedAt: undefined })),
    cuttingSummary: {
      totalBeds: cuts.length,
      totalQty: cuts.reduce((s, c) => s + (c.totalQty || 0), 0),
      cutters: [...new Set(cuts.map(c => c.cutter).filter(Boolean))]
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
      reworkRate: stats.rate,
      finalJudgment: determineFinalJudgment(inspections),
      records: inspections.map(i => ({ ...i, id: undefined, recordedAt: undefined }))
    },
    packaging: {
      totalBoxes: boxes.length,
      totalQty: boxes.reduce((s, b) => s + (b.qty || 0), 0),
      totalGW: boxes.reduce((s, b) => s + (b.grossWeight || 0), 0).toFixed(2),
      totalNW: boxes.reduce((s, b) => s + (b.netWeight || 0), 0).toFixed(2),
      boxes: boxes.map(b => ({ ...b, id: undefined }))
    },
    generatedAt: new Date().toISOString()
  };

  const jsonPath = path.join(outputDir, `inspection-report-${orderNo}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf-8');
  printSuccess(`[1/5] 检验报告 JSON: ${path.basename(jsonPath)}`);

  const csvContent = generateInspectionCSV(summary);
  const csvPath = path.join(outputDir, `inspection-report-${orderNo}.csv`);
  fs.writeFileSync(csvPath, '\uFEFF' + csvContent, 'utf-8');
  printSuccess(`[2/5] 检验数据 CSV: ${path.basename(csvPath)}`);

  const boxesCSV = generateBoxesCSV(boxes);
  const boxesCsvPath = path.join(outputDir, `packing-list-${orderNo}.csv`);
  fs.writeFileSync(boxesCsvPath, '\uFEFF' + boxesCSV, 'utf-8');
  printSuccess(`[3/5] 装箱单 CSV: ${path.basename(boxesCsvPath)}`);

  const defectsCSV = generateDefectsCSV(inspections);
  const defectsCsvPath = path.join(outputDir, `defect-summary-${orderNo}.csv`);
  fs.writeFileSync(defectsCsvPath, '\uFEFF' + defectsCSV, 'utf-8');
  printSuccess(`[4/5] 疵点汇总 CSV: ${path.basename(defectsCsvPath)}`);

  const readme = generateReadme(summary, order, traceCodes);
  const readmePath = path.join(outputDir, '验货说明.txt');
  fs.writeFileSync(readmePath, readme, 'utf-8');
  printSuccess(`[5/5] 验货说明文档: ${path.basename(readmePath)}`);

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
    const newCodes = storage.findTraceCodesByOrder(orderNo);
    printInfo(`已为 ${newCodes.length} 个箱子生成追溯码`);
  }

  if (storage.findTraceCodesByOrder(orderNo).length > 0) {
    const codesPath = path.join(outputDir, `trace-codes-${orderNo}.txt`);
    const codes = storage.findTraceCodesByOrder(orderNo);
    fs.writeFileSync(codesPath, codes.map(c => `${c.code}\t${c.boxNo}`).join('\n'), 'utf-8');
    printSuccess(`[附加] 追溯码清单: ${path.basename(codesPath)}`);
  }

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
      ['追溯码数', storage.findTraceCodesByOrder(orderNo).length],
      ['输出目录', outputDir]
    ]
  );

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
    csv += `${m.type},${m.category},${m.name},${m.code},${m.lotNo || m.batchNo},${m.color},${m.qty},${m.unit},${m.supplier}\n`;
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
  csv += `返工总数,${s.inspection.totalRework}\n`;
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

function generateReadme(s, order, codes) {
  let text = '';
  text += '='.repeat(60) + '\n';
  text += `  服装成衣检验报告 - 客户验货资料包\n`;
  text += '='.repeat(60) + '\n\n';
  text += `生成时间: ${formatDateTime(new Date())}\n\n`;
  text += '【订单信息】\n';
  text += `  订单号: ${order.orderNo}\n`;
  text += `  款号: ${order.styleNo}\n`;
  text += `  款式: ${order.styleName}\n`;
  text += `  客户: ${order.customer}\n`;
  text += `  数量: ${order.qty}件\n`;
  text += `  颜色: ${order.color}\n`;
  text += `  交期: ${order.deliveryDate ? formatDate(order.deliveryDate) : '-'}\n\n`;
  text += '【品质结论】\n';
  text += `  检验次数: ${s.inspection.totalInspections}次\n`;
  text += `  累计抽检: ${s.inspection.totalInspected}件\n`;
  text += `  累计返工: ${s.inspection.totalRework}件\n`;
  text += `  返工率: ${s.inspection.reworkRate}%\n`;
  text += `  最终判定: ${s.inspection.finalJudgment}\n\n`;
  text += '【包装信息】\n';
  text += `  箱数: ${s.packaging.totalBoxes}箱\n`;
  text += `  件数: ${s.packaging.totalQty}件\n`;
  text += `  总毛重: ${s.packaging.totalGW}kg\n`;
  text += `  总净重: ${s.packaging.totalNW}kg\n\n`;
  text += '【文件清单】\n';
  text += `  1. inspection-report-*.json - 完整检验数据(JSON)\n`;
  text += `  2. inspection-report-*.csv  - 检验报告(Excel可打开)\n`;
  text += `  3. packing-list-*.csv       - 详细装箱单\n`;
  text += `  4. defect-summary-*.csv     - 疵点类型统计\n`;
  text += `  5. trace-codes-*.txt        - 追溯码清单(如有)\n`;
  text += `  6. 验货说明.txt             - 本说明文件\n\n`;
  if (codes.length > 0) {
    text += `【追溯码】共 ${codes.length} 个，粘贴于外箱可扫码追溯完整生产链\n`;
  }
  text += '\n' + '='.repeat(60) + '\n';
  text += '本资料由 服装质检追溯器 (Garment Trace) 自动生成\n';
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
    const issues = [];

    if (!order.styleNo) issues.push('缺少款号');
    if (!order.qty || order.qty <= 0) issues.push('缺少订单数量');
    if (!order.customer) issues.push('缺少客户信息');
    if (!order.deliveryDate) issues.push('缺少交期');

    const materials = storage.findMaterialsByOrder(order.orderNo);
    if (materials.length === 0) {
      issues.push('未绑定任何面辅料');
    } else {
      const fabrics = materials.filter(m => m.type === '面料');
      const accs = materials.filter(m => m.type === '辅料');
      if (fabrics.length === 0) issues.push('未绑定面料');
      if (accs.length === 0) issues.push('未绑定辅料');
      fabrics.forEach(m => { if (!m.lotNo) issues.push(`面料 ${m.name} 缺少缸号`); });
      accs.forEach(m => { if (!m.batchNo) issues.push(`辅料 ${m.name} 缺少批次号`); });
    }

    const cuts = storage.findCuttingByOrder(order.orderNo);
    const cutQty = cuts.reduce((s, c) => s + (c.totalQty || 0), 0);
    if (cuts.length === 0) {
      issues.push('无裁剪记录');
    } else if (cutQty < order.qty) {
      issues.push(`裁剪数量不足 (裁剪${cutQty}件/订单${order.qty}件)`);
    }

    const sewing = storage.findSewingByOrder(order.orderNo);
    const sewQty = sewing.filter(s => s.process !== '整烫包装').reduce((s, r) => s + (r.completedQty || 0), 0);
    if (sewing.filter(s => s.process !== '整烫包装').length === 0) {
      issues.push('无缝制组别记录');
    } else if (sewQty < order.qty) {
      issues.push(`缝制完成数量不足 (完成${sewQty}件/订单${order.qty}件)`);
    }

    const ironPack = sewing.find(s => s.process === '整烫包装');
    if (!ironPack) {
      issues.push('无整烫包装记录');
    } else {
      if (!ironPack.ironDate) issues.push('缺少整烫日期');
      if (!ironPack.packDate) issues.push('缺少包装日期');
    }

    const inspections = storage.findInspectionsByOrder(order.orderNo);
    const inspQty = inspections.reduce((s, i) => s + i.inspectedQty, 0);
    if (inspections.length === 0) {
      issues.push('无质检抽检记录');
    } else if (inspQty < order.qty) {
      issues.push(`抽检覆盖不足 (抽检${inspQty}件/订单${order.qty}件)`);
    }
    inspections.forEach((i, idx) => {
      if (!i.inspector) issues.push(`第${idx + 1}次质检缺少检验员`);
      if (!i.judgment) issues.push(`第${idx + 1}次质检缺少判定结果`);
    });

    const boxes = storage.findBoxesByOrder(order.orderNo);
    const boxQty = boxes.reduce((s, b) => s + (b.qty || 0), 0);
    if (boxes.length === 0) {
      issues.push('无箱唛记录');
    } else if (boxQty < order.qty) {
      issues.push(`装箱数量不足 (装箱${boxQty}件/订单${order.qty}件)`);
    }

    if (issues.length > 0) {
      allIssues.push({ orderNo: order.orderNo, styleNo: order.styleNo, issues });
    }
  }

  if (allIssues.length === 0) {
    printSuccess('恭喜！所有记录完整，无漏填项。');
    return 0;
  }

  printWarning(`发现 ${allIssues.length} 个订单存在问题:\n`);

  for (const item of allIssues) {
    printSection(`订单 ${item.orderNo} (款号: ${item.styleNo})`);
    item.issues.forEach((issue, idx) => {
      console.log(`  ${idx + 1}. ⚠ ${issue}`);
    });
  }

  const totalIssues = allIssues.reduce((s, i) => s + i.issues.length, 0);
  console.log();
  printWarning(`合计发现 ${totalIssues} 项问题，请及时补全。`);

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
      codes.push({ code, boxNo: t.boxNo, orderNo: t.orderNo, styleNo: t.styleNo });
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
  }

  return 0;
}

function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--output': 'output',
    '--count': 'count',
    '--boxNo': 'boxNo', '--box-no': 'boxNo'
  };

  const boolFlags = ['--validate', '--traceCodes', '--trace-codes', '--generateCodes', '--generate-codes'];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (boolFlags.includes(arg)) continue;
    if ((arg === '--printBox' || arg === '--print-box') && args[i + 1] && !args[i + 1].startsWith('--')) {
      opts.printBox = args[++i];
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
        } else if (key === '--printBox' || key === '--print-box') {
          opts.printBox = val;
        }
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
    PASS: '\x1b[32m放行(PASS)\x1b[0m',
    REWORK: '\x1b[33m返工(REWORK)\x1b[0m',
    REJECT: '\x1b[31m退货(REJECT)\x1b[0m',
    PENDING: '待检验'
  };
  return map[j] || j;
}

function printHelp() {
  console.log(`
用法: garment-trace export [选项]

导出客户验货包、批量生成/导出追溯码、校验记录完整性。

客户验货包 (默认行为):
  --orderNo <订单号>        指定订单号 (必填)
  --output <目录>           输出目录 (默认: 项目根目录下)
  --generateCodes           如无追溯码则自动生成

追溯码管理:
  --traceCodes              生成/导出追溯码列表
  --traceCodes --orderNo <单号>  指定订单的箱唛追溯码
  --traceCodes --count <N>       前N个箱子
  --traceCodes --output <文件>   导出到指定文件 (txt)

箱唛标签:
  --printBox <箱号>         打印指定箱号的箱唛标签 (终端显示)

数据校验:
  --validate                校验所有订单是否有漏填记录
  --validate --orderNo <单号>   校验指定订单

示例:
  garment-trace export --orderNo PO2026001 --generateCodes
  garment-trace export --orderNo PO2026001 --output ./client-inspection
  garment-trace export --validate
  garment-trace export --validate --orderNo PO2026001
  garment-trace export --traceCodes
  garment-trace export --traceCodes --orderNo PO2026001 --output ./codes.txt
  garment-trace export --printBox JXA001-6001-0001
`);
}

module.exports = { run: exportCommand, help: printHelp };
