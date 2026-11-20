// 固定費の読み書きと、毎月の自動計上
import { db } from './db.js';
import { newId, nowIso } from '../lib/util.js';
import { validateFixedCostInput, rowsToCreate, monthsToGenerate, fixedRowId } from '../domain/fixedCost.js';
import { monthRange } from '../domain/kakeibo.js';
import { thisMonth } from '../domain/plans.js';
import { getMeta, setMeta, META } from './metaRepo.js';
import { ValidationError } from './productRepo.js';

export async function listFixedCosts() {
  const all = await db.fixedCosts.toArray();
  return all.sort((a, b) => (b.amount || 0) - (a.amount || 0) || a.name.localeCompare(b.name, 'ja'));
}

export function getFixedCost(id) {
  return db.fixedCosts.get(id);
}

/** 保存（id がなければ新規）。入力が不正なら ValidationError */
export async function saveFixedCost(id, raw) {
  const r = validateFixedCostInput(raw, thisMonth());
  if (!r.ok) throw new ValidationError(r.errors);
  const now = nowIso();
  const old = id ? await db.fixedCosts.get(id) : null;
  const row = { id: id ?? newId(), ...r.value, createdAt: old?.createdAt ?? now, updatedAt: now };
  await db.fixedCosts.put(row);
  return row;
}

/** その固定費から作られた記録の件数 */
export async function countGeneratedRows(fixedCostId) {
  return db.transactions.where('fixedCostId').equals(fixedCostId).count();
}

/**
 * 固定費を削除する。
 * @param {boolean} alsoRows すでに記録された分も消すか（残す＝実際に払った事実として残る）
 */
export async function deleteFixedCost(id, alsoRows) {
  await db.transaction('rw', db.fixedCosts, db.transactions, async () => {
    if (alsoRows) await db.transactions.where('fixedCostId').equals(id).delete();
    else await db.transactions.where('fixedCostId').equals(id).modify({ fixedCostId: null, source: 'manual' });
    await db.fixedCosts.delete(id);
  });
}

/** 今月分の記録を、今の固定費の金額に合わせ直す（「今月分にも反映する」ボタン） */
export async function applyToMonth(fixedCostId, month) {
  const fc = await db.fixedCosts.get(fixedCostId);
  if (!fc) return;
  const id = fixedRowId(fixedCostId, month);
  const row = await db.transactions.get(id);
  if (!row) return;
  await db.transactions.update(id, { amount: Number(fc.amount) || 0, updatedAt: nowIso() });
}

/**
 * 前に作った月の次から今月までの固定費を記録に起こす。
 * 同じ固定費・同じ月の ID は必ず同じなので、何度呼んでも、別の端末と同時に動いても増えない。
 * @returns {Promise<number>} 作った件数
 */
export async function generateFixedRows() {
  const now = thisMonth();
  const last = await getMeta(META.fixedGeneratedMonth);
  const months = monthsToGenerate(last, now);
  if (!months.length) return 0;

  const fixedCosts = await db.fixedCosts.toArray();
  let made = 0;
  if (fixedCosts.length) {
    const createdAt = nowIso();
    for (const month of months) {
      const { from, to } = monthRange(month);
      await db.transaction('rw', db.transactions, async () => {
        const existing = await db.transactions.where('date').between(from, to, true, true).toArray();
        const rows = rowsToCreate(fixedCosts, existing, month, createdAt);
        if (!rows.length) return;
        // 同じ ID がすでにあれば作らない（別の端末が先に作っていた場合）
        const ids = await db.transactions.bulkGet(rows.map((r) => r.id));
        const fresh = rows.filter((_, i) => !ids[i]);
        if (fresh.length) await db.transactions.bulkAdd(fresh);
        made += fresh.length;
      });
    }
  }
  await setMeta(META.fixedGeneratedMonth, now);
  return made;
}
