// 家計簿：記録（収入・支出）の入力シート
// レシートを見ながら素早く入れられるよう、金額 → カテゴリ → 日付 の順に並べ、
// 金額は電卓テンキー、カテゴリは大きなチップ（よく使う順）にする。
import { openSheet } from '../ui/sheet.js';
import { showErrors, bindErrorClear } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { calcFieldHtml, bindCalcField } from '../ui/calcPad.js';
import { listExpenseCategories } from '../data/expenseCategoryRepo.js';
import { getTransaction, saveTransaction, deleteTransaction, restoreTransaction, recentCategoryUse } from '../data/transactionRepo.js';
import { listStores } from '../data/storeRepo.js';
import { ValidationError } from '../data/productRepo.js';
import { todayLocal, esc } from '../lib/util.js';
import { t, dateLong } from '../lib/i18n.js';

const KINDS = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '収入' },
];

/** 日付を n 日前にずらす */
function shiftDate(ymd, days) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 記録の追加・編集シート
 * @param {string|null} id 編集する記録の ID（新規は null）
 * @param {{ date?: string, type?: string }} [defaults]
 */
export async function openTransactionSheet(id = null, defaults = {}) {
  const row = id ? await getTransaction(id) : null;
  const [categories, stores] = await Promise.all([listExpenseCategories(), listStores()]);
  const v = row ?? {
    type: defaults.type === 'income' ? 'income' : 'expense',
    amount: '',
    date: defaults.date || todayLocal(),
    categoryId: '',
    memo: '',
    storeId: null,
  };
  const fixed = row?.source === 'fixed';

  const sheet = openSheet({
    title: t(row ? '記録を直す' : '記録する'),
    body: `
      <form novalidate class="tx-form">
        ${
          fixed
            ? `<p class="notice">${t('固定費から自動で入った記録です。金額を直すとこの月だけ変わります。')}</p>`
            : ''
        }
        <div class="segmented tx-kind" role="tablist">
          ${KINDS.map(
            (k) =>
              `<button type="button" role="tab" data-kind="${k.key}" aria-selected="${String(v.type === k.key)}">${t(k.label)}</button>`
          ).join('')}
        </div>
        <input type="hidden" name="type" value="${esc(v.type)}">
        ${calcFieldHtml({ name: 'amount', label: t('金額'), value: v.amount === '' ? '' : String(v.amount) })}
        <div class="field">
          <label id="cat-label">${t('カテゴリ')}</label>
          <div class="chip-grid" role="radiogroup" aria-labelledby="cat-label" data-cats></div>
          <input type="hidden" name="categoryId" value="${esc(v.categoryId ?? '')}">
          <p class="field-error" data-error-for="categoryId"></p>
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
        <details class="more-nutri">
          <summary>${t('お店・メモ')} <span class="optional">${t('任意')}</span></summary>
          <div class="field">
            <label for="f-store">${t('お店')}</label>
            <select id="f-store" name="storeId" class="select">
              <option value="">${t('指定なし')}</option>
              ${stores.map((s) => `<option value="${s.id}" ${s.id === v.storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="f-memo">${t('メモ')}</label>
            <textarea id="f-memo" name="memo" class="input memo-input" rows="2" maxlength="200">${esc(v.memo ?? '')}</textarea>
            <p class="field-error" data-error-for="memo"></p>
          </div>
        </details>
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
  const catsEl = form.querySelector('[data-cats]');

  /** 種類に合わせてカテゴリのチップを並べ直す（よく使う順） */
  async function paintCats() {
    const type = typeInput.value;
    const use = await recentCategoryUse(type);
    const list = categories
      .filter((c) => c.type === type)
      .sort((a, b) => (use.get(b.id) ?? 0) - (use.get(a.id) ?? 0) || a.defaultOrder - b.defaultOrder);
    if (!list.some((c) => c.id === catInput.value)) catInput.value = '';
    catsEl.innerHTML = list
      .map(
        (c) => `<button type="button" class="chip-cat" role="radio" data-cat="${c.id}"
          aria-checked="${String(c.id === catInput.value)}" style="--swatch: var(--swatch-${(c.colorIndex ?? 0) + 1})">
          <span class="chip-dot" aria-hidden="true"></span>${esc(c.name)}</button>`
      )
      .join('');
  }
  await paintCats();

  form.addEventListener('click', async (e) => {
    const kind = e.target.closest('[data-kind]');
    if (kind) {
      typeInput.value = kind.dataset.kind;
      form.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-selected', String(b === kind)));
      await paintCats();
      return;
    }
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      catInput.value = cat.dataset.cat;
      catsEl.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-checked', String(b === cat)));
      form.querySelector('[data-error-for="categoryId"]').textContent = '';
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) {
      dateInput.value = shiftDate(todayLocal(), Number(day.dataset.day));
      return;
    }
  });

  async function submit(keepOpen) {
    const raw = {
      type: typeInput.value,
      amount: pad.value,
      categoryId: catInput.value,
      date: dateInput.value,
      memo: form.elements.namedItem('memo').value,
      storeId: form.elements.namedItem('storeId').value,
    };
    try {
      await saveTransaction(row?.id ?? null, raw);
    } catch (err) {
      if (err instanceof ValidationError) {
        showErrors(form, err.errors);
        return;
      }
      throw err;
    }
    if (keepOpen) {
      // 日付とカテゴリは残して金額だけ空にする（レシートを続けて入れるため）
      pad.reset('');
      pad.focus();
      toast(t('保存しました'));
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
