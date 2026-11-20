// 金額を入れるための電卓テンキー（＋ − × ÷ ＝）
//
// iPhone の数字キーボードには × ÷ が無く、記号を打つにはキーボードを切り替える必要があるため、
// アプリ側に大きなボタンのテンキーを出す。レシートを見ながらの入力も速くなる。
//
// 使い方：
//   body に calcFieldHtml({ name:'amount', label:'金額' }) を入れる
//   シートを開いたあと const pad = bindCalcField(sheet.el, 'amount')
//   pad.reset('') で空にする（「保存して続けて入力」用）
import { initCalc, applyKey, calcDisplay, calcExpression, calcNumber } from '../domain/calc.js';
import { esc } from '../lib/util.js';
import { t } from '../lib/i18n.js';

const ROWS = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', '00', '⌫', '+'],
];

/** 読み上げ用の名前 */
const LABELS = { '÷': '割る', '×': '掛ける', '−': '引く', '+': '足す', '⌫': '1文字消す', C: 'すべて消す', '=': '計算する' };

/**
 * @param {{name?:string, label?:string, value?:string, compact?:boolean}} opts
 *   compact … 見出しを出さず、余白を詰める（かんたん入力のように1画面に収めたい時）
 */
export function calcFieldHtml({ name = 'amount', label = '金額', value = '', compact = false }) {
  const key = (k) => {
    const op = LABELS[k];
    const cls = /^\d+$/.test(k) ? 'calc-num' : 'calc-op';
    return `<button type="button" class="calc-key ${cls}" data-key="${esc(k)}"${op ? ` aria-label="${esc(t(op))}"` : ''}>${esc(k)}</button>`;
  };
  return `
    <div class="field calc-field ${compact ? 'is-compact' : ''}">
      ${compact ? '' : `<label for="f-${name}">${esc(label)}</label>`}
      <div class="calc-display">
        <span class="calc-expr" data-calc-expr aria-hidden="true"></span>
        <input id="f-${name}" name="${name}" class="input calc-input" type="text" inputmode="none" readonly
               value="${esc(value)}" placeholder="0" autocomplete="off" aria-label="${esc(t('金額'))}">
        <span class="unit-suffix">${t('円')}</span>
      </div>
      <p class="field-error" data-error-for="${name}"></p>
      <div class="calc-pad" data-calc-pad role="group" aria-label="${esc(t('電卓'))}">
        ${ROWS.map((r) => r.map(key).join('')).join('')}
        <button type="button" class="calc-key calc-clear" data-key="C" aria-label="${esc(t('すべて消す'))}">C</button>
        <button type="button" class="calc-key calc-eq" data-key="=" aria-label="${esc(t('計算する'))}">=</button>
      </div>
    </div>`;
}

/**
 * テンキーを動くようにする
 * @param {HTMLElement} root シートの中身
 * @param {string} name 入力欄の name
 * @param {{ onChange?: (value:number) => void }} [opts]
 */
export function bindCalcField(root, name = 'amount', opts = {}) {
  const input = root.querySelector(`[name="${name}"]`);
  const pad = root.querySelector('[data-calc-pad]');
  const expr = root.querySelector('[data-calc-expr]');
  let state = initCalc(input.value);

  const paint = () => {
    input.value = calcDisplay(state);
    expr.textContent = calcExpression(state);
    input.dispatchEvent(new Event('input', { bubbles: true })); // エラー表示を消すため
    opts.onChange?.(calcNumber(state));
  };
  paint();

  // ボタンを押しても入力欄のフォーカスが外れないようにする
  pad.addEventListener('pointerdown', (e) => e.preventDefault());
  pad.addEventListener('mousedown', (e) => e.preventDefault());
  pad.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    state = applyKey(state, btn.dataset.key);
    paint();
  });

  // パソコンのキーボードからも打てるようにする
  input.addEventListener('keydown', (e) => {
    const map = { '*': '×', x: '×', '/': '÷', '-': '−', Enter: '=', Backspace: '⌫', Escape: 'C', Delete: 'C' };
    const key = /^\d$/.test(e.key) ? e.key : e.key === '+' ? '+' : map[e.key];
    if (!key) return;
    e.preventDefault();
    state = applyKey(state, key);
    paint();
  });

  return {
    get value() {
      return calcDisplay(state);
    },
    reset(v = '') {
      state = initCalc(v);
      paint();
    },
    focus() {
      input.focus();
    },
  };
}
