const fs = require('fs');
const path = require('path');
const { generateId, formatDateTime, validateRequired, printSuccess, printError, printWarning, printHeader } = require('../utils');

function initCommand(args, storage) {
  const opts = parseArgs(args);
  
  if (storage.isInitialized()) {
    if (!opts.force) {
      printError('项目已存在，使用 --force 参数覆盖初始化');
      return 1;
    }
    printWarning('覆盖现有项目档案...');
  }

  const project = {
    id: generateId('PRJ-'),
    name: opts.name || '未命名项目',
    factoryName: opts.factory || '',
    factoryCode: opts.code || '',
    contact: opts.contact || '',
    phone: opts.phone || '',
    address: opts.address || '',
    createdAt: new Date().toISOString(),
    version: '1.0.0',
    description: opts.desc || ''
  };

  const missing = validateRequired(project, ['name']);
  if (missing.length > 0) {
    printError(`缺少必填字段: ${missing.join(', ')}`);
    return 1;
  }

  storage.ensureDir();
  storage.saveProject(project);
  storage.saveOrders([]);
  storage.saveMaterials([]);
  storage.saveCutting([]);
  storage.saveSewing([]);
  storage.saveInspections([]);
  storage.saveBoxes([]);
  storage.saveTraceCodes([]);

  printHeader('项目档案初始化成功');
  console.log(`  项目ID:   ${project.id}`);
  console.log(`  项目名称: ${project.name}`);
  console.log(`  工厂名称: ${project.factoryName || '-'}`);
  console.log(`  工厂代码: ${project.factoryCode || '-'}`);
  console.log(`  联系人:   ${project.contact || '-'}`);
  console.log(`  创建时间: ${formatDateTime(project.createdAt)}`);
  console.log(`  数据目录: ${storage.dataDir}`);
  console.log();
  printSuccess('项目初始化完成，可以开始使用以下命令:');
  console.log('  import-order  - 导入订单清单');
  console.log('  link-material - 绑定面辅料信息');
  console.log('  record-cut    - 登记裁剪床次');
  console.log('  record-sew    - 记录缝制与包装');
  console.log('  inspect       - 录入质检信息');
  console.log('  query         - 查询追溯信息');
  console.log('  export        - 导出验货资料');

  return 0;
}

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--name' && args[i + 1]) { opts.name = args[++i]; }
    else if (arg === '--factory' && args[i + 1]) { opts.factory = args[++i]; }
    else if (arg === '--code' && args[i + 1]) { opts.code = args[++i]; }
    else if (arg === '--contact' && args[i + 1]) { opts.contact = args[++i]; }
    else if (arg === '--phone' && args[i + 1]) { opts.phone = args[++i]; }
    else if (arg === '--address' && args[i + 1]) { opts.address = args[++i]; }
    else if (arg === '--desc' && args[i + 1]) { opts.desc = args[++i]; }
    else if (arg === '--force') { opts.force = true; }
    else if (arg.startsWith('--name=')) { opts.name = arg.substring(7); }
    else if (arg.startsWith('--factory=')) { opts.factory = arg.substring(10); }
    else if (arg.startsWith('--code=')) { opts.code = arg.substring(7); }
    else if (arg.startsWith('--contact=')) { opts.contact = arg.substring(10); }
    else if (arg.startsWith('--phone=')) { opts.phone = arg.substring(8); }
  }
  return opts;
}

function printHelp() {
  console.log(`
用法: garment-trace init [选项]

初始化服装质检追溯项目档案。

选项:
  --name <名称>        项目名称 (必填)
  --factory <工厂名>   工厂名称
  --code <工厂代码>    工厂代码
  --contact <联系人>   联系人
  --phone <电话>       联系电话
  --address <地址>     工厂地址
  --desc <描述>        项目描述
  --force              强制覆盖已有项目

示例:
  garment-trace init --name 2026春夏订单 --factory 锦绣制衣 --code JX001
  garment-trace init --name "Q2 Production" --force
`);
}

module.exports = { run: initCommand, help: printHelp };
