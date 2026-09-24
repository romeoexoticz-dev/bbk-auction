import ExcelJS from "exceljs";
import type { OrderReport, OrderReportRow } from "@/lib/reports/order-report";

const orderStatusLabels: Record<string, string> = {
  pending_payment: "รอชำระ",
  paid: "ตรวจสอบแล้ว",
  preparing: "กำลังเตรียมส่ง",
  shipped: "จัดส่งแล้ว",
  delivered: "ส่งถึงแล้ว",
  completed: "สำเร็จ",
  cancelled: "ยกเลิก",
  disputed: "มีข้อโต้แย้ง",
  refunded: "คืนเงินแล้ว",
};

const paymentStatusLabels: Record<string, string> = {
  not_submitted: "ยังไม่ส่งหลักฐาน",
  submitted: "รอตรวจหลักฐาน",
  needs_correction: "ต้องส่งหลักฐานใหม่",
  approved: "ตรวจสอบแล้ว",
};

function csvCell(value: string | number) {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function baht(value: number) {
  return value / 100;
}

function formatDateTime(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

export function createOrderReportCsv(report: OrderReport) {
  const headers = [
    "เลขที่ Order", "วันที่สร้าง", "รายการประมูล", "หมวดหมู่", "ลูกค้า", "สถานะ Order",
    "สถานะชำระ", "ราคาชนะ (บาท)", "ค่าธรรมเนียม 10% (บาท)", "VAT ค่าธรรมเนียม (บาท)",
    "ค่าจัดส่ง (บาท)", "ยอดรวม (บาท)", "กำหนดชำระ", "บริษัทขนส่ง", "เลขพัสดุ", "วันที่จัดส่ง",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of report.rows) {
    lines.push([
      row.orderNumber,
      formatDateTime(row.createdAt),
      row.auctionTitle,
      row.category,
      row.buyerName,
      orderStatusLabels[row.status] ?? row.status,
      paymentStatusLabels[row.paymentReviewState] ?? row.paymentReviewState,
      baht(row.winningAmount).toFixed(2),
      baht(row.buyerFeeAmount).toFixed(2),
      baht(row.buyerFeeVatAmount).toFixed(2),
      baht(row.shippingAmount).toFixed(2),
      baht(row.totalAmount).toFixed(2),
      formatDateTime(row.paymentDueAt),
      row.carrier,
      row.trackingNumber,
      formatDateTime(row.shippedAt),
    ].map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function setSheetDefaults(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.properties.defaultRowHeight = 21;
  sheet.eachRow((row) => {
    row.alignment = { vertical: "middle" };
  });
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171713" } };
    cell.font = { bold: true, color: { argb: "FFF5DF9F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFB68A38" } } };
  });
}

function addOrderDetailSheet(workbook: ExcelJS.Workbook, name: string, rows: OrderReportRow[]) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "เลขที่ Order", key: "orderNumber", width: 22 },
    { header: "วันที่สร้าง", key: "createdAt", width: 19 },
    { header: "รายการประมูล", key: "auctionTitle", width: 40 },
    { header: "หมวดหมู่", key: "category", width: 20 },
    { header: "ลูกค้า", key: "buyerName", width: 24 },
    { header: "สถานะ Order", key: "status", width: 18 },
    { header: "สถานะชำระ", key: "paymentReviewState", width: 20 },
    { header: "ราคาชนะ (บาท)", key: "winningAmount", width: 18 },
    { header: "ค่าธรรมเนียม 10% (บาท)", key: "buyerFeeAmount", width: 21 },
    { header: "VAT ค่าธรรมเนียม (บาท)", key: "buyerFeeVatAmount", width: 22 },
    { header: "ค่าจัดส่ง (บาท)", key: "shippingAmount", width: 17 },
    { header: "ยอดรวม (บาท)", key: "totalAmount", width: 18 },
    { header: "กำหนดชำระ", key: "paymentDueAt", width: 19 },
    { header: "บริษัทขนส่ง", key: "carrier", width: 20 },
    { header: "เลขพัสดุ", key: "trackingNumber", width: 24 },
    { header: "วันที่จัดส่ง", key: "shippedAt", width: 19 },
  ];
  styleHeader(sheet.getRow(1));
  for (const row of rows) {
    sheet.addRow({
      orderNumber: row.orderNumber,
      createdAt: new Date(row.createdAt),
      auctionTitle: row.auctionTitle,
      category: row.category,
      buyerName: row.buyerName,
      status: orderStatusLabels[row.status] ?? row.status,
      paymentReviewState: paymentStatusLabels[row.paymentReviewState] ?? row.paymentReviewState,
      winningAmount: baht(row.winningAmount),
      buyerFeeAmount: baht(row.buyerFeeAmount),
      buyerFeeVatAmount: baht(row.buyerFeeVatAmount),
      shippingAmount: baht(row.shippingAmount),
      totalAmount: baht(row.totalAmount),
      paymentDueAt: new Date(row.paymentDueAt),
      carrier: row.carrier,
      trackingNumber: row.trackingNumber,
      shippedAt: row.shippedAt ? new Date(row.shippedAt) : null,
    });
  }
  const dateColumns = [2, 13, 16];
  const moneyColumns = [8, 9, 10, 11, 12];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber % 2 === 0) {
      row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBF1" } }; });
    }
    for (const column of dateColumns) row.getCell(column).numFmt = "dd/mm/yyyy hh:mm";
    for (const column of moneyColumns) row.getCell(column).numFmt = "#,##0.00";
  }
  sheet.autoFilter = { from: "A1", to: "P1" };
  setSheetDefaults(sheet);
  return sheet;
}

export async function createOrderReportXlsx(report: OrderReport) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BBK AUCTION";
  workbook.company = "บอล แบงค์เก่า";
  workbook.created = new Date();
  workbook.modified = new Date();

  const summary = workbook.addWorksheet("สรุป", { views: [{ state: "frozen", ySplit: 3 }] });
  summary.mergeCells("A1:D1");
  summary.getCell("A1").value = "BBK AUCTION รายงาน Order";
  summary.getCell("A1").font = { bold: true, color: { argb: "FFF7E8B2" }, size: 20 };
  summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171713" } };
  summary.getCell("A1").alignment = { vertical: "middle" };
  summary.getRow(1).height = 38;
  summary.mergeCells("A2:D2");
  summary.getCell("A2").value = `ช่วงวันที่ ${report.range.from} ถึง ${report.range.to} · หน่วย: บาท`;
  summary.getCell("A2").font = { color: { argb: "FF6D6455" }, italic: true };

  const metrics: Array<[string, number, string]> = [
    ["จำนวน Order", report.summary.orderCount, "#,##0"],
    ["ยอดประมูลจากราคาชนะ", baht(report.summary.auctionValue), "#,##0.00"],
    ["ค่าธรรมเนียมผู้ซื้อ 10%", baht(report.summary.buyerFees), "#,##0.00"],
    ["VAT ของค่าธรรมเนียม", baht(report.summary.feeVat), "#,##0.00"],
    ["ค่าธรรมเนียมรวม VAT", baht(report.summary.feesIncludingVat), "#,##0.00"],
    ["ยอดชำระที่ตรวจแล้ว", baht(report.summary.approvedPaymentTotal), "#,##0.00"],
    ["จำนวนรายการที่ชำระแล้ว", report.summary.approvedPaymentCount, "#,##0"],
    ["ยอดรอชำระ", baht(report.summary.pendingPaymentTotal), "#,##0.00"],
    ["จำนวนรายการรอชำระ", report.summary.pendingPaymentCount, "#,##0"],
    ["มูลค่าสินค้าค้างส่ง", baht(report.summary.pendingShipmentTotal), "#,##0.00"],
    ["จำนวนสินค้าค้างส่ง", report.summary.pendingShipmentCount, "#,##0"],
  ];
  summary.addRow([]);
  const heading = summary.addRow(["ตัวชี้วัด", "ยอด/จำนวน", "นิยาม", "แหล่งข้อมูล"]);
  styleHeader(heading);
  for (const [label, value, numFmt] of metrics) {
    const definition = label === "ยอดชำระที่ตรวจแล้ว"
      ? "Order ที่สถานะตรวจหลักฐานเป็น approved"
      : label.includes("ค้างส่ง")
        ? "Order สถานะ paid หรือ preparing"
        : "คำนวณจาก Order ในช่วงวันที่เลือก";
    const row = summary.addRow([label, value, definition, "Supabase orders"]);
    row.getCell(2).numFmt = numFmt;
  }
  summary.columns = [{ width: 31 }, { width: 20 }, { width: 42 }, { width: 22 }];
  summary.eachRow((row, rowNumber) => {
    if (rowNumber > 4 && rowNumber % 2 === 1) {
      row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBF1" } }; });
    }
    row.alignment = { vertical: "middle", wrapText: true };
  });

  addOrderDetailSheet(workbook, "รายละเอียด Order", report.rows);
  addOrderDetailSheet(workbook, "สินค้าค้างส่ง", report.rows.filter((row) => row.status === "paid" || row.status === "preparing"));

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
