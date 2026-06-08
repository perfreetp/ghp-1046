const { generateId, formatDate, formatDateTime, printTable, printSuccess, printError, printWarning, printInfo, printHeader, printSection, validateRequired } = require('../utils');

function linkMaterialCommand(args, storage) {
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
    return listMaterials(storage, opts.orderNo);
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

  if (!opts.type) {
    printError('缺少必填参数 --type (面料/辅料)');
    return 1;
  }

  if (opts.type === '面料' && !opts.lotNo) {
    printError('面料需要指定 --lotNo (缸号)');
    return 1;
  }

  if (opts.type === '辅料' && !opts.batchNo) {
    printError('辅料需要指定 --batchNo (批次号)');
    return 1;
  }

  const material = {
    id: generateId('MAT-'),
    orderNo: opts.orderNo,
    styleNo: order.styleNo,
    type: opts.type,
    category: opts.category || '',
    name: opts.name || '',
    code: opts.code || '',
    color: opts.color || order.color || '',
    lotNo: opts.lotNo || '',
    batchNo: opts.batchNo || '',
    supplier: opts.supplier || '',
    qty: parseFloat(opts.qty) || 0,
    unit: opts.unit || (opts.type === '面料' ? '米' : '个'),
    receivedDate: opts.receivedDate ? new Date(opts.receivedDate).toISOString() : new Date().toISOString(),
    inspectionResult: opts.inspectionResult || 'PENDING',
    remark: opts.remark || '',
    linkedAt: new Date().toISOString()
  };

  storage.addMaterial(material);
  storage.updateOrder(opts.orderNo, { status: 'MATERIAL_LINKED' });

  printHeader('面辅料绑定成功');
  printSection('物料信息');
  printTable(
    ['字段', '值'],
    [
      ['物料ID', material.id],
      ['订单号', material.orderNo],
      ['款号', material.styleNo],
      ['类型', material.type],
      ['分类', material.category],
      ['名称', material.name],
      ['物料编码', material.code],
      ['颜色', material.color],
      ['缸号', material.lotNo || '-'],
      ['批次号', material.batchNo || '-'],
      ['供应商', material.supplier],
      ['数量', `${material.qty} ${material.unit}`],
      ['到货日期', formatDate(material.receivedDate)],
      ['检验结果', material.inspectionResult],
      ['绑定时间', formatDateTime(material.linkedAt)]
    ]
  );

  return 0;
}

function listMaterials(storage, orderNo) {
  let materials = storage.getMaterials();
  if (orderNo) {
    materials = materials.filter(m => m.orderNo === orderNo);
  }

  if (materials.length === 0) {
    printWarning('暂无面辅料记录');
    return 0;
  }

  printHeader('面辅料清单');
  printTable(
    ['ID', '订单号', '款号', '类型', '名称', '缸号/批次', '颜色', '数量', '单位', '供应商'],
    materials.map(m => [
      m.id.substring(0, 10) + '...',
      m.orderNo,
      m.styleNo,
      m.type,
      m.name,
      m.lotNo || m.batchNo,
      m.color,
      m.qty,
      m.unit,
      m.supplier
    ])
  );
  return 0;
}

function parseArgs(args) {
  const opts = {};
  const keyMap = {
    '--orderNo': 'orderNo', '--order-no': 'orderNo',
    '--type': 'type',
    '--category': 'category',
    '--name': 'name',
    '--code': 'code',
    '--color': 'color',
    '--lotNo': 'lotNo', '--lot-no': 'lotNo',
    '--batchNo': 'batchNo', '--batch-no': 'batchNo',
    '--supplier': 'supplier',
    '--qty': 'qty',
    '--unit': 'unit',
    '--receivedDate': 'receivedDate', '--received-date': 'receivedDate',
    '--inspectionResult': 'inspectionResult', '--inspection-result': 'inspectionResult',
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
用法: garment-trace link-material [选项]

绑定面料缸号和辅料批次到订单。

选项:
  --orderNo <订单号>        订单号 (必填)
  --type <类型>             物料类型: 面料 / 辅料 (必填)
  --category <分类>         分类: 如 主料/里料/衬布 / 拉链/钮扣/织唛
  --name <名称>             物料名称
  --code <编码>             物料编码
  --color <颜色>            颜色
  --lotNo <缸号>            面料缸号 (面料必填)
  --batchNo <批次号>        辅料批次号 (辅料必填)
  --supplier <供应商>       供应商
  --qty <数量>              来料数量
  --unit <单位>             单位 (面料默认米, 辅料默认个)
  --receivedDate <日期>     到货日期 (YYYY-MM-DD)
  --inspectionResult <结果> 来料检验结果: PASS/FAIL/PENDING
  --remark <备注>           备注
  --list                    列出所有面辅料
  --list --orderNo <单号>   列出指定订单的面辅料

示例:
  garment-trace link-material --orderNo PO2026001 --type 面料 --category 主料 --name "精梳棉汗布" --code FB-001 --color 白色 --lotNo DYE20260608 --supplier 华纺纺织 --qty 3500 --unit 米
  garment-trace link-material --orderNo PO2026001 --type 辅料 --category 拉链 --name "3号尼龙拉链" --code ACC-Z001 --batchNo B20260605 --supplier YKK --qty 5200
  garment-trace link-material --list
  garment-trace link-material --list --orderNo PO2026001
`);
}

module.exports = { run: linkMaterialCommand, help: printHelp };
