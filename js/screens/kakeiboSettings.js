// 家計簿の設定：貯金目標・カテゴリ・固定費
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
import { listFixedCosts, getFixedCost, saveFixedCost, deleteFixedCost, countGeneratedRows, applyToMonth } from '../data/fixedCostRepo.js';
import { getMeta, setMeta, META } from '../data/metaRepo.js';
import { validateYenOrEmpty, rawSavingsGoal, withSavingsGoal, PALETTE_SIZE } from '../domain/kakeibo.js';
import { averageAmount, SAMPLE_MONTHS, CYCLES, cycleOf, cycleLabel, spreadOf, spreadLabel, monthlyAmount } from '../domain/fixedCost.js';
import { thisMonth } from '../domain/plans.js';
import { ValidationError } from '../data/productRepo.js';
import { makeSortable, dragHandle } from '../ui/sortable.js';
import { colorPickerHtml } from '../ui/storeBadge.js';
import { yearOptions, monthOptions } from '../ui/monthPick.js';
import { esc } from '../lib/util.js';
import { t, money, monthText, monthOnlyText } from '../lib/i18n.js';

/** 貯金目標を決めるシート。毎月の額と、その月だけの額を分けて入れられる */
export async function openSavingsGoalSheet(month = thisMonth()) {
  const sheet = openSheet({ title: t('貯金目標'), body: `<div data-body></div>` });
  const body = sheet.el.querySelector('[data-body]');
  /** 'default'（毎月）か 'month'（この月だけ） */
  let target = 'default';

  async function render() {
    const goals = await getMeta(META.savingsGoal);
    const value = rawSavingsGoal(goals, target === 'month' ? month : null);
    body.innerHTML = `
      <form novalidate>
        <p class="sheet-lead">${t('ためたい額。決めると「自由に使えるお金」が出せます。')}</p>
        <div class="segmented" role="tablist">
          <button type="button" role="tab" data-target="default" aria-selected="${String(target === 'default')}">${t('毎月')}</button>
          <button type="button" role="tab" data-target="month" aria-selected="${String(target === 'month')}">${t('{month}だけ', { month: monthText(month, null) })}</button>
        </div>
        <div class="field">
          <div class="row">
            <input name="savingsGoal" class="input grow" inputmode="numeric" value="${value ?? ''}"
                   placeholder="${target === 'month' ? esc(t('空欄なら毎月の設定を使う')) : esc(t('例：50000'))}" autocomplete="off">
            <span class="unit-suffix">${t('円')}</span>
          </div>
          <p class="field-error" data-error-for="savingsGoal"></p>
        </div>
        <div class="form-actions"><button type="submit" class="btn btn-primary btn-block">${t('保存')}</button></div>
      </form>`;

    const form = body.querySelector('form');
    bindErrorClear(form);
    form.querySelectorAll('[data-target]').forEach((b) =>
      b.addEventListener('click', () => {
        target = b.dataset.target;
        render();
      })
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = validateYenOrEmpty(form.elements.namedItem('savingsGoal').value);
      if (!r.ok) {
        showErrors(form, { savingsGoal: r.error });
        return;
      }
      await setMeta(META.savingsGoal, withSavingsGoal(await getMeta(META.savingsGoal), target === 'month' ? month : null, r.value));
      sheet.close();
      toast(t('保存しました'));
    });
  }

  await render();
  return sheet;
}

/** カテゴリの一覧シート（記録タブのチップの「編集」から開く） */
export async function openCategoryList() {
  const sheet = openSheet({ title: t('カテゴリ'), body: `<div data-body></div>` });
  const body = sheet.el.querySelector('[data-body]');

  async function render() {
    const categories = (await listExpenseCategories()).filter((c) => c.type === 'expense');
    body.innerHTML = `
      <p class="sheet-lead">${t('名前と色を変えられます。≡ を押さえると並べ替えられます。並べた順に表示します。')}</p>
      <ul class="list compact-list cat-list" data-cat-list>
        ${categories
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
      <button type="button" class="btn btn-block" data-cat-add>${t('＋ カテゴリを追加')}</button>`;

    body.querySelector('[data-cat-add]').addEventListener('click', async () => {
      const name = window.prompt(t('カテゴリ名'));
      if (!name?.trim()) return;
      try {
        await addExpenseCategory(name, 'expense');
        render();
      } catch (err) {
        toast(t(err?.errors?.name ?? '追加できませんでした'));
      }
    });
    body.querySelectorAll('[data-cat-edit]').forEach((b) =>
      b.addEventListener('click', () => openCategorySheet(b.dataset.catEdit, render))
    );
    makeSortable(body.querySelector('[data-cat-list]'), { onSort: (ids) => saveExpenseCategoryOrder(ids) });
  }

  await render();
  return sheet;
}

/** 固定費・固定収入の一覧シート（記録タブの下から開く） */
export async function openFixedCostList(month = thisMonth()) {
  const sheet = openSheet({ title: t('固定費・固定収入'), body: `<div data-body></div>` });
  const body = sheet.el.querySelector('[data-body]');

  async function render() {
    const fixedCosts = await listFixedCosts();
    body.innerHTML = `
      <p class="sheet-lead">${t('毎月決まって出入りするお金。登録するとすぐ今月の記録に入ります。収入はここだけで登録します。')}</p>
      ${
        fixedCosts.length
          ? `<ul class="list compact-list">${fixedCosts
              .map(
                (f) => `<li class="kb-row">
                  <button type="button" class="row-button" data-fixed="${f.id}">
                    <span class="kb-dot" style="background:var(--swatch-${(f.colorIndex ?? 0) + 1})"></span>
                    <span class="grow kb-name">${esc(f.name)}${f.endMonth ? `<span class="badge badge-muted">${t('終了')}</span>` : ''}
                      <span class="kb-memo">${[
                        cycleLabel(f) && t(cycleLabel(f)),
                        spreadLabel(f) && t(spreadLabel(f)),
                        f.dayOfMonth ? t('{d}日', { d: f.dayOfMonth }) : t('月初'),
                      ]
                        .filter(Boolean)
                        .join(t('・'))}</span></span>
                    <span class="kb-amount">${f.type === 'income' ? '+' : ''}${money(monthlyAmount(f))}${
                      monthlyAmount(f) !== f.amount ? `<small class="kb-per">${t('/月')}</small>` : ''
                    }</span>
                  </button>
                </li>`
              )
              .join('')}</ul>`
          : `<div class="placeholder">${t('まだ登録がありません。')}</div>`
      }
      <button type="button" class="btn btn-block" data-add-fixed>${t('＋ 固定費・固定収入を追加')}</button>`;

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

/** 固定費の追加・編集シート（カテゴリは持たず、名前と色で表す） */
export async function openFixedCostSheet(id, month, onSaved) {
  const fc = id ? await getFixedCost(id) : null;
  const made = id ? await countGeneratedRows(id) : 0;
  const v = fc ?? {
    type: 'expense',
    name: '',
    amount: '',
    colorIndex: 0,
    samples: {},
    everyMonths: 1,
    spread: true,
    dayOfMonth: '',
    startMonth: thisMonth(),
    endMonth: null,
    memo: '',
  };
  let color = v.colorIndex ?? 0;
  let samples = { ...(v.samples ?? {}) };

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
          <input id="f-name" name="name" class="input" value="${esc(v.name)}" placeholder="${t('例：家賃、携帯代、給与')}" autocomplete="off">
          <p class="field-error" data-error-for="name"></p>
        </div>
        <div class="field">
          <label>${t('色')}</label>
          ${colorPickerHtml(color, PALETTE_SIZE)}
        </div>
        ${calcFieldHtml({ name: 'amount', label: t('金額（変わる物は平均額）'), value: v.amount === '' ? '' : String(v.amount) })}
        <div class="field">
          <button type="button" class="btn btn-block" data-average>${t('年平均を出す（12か月の金額から）')}</button>
        </div>
        <div class="field">
          <label for="f-every">${t('支払いの間隔')}</label>
          <select id="f-every" name="everyMonths" class="select">
            ${CYCLES.map(
              (c) => `<option value="${c.months}" ${cycleOf(v) === c.months ? 'selected' : ''}>${t(c.label)}</option>`
            ).join('')}
          </select>
          <p class="sheet-lead">${t('水道代のように隔月の物は、ここで間隔を選びます。')}</p>
        </div>
        <div class="field" data-spread ${cycleOf(v) === 1 ? 'hidden' : ''}>
          <label id="spread-label">${t('入れ方')}</label>
          <div class="segmented" role="radiogroup" aria-labelledby="spread-label">
            <button type="button" role="radio" data-spread-btn="1" aria-checked="${String(spreadOf(v))}">${t('毎月ならす')}</button>
            <button type="button" role="radio" data-spread-btn="0" aria-checked="${String(!spreadOf(v))}">${t('請求の月にまとめて')}</button>
          </div>
          <p class="sheet-lead" data-spread-note></p>
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
          <div class="row month-pick check-after" data-end ${v.endMonth ? '' : 'hidden'}>
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
  const endBox = form.querySelector('[data-end]');
  const spreadBox = form.querySelector('[data-spread]');
  const spreadNote = form.querySelector('[data-spread-note]');
  let spread = spreadOf(v);

  /** 間隔と入れ方に合わせて、説明と出し入れを直す */
  function paintSpread() {
    const every = cycleOf({ everyMonths: form.elements.namedItem('everyMonths').value });
    spreadBox.hidden = every === 1;
    form.querySelectorAll('[data-spread-btn]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.spreadBtn === '1') === spread)));
    const amount = Number(pad.value) || 0;
    spreadNote.textContent = spread
      ? t('{total}を{n}か月に分けて、毎月{each}として入れます', {
          total: money(amount),
          n: every,
          each: money(Math.round(amount / Math.max(1, every))),
        })
      : t('請求が来る月にだけ{total}を入れます。「いつから」の月が基準です', { total: money(amount) });
  }
  form.elements.namedItem('everyMonths').addEventListener('change', paintSpread);
  form.querySelectorAll('[data-spread-btn]').forEach((b) =>
    b.addEventListener('click', () => {
      spread = b.dataset.spreadBtn === '1';
      paintSpread();
    })
  );

  form.querySelectorAll('[data-kind]').forEach((b) =>
    b.addEventListener('click', () => {
      typeInput.value = b.dataset.kind;
      form.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    })
  );
  sheet.el.querySelector('.color-pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    color = Number(b.dataset.color);
    sheet.el.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  });
  form.elements.namedItem('ended').addEventListener('change', (e) => (endBox.hidden = !e.target.checked));

  form.querySelector('[data-average]').addEventListener('click', () => {
    openAverageSheet(samples, (next, average) => {
      samples = next;
      pad.reset(String(average));
      paintSpread();
    });
  });
  paintSpread();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const g = (n) => form.elements.namedItem(n).value;
    try {
      await saveFixedCost(fc?.id ?? null, {
        type: typeInput.value,
        name: g('name'),
        amount: pad.value,
        colorIndex: color,
        samples,
        everyMonths: g('everyMonths'),
        spread,
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

  form.querySelector('[data-apply]')?.addEventListener('click', async () => {
    await applyToMonth(fc.id, month);
    toast(t('{month}の記録に反映しました', { month: monthText(month, null) }));
    onSaved?.();
  });

  form.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const alsoRows =
      made > 0 &&
      window.confirm(t('「{name}」から記録された{n}件も一緒に消しますか？（キャンセルすると記録は残します）', { name: fc.name, n: made }));
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
 * 年平均を出すシート。1月〜12月の金額を入れると平均を出す。
 * 入れた金額は固定費に残るので、あとから見直して計算し直せる。
 */
function openAverageSheet(samples, onPick) {
  const sheet = openSheet({
    title: t('年平均を出す'),
    body: `
      <p class="sheet-lead">${t('電気代のように月で変わる物は、1年分を入れて平均を出し、その額を毎月の固定費にします。入れた金額は残るので、あとから直せます。')}</p>
      <div class="avg-grid">
        ${SAMPLE_MONTHS.map(
          (m) => `<div class="avg-cell">
            <label for="f-avg-${m}">${monthOnlyText(m)}</label>
            <input id="f-avg-${m}" class="input" data-avg="${m}" inputmode="numeric" autocomplete="off"
                   value="${samples?.[m] ?? samples?.[String(m)] ?? ''}">
          </div>`
        ).join('')}
      </div>
      <p class="avg-result" data-result></p>
      <div class="form-actions">
        <button type="button" class="btn btn-primary btn-block" data-use>${t('この金額にする')}</button>
      </div>`,
  });

  const inputs = [...sheet.el.querySelectorAll('[data-avg]')];
  const result = sheet.el.querySelector('[data-result]');
  const values = () => Object.fromEntries(inputs.map((x) => [x.dataset.avg, x.value.trim()]).filter(([, v]) => v !== ''));
  const paint = () => {
    const { average, count } = averageAmount(values());
    result.textContent = count ? t('{n}か月の平均：{amount}', { n: count, amount: money(average) }) : t('金額を入れると平均が出ます');
  };
  sheet.el.addEventListener('input', paint);
  paint();

  sheet.el.querySelector('[data-use]').addEventListener('click', () => {
    const next = values();
    const { average, count } = averageAmount(next);
    if (!count) return;
    onPick(next, average);
    sheet.close();
    toast(t('年平均 {amount} にしました', { amount: money(average) }));
  });
}
