// お店の色と頭文字のバッジ（価格・買い物リストで使う）
// 色だけだと見分けにくく、名前を全部出すと行が長くなるため、色の丸に頭文字を1文字入れる。
import { esc } from '../lib/util.js';

/** 店名の頭1文字（絵文字などもそのまま1文字として扱う） */
export function storeInitial(name) {
  return Array.from(String(name ?? '').trim())[0] ?? '?';
}

/**
 * @param {{name:string, colorIndex?:number}} store
 * @param {{ withName?: boolean }} [opts] withName で名前も横に出す
 */
export function storeBadgeHtml(store, opts = {}) {
  if (!store) return '';
  const n = (store.colorIndex ?? 0) + 1;
  return `<span class="store-badge" style="--swatch: var(--swatch-${n})">
    <span class="store-initial" aria-hidden="true">${esc(storeInitial(store.name))}</span>
    ${opts.withName ? `<span class="store-badge-name">${esc(store.name)}</span>` : `<span class="visually-hidden">${esc(store.name)}</span>`}
  </span>`;
}

/** 色を選ぶボタンの並び（店舗の編集シートで使う） */
export function colorPickerHtml(selected = 0, size = 10) {
  return `<div class="color-pick" role="radiogroup">
    ${Array.from({ length: size }, (_, i) => i)
      .map(
        (i) => `<button type="button" class="color-swatch" role="radio" data-color="${i}"
          aria-checked="${String(i === selected)}" style="background: var(--swatch-${i + 1})"></button>`
      )
      .join('')}
  </div>`;
}
