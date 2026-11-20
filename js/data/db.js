// データベース定義。Dexie を直接使うのは data/ フォルダの中だけ。
import Dexie from '../../vendor/dexie.mjs';
import { newId, todayLocal } from '../lib/util.js';
import { CURRENT_SCHEMA_VERSION } from '../domain/backupFormat.js';
import { DEFAULT_CATEGORIES, splitCategories, mergeCategories, reorganizeCategories } from '../domain/categories.js';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES, PALETTE_SIZE } from '../domain/kakeibo.js';
import { syncEnabled, CLOUD_DB_URL } from './syncConfig.js';

/** データ構造の版（バックアップにも記録する） */
export const SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;

/** この端末で同期（Dexie Cloud）を使っているか */
export const SYNC = syncEnabled();

/** 同期しない時のデータベース名。旧名（yuteli）のまま（変えると端末に保存済みのデータが読めなくなるため） */
export const LOCAL_DB_NAME = 'yuteli';

// 同期する時は別のデータベース（kesela）を使う。同期用の部品は同期する時だけ読み込む
const addons = SYNC ? [(await import('../../vendor/dexie-cloud-addon.mjs')).default] : [];
export const db = SYNC ? new Dexie('kesela', { addons }) : new Dexie(LOCAL_DB_NAME);

if (SYNC) {
  db.cloud.configure({
    databaseUrl: CLOUD_DB_URL,
    requireAuth: true, // 同期中はログインしてから使う
    customLoginGui: true, // ログイン画面はアプリで作る（js/screens/loginSheet.js）
    socialAuth: false, // メールに届くコードだけでログイン
    tryUseServiceWorker: false, // sw.js はオフライン用だけ。同期は画面を開いている間に行う
  });
}

// 「主キー, 検索に使う項目…」の形で書く。ここに無い項目も保存はできる。
db.version(1).stores({
  categories: 'id, defaultOrder',
  products: 'id, categoryId, name',
  stores: 'id, name',
  storeShelfOrders: 'id, storeId, [storeId+categoryId]',
  shoppingListItems: 'id, productId',
  priceRecords: 'id, productId, storeId, [productId+storeId], purchasedAt',
  meta: 'key',
});

// 版2：毎日の量（朝昼晩）・栄養データ・1個の重さ・在庫を確定した日 を商品に追加
db.version(2)
  .stores({})
  .upgrade((tx) =>
    tx
      .table('products')
      .toCollection()
      .modify((p) => {
        p.consumption ??= { breakfast: 0, lunch: 0, dinner: 0 };
        p.gramsPerUnit ??= null;
        p.nutrition ??= null;
        p.stockUpdatedOn ??= todayLocal();
      })
  );

// 版3：食事グループを追加。「野菜・果物」などの「・」区切りカテゴリを分け、「缶詰」を追加
db.version(3)
  .stores({ foodGroups: 'id' })
  .upgrade(async (tx) => {
    const categories = await tx.table('categories').toArray();
    const storeShelfOrders = await tx.table('storeShelfOrders').toArray();
    const r = splitCategories({ categories, storeShelfOrders }, newId);
    if (!r.changed) return;
    await tx.table('categories').clear();
    await tx.table('categories').bulkAdd(r.categories);
    await tx.table('storeShelfOrders').clear();
    await tx.table('storeShelfOrders').bulkAdd(r.storeShelfOrders);
  });

// 版4：家計（買いたい物・やりたい事）を追加。商品に並び順を追加。分けたカテゴリを「・」でまとめ直す
db.version(4)
  .stores({ plans: 'id, month' })
  .upgrade(async (tx) => {
    const [categories, storeShelfOrders, products, shoppingListItems] = await Promise.all(
      ['categories', 'storeShelfOrders', 'products', 'shoppingListItems'].map((t) => tx.table(t).toArray())
    );
    const r = mergeCategories({ categories, storeShelfOrders, products, shoppingListItems });
    const prods = withSortOrder(r.products);
    for (const [name, rows] of [
      ['categories', r.categories],
      ['storeShelfOrders', r.storeShelfOrders],
      ['products', prods],
      ['shoppingListItems', r.shoppingListItems],
    ]) {
      await tx.table(name).clear();
      await tx.table(name).bulkAdd(rows);
    }
  });

// 版5：カテゴリを組み直す（野菜／果物／豆類…の17種類と並び。v1.12）
db.version(5)
  .stores({})
  .upgrade(async (tx) => {
    const [categories, storeShelfOrders, products, shoppingListItems] = await Promise.all(
      ['categories', 'storeShelfOrders', 'products', 'shoppingListItems'].map((t) => tx.table(t).toArray())
    );
    if (!categories.length) return; // 初めて開いた時は初期カテゴリを入れる処理に任せる
    const r = reorganizeCategories({ categories, storeShelfOrders, products, shoppingListItems }, newId);
    for (const [name, rows] of [
      ['categories', r.categories],
      ['storeShelfOrders', r.storeShelfOrders],
      ['products', r.products],
      ['shoppingListItems', r.shoppingListItems],
    ]) {
      await tx.table(name).clear();
      await tx.table(name).bulkAdd(rows);
    }
  });


// 版6：家計簿（記録・カテゴリ・固定費・予算）を追加。
// 既存テーブルへの追加は2つだけ：店舗の色（colorIndex）と、商品の「在庫を管理するか」（trackStock）。
// 既存の値は書き換えない。
db.version(6)
  .stores({
    expenseCategories: 'id, type, defaultOrder',
    transactions: 'id, date, categoryId, type, fixedCostId',
    fixedCosts: 'id, categoryId',
    budgets: 'id', // 件数が少なく、月・カテゴリが null の行もあるので全件読んで決める
  })
  .upgrade(async (tx) => {
    // 店舗に色を割り当てる（登録順）
    const stores = await tx.table('stores').toArray();
    stores.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    for (let i = 0; i < stores.length; i++) {
      if (stores[i].colorIndex == null) await tx.table('stores').update(stores[i].id, { colorIndex: i % PALETTE_SIZE });
    }
    // 今ある商品はすべて「在庫を管理する」（＝今までと同じ）
    await tx
      .table('products')
      .toCollection()
      .modify((p) => {
        p.trackStock ??= true;
      });
    // 家計簿の初期カテゴリ。同期する時はここでは入れない（2台目で二重になるため。js/data/sync.js で入れる）
    if (!SYNC && !(await tx.table('expenseCategories').count())) {
      await tx.table('expenseCategories').bulkAdd(defaultExpenseCategoryRows());
    }
  });

// 版7：固定費はカテゴリをやめて、名前と色で表す。お店に並び順を付ける（v1.15 の見直し）
db.version(7)
  .stores({})
  .upgrade(async (tx) => {
    const stores = await tx.table('stores').toArray();
    stores.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
    for (let i = 0; i < stores.length; i++) {
      if (stores[i].sortOrder == null) await tx.table('stores').update(stores[i].id, { sortOrder: i + 1 });
    }
    const fixed = await tx.table('fixedCosts').toArray();
    for (let i = 0; i < fixed.length; i++) {
      const changes = {};
      if (fixed[i].colorIndex == null) changes.colorIndex = i % PALETTE_SIZE;
      if (fixed[i].samples == null) changes.samples = {};
      if (Object.keys(changes).length) await tx.table('fixedCosts').update(fixed[i].id, changes);
    }
  });

/** 並び順のない商品に、カテゴリごと名前順の sortOrder を付ける */
export function withSortOrder(products) {
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return sorted.map((p, i) => ({ ...p, sortOrder: p.sortOrder ?? i + 1 }));
}

export { DEFAULT_CATEGORIES, DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES };

/** 初期カテゴリのデータを作る（初回起動・初期化で使う） */
export function defaultCategoryRows() {
  return DEFAULT_CATEGORIES.map((name, i) => ({ id: newId(), name, defaultOrder: i + 1 }));
}

/** 家計簿の初期カテゴリのデータを作る（支出のあとに収入） */
export function defaultExpenseCategoryRows() {
  const rows = [];
  DEFAULT_EXPENSE_CATEGORIES.forEach((name, i) =>
    rows.push({ id: newId(), name, type: 'expense', colorIndex: i % PALETTE_SIZE, defaultOrder: rows.length + 1 })
  );
  DEFAULT_INCOME_CATEGORIES.forEach((name, i) =>
    rows.push({ id: newId(), name, type: 'income', colorIndex: i % PALETTE_SIZE, defaultOrder: rows.length + 1 })
  );
  return rows;
}

// データベースが初めて作られた時だけ実行される。
// 同期する時はここでは入れない（2台目の端末で初期カテゴリが二重になるため）。js/data/sync.js の prepareCloudData で入れる
db.on('populate', (tx) => {
  if (SYNC) return;
  tx.table('categories').bulkAdd(defaultCategoryRows());
  tx.table('expenseCategories').bulkAdd(defaultExpenseCategoryRows());
  tx.table('meta').put({ key: 'schemaVersion', value: SCHEMA_VERSION });
});

/** ユーザーのデータが入るテーブル（バックアップ対象） */
export const DATA_TABLES = [
  'categories',
  'products',
  'stores',
  'storeShelfOrders',
  'shoppingListItems',
  'priceRecords',
  'foodGroups',
  'plans',
  'expenseCategories',
  'transactions',
  'fixedCosts',
  'budgets',
];

/** 全テーブル名 */
export const TABLES = [...DATA_TABLES, 'meta'];
