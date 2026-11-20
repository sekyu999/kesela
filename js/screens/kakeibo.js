// 家計タブ：上のセグメントで「今月（実績）」「カレンダー」「予定（買いたい物・やりたい事）」を切り替える
//
// ・今月  … 実際に発生した収入・支出の集計。家計簿の中心
// ・カレンダー … 日ごとの支出
// ・予定  … 今までの「家計」（js/screens/budget.js）。見込み・計画のまま
import { watch } from '../ui/live.js';
import { toast } from '../ui/toast.js';
import { listByMonth, monthlySavings } from '../data/transactionRepo.js';
import { listExpenseCategories } from '../data/expenseCategoryRepo.js';
import { listBudgets } from '../data/budgetRepo.js';
import { generateFixedRows } from '../data/fixedCostRepo.js';
import { getMeta, META } from '../data/metaRepo.js';
import { summarize, resolveBudget, byCategory, donutSlices, monthOf } from '../domain/kakeibo.js';
import { thisMonth, addMonths } from '../domain/plans.js';
import * as budget from './budget.js';
import { openTransactionSheet, quickFormHtml, bindQuickForm } from './kakeiboSheet.js';
import { openKakeiboSettings } from './kakeiboSettings.js';
import { todayLocal, esc } from '../lib/util.js';
import { t, money, monthText, dateShort } from '../lib/i18n.js';

export const title = '家計';

const SEGMENTS = [
  { key: 'month', label: '今月' },
  { key: 'calendar', label: 'カレンダー' },
  { key: 'plans', label: '予定' },
];

/** 画面を離れても覚えておく */
let segment = 'month';
let viewMonth = null;
let showAll = false;

export function mount(el) {
  viewMonth ??= thisMonth();
  el.innerHTML = `
    <div class="segmented kakeibo-seg" role="tablist">
      ${SEGMENTS.map(
        (s) => `<button type="button" role="tab" data-seg="${s.key}" aria-selected="${String(s.key === segment)}">${t(s.label)}</button>`
      ).join('')}
    </div>
    <div class="kakeibo-view"></div>`;
  const view = el.querySelector('.kakeibo-view');
  let stop = null;

  function show() {
    stop?.();
    el.querySelectorAll('[data-seg]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.seg === segment)));
    const box = document.createElement('div');
    view.replaceChildren(box);
    stop = (segment === 'plans' ? budget.mount(box) : segment === 'calendar' ? mountCalendar(box) : mountMonth(box)) ?? null;
  }

  el.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-seg]');
    if (!seg || seg.dataset.seg === segment) return;
    segment = seg.dataset.seg;
    show();
  });

  // 固定費を記録に起こす（月が変わった時だけ動く。何度呼んでも増えない）
  generateFixedRows()
    .then((n) => n && toast(t('固定費 {n}件を今月の記録に入れました', { n })))
    .catch((e) => console.error(e));

  show();
  return () => stop?.();
}

/** 月を切り替える部分 */
function monthNavHtml(month) {
  const now = thisMonth();
  return `<div class="month-nav">
    <button type="button" class="icon-btn" data-move="-1" aria-label="${t('前の月')}">‹</button>
    <strong class="month-nav-label">${monthText(month, month === now ? now : null)}</strong>
    <button type="button" class="icon-btn" data-move="1" aria-label="${t('次の月')}">›</button>
    ${month !== now ? `<button type="button" class="btn btn-small" data-move="now">${t('今月')}</button>` : ''}
  </div>`;
}

function bindMonthNav(el, redraw) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move]');
    if (!btn) return;
    viewMonth = btn.dataset.move === 'now' ? thisMonth() : addMonths(viewMonth, Number(btn.dataset.move));
    showAll = false;
    redraw();
  });
}

/** ① 今月：かんたん入力・収入・支出・貯金額・使えるお金・カテゴリ別・明細 */
function mountMonth(el) {
  let state = null;
  let catKey = null; // カテゴリの一覧が変わった時だけ入力欄を作り直すための印

  el.innerHTML = `
    <div class="stack">
      <div data-nav></div>
      <section class="card kb-quick" data-quick></section>
      <div data-body class="stack"></div>
    </div>`;
  const navEl = el.querySelector('[data-nav]');
  const quickEl = el.querySelector('[data-quick]');
  const bodyEl = el.querySelector('[data-body]');
  let quick = null;
  bindMonthNav(navEl, () => render());

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'edit':
        openTransactionSheet(btn.dataset.id);
        break;
      case 'all':
        showAll = true;
        render();
        break;
      case 'settings':
        openKakeiboSettings(viewMonth);
        break;
    }
  });

  function render() {
    if (!state) return;
    const { rows, categories, budgets, savingsGoal } = state;

    // 月の切り替え（中身だけ描き直す。処理は上で1回だけ付けてある）
    navEl.innerHTML = monthNavHtml(viewMonth);

    // かんたん入力（カテゴリの一覧が変わった時だけ作り直す。書いている途中を消さないため）
    const nextKey = categories.map((c) => `${c.id}:${c.name}:${c.colorIndex}:${c.type}`).join('|');
    if (nextKey !== catKey) {
      catKey = nextKey;
      quick?.destroy();
      quickEl.innerHTML = quickFormHtml(categories);
      quick = bindQuickForm(quickEl, categories);
    }

    const monthBudget = resolveBudget(budgets, viewMonth);
    const s = summarize(rows, { savingsGoal, budget: monthBudget });
    const cats = byCategory(rows, categories);
    const slices = donutSlices(cats);
    const shown = showAll ? rows : rows.slice(0, 10);

    bodyEl.innerHTML = `
      <section class="card">
        <ul class="kb-stats">
          <li><span>${t('収入')}</span><strong>${money(s.income)}</strong></li>
          <li><span>${t('支出')}</span><strong>${money(s.expense)}</strong></li>
          <li class="${s.savings < 0 ? 'is-minus' : ''}"><span>${t('貯金額')}</span><strong>${money(s.savings)}</strong></li>
        </ul>
        ${freeHtml(s)}
      </section>
      ${budgetHtml(s)}
      ${cats.length ? donutHtml(slices, s.expense) : ''}
      <section>
        <h2 class="section-title">${t('記録')}<span>${t('{n}件', { n: rows.length })}</span></h2>
        ${
          rows.length
            ? `<ul class="list compact-list">${shown.map((r) => rowHtml(r, categories)).join('')}</ul>
               ${!showAll && rows.length > shown.length ? `<button type="button" class="btn btn-block" data-action="all">${t('すべて見る')}</button>` : ''}`
            : `<div class="placeholder">${t('上の欄に金額を入れて「記録する」を押すと、ここに並びます。')}</div>`
        }
      </section>
      <button type="button" class="btn btn-block" data-action="settings">${t('予算・固定費・カテゴリ・貯金目標を設定')}</button>`;
  }

  const stop = watch(
    async () => ({
      rows: await listByMonth(viewMonth),
      categories: await listExpenseCategories(),
      budgets: await listBudgets(),
      savingsGoal: (await getMeta(META.savingsGoal)) ?? 0,
    }),
    (s) => {
      state = s;
      render();
    }
  );
  return () => {
    quick?.destroy();
    stop();
  };
}

/** 「今月自由に使えるお金」。貯金目標・収入が未設定の時は案内を出す */
function freeHtml(s) {
  if (!s.hasIncome) {
    return `<p class="notice kb-notice">${t('今月の収入がまだ記録されていません。給与を「固定収入」として登録すると、月初から使えるお金が分かります。')}</p>`;
  }
  if (s.free === null) {
    return `<p class="notice kb-notice">${t('貯金目標を決めると、今月自由に使えるお金が出せます。')}</p>`;
  }
  const used = s.expense + s.savingsGoal;
  const total = Math.max(s.income, used);
  const pct = (n) => `${total ? (n / total) * 100 : 0}%`;
  return `<div class="kb-free ${s.free < 0 ? 'is-over' : ''}">
    <div class="kb-free-head"><span>${t('今月自由に使えるお金')}</span><strong>${money(s.free)}</strong></div>
    <div class="kb-bar" role="img" aria-label="${esc(t('収入{income}、支出{expense}、貯金目標{goal}', { income: money(s.income), expense: money(s.expense), goal: money(s.savingsGoal) }))}">
      <span class="kb-bar-used" style="width:${pct(s.expense)}"></span>
      <span class="kb-bar-goal" style="width:${pct(s.savingsGoal)}"></span>
    </div>
    <p class="kb-free-note">${t('収入 {income} − 使った {expense} − 貯金目標 {goal}', {
      income: money(s.income),
      expense: money(s.expense),
      goal: money(s.savingsGoal),
    })}</p>
  </div>`;
}

/** 予算の残り（設定している時だけ） */
function budgetHtml(s) {
  if (s.budget == null) return '';
  const pct = Math.min(100, s.budget ? (s.expense / s.budget) * 100 : 0);
  const over = s.budgetLeft < 0;
  return `<section class="card">
    <div class="kb-free-head"><span>${t('予算の残り')}</span><strong class="${over ? 'is-minus' : ''}">${money(s.budgetLeft)}</strong></div>
    <div class="kb-bar"><span class="kb-bar-used ${over ? 'is-over' : ''}" style="width:${pct}%"></span></div>
    <p class="kb-free-note">${t('月予算 {budget}（固定費 {fixed} を含む）', { budget: money(s.budget), fixed: money(s.fixed) })}</p>
  </section>`;
}

/** カテゴリ別の円グラフ（ドーナツ）と一覧 */
function donutHtml(slices, total) {
  // 半径 15.9155 の円は一周がちょうど 100。長さをそのまま割合（％）として使える
  const ring = slices
    .map(
      (s) => `<circle class="kb-slice" cx="21" cy="21" r="15.9155" fill="none" stroke="var(--swatch-${(s.colorIndex ?? 0) + 1})"
        stroke-width="7" stroke-dasharray="${s.length} ${100 - s.length}" stroke-dashoffset="${-s.offset}"></circle>`
    )
    .join('');
  return `<section class="card">
    <h2 class="card-title">${t('何に使ったか')}</h2>
    <div class="kb-donut-wrap">
      <svg class="kb-donut" viewBox="0 0 42 42" role="img" aria-label="${esc(t('カテゴリ別の支出'))}">
        <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--border)" stroke-width="7"></circle>
        ${ring}
      </svg>
      <ul class="kb-legend">
        ${slices
          .map(
            (s) => `<li><span class="kb-dot" style="background:var(--swatch-${(s.colorIndex ?? 0) + 1})"></span>
              <span class="grow">${esc(s.name)}</span>
              <span class="kb-legend-pct">${Math.round(s.ratio * 100)}%</span>
              <strong>${money(s.amount)}</strong></li>`
          )
          .join('')}
      </ul>
    </div>
    <p class="kb-free-note">${t('支出の合計 {total}', { total: money(total) })}</p>
  </section>`;
}

/** 明細の1行 */
function rowHtml(r, categories) {
  const c = categories.find((x) => x.id === r.categoryId);
  return `<li class="kb-row ${r.type === 'income' ? 'is-income' : ''}">
    <button type="button" class="row-button" data-action="edit" data-id="${r.id}">
      <span class="kb-date">${dateShort(r.date)}</span>
      <span class="kb-dot" style="background:var(--swatch-${(c?.colorIndex ?? 0) + 1})" aria-hidden="true"></span>
      <span class="grow kb-name">${esc(c?.name ?? t('未分類'))}${r.memo ? `<span class="kb-memo">${esc(r.memo)}</span>` : ''}${
        r.source === 'fixed' ? `<span class="badge badge-muted">${t('固定')}</span>` : ''
      }</span>
      <span class="kb-amount">${r.type === 'income' ? '+' : ''}${money(r.amount)}</span>
    </button>
  </li>`;
}

/** ② カレンダー：日ごとの支出 */
function mountCalendar(el) {
  let state = null;

  el.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]');
    if (day) {
      openTransactionSheet(null, { date: day.dataset.day });
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (btn?.dataset.action === 'edit') openTransactionSheet(btn.dataset.id);
  });

  function render() {
    if (!state) return;
    const { rows, categories } = state;
    const [y, m] = viewMonth.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const firstDow = new Date(y, m - 1, 1).getDay();
    const perDay = new Map();
    for (const r of rows) {
      const d = Number(r.date.slice(8, 10));
      const cur = perDay.get(d) ?? { expense: 0, income: 0 };
      cur[r.type] += Number(r.amount) || 0;
      perDay.set(d, cur);
    }
    const max = Math.max(1, ...[...perDay.values()].map((v) => v.expense));
    const today = todayLocal();

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<li class="kb-cal-pad" aria-hidden="true"></li>');
    for (let d = 1; d <= last; d++) {
      const date = `${viewMonth}-${String(d).padStart(2, '0')}`;
      const v = perDay.get(d);
      const heat = v ? Math.round((v.expense / max) * 100) : 0;
      cells.push(`<li class="kb-cal-cell ${date === today ? 'is-today' : ''}">
        <button type="button" data-day="${date}" aria-label="${esc(t('{date}に記録する', { date }))}">
          <span class="kb-cal-d">${d}</span>
          ${v?.expense ? `<span class="kb-cal-sum" style="--heat:${heat}%">${money(v.expense)}</span>` : ''}
          ${v?.income ? `<span class="kb-cal-in" aria-hidden="true"></span>` : ''}
        </button>
      </li>`);
    }

    el.innerHTML = `
      <div class="stack">
        ${monthNavHtml(viewMonth)}
        <ul class="kb-cal-dow" aria-hidden="true">${['日', '月', '火', '水', '木', '金', '土'].map((d) => `<li>${t(d)}</li>`).join('')}</ul>
        <ul class="kb-cal">${cells.join('')}</ul>
        <section>
          <h2 class="section-title">${t('記録')}<span>${t('{n}件', { n: rows.length })}</span></h2>
          ${
            rows.length
              ? `<ul class="list compact-list">${rows.map((r) => rowHtml(r, categories)).join('')}</ul>`
              : `<div class="placeholder">${t('この月の記録はまだありません。')}</div>`
          }
        </section>
      </div>`;
    bindMonthNav(el.querySelector('.month-nav'), render);
  }

  return watch(
    async () => ({ rows: await listByMonth(viewMonth), categories: await listExpenseCategories() }),
    (s) => {
      state = s;
      render();
    }
  );
}

/** ほかの画面から「この月を見る」用 */
export function openMonth(month) {
  viewMonth = monthOf(`${month}-01`);
  segment = 'month';
}

/** 貯金ペースの計算に使う月の一覧（予定タブで使う） */
export async function recentSavings(months = 3) {
  const list = [];
  let m = thisMonth();
  for (let i = 0; i < months; i++) {
    list.push(m);
    m = addMonths(m, -1);
  }
  return monthlySavings(list);
}
