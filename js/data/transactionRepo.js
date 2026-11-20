// 家計簿の記録（実際に発生した収入・支出）の読み書き
import { db } from './db.js';
import { newId, nowIso } from '../lib/util.js';
import { validateTransactionInput, monthRange } from '../domain/kakeibo.js';
import { ValidationError } from './productRepo.js';

/** その月の記録（日付の新しい順） */
export async function listByMonth(month) {
  const { from, to } = monthRange(month);
  const rows = await db.transactions.where('date').between(from, to, true, true).toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

/** 月ごとの「収入 − 支出」（貯金ペースの計算用）。新しい月から months か月分 */
export async function monthlySavings(months) {
  const out = [];
  for (const month of months) {
    const rows = await listByMonth(month);
    const sum = (type) => rows.filter((r) => r.type === type).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    out.push({ month, savings: sum('income') - sum('expense'), count: rows.length });
  }
  return out;
}

export function getTransaction(id) {
  return db.transactions.get(id);
}

/** 保存（id がなければ新規）。入力が不正なら ValidationError */
export async function saveTransaction(id, raw) {
  const r = validateTransactionInput(raw);
  if (!r.ok) throw new ValidationError(r.errors);
  const now = nowIso();
  const old = id ? await db.transactions.get(id) : null;
  const row = {
    id: id ?? newId(),
    ...r.value,
    // 固定費から作られた記録は、金額を直しても「固定」のまま
    source: old?.source === 'fixed' ? 'fixed' : r.value.source,
    fixedCostId: old?.fixedCostId ?? r.value.fixedCostId,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
  await db.transactions.put(row);
  return row;
}

export async function deleteTransaction(id) {
  await db.transactions.delete(id);
}

/** 消した記録を元に戻す（「元に戻す」用） */
export async function restoreTransaction(row) {
  await db.transactions.put(row);
}
