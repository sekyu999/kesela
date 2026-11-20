// 同期（Dexie Cloud）まわりのデータ操作。同期がオンの端末でだけ使う
import Dexie from '../../vendor/dexie.mjs';
import { db, SYNC, LOCAL_DB_NAME, DATA_TABLES, SCHEMA_VERSION, defaultCategoryRows, defaultExpenseCategoryRows } from './db.js';
import { META } from './metaRepo.js';

/** 同期しない時のデータベースから引き継ぐ設定（端末ごとの物は引き継がない） */
const CARRY_META = [META.profile, META.note, META.lastBackupAt, META.selectedStoreId, META.savingsGoal, META.fixedGeneratedMonth];

/**
 * ログインした後、最初に1回呼ぶ。クラウドの最新を取り込んでから：
 *   クラウドにデータがある（2台目以降） → そのまま使う
 *   クラウドが空で、この端末に同期前のデータがある（1台目） → それをクラウドへ移す
 *   どちらも空 → 初期カテゴリを入れる
 * @returns {Promise<'cloud'|'moved'|'seeded'|'offline'>}
 */
export async function prepareCloudData() {
  if (!SYNC) return 'cloud';
  try {
    await db.cloud.sync({ wait: true, purpose: 'pull' });
  } catch (e) {
    console.warn('[sync] pull failed', e); // i18n-ignore
    // つながらない時は何もしない（空のまま初期カテゴリを入れると、つながった後に二重になるため）
    if (!(await db.categories.count())) return 'offline';
  }
  if (await db.categories.count()) {
    await ensureExpenseCategories();
    return 'cloud';
  }
  if (await copyFromLocal()) {
    await ensureExpenseCategories();
    return 'moved';
  }
  await db.transaction('rw', db.categories, db.meta, async () => {
    if (await db.categories.count()) return;
    await db.categories.bulkAdd(defaultCategoryRows());
    await db.expenseCategories.bulkAdd(defaultExpenseCategoryRows());
    await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
  });
  return 'seeded';
}

/**
 * 家計簿のカテゴリがまだ無ければ入れる。
 * 同期する時は、クラウドを取り込んだ後にここで入れる（版6の移行では入れない。2台目で二重になるため）
 */
async function ensureExpenseCategories() {
  if (await db.expenseCategories.count()) return;
  await db.transaction('rw', db.expenseCategories, async () => {
    if (await db.expenseCategories.count()) return;
    await db.expenseCategories.bulkAdd(defaultExpenseCategoryRows());
  });
}

/** 同期前のデータベースの中身を、同期用のデータベースへ写す（元のデータベースは消さない） */
async function copyFromLocal() {
  if (!(await Dexie.exists(LOCAL_DB_NAME))) return false;
  const old = new Dexie(LOCAL_DB_NAME); // 版を書かずに開くと、今ある形のまま読める
  await old.open();
  try {
    const names = new Set(old.tables.map((t) => t.name));
    if (!names.has('categories') || !(await old.table('categories').count())) return false;
    const data = {};
    for (const name of DATA_TABLES) data[name] = names.has(name) ? await old.table(name).toArray() : [];
    const meta = names.has('meta') ? await old.table('meta').toArray() : [];
    let copied = false;
    await db.transaction('rw', [...DATA_TABLES.map((name) => db.table(name)), db.meta], async () => {
      if (await db.categories.count()) return; // 先にほかの端末から入っていたら写さない
      for (const name of DATA_TABLES) await db.table(name).bulkPut(data[name]);
      for (const row of meta) if (CARRY_META.includes(row.key)) await db.meta.put({ key: row.key, value: row.value });
      await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION });
      copied = true;
    });
    return copied;
  } finally {
    old.close();
  }
}

/** 今すぐ同期する */
export async function syncNow() {
  await db.cloud.sync({ wait: true, purpose: 'push' });
}

/**
 * 同期の状態を見張る。呼ばれるたびに { email, phase, status, error, license } を渡す。
 * @returns {() => void} 見張るのをやめる関数
 */
export function watchSyncState(callback) {
  if (!SYNC) return () => {};
  let user = null;
  let state = null;
  const emit = () =>
    callback({
      email: user?.isLoggedIn ? user.email || user.userId : null,
      phase: state?.phase ?? 'initial',
      status: state?.status ?? 'not-started',
      error: state?.error ?? null,
      license: state?.license ?? 'ok',
    });
  const a = db.cloud.currentUser.subscribe((u) => {
    user = u;
    emit();
  });
  const b = db.cloud.syncState.subscribe((s) => {
    state = s;
    emit();
  });
  return () => {
    a.unsubscribe();
    b.unsubscribe();
  };
}

/** ログイン画面の表示を見張る（同期用の部品が出す「メールアドレスを入れて」などの要求） */
export function watchLoginRequests(callback) {
  if (!SYNC) return () => {};
  const sub = db.cloud.userInteraction.subscribe(callback);
  return () => sub.unsubscribe();
}
