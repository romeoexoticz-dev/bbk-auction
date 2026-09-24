"use client";

export function PrintOrderButton() {
  return (
    <button className="button button-outline order-print-button" type="button" onClick={() => window.print()}>
      พิมพ์ / บันทึก PDF
    </button>
  );
}
