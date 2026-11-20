// 固定費（家賃・通信費・サブスク・給与などの毎月決まった出入り）。画面や DB には依存しない純粋な関数。
//
// 二重計上を防ぐ決まり（docs/KAKEIBO-PLAN.md 4章）
//   ・1つの固定費から、1つの月に作る取引は必ず1件
//   ・取引の ID は「固定費の ID ＋ 月」から決める。別の端末が同時に作っても同じ ID になり、増えない
//   ・引き落とし日が来ているかに関係なく、その月の分は月初にまとめて作る
import { addMonths } from './plans.js';

/** 一度に作る月の上限（長く開かなかった時に作りすぎないように） */
export const MAX_MONTHS = 24;

/** その月に有効な固定費か */
export function isActiveIn(fc, month) {
  if (fc.startMonth && month < fc.startMonth) return false;
  if (fc.endMonth && month > fc.endMonth) return false;
  return true;
}

/** その月の何日に置くか。その月に無い日（2月31日）は末日に丸める */
export function dateInMonth(month, dayOfMonth) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(Math.floor(Number(dayOfMonth)) || 1, 1), last);
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** 固定費から作る取引の ID（同じ固定費・同じ月なら必ず同じ） */
export function fixedRowId(fixedCostId, month) {
  return `fx-${month}-${fixedCostId}`;
}

/**
 * 前に作った月の次から今月までの、作るべき月の一覧
 * @param {string|null} lastMonth 最後に作った月（YYYY-MM）。まだ一度も作っていなければ null
 * @param {string} now 今月（YYYY-MM）
 */
export function monthsToGenerate(lastMonth, now, max = MAX_MONTHS) {
  if (!lastMonth) return [now];
  if (lastMonth >= now) return [];
  const months = [];
  let m = addMonths(lastMonth, 1);
  while (m <= now && months.length < max) {
    months.push(m);
    m = addMonths(m, 1);
  }
  // 上限を超えるほど間が空いていた時は、新しい方の月を優先する
  if (months.length === max && months[months.length - 1] !== now) {
    const all = [];
    let x = now;
    for (let i = 0; i < max; i++) {
      all.unshift(x);
      x = addMonths(x, -1);
    }
    return all.filter((mm) => mm > lastMonth);
  }
  return months;
}

/**
 * その月に作るべき取引を決める。すでにある分（fixedCostId が一致）は作らないので、何度呼んでも増えない。
 * @param {Array} fixedCosts 全固定費
 * @param {Array} existing その月にすでにある取引
 * @param {string} month YYYY-MM
 * @param {string} createdAt 作成日時（ISO）
 */
export function rowsToCreate(fixedCosts, existing, month, createdAt) {
  const done = new Set(existing.filter((t) => t.fixedCostId).map((t) => t.fixedCostId));
  return fixedCosts
    .filter((fc) => isActiveIn(fc, month) && !done.has(fc.id))
    .map((fc) => ({
      id: fixedRowId(fc.id, month),
      type: fc.type === 'income' ? 'income' : 'expense',
      amount: Number(fc.amount) || 0,
      date: dateInMonth(month, fc.dayOfMonth),
      categoryId: null, // 固定費はカテゴリを持たない（固定費の名前と色でまとめて見せる）
      memo: '',
      storeId: null,
      fixedCostId: fc.id,
      source: 'fixed',
      createdAt,
      updatedAt: createdAt,
    }));
}

/** 12か月分の金額を入れる欄の月（1月〜12月） */
export const SAMPLE_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/**
 * 入れた金額の平均（円の整数）。空欄は数に入れない。
 * 電気代のように月で変わる物を「年平均」で登録するために使う。
 * 入れた金額は固定費に残しておき（samples）、あとから見直して計算し直せる。
 * @param {Array<string|number>|Record<string, any>} amounts 配列でも { '1': 8000, … } でもよい
 * @returns {{ average:number, count:number }}
 */
export function averageAmount(amounts) {
  if (amounts && !Array.isArray(amounts)) amounts = SAMPLE_MONTHS.map((m) => amounts[m] ?? amounts[String(m)]);
  const nums = amounts
    .map((v) => Number(String(v ?? '').replace(/[,円\s]/g, ''))) // i18n-ignore
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return { average: 0, count: 0 };
  return { average: Math.round(nums.reduce((a, b) => a + b, 0) / nums.length), count: nums.length };
}

/**
 * 固定費の入力の検証と整形
 * @returns {{ ok:true, value:object } | { ok:false, errors:Record<string,string> }}
 */
export function validateFixedCostInput(raw, thisMonthValue) {
  const errors = {};
  const type = raw.type === 'income' ? 'income' : 'expense';

  const name = String(raw.name ?? '').trim();
  if (!name) errors.name = '名前を入力してください';
  else if (name.length > 30) errors.name = '30文字以内にしてください';

  const amountText = String(raw.amount ?? '').replace(/[,円\s]/g, ''); // i18n-ignore
  const amount = amountText === '' ? NaN : Number(amountText);
  if (amountText === '') errors.amount = '金額を入力してください';
  else if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) errors.amount = '1円以上の整数で入力してください';

  const day = Math.floor(Number(raw.dayOfMonth));
  const dayOfMonth = Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
  if (String(raw.dayOfMonth ?? '').trim() !== '' && dayOfMonth === null) errors.dayOfMonth = '1〜31の日を選んでください';

  const startMonth = String(raw.startMonth ?? '').trim() || thisMonthValue;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) errors.startMonth = '月を選んでください';

  const endMonth = raw.ended ? String(raw.endMonth ?? '').trim() || thisMonthValue : null;
  if (endMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth)) errors.endMonth = '月を選んでください';
  if (endMonth && !errors.startMonth && endMonth < startMonth) errors.endMonth = '始まりの月より後にしてください';

  const memo = String(raw.memo ?? '').trim();
  if (memo.length > 200) errors.memo = '200文字以内にしてください';

  if (Object.keys(errors).length) return { ok: false, errors };
  const colorIndex = Number.isFinite(Number(raw.colorIndex)) ? Number(raw.colorIndex) : 0;
  const samples = raw.samples && typeof raw.samples === 'object' ? raw.samples : {};
  return { ok: true, value: { type, name, amount, categoryId: null, colorIndex, samples, dayOfMonth, startMonth, endMonth, memo } };
}
