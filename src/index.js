const Storage = require('./storage');
const { printError, printInfo } = require('./utils');

const commands = {
  init: require('./commands/init'),
  'import-order': require('./commands/import-order'),
  'link-material': require('./commands/link-material'),
  'record-cut': require('./commands/record-cut'),
  'record-sew': require('./commands/record-sew'),
  inspect: require('./commands/inspect'),
  query: require('./commands/query'),
  export: require('./commands/export')
};

const commandAliases = {
  'init': 'init',
  'import': 'import-order',
  'import-order': 'import-order',
  'link': 'link-material',
  'link-material': 'link-material',
  'cut': 'record-cut',
  'record-cut': 'record-cut',
  'sew': 'record-sew',
  'record-sew': 'record-sew',
  'inspect': 'inspect',
  'check': 'inspect',
  'query': 'query',
  'search': 'query',
  'export': 'export',
  'exp': 'export'
};

function run(argv) {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printMainHelp();
    return 0;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('garment-trace v1.0.0');
    return 0;
  }

  const commandName = args[0];
  const commandArgs = args.slice(1);

  const realName = commandAliases[commandName];
  if (!realName || !commands[realName]) {
    printError(`未知命令: ${commandName}`);
    printInfo('使用 garment-trace --help 查看所有可用命令');
    return 1;
  }

  if (commandArgs.includes('--help') || commandArgs.includes('-h')) {
    commands[realName].help();
    return 0;
  }

  const storage = new Storage(process.cwd());

  try {
    const exitCode = commands[realName].run(commandArgs, storage);
    return exitCode || 0;
  } catch (e) {
    printError(`执行出错: ${e.message}`);
    console.error(e.stack);
    return 1;
  }
}

function printMainHelp() {
  console.log(`
\x1b[1m服装质检追溯器 v1.0.0\x1b[0m
成衣工厂本地订单、面辅料、工序和抽检记录管理工具
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\x1b[36m用法:\x1b[0m
  garment-trace <命令> [选项]
  gt <命令> [选项]           (简写)

\x1b[36m核心命令:\x1b[0m
  \x1b[32minit\x1b[0m              创建项目档案，初始化本地数据库
  \x1b[32mimport-order\x1b[0m      导入订单清单 (单条录入/CSV/JSON批量)
  \x1b[32mlink-material\x1b[0m     绑定面料缸号和辅料批次
  \x1b[32mrecord-cut\x1b[0m        登记裁剪床次、层数、尺码分配
  \x1b[32mrecord-sew\x1b[0m        记录缝制组别、整烫包装时间
  \x1b[32minspect\x1b[0m           录入抽检、疵点、返工判定，生成箱唛
  \x1b[32mquery\x1b[0m             多维度查询 (款号/批次/追溯码/未检/返工率)
  \x1b[32mexport\x1b[0m            导出客户验货包、追溯码、校验漏填

\x1b[36m命令别名:\x1b[0m
  import → import-order | link → link-material
  cut → record-cut      | sew → record-sew
  check → inspect       | search → query
  exp → export

\x1b[36m全局选项:\x1b[0m
  -h, --help            显示帮助 (命令后加可查看命令详情)
  -v, --version         显示版本号

\x1b[36m典型工作流:\x1b[0m
  ① init 初始化项目
  ② import-order 导入订单
  ③ link-material 绑定面辅料缸号/批次
  ④ record-cut 登记裁剪
  ⑤ record-sew 记录缝制与包装
  ⑥ inspect --newBox 生成箱唛
  ⑦ inspect 录入质检抽检
  ⑧ query 查询追溯信息 / 统计返工率
  ⑨ export 导出客户验货包

\x1b[36m查看命令详情:\x1b[0m
  garment-trace <命令> --help
  例如: garment-trace inspect --help

\x1b[36m示例:\x1b[0m
  gt init --name "2026春夏生产" --factory 锦绣制衣
  gt import-order --orderNo PO2026001 --styleNo JX-A001 --qty 5000 --customer UNIQLO
  gt query --orderNo PO2026001
  gt export --validate

数据存储在当前目录下的 .garment-trace/ 文件夹中。
`);
}

module.exports = { run };
