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

/**
 * これまでに書いたメモ（新しい順・重複なし）。メモ欄の入力候補に使う
 */
export async function recentMemos(limit = 30) {
  const seen = new Set();
  const out = [];
  await db.transactions
    .orderBy('date')
    .reverse()
    .until(() => out.length >= limit)
    .each((r) => {
      const m = String(r.memo ?? '').trim();
      if (!m || seen.has(m)) return;
      seen.add(m);
      out.push(m);
    });
  return out;
}

/** 月の範囲の記録（年間グラフ用） */
export async function listBetween(fromMonth, toMonth) {
  const from = monthRange(fromMonth).from;
  const to = monthRange(toMonth).to;
  return db.transactions.where('date').between(from, to, true, true).toArray();
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
