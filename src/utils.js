const crypto = require('crypto');

function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}${timestamp}${random}`.toUpperCase();
}

function generateBoxNo(orderNo, styleNo, sequence) {
  const seq = String(sequence).padStart(4, '0');
  const styleClean = (styleNo || '').replace(/[^A-Za-z0-9]/g, '');
  const styleShort = styleClean.substring(0, 6).toUpperCase().padEnd(6, 'X');
  const orderTail = (orderNo || '').replace(/[^0-9]/g, '').slice(-4).padStart(4, '0');
  return `${styleShort}-${orderTail}-${seq}`;
}

function generateTraceCode(orderNo, styleNo, boxNo) {
  const data = `${orderNo}-${styleNo}-${boxNo}-${Date.now()}`;
  const hash = crypto.createHash('sha256').update(data).digest('hex').substring(0, 16).toUpperCase();
  return `GT-${hash}`;
}

function formatDate(date) {
  const d = date ? new Date(date) : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(date) {
  const d = date ? new Date(date) : new Date();
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

function validateRequired(obj, requiredFields) {
  const missing = [];
  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      missing.push(field);
    }
  }
  return missing;
}

function printTable(headers, rows) {
  const colWidths = headers.map((h, i) => {
    let max = String(h).length;
    rows.forEach(row => {
      const val = String(row[i] ?? '');
      if (val.length > max) max = val.length;
    });
    return max;
  });

  const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
  const headerLine = '|' + headers.map((h, i) => ` ${String(h).padEnd(colWidths[i])} `).join('|') + '|';
  
  console.log(separator);
  console.log(headerLine);
  console.log(separator);
  
  rows.forEach(row => {
    const line = '|' + row.map((cell, i) => {
      const val = String(cell ?? '');
      return ` ${val.padEnd(colWidths[i])} `;
    }).join('|') + '|';
    console.log(line);
  });
  
  console.log(separator);
}

function printSuccess(msg) {
  console.log(`\x1b[32m✔ ${msg}\x1b[0m`);
}

function printError(msg) {
  console.error(`\x1b[31m✘ ${msg}\x1b[0m`);
}

function printWarning(msg) {
  console.warn(`\x1b[33m⚠ ${msg}\x1b[0m`);
}

function printInfo(msg) {
  console.log(`\x1b[36mℹ ${msg}\x1b[0m`);
}

function printHeader(title) {
  const width = 60;
  const padding = Math.floor((width - title.length - 4) / 2);
  console.log('\n' + '='.repeat(width));
  console.log(' '.repeat(padding) + `  ${title}  ` + ' '.repeat(padding));
  console.log('='.repeat(width) + '\n');
}

function printSection(title) {
  console.log(`\n\x1b[1m── ${title} ──\x1b[0m`);
}

function calculateReorderRate(inspections) {
  if (!inspections || inspections.length === 0) return { rate: 0, total: 0, rework: 0 };
  let total = 0;
  let rework = 0;
  inspections.forEach(ins => {
    total += ins.inspectedQty || 0;
    rework += ins.reworkQty || 0;
  });
  const rate = total > 0 ? ((rework / total) * 100).toFixed(2) : 0;
  return { rate: parseFloat(rate), total, rework };
}

function getNextSequence(storage, orderNo, type) {
  if (type === 'box') {
    const boxes = storage.findBoxesByOrder(orderNo);
    return boxes.length + 1;
  }
  if (type === 'cutting') {
    const cuts = storage.findCuttingByOrder(orderNo);
    return cuts.length + 1;
  }
  return 1;
}

module.exports = {
  generateId,
  generateBoxNo,
  generateTraceCode,
  formatDate,
  formatDateTime,
  parseDate,
  validateRequired,
  printTable,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  printHeader,
  printSection,
  calculateReorderRate,
  getNextSequence
};
