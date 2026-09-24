import { NextRequest } from "next/server";
import { createOrderReportCsv, createOrderReportXlsx } from "@/lib/reports/order-report-export";
import { loadOrderReport, OrderReportError, resolveOrderReportRange } from "@/lib/reports/order-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof OrderReportError) {
    const status = error.code === "unauthorized" ? 401 : error.code === "forbidden" ? 403 : error.code === "too_many_rows" ? 413 : 400;
    const message = error.code === "too_many_rows"
      ? "ช่วงวันที่มีข้อมูลเกิน 25,000 รายการ กรุณาเลือกช่วงวันที่สั้นลง"
      : error.code === "invalid_range"
        ? "ช่วงวันที่ไม่ถูกต้องหรือยาวเกิน 366 วัน"
        : error.code === "query_failed"
          ? "โหลดข้อมูลรายงานไม่สำเร็จ"
          : "ไม่มีสิทธิ์ดาวน์โหลดรายงาน";
    return Response.json({ error: message }, { status });
  }
  console.error("Unable to export order report");
  return Response.json({ error: "สร้างไฟล์รายงานไม่สำเร็จ" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
    const range = resolveOrderReportRange(
      request.nextUrl.searchParams.get("from"),
      request.nextUrl.searchParams.get("to"),
    );
    const report = await loadOrderReport(range);
    const filename = `bbk-order-report-${range.from}-to-${range.to}.${format}`;
    if (format === "xlsx") {
      const buffer = await createOrderReportXlsx(report);
      return new Response(buffer, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const csv = createOrderReportCsv(report);
    return new Response(csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
