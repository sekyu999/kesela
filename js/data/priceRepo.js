// 価格記録の読み書き。v1.20 から「1つの店舗に何件でも」（容量違い・銘柄違いをメモで見分ける）。価格は1個（管理単位）あたり
import { db } from './db.js';
import { newId, nowIso, todayLocal } from '../lib/util.js';
import { validatePriceInput, newestFirst } from '../domain/pricing.js';
import { ValidationError } from './productRepo.js';

/**
 * @typedef {Object} PriceRecord
 * @property {string} id
 * @property {string} productId
 * @property {string} storeId
 * @property {number} price          税込の支払額（合計）
 * @property {number} quantity       購入数量（管理単位）
 * @property {number|null} packageContent
 * @property {'g'|'ml'|'個'|null} packageContentUnit
 * @property {string} purchasedAt    YYYY-MM-DD
 * @property {string|null} rawName   将来のレシート読み取り用（今は null）
 * @property {string|null} memo      任意のメモ（「200gの方」「特売」など）
 * @property {string} createdAt
 */

/**
 * 価格を保存する。id があればその記録を直し、なければ新しく足す。入力が不正なら ValidationError
 * price は1個（管理単位）あたりの税込金額。数量は1、購入日は今日として保存する
 */
export async function savePrice(raw, id = null) {
  const r = validatePriceInput({ ...raw, quantity: 1, purchasedAt: todayLocal() }, todayLocal());
  if (!r.ok) throw new ValidationError(r.errors);
  const now = nowIso();
  const old = id ? await db.priceRecords.get(id) : null;
  /** @type {PriceRecord} */
  const record = { id: old?.id ?? newId(), ...r.value, rawName: null, createdAt: old?.createdAt ?? now, updatedAt: now };
  await db.priceRecords.put(record);
  return record;
}

/** 1件取り出す（直す時の初期値に使う） */
export function getPriceRecord(id) {
  return db.priceRecords.get(id);
}

/** その商品の全記録（新しい順） */
export async function listByProduct(productId) {
  const list = await db.priceRecords.where('productId').equals(productId).toArray();
  return list.sort(newestFirst);
}

export function listAllRecords() {
  return db.priceRecords.toArray();
}

/** 記録を1件削除する */
export async function deletePriceRecord(id) {
  await db.priceRecords.delete(id);
}
