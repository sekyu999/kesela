// 家計簿：月ごとの集計・予算・自由に使えるお金。画面や DB には依存しない純粋な関数。
//
// 考え方（docs/KAKEIBO-PLAN.md 4章）
//   今月の収入   = その月の income の合計（固定収入＝給与を含む）
//   今月の支出   = その月の expense の合計（固定費を含む）
//   今月の貯金額 = 収入 − 支出
//   自由に使えるお金 = 収入 − 支出 − 貯金目標
// 固定費も固定収入も月初に1件ずつ記録済みなので、どの式も支出を1回しか引かない。


/** 円グラフ・店舗の色に使うパレットの数（css の --swatch-1 … に対応） */
export const PALETTE_SIZE = 10;

/** 初期の家計簿カテゴリ（支出） */
export const DEFAULT_EXPENSE_CATEGORIES = [
  '食費',
  '日用品',
  '住居',
  '水道・光熱',
  '通信',
  '交通',
  '医療・衛生',
  '交際・娯楽',
  '衣服・美容',
  '教養・趣味',
  'サブスク',
  'その他',
];

/** 初期の家計簿カテゴリ（収入） */
export const DEFAULT_INCOME_CATEGORIES = ['給与', '賞与', '副収入', 'その他'];

/** YYYY-MM の最初の日と最後の日 */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** その日付が属する月（YYYY-MM） */
export function monthOf(date) {
  return String(date).slice(0, 7);
}

/** 金額の合計 */
export function sumAmount(list) {
  return list.reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

/**
 * 月の集計
 * @param {Array} transactions その月の取引
 * @param {{ savingsGoal?: number }} opts
 */
export function summarize(transactions, { savingsGoal = 0 } = {}) {
  const income = sumAmount(transactions.filter((t) => t.type === 'income'));
  const expense = sumAmount(transactions.filter((t) => t.type === 'expense'));
  const fixed = sumAmount(transactions.filter((t) => t.type === 'expense' && t.source === 'fixed'));
  const savings = income - expense;
  const goal = Math.max(0, Math.round(Number(savingsGoal) || 0));
  return {
    income,
    expense,
    fixed,
    variable: expense - fixed,
    savings,
    savingsGoal: goal,
    // 貯金目標がない時は「使えるお金」を出さない（貯金額とまったく同じ数字になるため）
    free: goal > 0 ? income - expense - goal : null,
    toGoal: goal > 0 ? goal - savings : null,
    hasIncome: transactions.some((t) => t.type === 'income'),
    count: transactions.length,
  };
}

/**
 * 円グラフ・一覧用のまとまり（多い順）。ratio はその種類の合計に対する割合。
 * 固定費から入った記録は、カテゴリではなく**固定費そのもの**（名前と色）でまとめる。
 * @returns {Array<{key:string, categoryId:string|null, fixedCostId:string|null,
 *                  name:string, colorIndex:number, amount:number, ratio:number}>}
 */
export function byCategory(transactions, categories, fixedCosts = [], type = 'expense') {
  const rows = transactions.filter((t) => t.type === type);
  const total = sumAmount(rows);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const fxById = new Map(fixedCosts.map((f) => [f.id, f]));
  const groups = new Map();

  for (const t of rows) {
    const fx = t.fixedCostId ? fxById.get(t.fixedCostId) : null;
    const c = fx ? null : catById.get(t.categoryId);
    const key = fx ? `fx:${fx.id}` : `c:${t.categoryId ?? ''}`;
    const g = groups.get(key) ?? {
      key,
      categoryId: fx ? null : (t.categoryId ?? null),
      fixedCostId: fx?.id ?? null,
      name: fx ? fx.name : (c?.name ?? '未分類'),
      colorIndex: (fx ? fx.colorIndex : c?.colorIndex) ?? 0,
      order: fx ? 10000 : (c?.defaultOrder ?? 9999),
      amount: 0,
    };
    g.amount += Number(t.amount) || 0;
    groups.set(key, g);
  }

  return [...groups.values()]
    .map((g) => ({ ...g, ratio: total ? g.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount || a.order - b.order || a.name.localeCompare(b.name, 'ja'));
}

/**
 * ドーナツグラフの区切り。SVG の円に stroke-dasharray / stroke-dashoffset で描くための値。
 * 一周を circumference（既定 100）として、各区切りの長さと開始位置を返す。
 */
export function donutSlices(rows, circumference = 100) {
  let offset = 0;
  return rows.map((r) => {
    const length = r.ratio * circumference;
    const slice = { ...r, length, offset };
    offset += length;
    return slice;
  });
}

/** YYYY-MM の差（月数） */
export function monthsBetween(from, to) {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

/**
 * 取引（収入・支出）の入力の検証と整形
 * @returns {{ ok:true, value:object } | { ok:false, errors:Record<string,string> }}
 */
export function validateTransactionInput(raw) {
  const errors = {};
  const type = raw.type === 'income' ? 'income' : 'expense';

  const amountText = String(raw.amount ?? '').replace(/[,円\s]/g, ''); // i18n-ignore
  const amount = amountText === '' ? NaN : Number(amountText);
  if (amountText === '') errors.amount = '金額を入力してください';
  else if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) errors.amount = '1円以上の整数で入力してください';

  if (!raw.categoryId) errors.categoryId = 'カテゴリを選んでください';

  const date = String(raw.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) errors.date = '日付を入力してください';

  const memo = String(raw.memo ?? '').trim();
  if (memo.length > 200) errors.memo = '200文字以内にしてください';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type,
      amount,
      date,
      categoryId: raw.categoryId,
      memo,
      storeId: raw.storeId || null,
      fixedCostId: raw.fixedCostId || null,
      source: raw.source === 'fixed' ? 'fixed' : 'manual',
    },
  };
}

/** 金額の入力の検証（空欄は「設定しない」＝ null）。貯金目標で使う */
export function validateYenOrEmpty(raw) {
  const text = String(raw ?? '').replace(/[,円\s]/g, ''); // i18n-ignore
  if (text === '') return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > 100000000) return { ok: false, error: '0以上の整数（円）で入力してください' };
  return { ok: true, value: n };
}
