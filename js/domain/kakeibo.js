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
 * @param {{ savingsGoal?: number, budget?: number|null }} opts
 */
export function summarize(transactions, { savingsGoal = 0, budget = null } = {}) {
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
    budget,
    budgetLeft: budget == null ? null : budget - expense,
    hasIncome: transactions.some((t) => t.type === 'income'),
    count: transactions.length,
  };
}

/**
 * 予算を決める：その月の設定 → 毎月の既定（month が null）→ 未設定（null）
 * @param {Array} budgets 全予算
 * @param {string} month YYYY-MM
 * @param {string|null} categoryId null は月全体の予算
 */
export function resolveBudget(budgets, month, categoryId = null) {
  const target = categoryId ?? null;
  const same = (b) => (b.categoryId ?? null) === target;
  const forMonth = budgets.find((b) => b.month === month && same(b));
  if (forMonth) return Number(forMonth.amount) || 0;
  const def = budgets.find((b) => (b.month ?? null) === null && same(b));
  return def ? Number(def.amount) || 0 : null;
}

/**
 * カテゴリごとの金額（多い順）。ratio はその種類の合計に対する割合
 * @returns {Array<{categoryId:string|null, name:string, colorIndex:number, amount:number, ratio:number}>}
 */
export function byCategory(transactions, categories, type = 'expense') {
  const rows = transactions.filter((t) => t.type === type);
  const total = sumAmount(rows);
  const byId = new Map();
  for (const t of rows) byId.set(t.categoryId ?? null, (byId.get(t.categoryId ?? null) ?? 0) + (Number(t.amount) || 0));
  const catById = new Map(categories.map((c) => [c.id, c]));
  return [...byId.entries()]
    .map(([categoryId, amount], i) => {
      const c = catById.get(categoryId) ?? null;
      return {
        categoryId,
        name: c?.name ?? '未分類',
        colorIndex: c?.colorIndex ?? i % PALETTE_SIZE,
        amount,
        ratio: total ? amount / total : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ja'));
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
 * 貯金ペース：新しい方から months か月分の「収入 − 支出」の平均（円・整数）
 * @param {Array<{month:string, savings:number}>} monthly
 * @returns {number|null} 実績が1か月も無ければ null
 */
export function savingsPace(monthly, months = 3) {
  const rows = [...monthly].sort((a, b) => b.month.localeCompare(a.month)).slice(0, months);
  if (!rows.length) return null;
  return Math.round(rows.reduce((s, r) => s + (Number(r.savings) || 0), 0) / rows.length);
}

/**
 * 予定（買いたい物・やりたい事）が実現できそうか。
 * その月までに貯まる見込み（今ある分 ＋ ペース × 残り月数）と、その月までの予定の累計を比べる。
 * @returns {Map<string, {reachable:boolean, short:number, need:number, have:number}>}
 */
export function planOutlook(plans, now, pace, current = 0) {
  const out = new Map();
  if (pace == null) return out;
  const sorted = [...plans].filter((p) => p.month).sort((a, b) => a.month.localeCompare(b.month));
  let need = 0;
  for (const p of sorted) {
    need += Number(p.price) || 0;
    const months = Math.max(0, monthsBetween(now, p.month));
    const have = current + Math.max(0, pace) * months;
    out.set(p.id, { reachable: have >= need, short: Math.max(0, need - have), need, have });
  }
  return out;
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

/** 予算の入力の検証（空欄は「設定しない」＝ null） */
export function validateBudgetAmount(raw) {
  const text = String(raw ?? '').replace(/[,円\s]/g, ''); // i18n-ignore
  if (text === '') return { ok: true, value: null };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 0 || n > 100000000) return { ok: false, error: '0以上の整数（円）で入力してください' };
  return { ok: true, value: n };
}
