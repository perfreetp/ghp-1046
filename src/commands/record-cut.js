const { generateId, formatDate, formatDateTime, getNextSequence, printTable, printSuccess, printError, printWarning, printInfo, printHeader, printSection } = require('../utils');

function recordCutCommand(args, storage) {
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
    return listCutting(storage, opts.orderNo);
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

  const bedNo = opts.bedNo || String(getNextSequence(storage, opts.orderNo, 'cutting'));

  const sizes = parseSizes(opts.sizes || opts.sizeBreakdown);
  const totalQty = Object.values(sizes).reduce((sum, q) => sum + parseInt(q) || 0, 0);

  const cutting = {
    id: generateId('CUT-'),
    orderNo: opts.orderNo,
    styleNo: order.styleNo,
    bedNo: bedNo,
    layerCount: parseInt(opts.layers) || 0,
    spreads: parseInt(opts.spreads) || 0,
    totalQty: parseInt(opts.qty) || totalQty || 0,
    sizes: sizes,
    fabricLot: opts.fabricLot || '',
    cutter: opts.cutter || '',
    cutDate: opts.date ? new Date(opts.date).toISOString() : new Date().toISOString(),
    markerLength: parseFloat(opts.markerLength) || 0,
    markerWidth: parseFloat(opts.markerWidth) || 0,
    fabricUsage: parseFloat(opts.usage) || 0,
    remark: opts.remark || '',
    recordedAt: new Date().toISOString()
  };

  storage.addCutting(cutting);

  const allCuts = storage.findCuttingByOrder(opts.orderNo);
  const totalCut = allCuts.reduce((sum, c) => sum + (c.totalQty || 0), 0);
  if (totalCut >= order.qty) {
    storage.updateOrder(opts.orderNo, { status: 'CUTTING_DONE' });
  } else {
    storage.updateOrder(opts.orderNo, { status: 'CUTTING' });
  }

  printHeader('裁剪登记成功');
  printSection('裁剪信息');
  printTable(
    ['字段', '值'],
    [
      ['裁剪ID', cutting.id],
      ['订单号', cutting.orderNo],
      ['款号', cutting.styleNo],
      ['床次', `第${cutting.bedNo}床`],
      ['层数', cutting.layerCount],
      ['拉布匹数', cutting.spreads],
      ['裁剪总数量', cutting.totalQty],
      ['裁剪日期', formatDate(cutting.cutDate)],
      ['裁剪员', cutting.cutter],
      ['使用面料缸号', cutting.fabricLot],
      ['排料长度(米)', cutting.markerLength],
      ['排料幅宽(米)', cutting.markerWidth],
      ['用布量(米)', cutting.fabricUsage],
      ['累计裁剪数', totalCut],
      ['订单总数量', order.qty],
      ['完成度', `${((totalCut / order.qty) * 100).toFixed(1)}%`]
    ]
  );

  if (Object.keys(cutting.sizes).length > 0) {
    printSection('尺码分配');
    printTable(
      ['尺码', '数量'],
      Object.entries(cutting.sizes).map(([size, qty]) => [size, qty])
    );
  }

  return 0;
}

function listCutting(storage, orderNo) {
  let records = storage.getCutting();
  if (orderNo) {
    records = records.filter(c => c.orderNo === orderNo);
  }

  if (records.length === 0) {
    printWarning('暂无裁剪记录');
    return 0;
  }

  printHeader('裁剪记录清单');
  printTable(
    ['床次', '订单号', '款号', '层数', '数量', '裁剪员', '日期', '缸号'],
    records.map(r => [
      `第${r.bedNo}床`,
      r.orderNo,
      r.styleNo,
      r.layerCount,
      r.totalQty,
      r.cutter || '-',
      formatDate(r.cutDate),
      r.fabricLot || '-'
    ])
  );
  return 0;
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
    '--bedNo': 'bedNo', '--bed-no': 'bedNo',
    '--layers': 'layers',
    '--spreads': 'spreads',
    '--qty': 'qty',
    '--sizes': 'sizes',
    '--sizeBreakdown': 'sizeBreakdown', '--size-breakdown': 'sizeBreakdown',
    '--fabricLot': 'fabricLot', '--fabric-lot': 'fabricLot',
    '--cutter': 'cutter',
    '--date': 'date',
    '--markerLength': 'markerLength', '--marker-length': 'markerLength',
    '--markerWidth': 'markerWidth', '--marker-width': 'markerWidth',
    '--usage': 'usage',
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
用法: garment-trace record-cut [选项]

登记裁剪床次信息。

选项:
  --orderNo <订单号>        订单号 (必填)
  --bedNo <床次号>         床次号 (默认自动递增)
  --layers <层数>          裁剪层数
  --spreads <匹数>          拉布匹数
  --qty <总数量>          裁剪总数量
  --sizes <分配>          尺码数量分配 (如 S:100,M:200,L:150)
  --sizeBreakdown <明细>   同上，别名
  --fabricLot <缸号>        使用的面料缸号
  --cutter <裁剪员>         裁剪员姓名
  --date <日期>           裁剪日期 (YYYY-MM-DD)
  --markerLength <长度>    排料长度(米)
  --markerWidth <幅宽>     排料幅宽(米)
  --usage <用布量>         实际用布量(米)
  --remark <备注>          备注信息
  --list                  列出所有裁剪记录
  --list --orderNo <单号>  列出指定订单的裁剪记录

示例:
  garment-trace record-cut --orderNo PO2026001 --layers 200 --spreads 50 --qty 2500 --sizes "S:400,M:600,L:750,XL:500,XXL:250" --fabricLot DYE20260608 --cutter 张师傅 --date 2026-06-10 --usage 1850.5
  garment-trace record-cut --orderNo PO2026001 --layers 200 --qty 2500
  garment-trace record-cut --list
`);
}

module.exports = { run: recordCutCommand, help: printHelp };
