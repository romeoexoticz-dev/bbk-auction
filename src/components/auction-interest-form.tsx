"use client";

import { useActionState } from "react";
import { saveAuctionInterests, type InterestState } from "@/app/(customer)/account/actions";
import { AUCTION_CATEGORIES } from "@/lib/auctions/categories";

const initialState: InterestState = {};

export function AuctionInterestForm({ selected }: { selected: string[] }) {
  const [state, action, pending] = useActionState(saveAuctionInterests, initialState);

  return (
    <section className="panel account-panel interest-panel" id="interests">
      <div className="panel-heading">
        <div><h2>อยากประมูลอะไร</h2><p>ติ๊กหมวดที่สนใจ ระบบจะแจ้งเมื่อร้านเปิดรายการใหม่ที่ตรงกัน</p></div>
        <span className="table-filter">เลือกได้หลายหมวด</span>
      </div>
      <form action={action} className="interest-form">
        <fieldset>
          <legend className="sr-only">เลือกหมวดประมูลที่สนใจ</legend>
          <div className="interest-grid">
            {AUCTION_CATEGORIES.map((category) => (
              <label className="interest-option" key={category.value}>
                <input defaultChecked={selected.includes(category.value)} name="categories" type="checkbox" value={category.value} />
                <span className="interest-check" aria-hidden="true">✓</span>
                <span className="interest-icon" aria-hidden="true">{category.icon}</span>
                <span><strong>{category.value}</strong><small>{category.hint}</small></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="interest-actions">
          <p>ถ้าไม่ติ๊กเลย ระบบจะไม่แจ้งรายการใหม่ตามความสนใจ</p>
          <button className="button button-gold" disabled={pending} type="submit">{pending ? "กำลังบันทึก…" : "บันทึกสิ่งที่สนใจ"}</button>
        </div>
        {state.error && <p className="form-error" role="alert">{state.error}</p>}
        {state.success && <p className="interest-success" role="status">{state.success}</p>}
      </form>
    </section>
  );
}
