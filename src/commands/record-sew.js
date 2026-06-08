const { generateId, formatDate, formatDateTime, printTable, printSuccess, printError, printWarning, printInfo, printHeader, printSection } = require('../utils');

function recordSewCommand(args, storage) {
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
    return listSewing(storage, opts.orderNo);
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

  if (opts.stage === 'pack' || opts.stage === 'iron' || opts.ironDate || opts.packDate || opts.ironedBy || opts.packedBy) {
    return recordIronPack(storage, order, opts);
  }

  if (!opts.groupNo) {
    printError('缺少必填参数 --groupNo (缝制组别)');
    return 1;
  }

  const sewing = {
    id: generateId('SEW-'),
    orderNo: opts.orderNo,
    styleNo: order.styleNo,
    groupNo: opts.groupNo,
    leader: opts.leader || '',
    members: parseMembers(opts.members),
    assignedQty: parseInt(opts.qty) || 0,
    completedQty: parseInt(opts.completed) || 0,
    defectQty: parseInt(opts.defects) || 0,
    startDate: opts.startDate ? new Date(opts.startDate).toISOString() : new Date().toISOString(),
    endDate: opts.endDate ? new Date(opts.endDate).toISOString() : null,
    bundleQty: parseInt(opts.bundleQty) || 0,
    process: opts.process || '缝制',
    remark: opts.remark || '',
    recordedAt: new Date().toISOString()
  };

  storage.addSewing(sewing);

  const allSewing = storage.findSewingByOrder(opts.orderNo);
  const totalCompleted = allSewing.reduce((sum, s) => sum + (s.completedQty || 0), 0);
  
  let newStatus = order.status;
  if (totalCompleted >= order.qty) {
    newStatus = 'SEWING_DONE';
  } else if (totalCompleted > 0) {
    newStatus = 'SEWING';
  }
  if (newStatus !== order.status) {
    storage.updateOrder(opts.orderNo, { status: newStatus });
  }

  printHeader('缝制记录成功');
  printSection('缝制信息');
  printTable(
    ['字段', '值'],
    [
      ['记录ID', sewing.id],
      ['订单号', sewing.orderNo],
      ['款号', sewing.styleNo],
      ['缝制组别', `第${sewing.groupNo}组`],
      ['组长', sewing.leader || '-'],
      ['组员人数', sewing.members.length],
      ['分配数量', sewing.assignedQty],
      ['已完成数量', sewing.completedQty],
      ['次品数量', sewing.defectQty],
      ['开始日期', formatDate(sewing.startDate)],
      ['结束日期', sewing.endDate ? formatDate(sewing.endDate) : '进行中'],
      ['扎件数', sewing.bundleQty],
      ['工序', sewing.process],
      ['累计完成', totalCompleted],
      ['订单总数', order.qty],
      ['完成率', `${((totalCompleted / order.qty) * 100).toFixed(1)}%`]
    ]
  );

  if (sewing.members.length > 0) {
    printSection('组员名单');
    printTable(
      ['序号', '姓名'],
      sewing.members.map((m, i) => [i + 1, m])
    );
  }

  return 0;
}

function recordIronPack(storage, order, opts) {
  const updates = {};
  const details = [];

  if (opts.ironDate || opts.ironedBy || opts.ironQty) {
    updates.ironDate = opts.ironDate ? new Date(opts.ironDate).toISOString() : new Date().toISOString();
    updates.ironedBy = opts.ironedBy || '';
    updates.ironQty = parseInt(opts.ironQty) || order.qty;
    details.push(['整烫日期', formatDate(updates.ironDate)]);
    details.push(['整烫员', updates.ironedBy || '-']);
    details.push(['整烫数量', updates.ironQty]);
  }

  if (opts.packDate || opts.packedBy || opts.packQty || opts.boxCount) {
    updates.packDate = opts.packDate ? new Date(opts.packDate).toISOString() : new Date().toISOString();
    updates.packedBy = opts.packedBy || '';
    updates.packQty = parseInt(opts.packQty) || order.qty;
    updates.boxCount = parseInt(opts.boxCount) || 0;
    details.push(['包装日期', formatDate(updates.packDate)]);
    details.push(['包装员', updates.packedBy || '-']);
    details.push(['包装数量', updates.packQty]);
    details.push(['总箱数', updates.boxCount]);
  }

  if (Object.keys(updates).length === 0) {
    printError('请提供整烫或包装相关参数');
    return 1;
  }

  const existing = storage.getSewing().find(s => s.orderNo === order.orderNo && s.process === '整烫包装');
  if (existing) {
    const allSewing = storage.getSewing();
    const idx = allSewing.findIndex(s => s.id === existing.id);
    allSewing[idx] = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    storage.saveSewing(allSewing);
  } else {
    const record = {
      id: generateId('SEW-'),
      orderNo: order.orderNo,
      styleNo: order.styleNo,
      groupNo: '0',
      process: '整烫包装',
      ...updates,
      recordedAt: new Date().toISOString()
    };
    storage.addSewing(record);
  }

  if (updates.packDate || updates.ironDate) {
    storage.updateOrder(order.orderNo, { status: 'PACKING_DONE' });
  }

  printHeader('整烫包装记录成功');
  printSection(`订单: ${order.orderNo} / 款号: ${order.styleNo}`);
  printTable(['项目', '内容'], details);

  return 0;
}

function listSewing(storage, orderNo) {
  let records = storage.getSewing();
  if (orderNo) {
    records = records.filter(s => s.orderNo === orderNo);
  }

  if (records.length === 0) {
    printWarning('暂无缝制记录');
    return 0;
  }

  printHeader('缝制与包装记录');
  printTable(
    ['订单号', '款号', '工序', '组别', '负责人', '分配数', '完成数', '次品', '开始日期', '结束日期'],
    records.map(r => [
      r.orderNo,
      r.styleNo,
      r.process,
      r.process === '整烫包装' ? '-' : `第${r.groupNo}组`,
      r.leader || r.ironedBy || r.packedBy || '-',
      r.assignedQty || r.ironQty || r.packQty || '-',
      r.completedQty || r.packQty || '-',
      r.defectQty || '-',
      formatDate(r.startDate || r.ironDate || r.packDate),
      r.endDate ? formatDate(r.endDate) : r.packDate ? formatDate(r.packDate) : '-'
    ])
  );
  return 0;
}

function parseMembers(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;
  return String(str).split(/[,;，；]/).map(s => s.trim()).filter(s => s);
}

function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--groupNo': 'groupNo', '--group-no': 'groupNo',
    '--leader': 'leader',
    '--members': 'members',
    '--qty': 'qty',
    '--completed': 'completed',
    '--defects': 'defects',
    '--startDate': 'startDate', '--start-date': 'startDate',
    '--endDate': 'endDate', '--end-date': 'endDate',
    '--bundleQty': 'bundleQty', '--bundle-qty': 'bundleQty',
    '--process': 'process',
    '--stage': 'stage',
    '--ironDate': 'ironDate', '--iron-date': 'ironDate',
    '--ironedBy': 'ironedBy', '--ironed-by': 'ironedBy',
    '--ironQty': 'ironQty', '--iron-qty': 'ironQty',
    '--packDate': 'packDate', '--pack-date': 'packDate',
    '--packedBy': 'packedBy', '--packed-by': 'packedBy',
    '--packQty': 'packQty', '--pack-qty': 'packQty',
    '--boxCount': 'boxCount', '--box-count': 'boxCount',
    '--remark': 'remark'
  };

  const boolFlags = ['--list'];

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
  if (args.includes('--list')) opts.list = true;
  return opts;
}

function printHelp() {
  console.log(`
用法: garment-trace record-sew [选项]

记录缝制组别信息，或录入整烫包装时间。

缝制组别选项:
  --orderNo <订单号>        订单号 (必填)
  --groupNo <组号>          缝制组别号 (必填，如 1,2,3...)
  --leader <组长>           组长姓名
  --members <组员>          组员名单 (逗号分隔: 张三,李四,王五)
  --qty <分配数>            分配给该组的数量
  --completed <完成数>      已完成数量
  --defects <次品数>        发现次品数量
  --startDate <日期>        开始日期 (YYYY-MM-DD)
  --endDate <日期>          结束日期 (YYYY-MM-DD)
  --bundleQty <扎件数>      每扎件数
  --process <工序>          工序名称 (默认: 缝制)
  --remark <备注>           备注信息

整烫包装选项 (二选一或同时):
  --orderNo <订单号>        订单号 (必填)
  --stage <阶段>            阶段: iron / pack
  --ironDate <日期>         整烫日期
  --ironedBy <整烫员>       整烫员姓名
  --ironQty <数量>          整烫数量
  --packDate <日期>         包装日期
  --packedBy <包装员>       包装员姓名
  --packQty <数量>          包装数量
  --boxCount <箱数>         装箱总数

其他选项:
  --list                    列出所有缝制包装记录
  --list --orderNo <单号>   列出指定订单的记录

示例:
  garment-trace record-sew --orderNo PO2026001 --groupNo 1 --leader 李组长 --members "张平,王芳,刘洋,赵强,孙丽" --qty 2500 --completed 0 --startDate 2026-06-12
  garment-trace record-sew --orderNo PO2026001 --groupNo 1 --completed 2500 --defects 8 --endDate 2026-06-18
  garment-trace record-sew --orderNo PO2026001 --ironDate 2026-06-19 --ironedBy 陈师傅 --ironQty 5000
  garment-trace record-sew --orderNo PO2026001 --packDate 2026-06-20 --packedBy "王霞,周敏" --packQty 5000 --boxCount 208
  garment-trace record-sew --list
`);
}

module.exports = { run: recordSewCommand, help: printHelp };
