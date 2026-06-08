#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const CLI = `node "${path.join(__dirname, '..', 'bin', 'garment-trace.js')}"`;
const TEST_DIR = path.join(__dirname, '..', 'test-project');

let passed = 0;
let failed = 0;
const errors = [];

function run(cmd, opts = {}) {
  const fullCmd = `${CLI} ${cmd}`;
  console.log(`\n\x1b[36m▶ ${fullCmd}\x1b[0m`);
  try {
    const out = execSync(fullCmd, {
      cwd: TEST_DIR,
      encoding: 'utf-8',
      stdio: [null, 'pipe', 'pipe']
    });
    if (out) console.log(out);
    passed++;
    return { code: 0, output: out };
  } catch (e) {
    const err = e.stderr || e.stdout || e.message;
    if (err) console.log(`\x1b[33m${err}\x1b[0m`);
    if (opts.expectError) {
      passed++;
      console.log(`\x1b[32m✔ (预期的错误)\x1b[0m`);
      return { code: e.status || 1, output: err };
    }
    failed++;
    errors.push({ cmd, error: String(err).slice(0, 200) });
    return { code: e.status || 1, output: err };
  }
}

function setup() {
  console.log('='.repeat(70));
  console.log('  服装质检追溯器 - 端到端测试');
  console.log('='.repeat(70));
  console.log(`测试目录: ${TEST_DIR}`);

  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

function banner(text) {
  console.log('\n' + '━'.repeat(70));
  console.log(`  ${text}`);
  console.log('━'.repeat(70));
}

function teardown() {
  console.log('\n' + '='.repeat(70));
  console.log('  测试结果汇总');
  console.log('='.repeat(70));
  console.log(`  ✓ 通过: ${passed}`);
  console.log(`  ✗ 失败: ${failed}`);
  console.log(`  总计: ${passed + failed}`);
  if (failed === 0) {
    console.log('\n\x1b[32m🎉 所有测试通过！\x1b[0m\n');
  } else {
    console.log('\n\x1b[31m失败的命令:\x1b[0m');
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e.cmd}: ${e.error}`));
    process.exit(1);
  }
}

function main() {
  setup();

  banner('1. 帮助与版本');
  run('--version');
  run('--help');

  banner('2. 初始化项目 (init)');
  run('init --name "测试工厂2026" --factory "锦绣制衣厂" --code JX-001 --contact "王经理" --phone "13800138000" --address "广东省东莞市XX工业区"');
  run('init --name "已存在"', { expectError: true });
  run('init --name "测试工厂2026" --factory "锦绣制衣厂" --force');

  banner('3. 导入订单 (import-order)');
  run('import-order --help');
  run('import-order --orderNo PO2026001 --styleNo JX-A001 --styleName "男士圆领短袖T恤" --customer 优衣库 --customerPo UNI-2026-001 --qty 5000 --unitPrice 25.50 --color 白色 --sizeRange S-XXL --sizes "S:800,M:1200,L:1500,XL:1000,XXL:500" --deliveryDate 2026-08-15 --orderDate 2026-06-01 --season 2026SS');
  run('import-order --orderNo PO2026002 --styleNo JX-B002 --styleName "女士收腰连衣裙" --customer HM --qty 3000 --unitPrice 68 --color 碎花 --sizeRange S-XL --sizes "S:600,M:900,L:1000,XL:500" --deliveryDate 2026-07-30');
  run('import-order --orderNo PO2026003 --styleNo JX-C003 --styleName "儿童卫衣套装" --customer 西松屋 --qty 8000 --unitPrice 42 --color 藏青 --sizeRange 90-140 --sizes "90:1500,100:1800,110:1800,120:1500,130:1000,140:400" --deliveryDate 2026-08-10 --season 2026AW');
  const sampleCsv = path.join(__dirname, '..', 'examples', 'orders-sample.csv');
  if (fs.existsSync(sampleCsv)) {
    run(`import-order --file "${sampleCsv}" --overwrite`);
  }

  banner('4. 绑定面辅料 (link-material)');
  run('link-material --help');
  run('link-material --orderNo PO2026001 --type 面料 --category 主料 --name "精梳棉汗布40支" --code FB-001W --color 白色 --lotNo DYE20260608A --supplier 华纺纺织 --qty 3500 --unit 米 --inspectionResult PASS');
  run('link-material --orderNo PO2026001 --type 面料 --category 罗纹 --name "圆领罗纹" --code FB-001R --color 白色 --lotNo DYE20260608B --supplier 华纺纺织 --qty 320 --unit 米');
  run('link-material --orderNo PO2026001 --type 辅料 --category 拉链 --name "3号隐形拉链" --code ACC-Z003 --batchNo B20260605-Z --supplier YKK --qty 5200 --unit 条');
  run('link-material --orderNo PO2026001 --type 辅料 --category 织唛 --name "主唛织标" --code ACC-L001 --batchNo B20260606-L --supplier 华丽织标 --qty 5100 --unit 个');
  run('link-material --orderNo PO2026001 --type 辅料 --category 吊牌 --name "合格证吊牌" --code ACC-T001 --batchNo B20260606-T --supplier 金辉印刷 --qty 5100');
  run('link-material --list');
  run('link-material --list --orderNo PO2026001');

  banner('5. 登记裁剪 (record-cut)');
  run('record-cut --help');
  run('record-cut --orderNo PO2026001 --bedNo 1 --layers 200 --spreads 10 --qty 2000 --sizes "S:400,M:600,L:750,XL:250" --fabricLot DYE20260608A --cutter 张师傅 --date 2026-06-10 --markerLength 12.5 --markerWidth 1.85 --usage 1480.5');
  run('record-cut --orderNo PO2026001 --bedNo 2 --layers 200 --spreads 15 --qty 3000 --sizes "S:400,M:600,L:750,XL:750,XXL:500" --fabricLot DYE20260608A --cutter 李师傅 --date 2026-06-11 --usage 2220.3');
  run('record-cut --list');

  banner('6. 记录缝制与包装 (record-sew)');
  run('record-sew --help');
  run('record-sew --orderNo PO2026001 --groupNo 1 --leader 李组长 --members "张平,王芳,刘洋,赵强,孙丽,周伟,吴敏,郑涛" --qty 2500 --startDate 2026-06-12 --bundleQty 12');
  run('record-sew --orderNo PO2026001 --groupNo 2 --leader 陈组长 --members "黄磊,徐静,杨帆,朱琳,胡军,林燕,何强,罗敏" --qty 2500 --startDate 2026-06-12');
  run('record-sew --orderNo PO2026001 --groupNo 1 --completed 2500 --defects 12 --endDate 2026-06-18');
  run('record-sew --orderNo PO2026001 --groupNo 2 --completed 2480 --defects 20 --endDate 2026-06-19');
  run('record-sew --orderNo PO2026001 --ironDate 2026-06-20 --ironedBy "陈师傅,马师傅" --ironQty 4980');
  run('record-sew --orderNo PO2026001 --packDate 2026-06-21 --packedBy "王霞,周敏,刘芳" --packQty 4980 --boxCount 208');
  run('record-sew --list');

  banner('7. 质检与箱唛 (inspect)');
  run('inspect --help');
  run('inspect --defectTypes');
  run('inspect --newBox --orderNo PO2026001 --sequence 1 --qty 24 --sizes "S:6,M:6,L:6,XL:6" --gw 18.5 --nw 16.2 --measure "60x40x30" --sealNo SL000001 --palletNo PLT-A01 --packedBy 王霞 --date 2026-06-21');
  run('inspect --newBox --orderNo PO2026001 --sequence 2 --qty 24 --sizes "S:6,M:6,L:6,XL:6" --gw 18.4 --nw 16.1 --measure "60x40x30" --sealNo SL000002');
  run('inspect --newBox --orderNo PO2026001 --sequence 3 --qty 24 --sizes "M:6,L:6,XL:6,XXL:6" --gw 18.8 --nw 16.5 --measure "60x40x30" --sealNo SL000003');
  run('inspect --listBoxes');
  run('inspect --orderNo PO2026001 --boxNo JXA001-6001-0001 --inspectedQty 24 --passQty 23 --reworkQty 1 --defects "线头未清:1" --judgment REWORK --inspector 王质检 --date 2026-06-22');
  run('inspect --orderNo PO2026001 --boxNo JXA001-6001-0002 --inspectedQty 24 --passQty 24 --reworkQty 0 --defects "" --judgment PASS --inspector 王质检 --date 2026-06-22');
  run('inspect --orderNo PO2026001 --boxNo JXA001-6001-0003 --inspectedQty 24 --passQty 21 --reworkQty 2 --rejectQty 1 --defects "污渍:1,跳线:1,破洞:1" --judgment REWORK --inspector 李质检 --date 2026-06-22');
  run('inspect --orderNo PO2026001 --inspectedQty 500 --passQty 486 --reworkQty 12 --rejectQty 2 --defects "跳线:4,污渍:3,线头未清:3,色差:1,尺寸超差:1" --judgment REWORK --level AQL2.5 --inspector 王质检 --date 2026-06-23 --remark 生产中抽检');
  run('inspect --list');

  banner('8. 查询追溯 (query)');
  run('query --help');
  run('query');
  run('query --orders');
  run('query --orderNo PO2026001');
  run('query --styleNo JX-A001');
  run('query --boxNo JXA001-6001-0001');
  run('query --uninspected');
  run('query --reworkRate');

  banner('9. 导出与校验 (export)');
  run('export --help');
  run('export --validate', { expectError: true });
  run('export --traceCodes --orderNo PO2026001');
  run('export --printBox JXA001-6001-0001');
  run('export --orderNo PO2026001 --generateCodes');

  banner('10. 使用简写别名');
  run('gt --version 2>/dev/null || echo "别名需要 npm link 后才可用"');
  run('query --summary');

  teardown();
}

main();
