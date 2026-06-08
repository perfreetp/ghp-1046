const fs = require('fs');
const path = require('path');

class Storage {
  constructor(projectPath) {
    this.projectPath = projectPath || process.cwd();
    this.dataDir = path.join(this.projectPath, '.garment-trace');
    this.files = {
      project: path.join(this.dataDir, 'project.json'),
      orders: path.join(this.dataDir, 'orders.json'),
      materials: path.join(this.dataDir, 'materials.json'),
      cutting: path.join(this.dataDir, 'cutting.json'),
      sewing: path.join(this.dataDir, 'sewing.json'),
      inspections: path.join(this.dataDir, 'inspections.json'),
      boxes: path.join(this.dataDir, 'boxes.json'),
      traceCodes: path.join(this.dataDir, 'trace-codes.json'),
      scanLogs: path.join(this.dataDir, 'scan-logs.json'),
      riskHandlings: path.join(this.dataDir, 'risk-handlings.json')
    };
  }

  isInitialized() {
    return fs.existsSync(this.files.project);
  }

  ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  readFile(filePath, defaultValue) {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch (e) {
      return defaultValue;
    }
  }

  writeFile(filePath, data) {
    this.ensureDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  getProject() {
    return this.readFile(this.files.project, null);
  }

  saveProject(project) {
    this.writeFile(this.files.project, project);
  }

  getOrders() {
    return this.readFile(this.files.orders, []);
  }

  saveOrders(orders) {
    this.writeFile(this.files.orders, orders);
  }

  addOrder(order) {
    const orders = this.getOrders();
    orders.push(order);
    this.saveOrders(orders);
  }

  findOrder(orderNo) {
    const orders = this.getOrders();
    return orders.find(o => o.orderNo === orderNo);
  }

  updateOrder(orderNo, updates) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.orderNo === orderNo);
    if (idx !== -1) {
      orders[idx] = { ...orders[idx], ...updates, updatedAt: new Date().toISOString() };
      this.saveOrders(orders);
      return orders[idx];
    }
    return null;
  }

  getMaterials() {
    return this.readFile(this.files.materials, []);
  }

  saveMaterials(materials) {
    this.writeFile(this.files.materials, materials);
  }

  addMaterial(material) {
    const materials = this.getMaterials();
    materials.push(material);
    this.saveMaterials(materials);
  }

  findMaterialsByOrder(orderNo) {
    return this.getMaterials().filter(m => m.orderNo === orderNo);
  }

  getCutting() {
    return this.readFile(this.files.cutting, []);
  }

  saveCutting(cutting) {
    this.writeFile(this.files.cutting, cutting);
  }

  addCutting(record) {
    const cutting = this.getCutting();
    cutting.push(record);
    this.saveCutting(cutting);
  }

  findCuttingByOrder(orderNo) {
    return this.getCutting().filter(c => c.orderNo === orderNo);
  }

  getSewing() {
    return this.readFile(this.files.sewing, []);
  }

  saveSewing(sewing) {
    this.writeFile(this.files.sewing, sewing);
  }

  addSewing(record) {
    const sewing = this.getSewing();
    sewing.push(record);
    this.saveSewing(sewing);
  }

  findSewingByOrder(orderNo) {
    return this.getSewing().filter(s => s.orderNo === orderNo);
  }

  getInspections() {
    return this.readFile(this.files.inspections, []);
  }

  saveInspections(inspections) {
    this.writeFile(this.files.inspections, inspections);
  }

  addInspection(record) {
    const inspections = this.getInspections();
    inspections.push(record);
    this.saveInspections(inspections);
  }

  findInspectionsByOrder(orderNo) {
    return this.getInspections().filter(i => i.orderNo === orderNo);
  }

  findInspectionsByBox(boxNo) {
    return this.getInspections().filter(i => i.boxNo === boxNo);
  }

  getBoxes() {
    return this.readFile(this.files.boxes, []);
  }

  saveBoxes(boxes) {
    this.writeFile(this.files.boxes, boxes);
  }

  addBox(box) {
    const boxes = this.getBoxes();
    boxes.push(box);
    this.saveBoxes(boxes);
  }

  findBoxesByOrder(orderNo) {
    return this.getBoxes().filter(b => b.orderNo === orderNo);
  }

  findBoxByNo(boxNo) {
    return this.getBoxes().find(b => b.boxNo === boxNo);
  }

  getTraceCodes() {
    return this.readFile(this.files.traceCodes, []);
  }

  saveTraceCodes(codes) {
    this.writeFile(this.files.traceCodes, codes);
  }

  addTraceCode(code) {
    const codes = this.getTraceCodes();
    codes.push(code);
    this.saveTraceCodes(codes);
  }

  findTraceCode(code) {
    return this.getTraceCodes().find(c => c.code === code);
  }

  findTraceCodesByOrder(orderNo) {
    return this.getTraceCodes().filter(c => c.orderNo === orderNo);
  }

  getScanLogs() {
    return this.readFile(this.files.scanLogs, []);
  }

  saveScanLogs(logs) {
    this.writeFile(this.files.scanLogs, logs);
  }

  addScanLog(log) {
    const logs = this.getScanLogs();
    logs.push(log);
    this.saveScanLogs(logs);
  }

  findScanLogsByTraceCode(code) {
    return this.getScanLogs().filter(l => l.traceCode === code);
  }

  findScanLogsByOrder(orderNo) {
    return this.getScanLogs().filter(l => l.orderNo === orderNo);
  }

  findScanLogsByBox(boxNo) {
    return this.getScanLogs().filter(l => l.boxNo === boxNo);
  }

  getRiskHandlings() {
    return this.readFile(this.files.riskHandlings, []);
  }

  saveRiskHandlings(records) {
    this.writeFile(this.files.riskHandlings, records);
  }

  addRiskHandling(record) {
    const records = this.getRiskHandlings();
    records.push(record);
    this.saveRiskHandlings(records);
  }

  findRiskHandlingsByOrder(orderNo) {
    return this.getRiskHandlings().filter(r => r.orderNo === orderNo);
  }

  findLatestRiskHandlingByOrder(orderNo) {
    const list = this.findRiskHandlingsByOrder(orderNo).sort((a, b) => new Date(b.handledAt) - new Date(a.handledAt));
    return list.length > 0 ? list[0] : null;
  }

  getAllLatestRiskHandlings() {
    const map = {};
    this.getRiskHandlings().forEach(r => {
      const existing = map[r.orderNo];
      if (!existing || new Date(r.handledAt) > new Date(existing.handledAt)) {
        map[r.orderNo] = r;
      }
    });
    return map;
  }
}

module.exports = Storage;
