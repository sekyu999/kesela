// 予算（月全体・カテゴリ別）の読み書き
// month が null なら「毎月の既定」、categoryId が null なら「月全体」
import { db } from './db.js';
import { newId } from '../lib/util.js';

export function listBudgets() {
  return db.budgets.toArray();
}

/**
 * 予算を決める（空欄＝amount が null なら設定を消す）
 * @param {string|null} month YYYY-MM。null は毎月の既定
 * @param {string|null} categoryId null は月全体
 * @param {number|null} amount
 */
export async function setBudget(month, categoryId, amount) {
  const m = month ?? null;
  const c = categoryId ?? null;
  await db.transaction('rw', db.budgets, async () => {
    const all = await db.budgets.toArray();
    const hit = all.find((b) => (b.month ?? null) === m && (b.categoryId ?? null) === c);
    if (amount === null || amount === undefined) {
      if (hit) await db.budgets.delete(hit.id);
      return;
    }
    if (hit) await db.budgets.update(hit.id, { amount });
    else await db.budgets.add({ id: newId(), month: m, categoryId: c, amount });
  });
}
