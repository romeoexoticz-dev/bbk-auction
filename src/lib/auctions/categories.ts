export const AUCTION_CATEGORIES = [
  { value: "เหรียญกษาปณ์", icon: "๑", hint: "เหรียญไทย เหรียญต่างประเทศ และเหรียญที่ระลึก" },
  { value: "ธนบัตร", icon: "฿", hint: "ธนบัตรเก่า เลขสวย และธนบัตรต่างประเทศ" },
  { value: "พระเครื่อง", icon: "◈", hint: "พระเครื่องและวัตถุมงคลที่มีข้อมูลประกอบ" },
  { value: "การ์ดสะสม", icon: "◆", hint: "การ์ดเกม การ์ดกีฬา และการ์ดเกรด" },
  { value: "ของเก่า", icon: "✦", hint: "ของสะสมและของเก่าประเภทอื่น" },
] as const;

export type AuctionCategory = (typeof AUCTION_CATEGORIES)[number]["value"];

export const AUCTION_CATEGORY_VALUES = new Set<string>(
  AUCTION_CATEGORIES.map((category) => category.value),
);
