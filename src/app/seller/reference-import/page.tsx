import Link from "next/link";
import { ReferenceCatalogImporter } from "@/components/reference-catalog-importer";

export default function ReferenceImportPage() {
  return (
    <>
      <section className="dashboard-intro">
        <div><span className="dash-kicker">เครื่องมือภายในทีม</span><h1>เตรียมคลังสินค้าจากภาพอ้างอิง</h1><p>สร้างฉบับร่างเพื่อรอทีมตรวจและถ่ายภาพสินค้าจริงก่อนเผยแพร่</p></div>
        <Link className="button button-outline" href="/seller">กลับหน้าสินค้า</Link>
      </section>
      <ReferenceCatalogImporter />
    </>
  );
}
