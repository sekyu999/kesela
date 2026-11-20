// 家計簿のカテゴリ（食材の categories とは別物）の読み書き
import { db } from './db.js';
import { newId } from '../lib/util.js';
import { nameKey } from '../domain/product.js';
import { ValidationError } from './productRepo.js';
import { PALETTE_SIZE } from '../domain/kakeibo.js';

/** 並び順どおりの全カテゴリ（支出・収入の両方） */
export async function listExpenseCategories() {
  const all = await db.expenseCategories.toArray();
  return all.sort((a, b) => a.defaultOrder - b.defaultOrder);
}

/** 支出用または収入用だけ */
export async function listByType(type) {
  const all = await listExpenseCategories();
  return all.filter((c) => c.type === type);
}

function checkName(raw) {
  const name = String(raw ?? '').trim();
  if (!name) throw new ValidationError({ name: 'カテゴリ名を入力してください' });
  if (name.length > 20) throw new ValidationError({ name: '20文字以内にしてください' });
  return name;
}

export async function addExpenseCategory(rawName, type = 'expense', colorIndex = null) {
  const name = checkName(rawName);
  return db.transaction('rw', db.expenseCategories, async () => {
    const all = await db.expenseCategories.toArray();
    const key = nameKey(name);
    if (all.some((c) => c.type === type && nameKey(c.name) === key)) {
      throw new ValidationError({ name: '同じ名前のカテゴリがすでにあります' });
    }
    const last = Math.max(0, ...all.map((c) => c.defaultOrder));
    const cat = {
      id: newId(),
      name,
      type: type === 'income' ? 'income' : 'expense',
      colorIndex: colorIndex ?? all.length % PALETTE_SIZE,
      defaultOrder: last + 1,
    };
    await db.expenseCategories.add(cat);
    return cat;
  });
}

export async function updateExpenseCategory(id, { name, colorIndex }) {
  const changes = {};
  if (name !== undefined) changes.name = checkName(name);
  if (colorIndex !== undefined) changes.colorIndex = Number(colorIndex) || 0;
  await db.transaction('rw', db.expenseCategories, async () => {
    if (changes.name) {
      const me = await db.expenseCategories.get(id);
      const all = await db.expenseCategories.toArray();
      const key = nameKey(changes.name);
      if (all.some((c) => c.id !== id && c.type === me?.type && nameKey(c.name) === key)) {
        throw new ValidationError({ name: '同じ名前のカテゴリがすでにあります' });
      }
    }
    await db.expenseCategories.update(id, changes);
  });
}

export async function saveExpenseCategoryOrder(ids) {
  await db.transaction('rw', db.expenseCategories, async () => {
    for (let i = 0; i < ids.length; i++) await db.expenseCategories.update(ids[i], { defaultOrder: i + 1 });
  });
}

export function countTransactionsInCategory(id) {
  return db.transactions.where('categoryId').equals(id).count();
}

/** 削除する。使っている記録・固定費・予算があれば削除できない */
export async function deleteExpenseCategory(id) {
  await db.transaction('rw', db.expenseCategories, db.transactions, db.fixedCosts, db.budgets, async () => {
    const n = await db.transactions.where('categoryId').equals(id).count();
    if (n) throw new ValidationError({ name: `このカテゴリの記録が${n}件あるため削除できません` }); // i18n-ignore（画面で作り直す）
    const f = await db.fixedCosts.where('categoryId').equals(id).count();
    if (f) throw new ValidationError({ name: `このカテゴリの固定費が${f}件あるため削除できません` }); // i18n-ignore（画面で作り直す）
    await db.budgets.filter((b) => b.categoryId === id).delete();
    await db.expenseCategories.delete(id);
  });
}
