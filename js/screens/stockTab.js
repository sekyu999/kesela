// 在庫タブ：上のセグメントで「在庫」と「価格」を切り替える
// どちらも対象は同じ商品なので、1つのタブにまとめる（v1.15 のナビ再編）
import * as stock from './stock.js';
import * as prices from './prices.js';
import { t } from '../lib/i18n.js';

export const title = '在庫';

const SEGMENTS = [
  { key: 'stock', label: '在庫' },
  { key: 'prices', label: '価格' },
];

/** 画面を離れても覚えておく */
let segment = 'stock';

/** ほかの画面や URL（#/prices）から切り替える */
export function setSegment(key) {
  if (SEGMENTS.some((s) => s.key === key)) segment = key;
}

export function mount(el) {
  el.innerHTML = `
    <div class="segmented stock-seg" role="tablist">
      ${SEGMENTS.map(
        (s) => `<button type="button" role="tab" data-seg="${s.key}" aria-selected="${String(s.key === segment)}">${t(s.label)}</button>`
      ).join('')}
    </div>
    <div class="stock-view"></div>`;
  const view = el.querySelector('.stock-view');
  let stop = null;

  function show() {
    stop?.();
    el.querySelectorAll('[data-seg]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.seg === segment)));
    const box = document.createElement('div');
    view.replaceChildren(box);
    stop = (segment === 'prices' ? prices.mount(box) : stock.mount(box)) ?? null;
  }

  el.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-seg]');
    if (!seg || seg.dataset.seg === segment) return;
    segment = seg.dataset.seg;
    show();
  });

  show();
  return () => stop?.();
}
