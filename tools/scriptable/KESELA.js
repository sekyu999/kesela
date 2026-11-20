// KESELA 今月のお金のウィジェット（iPhone の Scriptable アプリ用）
//
// 使い方は docs/DESIGN.md。v1.15 で買い物リストから「今月のお金と目標」に差し替えた。
// ・Dexie Cloud（同期のデータ）から今月の収入・支出・貯金・使えるお金と、目標（予定）を読む。書き換えはしない
// ・接続用の鍵（clientId / clientSecret）は iPhone のキーチェーンに保存する（このファイルには書かない）
// ・ウィジェットを押すと KESELA の家計画面を開く
// ・つながらない時は、最後に読めた内容を表示する
// ・固定費は「アプリを開いた時」に記録へ入るため、まだ入っていない月は「アプリを開いて更新」と出す

const DB_URL = 'https://zy157txa6.dexie.cloud';
const APP_URL = 'https://sekyu999.github.io/kesela/#/budget';
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

// ---------- 今月のお金を作る ----------

const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')}円`;
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const sum = (list) => list.reduce((s, x) => s + (Number(x.amount) || 0), 0);

async function loadMoney(key) {
  const auth = { Authorization: `Bearer ${await token(key)}` };
  const [transactions, budgets, plans, fixedCosts, meta] = await Promise.all(
    ['transactions', 'budgets', 'plans', 'fixedCosts', 'meta'].map((t) => request(`/all/${t}`, { headers: auth }).then(rows))
  );

  const month = thisMonth();
  const inMonth = (ym) => transactions.filter((t) => String(t.date ?? '').slice(0, 7) === ym);
  const savingsOf = (ym) => {
    const r = inMonth(ym);
    return sum(r.filter((x) => x.type === 'income')) - sum(r.filter((x) => x.type === 'expense'));
  };

  const rowsNow = inMonth(month);
  const income = sum(rowsNow.filter((t) => t.type === 'income'));
  const expense = sum(rowsNow.filter((t) => t.type === 'expense'));
  const goal = Number(meta.find((m) => m.key === 'savingsGoal')?.value) || 0;

  // 月全体の予算（その月 → 毎月の既定の順）
  const pick = (ym) => budgets.find((b) => (b.month ?? null) === ym && (b.categoryId ?? null) === null);
  const budget = (pick(month) ?? pick(null))?.amount ?? null;

  // 固定費がまだ今月の記録に入っていないか（アプリを開くと入る）
  const active = fixedCosts.filter((f) => (!f.startMonth || f.startMonth <= month) && (!f.endMonth || f.endMonth >= month));
  const done = new Set(rowsNow.filter((t) => t.fixedCostId).map((t) => t.fixedCostId));
  const pending = active.filter((f) => !done.has(f.id)).length;

  // 貯金ペース（直近3か月の平均）と、目標が届きそうか
  const months = [month, addMonths(month, -1), addMonths(month, -2)];
  const pace = Math.round(months.reduce((s, m) => s + savingsOf(m), 0) / months.length);
  const current = savingsOf(month);
  let need = 0;
  const goals = plans
    .filter((p) => p.month && p.month >= month)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((p) => {
      need += Number(p.price) || 0;
      const [y1, m1] = month.split('-').map(Number);
      const [y2, m2] = p.month.split('-').map(Number);
      const have = current + Math.max(0, pace) * Math.max(0, (y2 - y1) * 12 + (m2 - m1));
      return { title: p.title, price: Number(p.price) || 0, month: p.month, reachable: have >= need, short: Math.max(0, need - have) };
    })
    .slice(0, 3);

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();

  return {
    month,
    daysInMonth,
    day,
    daysLeft: Math.max(0, daysInMonth - day + 1), // 今日を含めてあと何日
    income,
    expense,
    savings: income - expense,
    goal,
    free: goal > 0 ? income - expense - goal : null,
    budget,
    budgetLeft: budget == null ? null : budget - expense,
    hasIncome: rowsNow.some((t) => t.type === 'income'),
    pending,
    goals,
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

// ---------- ウィジェットの見た目 ----------

function timeText(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const WARN = new Color('#d99a1e');

/**
 * 今月どれだけ使っていいか。
 * 貯金目標があれば「収入 − 支出 − 貯金目標」、無ければ予算の残り。どちらも無ければ null
 */
function spendableOf(data) {
  if (data.free !== null && data.hasIncome) return { value: data.free, label: '使っていい' };
  if (data.budgetLeft !== null) return { value: data.budgetLeft, label: '予算の残り' };
  return { value: null, label: !data.hasIncome ? '収入が未記録' : '貯金目標が未設定' };
}

/**
 * 使った割合の帯。
 * 濃いバー＝使った割合、細い縦線＝今日の位置（今月のどこまで来たか）。
 * バーが縦線より先なら使いすぎ、手前なら余裕がある、と一目で分かる。
 */
function addPaceBar(stack, data, width, height) {
  const sp = spendableOf(data);
  const total = sp.value === null ? Math.max(data.expense, 1) : data.expense + Math.max(0, sp.value);
  const usedW = Math.max(2, Math.min(width, (data.expense / Math.max(total, 1)) * width));
  const elapsedW = Math.max(0, Math.min(width, (data.day / data.daysInMonth) * width));
  const over = usedW > elapsedW + width * 0.02;

  const bar = stack.addStack();
  bar.size = new Size(width, height);
  bar.cornerRadius = height / 2;
  bar.backgroundColor = Color.dynamic(new Color('#e4f1e8'), new Color('#23382b'));

  const used = bar.addStack();
  used.size = new Size(usedW, height);
  used.backgroundColor = over ? WARN : ACCENT;

  // 今日の位置の印
  const before = elapsedW - usedW - 2;
  if (before > 0) bar.addSpacer(before);
  const tick = bar.addStack();
  tick.size = new Size(2, height);
  tick.backgroundColor = Color.dynamic(new Color('#1f201d'), new Color('#ecebe6'));
  bar.addSpacer();
  return { over };
}

/** 「支出」「貯金」などの1項目 */
function addStat(stack, label, value, size) {
  const col = stack.addStack();
  col.layoutVertically();
  const l = col.addText(label);
  l.font = Font.systemFont(size - 4);
  l.textColor = SUB;
  const v = col.addText(value);
  v.font = Font.boldSystemFont(size);
  v.textColor = TEXT;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.6;
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
  const lock = spendableOf(data);

  // ロック画面（丸）：使っていい額とあと何日
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(lock.value === null ? '—' : yen(lock.value).replace('円', ''));
    t.font = Font.boldSystemFont(15);
    t.centerAlignText();
    t.minimumScaleFactor = 0.5;
    const s = w.addText(`あと${data.daysLeft}日`);
    s.font = Font.systemFont(9);
    s.centerAlignText();
    return w;
  }
  // ロック画面（横長）：使っていい額・あと何日・1日あたり
  if (family === 'accessoryRectangular') {
    const h = w.addText(lock.value === null ? lock.label : `${lock.label} ${yen(lock.value)}`);
    h.font = Font.boldSystemFont(13);
    h.lineLimit = 1;
    const per = lock.value === null ? null : Math.max(0, Math.round(lock.value / Math.max(1, data.daysLeft)));
    const s = w.addText(per === null ? `支出 ${yen(data.expense)}` : `あと${data.daysLeft}日・1日 ${yen(per)}`);
    s.font = Font.systemFont(12);
    s.lineLimit = 1;
    return w;
  }
  // ロック画面（1行）
  if (family === 'accessoryInline') {
    w.addText(lock.value === null ? `支出 ${yen(data.expense)}` : `${lock.label} ${yen(lock.value)}・あと${data.daysLeft}日`);
    return w;
  }

  // ホーム画面
  w.backgroundColor = BG;
  w.setPadding(12, 14, 10, 14);
  const sp = spendableOf(data);
  const perDay = sp.value === null ? null : Math.max(0, Math.round(sp.value / Math.max(1, data.daysLeft)));

  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText('今月のお金');
  title.font = Font.boldSystemFont(family === 'small' ? 12 : 13);
  title.textColor = ACCENT;
  head.addSpacer();
  const left = head.addText(`あと${data.daysLeft}日`);
  left.font = Font.boldSystemFont(family === 'small' ? 12 : 13);
  left.textColor = SUB;

  w.addSpacer(family === 'small' ? 6 : 8);

  // いちばん大きく出すのは「使っていい額」
  const big = w.addText(sp.value === null ? sp.label : yen(sp.value));
  big.font = Font.boldSystemFont(family === 'small' ? 22 : 26);
  big.textColor = sp.value !== null && sp.value < 0 ? new Color('#b4382c') : TEXT;
  big.lineLimit = 1;
  big.minimumScaleFactor = 0.5;
  const cap = w.addText(sp.value === null ? 'アプリで設定するとここに出ます' : sp.label);
  cap.font = Font.systemFont(family === 'small' ? 10 : 11);
  cap.textColor = SUB;

  w.addSpacer(family === 'small' ? 7 : 9);
  const { over } = addPaceBar(w, data, family === 'small' ? 128 : 300, 8);
  w.addSpacer(5);

  const line = w.addStack();
  const spent = line.addText(`使った ${yen(data.expense)}`);
  spent.font = Font.systemFont(family === 'small' ? 10 : 12);
  spent.textColor = TEXT;
  spent.lineLimit = 1;
  spent.minimumScaleFactor = 0.6;
  if (family !== 'small' && perDay !== null) {
    line.addSpacer();
    const pd = line.addText(`1日あたり ${yen(perDay)}`);
    pd.font = Font.boldSystemFont(12);
    pd.textColor = over ? WARN : ACCENT;
    pd.lineLimit = 1;
  }
  if (family === 'small' && perDay !== null) {
    const pd = w.addText(`1日 ${yen(perDay)}`);
    pd.font = Font.boldSystemFont(11);
    pd.textColor = over ? WARN : ACCENT;
    pd.lineLimit = 1;
  }

  if (family === 'large') {
    w.addSpacer(10);
    const stats = w.addStack();
    addStat(stats, '収入', yen(data.income), 14);
    stats.addSpacer();
    addStat(stats, '支出', yen(data.expense), 14);
    stats.addSpacer();
    addStat(stats, '貯金', yen(data.savings), 14);
    if (data.goals.length) {
      w.addSpacer(10);
      const h = w.addText('目標');
      h.font = Font.boldSystemFont(12);
      h.textColor = ACCENT;
      w.addSpacer(3);
      for (const g of data.goals) {
        const row = w.addStack();
        row.centerAlignContent();
        const n = row.addText(g.title);
        n.font = Font.systemFont(13);
        n.textColor = TEXT;
        n.lineLimit = 1;
        row.addSpacer();
        const r = row.addText(g.reachable ? '届きそう' : `あと${yen(g.short)}`);
        r.font = Font.boldSystemFont(12);
        r.textColor = g.reachable ? ACCENT : SUB;
        r.lineLimit = 1;
        w.addSpacer(3);
      }
    }
  }

  w.addSpacer();
  const foot = w.addStack();
  if (data.pending) {
    const p = foot.addText('アプリを開いて更新');
    p.font = Font.systemFont(10);
    p.textColor = WARN;
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
    const data = await loadMoney(key);
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
  menu.title = 'KESELA ウィジェット（今月のお金）';
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
      : `${data.month}\n収入 ${yen(data.income)}\n支出 ${yen(data.expense)}\n貯金 ${yen(data.savings)}\n` +
        `使えるお金 ${data.free === null ? '（貯金目標が未設定）' : yen(data.free)}` +
        (data.pending ? `\n※ 固定費 ${data.pending}件が未反映（アプリを開くと入ります）` : '');
    a.addAction('OK');
    await a.presentAlert();
  } else if (pick === 4) {
    await askKey();
  }
}
Script.complete();
