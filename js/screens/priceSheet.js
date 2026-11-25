// 価格を記録するシート（買い物リスト・価格画面の両方から開く）
// v1.20：1つの店舗に何件でも記録できる。1個（管理単位）あたりの金額とメモを入れる（日付・買った数は入れない）
import { openSheet } from '../ui/sheet.js';
import { bindErrorClear, showErrors, formValues } from '../ui/form.js';
import { toast } from '../ui/toast.js';
import { listProducts, getProduct, createProduct, ValidationError } from '../data/productRepo.js';
import { listCategories } from '../data/categoryRepo.js';
import { nameKey } from '../domain/product.js';
import { listStores } from '../data/storeRepo.js';
import { savePrice, getPriceRecord, listAllRecords } from '../data/priceRepo.js';
import { INPUT_UNITS } from '../domain/units.js';
import { newestFirst } from '../domain/pricing.js';
import { esc } from '../lib/util.js';
import { t } from '../lib/i18n.js';

/**
 * 価格の記録シート。
 * recordId があればその1件を直す。なければ新しく足す（同じ店舗に何件でも足せる）
 * @param {{ productId?: string, storeId?: string, recordId?: string }} [preset]
 */
export async function openPriceSheet(preset = {}) {
  const [products, stores, categories, editing, allRecords] = await Promise.all([
    listProducts(),
    listStores(),
    listCategories(),
    preset.recordId ? getPriceRecord(preset.recordId) : null,
    listAllRecords(),
  ]);
  // メモの候補は、これまでに自分が書いたメモから（新しい順）
  const memoSuggestions = [...new Set([...allRecords].sort(newestFirst).map((r) => r.memo).filter(Boolean))].slice(0, 20);

  if (stores.length === 0) {
    toast(t('先に「お店」で店舗を登録してください'));
    return;
  }

  const productId = editing?.productId ?? preset.productId ?? '';
  const storeId = editing?.storeId ?? preset.storeId ?? stores[0].id;
  const product = productId ? await getProduct(productId) : null;

  const body = `
    <form novalidate>
      <div class="field">
        <label for="f-productName">${t('商品')}</label>
        ${
          product
            ? `<input id="f-productName" class="input" value="${esc(product.name)}" disabled>
               <input type="hidden" name="productId" value="${product.id}">`
            : `<input id="f-productName" name="productName" class="input" list="price-product-names" autocomplete="off"
                      placeholder="${t('選ぶか、新しい名前を入れる')}" enterkeyhint="next">
               <datalist id="price-product-names">
                 ${products.map((p) => `<option value="${esc(p.name)}"></option>`).join('')}
               </datalist>
               <p class="note">${t('登録のない名前を入れると、在庫を管理しない商品として作ります。')}</p>`
        }
        <p class="field-error" data-error-for="productName"></p>
        <p class="field-error" data-error-for="productId"></p>
      </div>

      <div class="field">
        <label for="f-storeId">${t('店舗')}</label>
        <select id="f-storeId" name="storeId" class="select">
          ${stores.map((s) => `<option value="${s.id}" ${s.id === storeId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
        <p class="field-error" data-error-for="storeId"></p>
      </div>

      <div class="field">
        <label for="f-price" id="price-label">${t('1つあたりの金額（税込）')}</label>
        <div class="row" style="align-items:center">
          <input id="f-price" name="price" class="input grow" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${t('例：228')}">
          <span>${t('円')}</span>
        </div>
        <p class="field-error" data-error-for="price"></p>
      </div>

      <div class="field">
        <label for="f-packageContent">${t('1つあたりの内容量')} <span class="optional">${t('任意')}</span></label>
        <div class="row">
          <input id="f-packageContent" name="packageContent" class="input grow" inputmode="decimal" autocomplete="off">
          <select name="packageContentUnit" class="select" style="width:96px" aria-label="${t('内容量の単位')}">
            ${INPUT_UNITS.map((u) => `<option value="${u}">${esc(t(u))}</option>`).join('')}
          </select>
        </div>
        <p class="field-error" data-error-for="packageContent"></p>
      </div>

      <div class="field">
        <label for="f-priceMemo">${t('メモ')} <span class="optional">${t('任意')}</span></label>
        <input id="f-priceMemo" name="memo" class="input" autocomplete="off" maxlength="40"
               list="price-memos" placeholder="${t('例：200gの方・特売')}" enterkeyhint="done">
        <datalist id="price-memos">
          ${memoSuggestions.map((m) => `<option value="${esc(m)}"></option>`).join('')}
        </datalist>
        <p class="note">${t('同じお店で複数の価格を分けて記録したい時に使います。')}</p>
        <p class="field-error" data-error-for="memo"></p>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-block">${t(editing ? '保存' : '記録する')}</button>
      </div>
    </form>
  `;

  const title = editing ? t('価格を直す') : product ? t('{name}の価格', { name: product.name }) : t('価格を記録');
  const sheet = openSheet({ title, body });
  const form = sheet.el.querySelector('form');
  bindErrorClear(form);

  const priceInput = form.elements.namedItem('price');
  const contentInput = form.elements.namedItem('packageContent');
  const contentUnit = form.elements.namedItem('packageContentUnit');
  const priceLabel = form.querySelector('#price-label');
  const memoInput = form.elements.namedItem('memo');

  // その店舗の記録があれば入れる。なければ内容量だけ商品マスタから
  /** 入れた名前に合う商品（無ければ null） */
  function findByName(name) {
    const key = nameKey(name ?? '');
    return key ? (products.find((p) => nameKey(p.name) === key) ?? null) : null;
  }

  // 直す時は、その記録の内容をそのまま入れる。新しく足す時は商品マスタの内容量だけ
  async function fill() {
    const hidden = form.querySelector('input[name="productId"]');
    const pid = hidden ? hidden.value : (findByName(form.elements.namedItem('productName')?.value)?.id ?? '');
    if (!pid) return;
    const p = await getProduct(pid);
    priceLabel.textContent = p ? t('1{unit}あたりの金額（税込）', { unit: t(p.inventoryUnit) }) : t('1つあたりの金額（税込）');
    if (editing) {
      // v1.10 までの記録は合計額＋数量なので、1つあたりに直して出す
      priceInput.value = Math.round(editing.price / (editing.quantity || 1));
      contentInput.value = editing.packageContent ?? p?.packageContent ?? '';
      contentUnit.value = editing.packageContentUnit ?? p?.packageContentUnit ?? 'g';
      memoInput.value = editing.memo ?? '';
      return;
    }
    if (!priceInput.value) {
      contentInput.value = p?.packageContent ?? '';
      contentUnit.value = p?.packageContentUnit ?? 'g';
    }
  }
  form.addEventListener('change', (e) => {
    if (e.target.name === 'productName') fill();
  });
  fill();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const values = formValues(form);
      if (!values.productId) {
        // 名前で探し、無ければ「在庫を管理しない商品」としてその場で作る
        const name = String(values.productName ?? '').trim();
        if (!name) {
          showErrors(form, { productName: '商品を選ぶか、名前を入れてください' });
          return;
        }
        const found = findByName(name);
        if (found) values.productId = found.id;
        else {
          const made = await createProduct({
            name,
            categoryId: categories[0]?.id ?? '',
            inventoryUnit: t('個'),
            currentStock: 0,
            targetStock: 0,
            trackStock: false,
          });
          values.productId = made.id;
          toast(t('「{name}」を在庫を管理しない商品として追加しました', { name }));
        }
      }
      await savePrice(values, editing?.id ?? null);
      sheet.close();
      toast(t(editing ? '保存しました' : '価格を記録しました'));
    } catch (err) {
      if (err instanceof ValidationError) showErrors(form, err.errors);
      else {
        console.error(err);
        toast(t('記録できませんでした'));
      }
    }
  });
}
