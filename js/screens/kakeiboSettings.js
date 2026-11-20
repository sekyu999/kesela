// 家計簿の設定：貯金目標・予算（月全体とカテゴリ別）・固定費
import { openSheet } from '../ui/sheet.js';
import { showErrors, bindErrorClear } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { calcFieldHtml, bindCalcField } from '../ui/calcPad.js';
import {
  listExpenseCategories,
  addExpenseCategory,
  updateExpenseCategory,
  deleteExpenseCategory,
  saveExpenseCategoryOrder,
  countTransactionsInCategory,
} from '../data/expenseCategoryRepo.js';
import { listBudgets, setBudget } from '../data/budgetRepo.js';
import {
  listFixedCosts,
  getFixedCost,
  saveFixedCost,
  deleteFixedCost,
  countGeneratedRows,
  applyToMonth,
  pastAmounts,
} from '../data/fixedCostRepo.js';
import { getMeta, setMeta, META } from '../data/metaRepo.js';
import { resolveBudget, validateBudgetAmount, PALETTE_SIZE } from '../domain/kakeibo.js';
import { averageAmount } from '../domain/fixedCost.js';
import { makeSortable, dragHandle } from '../ui/sortable.js';
import { colorPickerHtml } from '../ui/storeBadge.js';
import { thisMonth } from '../domain/plans.js';
import { ValidationError } from '../data/productRepo.js';
import { yearOptions, monthOptions } from '../ui/monthPick.js';
import { esc } from '../lib/util.js';
import { t, money, monthText } from '../lib/i18n.js';

/** 家計簿の設定シート */
export async function openKakeiboSettings(month = thisMonth()) {
  const sheet = openSheet({ title: t('家計簿の設定'), body: `<div class="stack" data-body></div>` });
  const body = sheet.el.querySelector('[data-body]');

  async function render() {
    const [categories, budgets, fixedCosts, goal] = await Promise.all([
      listExpenseCategories(),
      listBudgets(),
      listFixedCosts(),
      getMeta(META.savingsGoal),
    ]);
    const expenseCats = categories.filter((c) => c.type === 'expense');
    const amountInput = (name, value, placeholder) =>
      `<div class="row" style="align-items:center">
        <input name="${name}" class="input grow" inputmode="numeric" value="${value == null ? '' : value}"
               placeholder="${esc(placeholder)}" autocomplete="off">
        <span class="unit-suffix">${t('円')}</span>
      </div>`;

    body.innerHTML = `
      <form novalidate data-budget-form>
        <section>
          <h3 class="section-title">${t('貯金目標')}</h3>
          <p class="sheet-lead">${t('今月ためたい額。決めると「自由に使えるお金」が出せます。')}</p>
          <div class="field">${amountInput('savingsGoal', goal ?? '', t('例：50000'))}
            <p class="field-error" data-error-for="savingsGoal"></p></div>
        </section>
        <section style="margin-top:18px">
          <h3 class="section-title">${t('月予算')}</h3>
          <p class="sheet-lead">${t('固定費を含む、その月に使っていい総額。空欄なら予算を出しません。')}</p>
          <div class="field">
            <label>${t('毎月（既定）')}</label>
            ${amountInput('defaultBudget', budgets.find((b) => (b.month ?? null) === null && (b.categoryId ?? null) === null)?.amount ?? '', t('例：200000'))}
            <p class="field-error" data-error-for="defaultBudget"></p>
          </div>
          <div class="field">
            <label>${t('{month}だけ', { month: monthText(month, null) })}</label>
            ${amountInput('monthBudget', budgets.find((b) => b.month === month && (b.categoryId ?? null) === null)?.amount ?? '', t('空欄なら既定を使う'))}
            <p class="field-error" data-error-for="monthBudget"></p>
          </div>
        </section>
        <section style="margin-top:18px">
          <h3 class="section-title">${t('カテゴリ別の予算')}</h3>
          <p class="sheet-lead">${t('毎月の既定として保存します。空欄なら出しません。')}</p>
          ${expenseCats
            .map(
              (c) => `<div class="field kb-catbudget">
                <label for="f-cb-${c.id}"><span class="kb-dot" style="background:var(--swatch-${(c.colorIndex ?? 0) + 1})"></span>${esc(c.name)}</label>
                <div class="row" style="align-items:center">
                  <input id="f-cb-${c.id}" name="cat-${c.id}" class="input grow" inputmode="numeric"
                         value="${resolveBudget(budgets, month, c.id) ?? ''}" autocomplete="off">
                  <span class="unit-suffix">${t('円')}</span>
                </div>
              </div>`
            )
            .join('')}
          <p class="field-error" data-error-for="cats"></p>
        </section>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block">${t('保存')}</button>
        </div>
      </form>

      <section style="margin-top:8px">
        <h3 class="section-title">${t('カテゴリ')}</h3>
        <p class="sheet-lead">${t('名前と色を変えられます。≡ を押さえると並べ替えられます。')}</p>
        ${['expense', 'income']
          .map(
            (type) => `<h4 class="section-title sub">${t(type === 'expense' ? '支出' : '収入')}</h4>
            <ul class="list compact-list cat-list" data-cat-list="${type}">
              ${categories
                .filter((c) => c.type === type)
                .map(
                  (c) => `<li data-id="${c.id}">
                    ${dragHandle(esc(c.name))}
                    <button type="button" class="row-button" data-cat-edit="${c.id}">
                      <span class="kb-dot" style="background:var(--swatch-${(c.colorIndex ?? 0) + 1})"></span>
                      <span class="grow">${esc(c.name)}</span><span class="note">›</span>
                    </button>
                  </li>`
                )
                .join('')}
            </ul>
            <button type="button" class="btn btn-block btn-small" data-cat-add="${type}">${t(
              type === 'expense' ? '＋ 支出のカテゴリを追加' : '＋ 収入のカテゴリを追加'
            )}</button>`
          )
          .join('')}
      </section>

      <section style="margin-top:18px">
        <h3 class="section-title">${t('固定費・固定収入')}</h3>
        <p class="sheet-lead">${t('毎月決まって出入りするお金。月の初めに1か月分がまとめて記録に入ります。金額が変わる物は平均額を入れてください。')}</p>
        ${
          fixedCosts.length
            ? `<ul class="list compact-list">${fixedCosts
                .map(
                  (f) => `<li class="kb-row">
                    <button type="button" class="row-button" data-fixed="${f.id}">
                      <span class="grow kb-name">${esc(f.name)}${f.endMonth ? `<span class="badge badge-muted">${t('終了')}</span>` : ''}
                        <span class="kb-memo">${f.dayOfMonth ? t('毎月{d}日', { d: f.dayOfMonth }) : t('月初')}</span></span>
                      <span class="kb-amount">${f.type === 'income' ? '+' : ''}${money(f.amount)}</span>
                    </button>
                  </li>`
                )
                .join('')}</ul>`
            : `<div class="placeholder">${t('まだ登録がありません。')}</div>`
        }
        <button type="button" class="btn btn-block" data-add-fixed>${t('＋ 固定費・固定収入を追加')}</button>
      </section>`;

    const form = body.querySelector('[data-budget-form]');
    bindErrorClear(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errors = {};
      const read = (name, key) => {
        const r = validateBudgetAmount(form.elements.namedItem(name).value);
        if (!r.ok) errors[key] = r.error;
        return r.ok ? r.value : null;
      };
      const goalValue = read('savingsGoal', 'savingsGoal');
      const def = read('defaultBudget', 'defaultBudget');
      const mon = read('monthBudget', 'monthBudget');
      const catValues = expenseCats.map((c) => {
        const r = validateBudgetAmount(form.elements.namedItem(`cat-${c.id}`).value);
        if (!r.ok) errors.cats = r.error;
        return [c.id, r.ok ? r.value : null];
      });
      if (Object.keys(errors).length) {
        showErrors(form, errors);
        return;
      }
      await setMeta(META.savingsGoal, goalValue ?? 0);
      await setBudget(null, null, def);
      await setBudget(month, null, mon);
      for (const [id, v] of catValues) await setBudget(null, id, v);
      toast(t('保存しました'));
      render();
    });

    // カテゴリの追加・編集・並べ替え
    body.querySelectorAll('[data-cat-add]').forEach((b) =>
      b.addEventListener('click', async () => {
        const name = window.prompt(t('カテゴリ名'));
        if (!name?.trim()) return;
        try {
          await addExpenseCategory(name, b.dataset.catAdd);
          render();
        } catch (err) {
          toast(t(err?.errors?.name ?? '追加できませんでした'));
        }
      })
    );
    body.querySelectorAll('[data-cat-edit]').forEach((b) =>
      b.addEventListener('click', () => openCategorySheet(b.dataset.catEdit, render))
    );
    body.querySelectorAll('[data-cat-list]').forEach((ul) =>
      makeSortable(ul, {
        onSort: async (ids) => {
          // 支出・収入それぞれの並びをつなげて保存する
          const all = [...body.querySelectorAll('[data-cat-list]')].flatMap((x) =>
            x === ul ? ids : [...x.children].map((li) => li.dataset.id)
          );
          await saveExpenseCategoryOrder(all.filter(Boolean));
        },
      })
    );

    body.querySelector('[data-add-fixed]').addEventListener('click', () => openFixedCostSheet(null, month, render));
    body.querySelectorAll('[data-fixed]').forEach((b) =>
      b.addEventListener('click', () => openFixedCostSheet(b.dataset.fixed, month, render))
    );
  }

  await render();
  return sheet;
}

const KINDS = [
  { key: 'expense', label: '固定費（支出）' },
  { key: 'income', label: '固定収入' },
];

/** 固定費の追加・編集シート */
export async function openFixedCostSheet(id, month, onSaved) {
  const [fc, categories] = await Promise.all([id ? getFixedCost(id) : null, listExpenseCategories()]);
  const made = id ? await countGeneratedRows(id) : 0;
  const v = fc ?? {
    type: 'expense',
    name: '',
    amount: '',
    categoryId: '',
    dayOfMonth: '',
    startMonth: thisMonth(),
    endMonth: null,
    memo: '',
  };

  const sheet = openSheet({
    title: t(fc ? '固定費を直す' : '固定費を追加'),
    body: `
      <form novalidate>
        <div class="segmented tx-kind" role="tablist">
          ${KINDS.map(
            (k) => `<button type="button" role="tab" data-kind="${k.key}" aria-selected="${String(v.type === k.key)}">${t(k.label)}</button>`
          ).join('')}
        </div>
        <input type="hidden" name="type" value="${esc(v.type)}">
        <div class="field">
          <label for="f-name">${t('名前')}</label>
          <input id="f-name" name="name" class="input" value="${esc(v.name)}" placeholder="${t('例：家賃、携帯代、Netflix')}" autocomplete="off">
          <p class="field-error" data-error-for="name"></p>
        </div>
        ${calcFieldHtml({ name: 'amount', label: t('金額（変わる物は平均額）'), value: v.amount === '' ? '' : String(v.amount) })}
        <div class="field">
          <label id="fc-cat-label">${t('カテゴリ')}</label>
          <div class="chip-grid" role="radiogroup" aria-labelledby="fc-cat-label" data-cats></div>
          <input type="hidden" name="categoryId" value="${esc(v.categoryId ?? '')}">
          <p class="field-error" data-error-for="categoryId"></p>
        </div>
        <div class="field">
          <label for="f-day">${t('引き落とし日')} <span class="optional">${t('任意')}</span></label>
          <select id="f-day" name="dayOfMonth" class="select">
            <option value="">${t('月初')}</option>
            ${Array.from({ length: 31 }, (_, i) => i + 1)
              .map((d) => `<option value="${d}" ${String(v.dayOfMonth) === String(d) ? 'selected' : ''}>${t('{d}日', { d })}</option>`)
              .join('')}
          </select>
          <p class="sheet-lead">${t('記録はこの日付で入ります。使えるお金の計算には、日付に関係なく月初から入ります。')}</p>
          <p class="field-error" data-error-for="dayOfMonth"></p>
        </div>
        <div class="field">
          <label for="f-start-year">${t('いつから')}</label>
          <div class="row month-pick">
            <select id="f-start-year" name="startYear" class="select" aria-label="${t('年')}">${yearOptions(v.startMonth)}</select>
            <select name="startMon" class="select" aria-label="${t('月')}">${monthOptions(v.startMonth)}</select>
          </div>
          <p class="field-error" data-error-for="startMonth"></p>
        </div>
        <div class="field">
          <label class="check-row"><input type="checkbox" name="ended" value="1" ${v.endMonth ? 'checked' : ''}>${t('やめた（この月まで）')}</label>
          <div class="row month-pick" data-end ${v.endMonth ? '' : 'hidden'}>
            <select name="endYear" class="select" aria-label="${t('年')}">${yearOptions(v.endMonth ?? thisMonth())}</select>
            <select name="endMon" class="select" aria-label="${t('月')}">${monthOptions(v.endMonth ?? thisMonth())}</select>
          </div>
          <p class="field-error" data-error-for="endMonth"></p>
        </div>
        <div class="field">
          <label for="f-memo">${t('メモ')} <span class="optional">${t('任意')}</span></label>
          <textarea id="f-memo" name="memo" class="input memo-input" rows="2" maxlength="200">${esc(v.memo ?? '')}</textarea>
          <p class="field-error" data-error-for="memo"></p>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-block" data-average>${t('年平均を出す（12か月の金額から）')}</button>
          <button type="submit" class="btn btn-primary btn-block">${t('保存')}</button>
          ${
            fc && made
              ? `<button type="button" class="btn btn-block" data-apply>${t('{month}の記録にも今の金額を反映する', { month: monthText(month, null) })}</button>`
              : ''
          }
          ${fc ? `<button type="button" class="btn-danger-text" data-delete>${t('削除')}</button>` : ''}
        </div>
      </form>`,
  });

  const form = sheet.el.querySelector('form');
  bindErrorClear(form);
  const pad = bindCalcField(sheet.el, 'amount');
  const typeInput = form.elements.namedItem('type');
  const catInput = form.elements.namedItem('categoryId');
  const catsEl = form.querySelector('[data-cats]');
  const endBox = form.querySelector('[data-end]');

  function paintCats() {
    const list = categories.filter((c) => c.type === typeInput.value);
    if (!list.some((c) => c.id === catInput.value)) catInput.value = '';
    catsEl.innerHTML = list
      .map(
        (c) => `<button type="button" class="chip-cat" role="radio" data-cat="${c.id}"
          aria-checked="${String(c.id === catInput.value)}" style="--swatch: var(--swatch-${(c.colorIndex ?? 0) + 1})">
          <span class="chip-dot" aria-hidden="true"></span>${esc(c.name)}</button>`
      )
      .join('');
  }
  paintCats();

  form.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-kind]');
    if (kind) {
      typeInput.value = kind.dataset.kind;
      form.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-selected', String(b === kind)));
      paintCats();
      return;
    }
    const cat = e.target.closest('[data-cat]');
    if (cat) {
      catInput.value = cat.dataset.cat;
      catsEl.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-checked', String(b === cat)));
    }
  });
  form.elements.namedItem('ended').addEventListener('change', (e) => (endBox.hidden = !e.target.checked));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (n) => form.elements.namedItem(n).value;
    try {
      await saveFixedCost(fc?.id ?? null, {
        type: typeInput.value,
        name: g('name'),
        amount: pad.value,
        categoryId: catInput.value,
        dayOfMonth: g('dayOfMonth'),
        startMonth: `${g('startYear')}-${g('startMon')}`,
        ended: form.elements.namedItem('ended').checked,
        endMonth: `${g('endYear')}-${g('endMon')}`,
        memo: g('memo'),
      });
      sheet.close();
      toast(t('保存しました'));
      onSaved?.();
    } catch (err) {
      if (err instanceof ValidationError) showErrors(form, err.errors);
      else throw err;
    }
  });

  form.querySelector('[data-average]').addEventListener('click', () => {
    openAverageSheet(fc?.id ?? null, (n) => pad.reset(String(n)));
  });

  form.querySelector('[data-apply]')?.addEventListener('click', async () => {
    await applyToMonth(fc.id, month);
    toast(t('{month}の記録に反映しました', { month: monthText(month, null) }));
    onSaved?.();
  });

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const alsoRows =
      made > 0 &&
      window.confirm(
        t('「{name}」から記録された{n}件も一緒に消しますか？（キャンセルすると記録は残します）', { name: fc.name, n: made })
      );
    if (!window.confirm(t('「{name}」を削除しますか？', { name: fc.name }))) return;
    await deleteFixedCost(fc.id, alsoRows);
    sheet.close();
    toast(t('削除しました'));
    onSaved?.();
  });

  return sheet;
}

/** カテゴリの名前・色を直すシート */
async function openCategorySheet(id, onSaved) {
  const categories = await listExpenseCategories();
  const cat = categories.find((c) => c.id === id);
  if (!cat) return;
  const used = await countTransactionsInCategory(id);

  const sheet = openSheet({
    title: t('カテゴリ'),
    body: `
      <form novalidate>
        <div class="field">
          <label for="f-cname">${t('名前')}</label>
          <input id="f-cname" name="name" class="input" value="${esc(cat.name)}" autocomplete="off" enterkeyhint="done">
          <p class="field-error" data-error-for="name"></p>
        </div>
        <div class="field">
          <label>${t('色')}</label>
          ${colorPickerHtml(cat.colorIndex ?? 0, PALETTE_SIZE)}
        </div>
        <p class="note">${used ? t('このカテゴリの記録が{n}件あります。', { n: used }) : t('まだ記録はありません。')}</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-block">${t('保存')}</button>
          <button type="button" class="btn-danger-text" data-del>${t('削除')}</button>
        </div>
      </form>`,
  });

  const form = sheet.el.querySelector('form');
  bindErrorClear(form);
  let color = cat.colorIndex ?? 0;
  sheet.el.querySelector('.color-pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    color = Number(b.dataset.color);
    sheet.el.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await updateExpenseCategory(id, { name: form.elements.namedItem('name').value, colorIndex: color });
      sheet.close();
      toast(t('保存しました'));
      onSaved?.();
    } catch (err) {
      if (err instanceof ValidationError) showErrors(form, err.errors);
      else throw err;
    }
  });

  form.querySelector('[data-del]').addEventListener('click', async () => {
    if (!window.confirm(t('「{name}」を削除しますか？', { name: cat.name }))) return;
    try {
      await deleteExpenseCategory(id);
      sheet.close();
      toast(t('削除しました'));
      onSaved?.();
    } catch (err) {
      if (err instanceof ValidationError) showErrors(form, err.errors);
      else throw err;
    }
  });
}

/**
 * 年平均を出すシート。12か月分の金額を入れると平均を出す。
 * すでに記録がある固定費なら、その記録から入れることもできる。
 */
async function openAverageSheet(fixedCostId, onPick) {
  const past = fixedCostId ? await pastAmounts(fixedCostId, 12) : [];
  const sheet = openSheet({
    title: t('年平均を出す'),
    body: `
      <p class="sheet-lead">${t('電気代のように月で変わる物は、12か月分を入れて平均を出し、その額を毎月の固定費にします。')}</p>
      ${past.length ? `<button type="button" class="btn btn-block" data-fill>${t('これまでの記録{n}件から入れる', { n: past.length })}</button>` : ''}
      <div class="avg-grid">
        ${Array.from({ length: 12 }, (_, i) => i)
          .map(
            (i) => `<div class="avg-cell">
              <label for="f-avg-${i}">${t('{n}か月前', { n: i + 1 })}</label>
              <input id="f-avg-${i}" class="input" data-avg="${i}" inputmode="numeric" autocomplete="off">
            </div>`
          )
          .join('')}
      </div>
      <p class="avg-result" data-result></p>
      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-block" data-use>${t('この金額にする')}</button>
      </div>`,
  });

  const inputs = [...sheet.el.querySelectorAll('[data-avg]')];
  const result = sheet.el.querySelector('[data-result]');
  const calc = () => averageAmount(inputs.map((x) => x.value));
  const paint = () => {
    const { average, count } = calc();
    result.textContent = count
      ? t('{n}か月の平均：{amount}', { n: count, amount: money(average) })
      : t('金額を入れると平均が出ます');
  };
  sheet.el.addEventListener('input', paint);
  paint();

  sheet.el.querySelector('[data-fill]')?.addEventListener('click', () => {
    past.forEach((r, i) => {
      if (inputs[i]) inputs[i].value = String(r.amount);
    });
    paint();
  });

  sheet.el.querySelector('[data-use]').addEventListener('click', () => {
    const { average, count } = calc();
    if (!count) return;
    onPick(average);
    sheet.close();
    toast(t('年平均 {amount} にしました', { amount: money(average) }));
  });
}
