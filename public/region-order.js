const REGION_ROWS = [
  ['hokkaido', '北海道', ['北海道']],
  ['tohoku', '東北', ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県']],
  ['kanto', '関東', ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県']],
  ['chubu', '中部', ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県']],
  ['kinki', '近畿', ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県']],
  ['chugoku', '中国', ['鳥取県', '島根県', '岡山県', '広島県', '山口県']],
  ['shikoku', '四国', ['徳島県', '香川県', '愛媛県', '高知県']],
  ['kyushu-okinawa', '九州・沖縄', ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']]
];

let prefectureOrder = 0;
export const PREFECTURES = Object.freeze(REGION_ROWS.flatMap(([regionId, regionName, names]) => names.map((prefectureName) => {
  prefectureOrder += 1;
  return Object.freeze({
    prefectureCode: String(prefectureOrder).padStart(2, '0'),
    prefectureName,
    regionId,
    regionName,
    displayOrder: prefectureOrder
  });
})));

export const REGIONS = Object.freeze(REGION_ROWS.map(([regionId, regionName], index) => Object.freeze({
  regionId,
  regionName,
  displayOrder: index + 1,
  prefectureCodes: Object.freeze(PREFECTURES.filter((item) => item.regionId === regionId).map((item) => item.prefectureCode))
})));

export const NATIONAL_OPTION = Object.freeze({ regionId: '', regionName: '全国', displayOrder: 0 });

const PREFECTURE_BY_CODE = new Map(PREFECTURES.map((item) => [item.prefectureCode, item]));
const PREFECTURE_BY_NAME = new Map(PREFECTURES.map((item) => [item.prefectureName, item]));
const REGION_BY_ID = new Map(REGIONS.map((item) => [item.regionId, item]));

export function prefectureFrom(value, code = '') {
  const codeText = String(code || '').trim();
  const codeMatch = codeText.match(/^(\d{2})(?:\d{3})?$/);
  if (codeMatch && PREFECTURE_BY_CODE.has(codeMatch[1])) return PREFECTURE_BY_CODE.get(codeMatch[1]);
  const text = String(value || '').trim();
  if (PREFECTURE_BY_NAME.has(text)) return PREFECTURE_BY_NAME.get(text);
  return PREFECTURES.find((item) => text.includes(item.prefectureName)) || null;
}

export function prefecturesForRegion(regionId = '') {
  if (!regionId) return [...PREFECTURES];
  if (!REGION_BY_ID.has(regionId)) return [];
  return PREFECTURES.filter((item) => item.regionId === regionId);
}

export function orderedPrefectureOptions(counts = new Map(), options = {}) {
  const { regionId = '', onlyWithReports = false, allowedCodes = null } = options;
  const allowed = allowedCodes ? new Set(allowedCodes) : null;
  return prefecturesForRegion(regionId)
    .filter((item) => !allowed || allowed.has(item.prefectureCode))
    .map((item) => ({ ...item, count: Number(counts.get(item.prefectureCode) || 0) }))
    .filter((item) => !onlyWithReports || item.count > 0);
}

export function sortPlateauRegions(regions = []) {
  return [...regions].sort((a, b) => {
    const aPrefecture = prefectureFrom(a.prefecture_name, a.prefecture_code || a.municipality_code);
    const bPrefecture = prefectureFrom(b.prefecture_name, b.prefecture_code || b.municipality_code);
    const prefectureDifference = (aPrefecture?.displayOrder ?? 99) - (bPrefecture?.displayOrder ?? 99);
    if (prefectureDifference) return prefectureDifference;
    return String(a.municipality_code || '').localeCompare(String(b.municipality_code || ''), 'en');
  });
}

export function regionForPrefecture(prefectureCode) {
  const prefecture = PREFECTURE_BY_CODE.get(String(prefectureCode || '').padStart(2, '0'));
  return prefecture ? REGION_BY_ID.get(prefecture.regionId) : null;
}

export function validateRegionConfiguration() {
  const expectedCodes = Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(2, '0'));
  const actualCodes = PREFECTURES.map((item) => item.prefectureCode);
  const uniqueNames = new Set(PREFECTURES.map((item) => item.prefectureName));
  const regionCodes = REGIONS.flatMap((item) => item.prefectureCodes);
  const valid = PREFECTURES.length === 47
    && uniqueNames.size === 47
    && actualCodes.every((code, index) => code === expectedCodes[index])
    && regionCodes.every((code, index) => code === expectedCodes[index])
    && PREFECTURES[0]?.prefectureName === '北海道'
    && PREFECTURES.at(-1)?.prefectureName === '沖縄県';
  return Object.freeze({ valid, prefectureCount: PREFECTURES.length, regionCount: REGIONS.length, errorCode: valid ? null : 'region_order_mismatch' });
}
