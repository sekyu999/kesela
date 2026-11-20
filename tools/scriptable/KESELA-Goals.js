// KESELA 目標のウィジェット（iPhone の Scriptable アプリ用）
//
// 家計簿のウィジェット（KESELA.js）とは別のスクリプト。目標メモの ToDo を表示する。
// ・Dexie Cloud（同期のデータ）の meta.note から目標メモを読む。書き換えはしない
// ・接続用の鍵は KESELA.js と同じキーチェーンを使う（先に KESELA.js で設定しておけば、入力は1回で済む）
// ・押すと KESELA の目標画面を開く
// ・つながらない時は、最後に読めた内容を表示する

const DB_URL = 'https://zy157txa6.dexie.cloud';
const APP_URL = 'https://sekyu999.github.io/kesela/#/goals';
const KEY_NAME = 'kesela.dexieCloud'; // KESELA.js と共通
const TOKEN_NAME = 'kesela.dexieCloud.token'; // KESELA.js と共通
const CACHE_FILE = 'kesela-goals-cache.json';
const REFRESH_MIN = 30;

const ACCENT = Color.dynamic(new Color('#2f7d4f'), new Color('#7cc79a'));
const TEXT = Color.dynamic(new Color('#1b1c1a'), new Color('#f2f1ec'));
const SUB = Color.dynamic(new Color('#6b6a64'), new Color('#a9a8a1'));
const WARN = new Color('#d99a1e');
const BG = Color.dynamic(new Color('#f6f5f1'), new Color('#1b1c1a'));

// ---------- 鍵と通行証（KESELA.js と同じ仕組み）----------

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

function rows(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.data)) return res.data;
  if (res && Array.isArray(res.result)) return res.result;
  return [];
}

// ---------- 目標メモを読む ----------

const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 行の中の **太字** ~~打ち消し~~ の記号は、ウィジェットでは外して表示する */
const plain = (s) => String(s ?? '').replaceAll('**', '').replaceAll('~~', '');

/**
 * 目標メモ（Markdown）を、ウィジェットに出す行に変える。
 * js/domain/note.js と同じ書き方を読む（見出し・ToDo・箇条書き）。
 */
function parseNote(text) {
  const out = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    let m = raw.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      out.push({ type: 'heading', text: plain(m[2].trim()) });
      continue;
    }
    m = raw.match(/^\s*[-*+]\s+\[( |x|X)\]\s?(.*)$/);
    if (m) {
      const mm = m[2].match(/\s*@(\d{4}-(?:0[1-9]|1[0-2]))\s*$/);
      out.push({
        type: 'todo',
        checked: m[1] !== ' ',
        text: plain((mm ? m[2].slice(0, mm.index) : m[2]).trim()),
        month: mm ? mm[1] : null,
      });
      continue;
    }
    m = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (m) {
      out.push({ type: 'bullet', text: plain(m[1].trim()) });
      continue;
    }
    out.push({ type: 'text', text: plain(raw.trim()) });
  }
  return out;
}

async function loadGoals(key) {
  const auth = { Authorization: `Bearer ${await token(key)}` };
  const meta = rows(await request('/all/meta', { headers: auth }));
  const note = meta.find((m) => m.key === 'note')?.value;
  const lines = parseNote(note?.text ?? '');
  const todos = lines.filter((l) => l.type === 'todo');
  return {
    lines,
    done: todos.filter((t) => t.checked).length,
    total: todos.length,
    at: new Date().toISOString(),
  };
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

// ---------- 見た目 ----------

const LIMITS = { small: 5, medium: 6, large: 16, accessoryRectangular: 2 };

function timeText(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 出す行：未チェックの ToDo を先に。余りがあれば見出しと済みの ToDo も */
function pickLines(data, limit) {
  const todo = data.lines.filter((l) => l.type === 'todo' && !l.checked);
  const rest = data.lines.filter((l) => l.type === 'heading' || (l.type === 'todo' && l.checked));
  return [...todo, ...rest].slice(0, limit);
}

function buildWidget(data, family, note) {
  const w = new ListWidget();
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60 * 1000);

  if (!data) {
    w.backgroundColor = BG;
    const t = w.addText(note ?? '読み込めませんでした');
    t.font = Font.systemFont(12);
    t.textColor = SUB;
    return w;
  }
  const now = thisMonth();
  const limit = LIMITS[family] ?? LIMITS.medium;
  const lines = pickLines(data, limit);

  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(`${data.done}/${data.total}`);
    t.font = Font.boldSystemFont(15);
    t.centerAlignText();
    const s = w.addText('目標');
    s.font = Font.systemFont(9);
    s.centerAlignText();
    return w;
  }
  if (family === 'accessoryRectangular') {
    const h = w.addText(`目標 ${data.done}/${data.total}`);
    h.font = Font.boldSystemFont(13);
    for (const l of lines.slice(0, LIMITS.accessoryRectangular)) {
      const t = w.addText(l.text);
      t.font = Font.systemFont(12);
      t.lineLimit = 1;
    }
    return w;
  }
  if (family === 'accessoryInline') {
    w.addText(lines.length ? `目標：${lines[0].text}` : `目標 ${data.done}/${data.total}`);
    return w;
  }

  w.backgroundColor = BG;
  w.setPadding(12, 14, 10, 14);
  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText('目標');
  title.font = Font.boldSystemFont(family === 'small' ? 12 : 13);
  title.textColor = ACCENT;
  head.addSpacer();
  if (data.total) {
    const c = head.addText(`${data.done}/${data.total}`);
    c.font = Font.boldSystemFont(family === 'small' ? 12 : 13);
    c.textColor = SUB;
  }
  w.addSpacer(6);

  if (!lines.length) {
    const t = w.addText('まだ何も書かれていません');
    t.font = Font.systemFont(12);
    t.textColor = SUB;
  }

  for (const l of lines) {
    const row = w.addStack();
    row.centerAlignContent();
    if (l.type === 'heading') {
      const h = row.addText(l.text);
      h.font = Font.boldSystemFont(family === 'small' ? 12 : 13);
      h.textColor = ACCENT;
      h.lineLimit = 1;
    } else {
      const box = row.addText(l.checked ? '☑ ' : '☐ ');
      box.font = Font.systemFont(family === 'small' ? 12 : 13);
      box.textColor = l.checked ? SUB : ACCENT;
      const n = row.addText(l.text);
      n.font = Font.systemFont(family === 'small' ? 12 : 13);
      n.textColor = l.checked ? SUB : TEXT;
      n.lineLimit = 1;
      if (l.month && family !== 'small') {
        row.addSpacer(4);
        const m = row.addText(`${Number(l.month.slice(5, 7))}月`);
        m.font = Font.systemFont(11);
        m.textColor = !l.checked && l.month < now ? WARN : SUB;
      }
    }
    row.addSpacer();
    w.addSpacer(3);
  }

  w.addSpacer();
  const at = w.addText(note ? `${note}・${timeText(data.at)}` : timeText(data.at));
  at.font = Font.systemFont(10);
  at.textColor = SUB;
  at.rightAlignText();
  return w;
}

// ---------- 実行 ----------

async function fetchData() {
  const key = savedKey();
  if (!key) return { data: readCache(), note: config.runsInWidget ? 'Scriptable で一度開いて設定' : null, needKey: true };
  try {
    const data = await loadGoals(key);
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
  if (!savedKey()) await askKey();
  const menu = new Alert();
  menu.title = 'KESELA ウィジェット（目標）';
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
    a.message = error
      ? String(error.message ?? error)
      : `ToDo ${data.done}/${data.total}\n${pickLines(data, 5).map((l) => l.text).join('\n')}`;
    a.addAction('OK');
    await a.presentAlert();
  } else if (pick === 4) {
    await askKey();
  }
}
Script.complete();
