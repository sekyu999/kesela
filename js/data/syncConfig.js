// 同期（Dexie Cloud）の設定
// 同期のオン・オフは端末ごと（localStorage）。オフの端末は今までどおり端末の中のデータ（IndexedDB 'yuteli'）を使う。
// オンの端末は別のデータベース（'kesela'）を使い、Dexie Cloud と同期する。

/** Dexie Cloud のデータベースの URL（npx dexie-cloud create で作ったもの）。空の間は同期の項目を出さない */
export const CLOUD_DB_URL = 'https://zy157txa6.dexie.cloud';

const KEY = 'kesela.sync';

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 同期を使える状態か（データベースの URL が設定済み） */
export function syncAvailable() {
  return Boolean(CLOUD_DB_URL);
}

/** この端末で同期がオンか */
export function syncEnabled() {
  return syncAvailable() && storage()?.getItem(KEY) === '1';
}

/** 同期のオン・オフを切り替えて読み込み直す（使うデータベースが変わるため） */
export function setSyncEnabled(on) {
  if (on) storage()?.setItem(KEY, '1');
  else storage()?.removeItem(KEY);
  location.reload();
}
