// KESELA 買い物リストのウィジェット（iPhone の Scriptable アプリ用）
//
// 使い方は docs/DESIGN.md 27章。
// ・Dexie Cloud（同期のデータ）から買い物リストを読んで表示する。書き換えはしない
// ・接続用の鍵（clientId / clientSecret）は iPhone のキーチェーンに保存する（このファイルには書かない）
// ・ウィジェットを押すと KESELA の買い物リストを開く
// ・つながらない時は、最後に読めた内容を表示する

const DB_URL = 'https://zy157txa6.dexie.cloud';
const APP_URL = 'https://sekyu999.github.io/kesela/#/list';
const KEY_NAME = 'kesela.dexieCloud'; // キーチェーンの名前（鍵）
const TOKEN_NAME = 'kesela.dexieCloud.token'; // キーチェーンの名前（1時間使える通行証）
const CACHE_FILE = 'kesela-widget-cache.json';
const REFRESH_MIN = 15; // 何分ごとに読み直してほしいか（実際の間隔は iOS が決める）

const ACCENT = Color.dynamic(new Color('#2f7d4f'), new Color('#7cc79a'));
const TEXT = Color.dynamic(new Color('#1b1c1a'), new Color('#f2f1ec'));
const SUB = Color.dynamic(new Color('#6b6a64'), new Color('#a9a8a1'));
const BG = Color.dynamic(new Color('#f6f5f1'), new Color('#1b1c1a'));

// ---------- 鍵と通行証 ----------

async function askKey() {
  const a = new Alert();
  a.title = 'KESELA の接続設定';
  a.message = 'Mac で表示した clientId と clientSecret を貼り付けてください（iPhone の中にだけ保存します）';
  a.addTextField('clientId');
  a.addSecureTextField('clientSecret');
  a.addAction('保存');
  a.addCancelAction('キャンセル');
  if ((await a.presentAlert()) === -1) return null;
  const key = { clientId: a.textFieldValue(0).trim(), clientSecret: a.textFieldValue(1).trim() };
  if (!key.clientId || !key.clientSecret) return null;
  Keychain.set(KEY_NAME, JSON.stringify(key));
  if (Keychain.contains(TOKEN_NAME)) Keychain.remove(TOKEN_NAME);
  return key;
}

function savedKey() {
  return Keychain.contains(KEY_NAME) ? JSON.parse(Keychain.get(KEY_NAME)) : null;
}

async function request(path, { method = 'GET', headers = {}, body } = {}) {
  const r = new Request(DB_URL + path);
  r.method = method;
  r.headers = headers;
  if (body !== undefined) r.body = JSON.stringify(body);
  r.timeoutInterval = 15;
  const text = await r.loadString();
  const status = r.response?.statusCode ?? 0;
  if (status < 200 || status >= 300) throw new Error(`${method} ${path} → ${status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function token(key) {
  if (Keychain.contains(TOKEN_NAME)) {
    const t = JSON.parse(Keychain.get(TOKEN_NAME));
    if (t.expires > Date.now() + 60 * 1000) return t.accessToken;
  }
  const res = await request('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      grant_type: 'client_credentials',
      client_id: key.clientId,
      client_secret: key.clientSecret,
      scopes: ['ACCESS_DB', 'GLOBAL_READ'], // 読むだけ
    },
  });
  const expires = res.accessTokenExpiration ? new Date(res.accessTokenExpiration).getTime() : Date.now() + 50 * 60 * 1000;
  Keychain.set(TOKEN_NAME, JSON.stringify({ accessToken: res.accessToken, expires }));
  return res.accessToken;
}

/** /all/<テーブル> の結果を配列にする（配列そのもの・{ data: [...] } のどちらでも） */
function rows(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  if (res && Array.isArray(res.result)) return res.result;
  return [];
}

// ---------- 買い物リストを作る ----------

async function loadList(key) {
  const auth = { Authorization: `Bearer ${await token(key)}` };
  const [items, products, categories] = await Promise.all(
    ['shoppingListItems', 'products', 'categories'].map((t) => request(`/all/${t}`, { headers: auth }).then(rows))
  );
  const prodById = new Map(products.map((p) => [p.id, p]));
  const catOrder = new Map(categories.map((c) => [c.id, c.defaultOrder ?? 999]));
  const list = items.map((it) => {
    const p = it.productId ? prodById.get(it.productId) : null;
    const unit = it.unit || p?.inventoryUnit || '';
    const qty = Number(it.quantity) || 0;
    return {
      name: it.name || p?.name || '',
      qty: qty ? `${Math.round(qty * 100) / 100}${unit}` : '',
      order: catOrder.get(it.categoryId ?? p?.categoryId) ?? 999,
      sort: p?.sortOrder ?? 9999,
    };
  });
  list.sort((a, b) => a.order - b.order || a.sort - b.sort || a.name.localeCompare(b.name, 'ja'));
  return { items: list, at: new Date().toISOString() };
}

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
}

function readCache() {
  const fm = FileManager.local();
  const p = cachePath();
  return fm.fileExists(p) ? JSON.parse(fm.readString(p)) : null;
}

function writeCache(data) {
  FileManager.local().writeString(cachePath(), JSON.stringify(data));
}

// ---------- ウィジェットの見た目 ----------

const LIMITS = { small: 4, medium: 8, large: 18, accessoryRectangular: 2 };

function timeText(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildWidget(data, family, note) {
  const w = new ListWidget();
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);
  const items = data?.items ?? [];

  // ロック画面（丸）：件数だけ
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(String(items.length));
    t.font = Font.boldSystemFont(22);
    t.centerAlignText();
    const s = w.addText('買う物');
    s.font = Font.systemFont(9);
    s.centerAlignText();
    return w;
  }
  // ロック画面（横長）：件数と最初の2つ
  if (family === 'accessoryRectangular') {
    const h = w.addText(`買い物 ${items.length}件`);
    h.font = Font.boldSystemFont(13);
    for (const it of items.slice(0, LIMITS.accessoryRectangular)) {
      const t = w.addText(it.name);
      t.font = Font.systemFont(12);
      t.lineLimit = 1;
    }
    return w;
  }
  // ロック画面（1行）
  if (family === 'accessoryInline') {
    w.addText(items.length ? `買い物 ${items.length}件：${items[0].name}` : '買い物リストは空です');
    return w;
  }

  // ホーム画面
  w.backgroundColor = BG;
  w.setPadding(12, 14, 10, 14);
  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText('買い物リスト');
  title.font = Font.boldSystemFont(family === 'small' ? 13 : 15);
  title.textColor = ACCENT;
  head.addSpacer();
  const count = head.addText(`${items.length}件`);
  count.font = Font.boldSystemFont(family === 'small' ? 13 : 15);
  count.textColor = TEXT;
  w.addSpacer(6);

  if (!data) {
    const t = w.addText(note ?? '読み込めませんでした');
    t.font = Font.systemFont(12);
    t.textColor = SUB;
    w.addSpacer();
    return w;
  }
  if (!items.length) {
    const t = w.addText('買う物はありません');
    t.font = Font.systemFont(13);
    t.textColor = SUB;
  }

  const limit = LIMITS[family] ?? LIMITS.medium;
  const shown = items.slice(0, limit);
  const columns = family === 'small' ? 1 : 2;
  const perCol = Math.ceil(limit / columns);
  const row = w.addStack();
  row.topAlignContent();
  for (let c = 0; c < columns; c++) {
    const col = row.addStack();
    col.layoutVertically();
    for (const it of shown.slice(c * perCol, (c + 1) * perCol)) {
      const line = col.addStack();
      line.centerAlignContent();
      const dot = line.addText('○ ');
      dot.font = Font.systemFont(11);
      dot.textColor = ACCENT;
      const name = line.addText(it.name);
      name.font = Font.systemFont(family === 'small' ? 12 : 13);
      name.textColor = TEXT;
      name.lineLimit = 1;
      if (it.qty && family !== 'small') {
        line.addSpacer(4);
        const q = line.addText(it.qty);
        q.font = Font.boldSystemFont(12);
        q.textColor = SUB;
        q.lineLimit = 1;
      }
      col.addSpacer(2);
    }
    if (c < columns - 1) row.addSpacer(10);
  }
  w.addSpacer();
  const foot = w.addStack();
  if (items.length > shown.length) {
    const more = foot.addText(`ほか${items.length - shown.length}件`);
    more.font = Font.systemFont(10);
    more.textColor = SUB;
  }
  foot.addSpacer();
  const at = foot.addText(note ? `${note}・${timeText(data.at)}` : timeText(data.at));
  at.font = Font.systemFont(10);
  at.textColor = SUB;
  return w;
}

// ---------- 実行 ----------

async function fetchData() {
  const key = savedKey();
  if (!key) return { data: readCache(), note: config.runsInWidget ? 'Scriptable で一度開いて設定' : null, needKey: true };
  try {
    const data = await loadList(key);
    writeCache(data);
    return { data };
  } catch (e) {
    console.error(e);
    return { data: readCache(), note: 'オフライン', error: e };
  }
}

if (config.runsInWidget) {
  const { data, note } = await fetchData();
  Script.setWidget(buildWidget(data, config.widgetFamily, note));
} else {
  // Scriptable のアプリの中で開いた時：設定とプレビュー
  if (!savedKey()) await askKey();
  const menu = new Alert();
  menu.title = 'KESELA ウィジェット';
  ['プレビュー（小）', 'プレビュー（中）', 'プレビュー（大）', '読み込みを確認', '接続設定をやり直す'].forEach((x) => menu.addAction(x));
  menu.addCancelAction('閉じる');
  const pick = await menu.presentSheet();
  if (pick >= 0 && pick <= 2) {
    const { data, note } = await fetchData();
    const fam = ['small', 'medium', 'large'][pick];
    const w = buildWidget(data, fam, note);
    await (fam === 'small' ? w.presentSmall() : fam === 'medium' ? w.presentMedium() : w.presentLarge());
  } else if (pick === 3) {
    const { data, error } = await fetchData();
    const a = new Alert();
    a.title = error ? '読み込めませんでした' : '読み込めました';
    a.message = error ? String(error.message ?? error) : `買い物リスト ${data.items.length}件\n${data.items.slice(0, 5).map((i) => i.name).join('、')}`;
    a.addAction('OK');
    await a.presentAlert();
  } else if (pick === 4) {
    await askKey();
  }
}
Script.complete();
