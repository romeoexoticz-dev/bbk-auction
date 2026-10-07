type AuctionCategory = "เหรียญกษาปณ์" | "ธนบัตร" | "พระเครื่อง" | "การ์ดสะสม" | "ของเล่น" | "ของเก่า";

type ExpansionSeed = {
  sourceId: string;
  title: string;
  category: AuctionCategory;
  referenceImageUrl: string;
  sourceLabel: string;
  sourceUrl?: string;
  license?: string;
};

const durationDays = [3, 5, 7, 15, 3, 5, 7, 15, 7, 15] as const;

function localSeed(sourceId: string, title: string, category: AuctionCategory): ExpansionSeed {
  return {
    sourceId,
    title,
    category,
    referenceImageUrl: `/reference-catalog/exp_${sourceId}.webp`,
    sourceLabel: "คลังภาพที่พี่บอลอนุญาต",
  };
}

function commonsSeed(
  sourceId: string,
  title: string,
  category: AuctionCategory,
  referenceImageUrl: string,
  fileName: string,
  license: string,
): ExpansionSeed {
  return {
    sourceId,
    title,
    category,
    referenceImageUrl,
    sourceLabel: `Wikimedia Commons · ${fileName} · ${license}`,
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName.replace(/ /g, "_"))}`,
    license,
  };
}

const seeds: ExpansionSeed[] = [
  localSeed("exp_coin_air_force_academy_2546", "เหรียญที่ระลึก ร.9 50 ปี โรงเรียนนายเรืออากาศ 50 บาท พ.ศ. 2546", "เหรียญกษาปณ์"),
  localSeed("exp_coin_national_intelligence_2546", "เหรียญที่ระลึก ร.9 50 ปี สำนักข่าวกรองแห่งชาติ 50 บาท พ.ศ. 2546", "เหรียญกษาปณ์"),
  localSeed("exp_coin_royal_institute_2547", "เหรียญที่ระลึก ร.9 70 ปี ราชบัณฑิตยสถาน 10 บาท พ.ศ. 2547", "เหรียญกษาปณ์"),
  localSeed("exp_coin_drug_free_nation_2547", "เหรียญที่ระลึก ร.9 พลังแผ่นดินขจัดสิ่งเสพติด 10 บาท พ.ศ. 2547", "เหรียญกษาปณ์"),
  localSeed("exp_coin_iucn_2547", "เหรียญที่ระลึก ร.9 การประชุมสมัชชาการอนุรักษ์สิ่งแวดล้อมโลก ครั้งที่ 3 ราคา 10 บาท พ.ศ. 2547", "เหรียญกษาปณ์"),
  localSeed("exp_coin_cites_2547", "เหรียญที่ระลึก ร.9 การประชุมไซเตส CITES ครั้งที่ 13 ราคา 10 บาท พ.ศ. 2547", "เหรียญกษาปณ์"),
  localSeed("exp_coin_army_transport_2548", "เหรียญที่ระลึก ร.9 100 ปี กรมการขนส่งทหารบก 10 บาท พ.ศ. 2548", "เหรียญกษาปณ์"),
  localSeed("exp_coin_national_library_2548", "เหรียญที่ระลึก ร.9 100 ปี หอสมุดแห่งชาติ 20 บาท พ.ศ. 2548", "เหรียญกษาปณ์"),
  localSeed("exp_coin_cabinet_secretariat_2549", "เหรียญที่ระลึก ร.9 72 ปี สำนักเลขาธิการคณะรัฐมนตรี 10 บาท พ.ศ. 2549", "เหรียญกษาปณ์"),
  localSeed("exp_coin_asia_pacific_scout_2548", "เหรียญที่ระลึก ร.9 งานชุมนุมลูกเสือเอเชีย-แปซิฟิก ครั้งที่ 25 ราคา 10 บาท พ.ศ. 2548", "เหรียญกษาปณ์"),

  localSeed("exp_note_rama8_50_wartime", "ธนบัตร 50 บาท รัชกาลที่ 8 รุ่นชั่วคราวสมัยสงครามโลก", "ธนบัตร"),
  localSeed("exp_note_5_red_young", "ธนบัตร 5 บาท ตัวเลขสีแดง พระพักตร์หนุ่ม", "ธนบัตร"),
  localSeed("exp_note_100_red_young", "ธนบัตร 100 บาท ตัวเลขสีแดง พระพักตร์หนุ่ม", "ธนบัตร"),
  localSeed("exp_note_rama8_10_wartime", "ธนบัตร 10 บาท รัชกาลที่ 8 รุ่นชั่วคราวสมัยสงครามโลก", "ธนบัตร"),
  localSeed("exp_note_100_ploughing_2475", "ธนบัตร 100 บาท รุ่นไถนา ลายเซ็นพระโกมารฯ พ.ศ. 2475", "ธนบัตร"),
  localSeed("exp_note_10_red_young", "ธนบัตร 10 บาท ตัวเลขสีแดง พระพักตร์หนุ่ม", "ธนบัตร"),
  localSeed("exp_note_rama8_10_2489", "ธนบัตร 10 บาท รัชกาลที่ 8 พ.ศ. 2489", "ธนบัตร"),
  localSeed("exp_note_50satang_japan_2485", "ธนบัตร 50 สตางค์ รัชกาลที่ 8 พิมพ์ญี่ปุ่น พ.ศ. 2485", "ธนบัตร"),
  localSeed("exp_note_rama8_1_2489", "ธนบัตร 1 บาท รัชกาลที่ 8 พ.ศ. 2489", "ธนบัตร"),
  localSeed("exp_note_one_sided_1_2466", "ธนบัตรหน้าเดียว 1 บาท ลายเซ็นพระยาเทพฯ–ศุภโยคฯ พ.ศ. 2466", "ธนบัตร"),

  commonsSeed("exp_amulet_somdet_framed", "พระสมเด็จทรงสี่เหลี่ยมในกรอบ (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/3/38/Thai_amulet_photographed_2026-08-26_-_Somdet_tablet%2C_framed_%28cutout%29.png", "Thai amulet photographed 2026-08-26 - Somdet tablet, framed (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_monday_buddha", "พระพิมพ์พระประจำวันจันทร์ในกรอบลงยา (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/9/91/Thai_amulet_photographed_2026-09-01_-_Monday_Buddha_tablet_in_an_enamel_frame_%28cutout%29.png", "Thai amulet photographed 2026-09-01 - Monday Buddha tablet in an enamel frame (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_pentagonal_clear", "พระพิมพ์ห้าเหลี่ยมในกรอบใส (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/b/b1/Thai_amulet_photographed_2026-09-01_-_Pentagonal_tablet_in_a_clear_case_%28cutout%29.png", "Thai amulet photographed 2026-09-01 - Pentagonal tablet in a clear case (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_naga_teardrop", "เครื่องรางพญานาคในกรอบทรงหยดน้ำ (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/0/0d/Thai_amulet_photographed_2026-09-02_-_Coiled_naga_in_a_teardrop_case_%28cutout%29.png", "Thai amulet photographed 2026-09-02 - Coiled naga in a teardrop case (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_cowrie", "เครื่องรางเบี้ยแก้ (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/2/2c/Thai_amulet_photographed_2026-09-02_-_Cowrie_charm_%28cutout%29.png", "Thai amulet photographed 2026-09-02 - Cowrie charm (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_garuda", "เครื่องรางครุฑในกรอบกลม (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/a/af/Thai_amulet_photographed_2026-09-02_-_Garuda_in_a_round_case_%28cutout%29.png", "Thai amulet photographed 2026-09-02 - Garuda in a round case (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_hun_payont", "หุ่นพยนต์ในกรอบโค้ง (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/f/fc/Thai_amulet_photographed_2026-09-02_-_Hun_payont_in_an_arched_case_%28cutout%29.png", "Thai amulet photographed 2026-09-02 - Hun payont in an arched case (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_khun_phaen", "พระพิมพ์ขุนแผนในกรอบโลหะ (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/7/7e/Thai_amulet_photographed_2026-09-02_-_Khun_Phaen-style_Buddha_tablet_in_a_steel_case_%28cutout%29.png", "Thai amulet photographed 2026-09-02 - Khun Phaen-style Buddha tablet in a steel case (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_nang_kwak", "พระนางกวักแบบพิมพ์ (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/6/6f/Thai_amulet_photographed_2026-09-02_-_Nang_Kwak_tablet_%28cutout%29.png", "Thai amulet photographed 2026-09-02 - Nang Kwak tablet (cutout).png", "CC BY 4.0"),
  commonsSeed("exp_amulet_thao_wessuwan", "ท้าวเวสสุวรรณในกรอบโค้ง (ภาพอ้างอิง)", "พระเครื่อง", "https://upload.wikimedia.org/wikipedia/commons/c/cd/Thai_amulet_photographed_2026-09-02_-_Thao_Wessuwan_in_an_arched_case_%28cutout%29.png", "Thai amulet photographed 2026-09-02 - Thao Wessuwan in an arched case (cutout).png", "CC BY 4.0"),

  commonsSeed("exp_card_atc_art", "การ์ดศิลปินสะสม ATC (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/c/ca/ATC_mvs_06255.jpg", "ATC mvs 06255.jpg", "CC BY-SA 4.0"),
  commonsSeed("exp_card_bjorn_berglund", "การ์ดภาพบุคคล Björn Berglund (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/c/ce/Berglund%2C_Bj%C3%B6rn.jpg", "Berglund, Björn.jpg", "Public domain"),
  commonsSeed("exp_card_bognard", "การ์ดสะสมลายธนบัตร Bognard (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/3/37/Bognard-card-Russian-banknote.jpg", "Bognard-card-Russian-banknote.jpg", "Public domain"),
  commonsSeed("exp_card_brain_rot", "การ์ดสะสม Brain Rot Helsinki (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/9/97/Brain_rot_helsinki.jpg", "Brain rot helsinki.jpg", "Public domain"),
  commonsSeed("exp_card_captain_crackers", "การ์ดโจรสลัด Captain Crackers ปี 1948 (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/3/3b/Captain_Crackers_from_the_1948_Leaf_Pirate_Trading_Cards_set.png", "Captain Crackers from the 1948 Leaf Pirate Trading Cards set.png", "Public domain"),
  commonsSeed("exp_card_darwin", "การ์ดภาพ Charles Darwin แบบ carte de visite (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/e/e1/Charles_Darwin_carte_de_visite.jpg", "Charles Darwin carte de visite.jpg", "Public domain"),
  commonsSeed("exp_card_edo_actor_hair", "ภาพพิมพ์สะสมทรงผมนักแสดงญี่ปุ่น ค.ศ. 1858 (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/a/af/Color_woodblock_print_for_children_who_collected_actors%27_hairsyles%2C_1858_AD_-_Edo-Tokyo_Museum_-_Sumida%2C_Tokyo%2C_Japan_-_DSC06710.jpg", "Color woodblock print for children who collected actors' hairsyles, 1858 AD.jpg", "Public domain"),
  commonsSeed("exp_card_esther", "การ์ดภาพสะสม Esther (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/c/c3/EstherHaham14.jpg", "EstherHaham14.jpg", "CC BY 4.0"),
  commonsSeed("exp_card_filmisar", "ชุดการ์ดภาพยนตร์ Svensk Filmindustri (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/3/3e/Filmisar_Svensk_Filmindustri.jpg", "Filmisar Svensk Filmindustri.jpg", "Public domain"),
  commonsSeed("exp_card_harald_madsen", "การ์ดภาพ Harald Madsen (ภาพอ้างอิง)", "การ์ดสะสม", "https://upload.wikimedia.org/wikipedia/commons/e/e5/Harald_Madsen_%22Bivognen%22_%22Sl%C3%A4pvagnen%22.jpg", "Harald Madsen Bivognen Släpvagnen.jpg", "Public domain"),

  ...Array.from({ length: 10 }, (_, index) => commonsSeed(
    `exp_toy_vintage_ornament_${String(index + 1).padStart(2, "0")}`,
    `ของเล่นและของตกแต่งวินเทจ ชุดภาพ ${String(index + 1).padStart(2, "0")} (ภาพอ้างอิง)`,
    "ของเล่น",
    ["e/e3/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_01.jpg", "9/9a/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_02.jpg", "d/d1/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_03.jpg", "8/89/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_04.jpg", "b/bd/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_05.jpg", "3/3e/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_06.jpg", "7/70/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_07.jpg", "c/c0/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_08.jpg", "9/91/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_09.jpg", "4/49/2023.12.09_Vintage_Christmas_Ornaments_Market_Minsk_Belarus_10.jpg"].map((path) => `https://upload.wikimedia.org/wikipedia/commons/${path}`)[index],
    `2023.12.09 Vintage Christmas Ornaments Market Minsk Belarus ${String(index + 1).padStart(2, "0")}.jpg`,
    "CC BY-SA 4.0",
  )),

  commonsSeed("exp_antique_wall_maps_1858", "แผนที่แขวนผนังคู่ ค.ศ. 1858 (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/1/15/1858_Set_of_Two_Pelton_Wall_Maps%2C_Western_Hemisphere_and_Eastern_Hemisphere_-_Geographicus_-_World-pelton-1858.jpg", "1858 Set of Two Pelton Wall Maps.jpg", "Public domain"),
  commonsSeed("exp_antique_wine_glass", "แก้วไวน์ทรง Baluster ฝรั่งเศส ศตวรรษที่ 18 (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/f/f4/18th_Century_French_Baluster_wine_glass.jpg", "18th Century French Baluster wine glass.jpg", "CC BY-SA 4.0"),
  commonsSeed("exp_antique_player_piano", "เครื่องเล่นเปียโน M&H ปี 1926 (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/b/b2/1926_M%26H_Daytime_Side_View.jpg", "1926 M&H Daytime Side View.jpg", "CC BY-SA 4.0"),
  commonsSeed("exp_antique_fire_engine", "รถดับเพลิง Studebaker ปี 1929 (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/2/26/1929_Studebaker_fire_engine.jpg", "1929 Studebaker fire engine.jpg", "CC BY-SA 4.0"),
  commonsSeed("exp_antique_lamps_glasses", "ชุดโคมไฟและเครื่องแก้วเก่า (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/5/54/2_Big_and_small_%27lights_n_glasses%27.jpg", "2 Big and small lights n glasses.jpg", "CC BY-SA 4.0"),
  commonsSeed("exp_antique_limoges_roses", "เครื่องลายคราม Limoges ลายกุหลาบ ค.ศ. 1892–1919 (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/a/a6/2018.12.06_LIMOGES_porcelain_Tresseman_%26_Vogt_with_Roses_1892_%E2%80%93_1919.jpg", "LIMOGES porcelain Tresseman & Vogt with Roses 1892–1919.jpg", "CC BY-SA 4.0"),
  commonsSeed("exp_antique_limoges", "เครื่องลายคราม Limoges Tresseman & Vogt ค.ศ. 1892–1919 (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/0/03/2018.12.18_LIMOGES_Tresseman_%26_Vogt_1892_%E2%80%93_1919.jpg", "LIMOGES Tresseman & Vogt 1892–1919.jpg", "CC BY-SA 4.0"),
  commonsSeed("exp_antique_camera_typewriter_phone", "ชุดกล้อง เครื่องพิมพ์ดีด และโทรศัพท์หมุนวินเทจ (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/2/2a/A_classic_camera_rests_on_a_polished_wooden_table%2C_surrounded_by_an_antique_typewriter_and_a_vintage_rotary_phone.jpg", "Classic camera, antique typewriter and vintage rotary phone.jpg", "CC BY 2.0"),
  commonsSeed("exp_antique_breweriana", "ชุดของสะสม Breweriana หลายประเภท (ภาพอ้างอิง)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/c/c8/A_collection_of_many_types_of_breweriana.jpg", "A collection of many types of breweriana.jpg", "CC BY-SA 3.0"),
  commonsSeed("exp_antique_reference_object", "ของเก่าสะสมจากภาพอ้างอิง Wikimedia (ชุดที่ 10)", "ของเก่า", "https://upload.wikimedia.org/wikipedia/commons/5/50/1._DSCN6707_%282%29.jpg", "1. DSCN6707 (2).jpg", "CC BY-SA 4.0"),
];

const categoryOffsets = new Map<AuctionCategory, number>();

const referenceAuctionExpansion = seeds.map((seed) => {
  const categoryIndex = categoryOffsets.get(seed.category) ?? 0;
  categoryOffsets.set(seed.category, categoryIndex + 1);
  const attribution = seed.sourceUrl ? `${seed.sourceLabel}\nที่มา: ${seed.sourceUrl}` : seed.sourceLabel;
  return {
    ...seed,
    durationDays: durationDays[categoryIndex % durationDays.length],
    description: `ภาพอ้างอิงเพื่อทดสอบระบบเท่านั้น ไม่ใช่ภาพยืนยันสินค้าที่จะส่งมอบ ต้องตรวจภาพสินค้าจริงด้านหน้า ด้านหลัง ตำหนิ รุ่น และความแท้ก่อนเปิดขายจริง\n\n${seed.title}\n\nแหล่งภาพ: ${attribution}\n\n[REFERENCE-CATALOG:${seed.sourceId}]`,
    itemYear: "รอตรวจปีหรือยุคจากสินค้าจริง",
    itemModel: seed.title.replace(/ \(ภาพอ้างอิง\)$/, ""),
    itemSize: "รอตรวจขนาดและน้ำหนักจากสินค้าจริง",
    conditionSummary: "ภาพอ้างอิงเท่านั้น รอตรวจสภาพและตำหนิจากสินค้าจริง",
    expertNotes: `ยังไม่ได้ตรวจสินค้าจริง ห้ามฟันธงความแท้ สภาพ หรือราคา · ${seed.sourceLabel}`,
    openingPrice: 100,
  };
});

export default referenceAuctionExpansion;
