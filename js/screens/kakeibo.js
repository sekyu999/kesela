// 家計タブ：上のセグメントで「今月（実績）」「カレンダー」「予定（買いたい物・やりたい事）」を切り替える
//
// ・今月  … かんたん入力と、今月のお金の様子（収入・支出・貯金・使えるお金・何に使ったか）
// ・カレンダー … 日ごとの支出と、日付ごとにまとめた記録
// ・予定  … 今までの「家計」（js/screens/budget.js）。見込み・計画のまま
import { watch } from '../ui/live.js';
import { toast } from '../ui/toast.js';
import { listByMonth, monthlySavings } from '../data/transactionRepo.js';
import { listExpenseCategories } from '../data/expenseCategoryRepo.js';
import { listFixedCosts, generateFixedRows } from '../data/fixedCostRepo.js';
import { listBudgets } from '../data/budgetRepo.js';
import { getMeta, META } from '../data/metaRepo.js';
import { summarize, resolveBudget, byCategory, donutSlices, monthOf } from '../domain/kakeibo.js';
import { thisMonth, addMonths } from '../domain/plans.js';
import { weekDays, weekStart } from '../ui/weekStart.js';
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

/** 下のタブで「家計」をもう一度押した時は、いちばん左のセグメントに戻す */
export function resetSegment() {
  segment = SEGMENTS[0].key;
  viewMonth = thisMonth();
}

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

  // 固定費を記録に起こす（足した直後・月が変わった時に入る。何度呼んでも増えない）
  generateFixedRows().catch((e) => console.error(e));

  show();
  return () => stop?.();
}

// ===================== 月の切り替え =====================

function monthNavHtml(month) {
  const now = thisMonth();
  return `<div class="month-nav">
    <button type="button" class="icon-btn" data-move="-1" aria-label="${t('前の月')}">‹</button>
    <strong class="month-nav-label">${monthText(month, month === now ? now : null)}</strong>
    <button type="button" class="icon-btn" data-move="1" aria-label="${t('次の月')}">›</button>
    ${month !== now ? `<button type="button" class="btn btn-small" data-move="now">${t('今月')}</button>` : ''}
  </div>`;
}

/**
 * 月を切り替える処理。
 * 月が変わったら読み直す（読み直さないと、前の月の記録を今の月のカレンダーに描いてしまう）
 */
function bindMonthNav(el, onChange) {
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move]');
    if (!btn) return;
    viewMonth = btn.dataset.move === 'now' ? thisMonth() : addMonths(viewMonth, Number(btn.dataset.move));
    onChange();
  });
}

// ===================== ① 今月 =====================

function mountMonth(el) {
  let state = null;
  let catKey = null; // カテゴリの一覧が変わった時だけ入力欄を作り直すための印
  let quick = null;
  let stop = null;

  el.innerHTML = `
    <div class="stack">
      <div data-nav></div>
      <section class="card kb-quick" data-quick></section>
      <div data-body class="stack"></div>
    </div>`;
  const navEl = el.querySelector('[data-nav]');
  const quickEl = el.querySelector('[data-quick]');
  const bodyEl = el.querySelector('[data-body]');

  bindMonthNav(navEl, () => subscribe());

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn?.dataset.action === 'settings') openKakeiboSettings(viewMonth);
  });

  function render() {
    if (!state) return;
    const { rows, categories, fixedCosts, budgets, savingsGoal } = state;
    navEl.innerHTML = monthNavHtml(viewMonth);

    // かんたん入力（カテゴリの一覧が変わった時だけ作り直す。書いている途中を消さないため）
    const nextKey = categories.map((c) => `${c.id}:${c.name}:${c.colorIndex}`).join('|');
    if (nextKey !== catKey) {
      catKey = nextKey;
      quick?.destroy();
      quickEl.innerHTML = quickFormHtml();
      quick = bindQuickForm(quickEl, categories);
    }

    const s = summarize(rows, { savingsGoal, budget: resolveBudget(budgets, viewMonth) });
    const cats = byCategory(rows, categories, fixedCosts);

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
      ${cats.length ? donutHtml(donutSlices(cats), s.expense) : ''}
      <button type="button" class="btn btn-block" data-action="settings">${t('予算・固定費・カテゴリ・貯金目標を設定')}</button>`;
  }

  /** その月のデータを読み直す（月を切り替えた時にも呼ぶ） */
  function subscribe() {
    stop?.();
    stop = watch(
      async () => ({
        rows: await listByMonth(viewMonth),
        categories: await listExpenseCategories(),
        fixedCosts: await listFixedCosts(),
        budgets: await listBudgets(),
        savingsGoal: (await getMeta(META.savingsGoal)) ?? 0,
      }),
      (s) => {
        state = s;
        render();
      }
    );
  }
  subscribe();

  return () => {
    quick?.destroy();
    stop?.();
  };
}

/** 「今月自由に使えるお金」。貯金目標・収入が未設定の時は案内を出す */
function freeHtml(s) {
  if (!s.hasIncome) {
    return `<p class="notice kb-notice">${t('今月の収入がまだ記録されていません。給与を「固定収入」として登録してください。')}</p>`;
  }
  if (s.free === null) {
    return `<p class="notice kb-notice">${t('貯金目標を決めると、今月自由に使えるお金が出せます。')}</p>`;
  }
  const total = Math.max(s.income, s.expense + s.savingsGoal, 1);
  const pct = (n) => `${(n / total) * 100}%`;
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

/** 何に使ったか：円グラフ（名前を輪の中に出す）と一覧 */
function donutHtml(slices, total) {
  // 半径 15.9155 の円は一周がちょうど 100。長さをそのまま割合（％）として使える
  const R = 15.9155;
  const ring = slices
    .map(
      (s) => `<circle class="kb-slice" cx="21" cy="21" r="${R}" fill="none" stroke="var(--swatch-${(s.colorIndex ?? 0) + 1})"
        stroke-width="10" stroke-dasharray="${s.length} ${100 - s.length}" stroke-dashoffset="${-s.offset}"></circle>`
    )
    .join('');
  // 輪の上に名前を置く（小さすぎる区切りは文字が入らないので出さない）
  const labels = slices
    .filter((s) => s.ratio >= 0.1)
    .map((s) => {
      const mid = ((s.offset + s.length / 2) / 100) * 2 * Math.PI - Math.PI / 2;
      const x = 21 + Math.cos(mid) * R;
      const y = 21 + Math.sin(mid) * R;
      return `<text class="kb-slice-label" x="${x.toFixed(2)}" y="${y.toFixed(2)}">${esc(s.name)}</text>`;
    })
    .join('');
  return `<section class="card">
    <h2 class="card-title">${t('何に使ったか')}</h2>
    <div class="kb-donut-wrap">
      <svg class="kb-donut" viewBox="0 0 42 42" role="img" aria-label="${esc(t('カテゴリ別の支出'))}">
        <g transform="rotate(-90 21 21)">
          <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--border)" stroke-width="10"></circle>
          ${ring}
        </g>
        ${labels}
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

// ===================== ② カレンダー =====================

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function mountCalendar(el) {
  let state = null;
  let stop = null;

  el.innerHTML = `<div class="stack"><div data-nav></div><div data-body></div></div>`;
  const navEl = el.querySelector('[data-nav]');
  const bodyEl = el.querySelector('[data-body]');

  bindMonthNav(navEl, () => subscribe());

  el.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day]');
    if (day) {
      openTransactionSheet(null, { date: day.dataset.day });
      return;
    }
    const btn = e.target.closest('[data-action="edit"]');
    if (btn) openTransactionSheet(btn.dataset.id);
  });

  function render() {
    if (!state) return;
    const { rows, categories, fixedCosts } = state;
    navEl.innerHTML = monthNavHtml(viewMonth);

    const [y, m] = viewMonth.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const start = weekStart();
    const firstDow = (new Date(y, m - 1, 1).getDay() - start + 7) % 7;
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
      cells.push(`<li class="kb-cal-cell ${date === today ? 'is-today' : ''}">
        <button type="button" data-day="${date}" aria-label="${esc(t('{date}に記録する', { date }))}">
          <span class="kb-cal-d">${d}</span>
          ${v?.expense ? `<span class="kb-cal-sum" style="--heat:${Math.round((v.expense / max) * 100)}%">${money(v.expense)}</span>` : ''}
          ${v?.income ? '<span class="kb-cal-in" aria-hidden="true"></span>' : ''}
        </button>
      </li>`);
    }

    bodyEl.innerHTML = `
      <ul class="kb-cal-dow" aria-hidden="true">${weekDays(DOW).map((d) => `<li>${t(d)}</li>`).join('')}</ul>
      <ul class="kb-cal">${cells.join('')}</ul>
      ${dayListHtml(rows, categories, fixedCosts)}`;
  }

  function subscribe() {
    stop?.();
    stop = watch(
      async () => ({
        rows: await listByMonth(viewMonth),
        categories: await listExpenseCategories(),
        fixedCosts: await listFixedCosts(),
      }),
      (s) => {
        state = s;
        render();
      }
    );
  }
  subscribe();

  return () => stop?.();
}

/** 記録を日付ごとにまとめた一覧（色の丸とメモだけ。カテゴリ名は丸の色で表す） */
function dayListHtml(rows, categories, fixedCosts) {
  if (!rows.length) return `<div class="placeholder">${t('この月の記録はまだありません。')}</div>`;
  const catById = new Map(categories.map((c) => [c.id, c]));
  const fxById = new Map(fixedCosts.map((f) => [f.id, f]));
  const days = new Map();
  for (const r of rows) {
    if (!days.has(r.date)) days.set(r.date, []);
    days.get(r.date).push(r);
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => {
      const total = list.reduce((s, r) => s + (r.type === 'expense' ? Number(r.amount) || 0 : 0), 0);
      return `<section class="kb-day">
        <h3 class="section-title kb-day-head"><span>${dateShort(date)}</span><span>${money(total)}</span></h3>
        <ul class="list compact-list">${list.map((r) => dayRowHtml(r, catById, fxById)).join('')}</ul>
      </section>`;
    })
    .join('');
}

function dayRowHtml(r, catById, fxById) {
  const fx = r.fixedCostId ? fxById.get(r.fixedCostId) : null;
  const src = fx ?? catById.get(r.categoryId);
  const name = fx?.name ?? catById.get(r.categoryId)?.name ?? t('未分類');
  return `<li class="kb-row ${r.type === 'income' ? 'is-income' : ''}">
    <button type="button" class="row-button" data-action="edit" data-id="${r.id}">
      <span class="kb-dot" style="background:var(--swatch-${(src?.colorIndex ?? 0) + 1})" aria-hidden="true"></span>
      <span class="grow kb-name">${r.memo ? esc(r.memo) : `<span class="kb-memo">${esc(name)}</span>`}<span class="visually-hidden">${esc(name)}</span></span>
      <span class="kb-amount">${r.type === 'income' ? '+' : ''}${money(r.amount)}</span>
    </button>
  </li>`;
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
