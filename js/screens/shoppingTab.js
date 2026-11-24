// 買い物リストのタブ：上のセグメントで「リスト」「価格」「お店」を切り替える
// 買い物に関わるもの（買う物・いくらか・どこで）を1つのタブにまとめる（v1.18）
import * as shopping from './shopping.js';
import * as prices from './prices.js';
import { t } from '../lib/i18n.js';

export const title = '買い物';

const SEGMENTS = [
  { key: 'list', label: 'リスト' },
  { key: 'prices', label: '価格' },
  { key: 'stores', label: 'お店' },
];

/** 画面を離れても覚えておく。開いた時はいちばん左から */
let segment = SEGMENTS[0].key;

/** ほかの画面や URL（#/prices）から切り替える */
export function setSegment(key) {
  if (SEGMENTS.some((s) => s.key === key)) segment = key;
}

/** 下のタブで「リスト」をもう一度押した時は、いちばん左に戻す */
export function resetSegment() {
  segment = SEGMENTS[0].key;
}

export function mount(el) {
  el.innerHTML = `
    <div class="segmented shop-seg" role="tablist">
      ${SEGMENTS.map(
        (s) => `<button type="button" role="tab" data-seg="${s.key}" aria-selected="${String(s.key === segment)}">${t(s.label)}</button>`
      ).join('')}
    </div>
    <div class="shop-view"></div>`;
  const view = el.querySelector('.shop-view');
  let stop = null;

  function show() {
    stop?.();
    el.querySelectorAll('[data-seg]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.seg === segment)));
    const box = document.createElement('div');
    view.replaceChildren(box);
    stop =
      (segment === 'prices' ? prices.mountCompare(box) : segment === 'stores' ? prices.mountStores(box) : shopping.mount(box)) ?? null;
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
