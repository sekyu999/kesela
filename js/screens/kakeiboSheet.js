// 家計簿：記録（収入・支出）の入力
//   ・かんたん入力（quickFormHtml / bindQuickForm）… 家計タブの上に常に出ている。金額・カテゴリ・メモだけ
//   ・記録を直すシート（openTransactionSheet）… 一覧の行をタップした時。日付も変えられる
import { openSheet } from '../ui/sheet.js';
import { showErrors, bindErrorClear } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { calcFieldHtml, bindCalcField } from '../ui/calcPad.js';
import { listExpenseCategories } from '../data/expenseCategoryRepo.js';
import { getTransaction, saveTransaction, deleteTransaction, restoreTransaction } from '../data/transactionRepo.js';
import { ValidationError } from '../data/productRepo.js';
import { todayLocal, esc } from '../lib/util.js';
import { t, dateLong, dateShort } from '../lib/i18n.js';

/** 日付を n 日ずらす */
function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** カテゴリのチップ（色つき） */
function chipsHtml(list, selected) {
  return list
    .map(
      (c) => `<button type="button" class="chip-cat" role="radio" data-cat="${c.id}"
        aria-checked="${String(c.id === selected)}" style="--swatch: var(--swatch-${(c.colorIndex ?? 0) + 1})">
        <span class="chip-dot" aria-hidden="true"></span>${esc(c.name)}</button>`
    )
    .join('');
}

// ===================== かんたん入力（常に表示） =====================

/**
 * 家計タブの上に出す入力欄の HTML。
 * ボタンを押してシートを開かなくても、そのまま記録できるようにするためのもの。
 * 収入は固定収入（設定の「固定費・固定収入」）だけで入るので、ここは支出のみ。
 */
export function quickFormHtml() {
  return `
    <form novalidate class="quick-form">
      ${calcFieldHtml({ name: 'amount', value: '', compact: true })}
      <div class="chip-grid" role="radiogroup" aria-label="${t('カテゴリ')}" data-cats></div>
      <p class="field-error" data-error-for="categoryId"></p>
      <input type="hidden" name="categoryId" value="">
      <div class="row quick-row">
        <input name="date" class="input quick-date" type="date" value="" aria-label="${t('日付')}">
        <input name="memo" class="input grow" maxlength="200" autocomplete="off" enterkeyhint="done"
               aria-label="${t('メモ')}" placeholder="${t('メモ（任意）')}">
      </div>
      <p class="field-error" data-error-for="date"></p>
      <button type="submit" class="btn btn-primary btn-block quick-save">${t('記録する')}</button>
    </form>`;
}

/**
 * かんたん入力を動くようにする
 * @param {HTMLElement} root quickFormHtml を入れた要素
 * @param {Array} categories 家計簿のカテゴリ
 * @returns {{ destroy: () => void }}
 */
export function bindQuickForm(root, categories) {
  const form = root.querySelector('form');
  bindErrorClear(form);
  const pad = bindCalcField(root, 'amount');
  const catInput = form.elements.namedItem('categoryId');
  const memoInput = form.elements.namedItem('memo');
  const dateInput = form.elements.namedItem('date');
  const catsEl = form.querySelector('[data-cats]');

  dateInput.value = todayLocal();
  // 並べ替えはしない（設定で並べた順のまま出す）
  catsEl.innerHTML = chipsHtml(categories.filter((c) => c.type === 'expense'), '');

  form.addEventListener('click', (e) => {
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      catInput.value = cat.dataset.cat;
      catsEl.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-checked', String(b === cat)));
      form.querySelector('[data-error-for="categoryId"]').textContent = '';
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) dateInput.value = shiftDate(todayLocal(), Number(day.dataset.day));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveTransaction(null, {
        type: 'expense',
        amount: pad.value,
        categoryId: catInput?.value ?? row?.categoryId ?? null,
        date: dateInput.value,
        memo: memoInput.value,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        showErrors(form, err.errors);
        return;
      }
      throw err;
    }
    // 金額とメモだけ空にする（カテゴリと日付は続けて使うことが多いので残す）
    pad.reset('');
    memoInput.value = '';
    toast(t('記録しました'));
  });

  return { destroy() {} };
}

// ===================== 記録を直すシート =====================

/**
 * @param {string|null} id 直す記録の ID（新規は null）
 * @param {{ date?:string, type?:string, amount?:string, categoryId?:string, memo?:string }} [defaults]
 */
export async function openTransactionSheet(id = null, defaults = {}) {
  const row = id ? await getTransaction(id) : null;
  const categories = await listExpenseCategories();
  const v = row ?? {
    type: 'expense',
    amount: defaults.amount ?? '',
    date: defaults.date || todayLocal(),
    categoryId: defaults.categoryId ?? '',
    memo: defaults.memo ?? '',
  };
  const fixed = row?.source === 'fixed';

  const sheet = openSheet({
    title: t(row ? '記録を直す' : '記録する'),
    body: `
      <form novalidate class="tx-form">
        ${fixed ? `<p class="notice">${t('固定費から自動で入った記録です。金額を直すとこの月だけ変わります。')}</p>` : ''}
        ${v.type === 'income' ? `<p class="sheet-lead">${t('収入')}</p>` : ''}
        <input type="hidden" name="type" value="${esc(v.type)}">
        ${calcFieldHtml({ name: 'amount', label: t('金額'), value: v.amount === '' ? '' : String(v.amount) })}
        ${
          v.type === 'income'
            ? ''
            : `<div class="field">
          <label id="cat-label">${t('カテゴリ')}</label>
          <div class="chip-grid" role="radiogroup" aria-labelledby="cat-label" data-cats></div>
          <input type="hidden" name="categoryId" value="${esc(v.categoryId ?? '')}">
          <p class="field-error" data-error-for="categoryId"></p>
        </div>`
        }
        <div class="field">
          <label for="f-memo">${t('メモ')} <span class="optional">${t('任意')}</span></label>
          <input id="f-memo" name="memo" class="input" maxlength="200" value="${esc(v.memo ?? '')}" autocomplete="off">
          <p class="field-error" data-error-for="memo"></p>
        </div>
        <div class="field">
          <label for="f-date">${t('日付')}</label>
          <div class="row date-row">
            <input id="f-date" name="date" class="input grow" type="date" value="${esc(v.date)}">
            <button type="button" class="btn btn-small" data-day="0">${t('今日')}</button>
            <button type="button" class="btn btn-small" data-day="-1">${t('昨日')}</button>
          </div>
          <p class="field-error" data-error-for="date"></p>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block">${t('保存')}</button>
          ${
            row
              ? `<button type="button" class="btn-danger-text" data-delete>${t('削除')}</button>`
              : `<button type="button" class="btn btn-block" data-again>${t('保存して続けて入力')}</button>`
          }
        </div>
      </form>`,
  });

  const form = sheet.el.querySelector('form');
  bindErrorClear(form);
  const pad = bindCalcField(sheet.el, 'amount');
  const typeInput = form.elements.namedItem('type');
  const catInput = form.elements.namedItem('categoryId');
  const dateInput = form.elements.namedItem('date');
  // 収入（固定収入から入った記録）はカテゴリを持たない
  const catsEl = form.querySelector('[data-cats]');

  // 並べ替えはしない（設定で並べた順のまま出す）
  if (catsEl) catsEl.innerHTML = chipsHtml(categories.filter((c) => c.type === typeInput.value), catInput?.value ?? '');

  form.addEventListener('click', (e) => {
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      catInput.value = cat.dataset.cat;
      catsEl.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-checked', String(b === cat)));
      form.querySelector('[data-error-for="categoryId"]').textContent = '';
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) dateInput.value = shiftDate(todayLocal(), Number(day.dataset.day));
  });

  async function submit(keepOpen) {
    try {
      await saveTransaction(row?.id ?? null, {
        type: typeInput.value,
        amount: pad.value,
        categoryId: catInput?.value ?? row?.categoryId ?? null,
        date: dateInput.value,
        memo: form.elements.namedItem('memo').value,
      });
    } catch (err) {
      if (err instanceof ValidationError) {
        showErrors(form, err.errors);
        return;
      }
      throw err;
    }
    if (keepOpen) {
      pad.reset('');
      form.elements.namedItem('memo').value = '';
      pad.focus();
      toast(t('記録しました'));
      return;
    }
    sheet.close();
    toast(t('保存しました'));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(false);
  });
  form.querySelector('[data-again]')?.addEventListener('click', () => submit(true));

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!window.confirm(t('この記録（{date}）を削除しますか？', { date: dateLong(row.date) }))) return;
    await deleteTransaction(row.id);
    sheet.close();
    toast(t('削除しました'), { actions: [{ label: t('元に戻す'), onClick: () => restoreTransaction(row) }] });
  });

  return sheet;
}
