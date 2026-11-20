// 金額入力の電卓（＋ − × ÷ ＝）。画面や DB には依存しない純粋な関数。
//
// ・扱うのは円の整数だけ。割り算などで小数が出たら四捨五入する
// ・マイナスにはしない（金額として使うため。0 で止める）
// ・state は { acc, op, cur, just } の組。just は「直前に演算子か＝を押した」印で、
//   次に数字を打つと今の数を置き換える（電卓と同じ動き）

export const CALC_OPS = ['+', '−', '×', '÷'];

const APPLY = {
  '+': (a, b) => a + b,
  '−': (a, b) => a - b,
  '×': (a, b) => a * b,
  '÷': (a, b) => (b === 0 ? null : a / b),
};

/** 入力できる桁数 */
const MAX_DIGITS = 10;

const clean = (v) => String(v ?? '').replace(/[^0-9]/g, '');
const round = (n) => Math.max(0, Math.round(n));

/** @param {string|number} value 最初に入っている金額 */
export function initCalc(value = '') {
  return { acc: null, op: null, cur: clean(value), just: false };
}

/** 入力欄に出す文字（空なら空のまま） */
export function calcDisplay(state) {
  return state.cur;
}

/** 入力欄の上に小さく出す途中式（例「1,280 ＋」）。計算中でなければ空 */
export function calcExpression(state) {
  if (state.op == null || state.acc == null) return '';
  return `${state.acc.toLocaleString('en-US')} ${state.op}`;
}

/** 今の値（数値）。空なら 0 */
export function calcNumber(state) {
  return state.cur === '' ? 0 : Number(state.cur);
}

/**
 * キーを1つ押した後の state を返す
 * @param {object} state
 * @param {string} key '0'〜'9' / '00' / '+' '−' '×' '÷' / '=' / '⌫' / 'C'
 */
export function applyKey(state, key) {
  if (/^\d+$/.test(key)) {
    const base = state.just || state.cur === '0' ? '' : state.cur;
    const next = (base + key).replace(/^0+(?=\d)/, '');
    if (next.length > MAX_DIGITS) return state;
    return { ...state, cur: next, just: false };
  }

  if (CALC_OPS.includes(key)) {
    // 続けて演算子を押した時は、押し直し（計算はしない）
    if (state.just && state.op != null) return { ...state, op: key };
    if (state.op != null) {
      const r = APPLY[state.op](state.acc, calcNumber(state));
      if (r === null) return { ...initCalc(''), error: true };
      const v = round(r);
      return { acc: v, op: key, cur: String(v), just: true };
    }
    return { acc: calcNumber(state), op: key, cur: state.cur, just: true };
  }

  if (key === '=') {
    if (state.op == null) return { ...state, just: true };
    const r = APPLY[state.op](state.acc, calcNumber(state));
    if (r === null) return { ...initCalc(''), error: true };
    return { acc: null, op: null, cur: String(round(r)), just: true };
  }

  if (key === '⌫') {
    if (state.just) return { ...state, cur: '', just: false };
    return { ...state, cur: state.cur.slice(0, -1), just: false };
  }

  if (key === 'C') return initCalc('');

  return state;
}
