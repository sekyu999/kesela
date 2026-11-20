// ⑦ 目標：自分で掲げた目標・信念を書いておき、起動時に見る。他の機能とはつながらない独立した画面。
//
// 表示したまま直接書き換える（Notion のように1行＝1ブロック）。v1.15 で入力部分を作り直した。
//   Enter で次の行／行頭で Backspace → 記号を外す → さらに押すと前の行とつなぐ
//   行頭に「# 」→ 見出し、「[] 」→ ToDo、「- 」→ 箇条書き、「1. 」→ 番号付き
//   行頭で「/」→ ブロックの種類を選ぶメニュー
//   Tab／ツールバーの → ← で入れ子（インデント）
//   選んだ文字だけ太字・打ち消し（contenteditable なので、行の一部にもかけられる）
//   行の左の「≡」を押さえて上下にドラッグで並べ替え
import { watch } from '../ui/live.js';
import { openSheet } from '../ui/sheet.js';
import { makeSortable, dragHandle } from '../ui/sortable.js';
import { getNoteText, saveNoteText } from '../data/noteRepo.js';
import {
  toEditBlocks,
  fromEditBlocks,
  lineToBlock,
  shortcutFor,
  changeType,
  numberFor,
  inlineToHtml,
  inlineFromHtml,
  BLOCK_TYPES,
  MAX_INDENT,
  NOTE_MAX,
} from '../domain/note.js';
import { thisMonth } from '../domain/plans.js';
import { yearOptions, monthOptions } from '../ui/monthPick.js';
import { esc } from '../lib/util.js';
import { t, monthText } from '../lib/i18n.js';

export const title = '目標';

/** 書いてから保存するまでの待ち時間 */
const SAVE_DELAY = 600;

/** 目標に何か書いてあるか（起動時にこの画面を出すかの判断に使う。設定は js/ui/startScreen.js） */
export async function hasNote() {
  return !!(await getNoteText()).trim();
}

const CAL_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';

const TOOLS = [
  { key: 'heading', label: '見出し', kind: 'type' },
  { key: 'todo', label: 'ToDo', kind: 'type' },
  { key: 'bullet', label: '箇条書き', kind: 'type' },
  { key: 'number', label: '番号付き', kind: 'type' },
  { key: 'bold', label: '太字', kind: 'mark', html: '<b>B</b>' },
  { key: 'strike', label: '打ち消し', kind: 'mark', html: '<s>S</s>' },
  { key: 'outdent', label: '左へ', kind: 'indent', html: '←' },
  { key: 'indent', label: '右へ', kind: 'indent', html: '→' },
];

export function mount(el) {
  /** @type {Array<import('../domain/note.js').EditBlock & {_k:number}>} */
  let blocks = [];
  let saved = null;
  let timer = null;
  let keySeq = 0;
  const key = () => ++keySeq;

  el.innerHTML = `
    <div class="goal-tools" role="toolbar" aria-label="${t('書式')}" hidden>
      ${TOOLS.map(
        (x) =>
          `<button type="button" class="chip-btn" data-tool="${x.key}" aria-label="${esc(t(x.label))}">${x.html ?? t(x.label)}</button>`
      ).join('')}
    </div>
    <div class="goal-editor"></div>
    <div class="goal-tail" data-tail aria-hidden="true"></div>
    <div class="slash-menu" data-slash hidden role="listbox" aria-label="${t('ブロックの種類')}"></div>`;
  const tools = el.querySelector('.goal-tools');
  const editor = el.querySelector('.goal-editor');
  const slash = el.querySelector('[data-slash]');

  // ---- 保存 ----
  function save() {
    clearTimeout(timer);
    timer = null;
    const text = fromEditBlocks(blocks).slice(0, NOTE_MAX);
    if (text === saved) return;
    saved = text;
    saveNoteText(text);
  }
  const saveLater = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
  };

  // ---- 描画 ----
  function markerHtml(b, i) {
    if (b.type === 'todo') {
      return `<input type="checkbox" class="gb-check" data-check="${i}" ${b.checked ? 'checked' : ''}
        aria-label="${esc(t('{name}を済みにする', { name: b.text || t('ToDo') }))}">`;
    }
    if (b.type === 'bullet') return '<span class="gb-dot" aria-hidden="true"></span>';
    if (b.type === 'number') return `<span class="gb-no" aria-hidden="true">${numberFor(blocks, i)}.</span>`;
    return '';
  }

  function blockHtml(b, i) {
    const cls = ['gb', `gb-${b.type}`, b.type === 'heading' ? `gb-h${b.level || 2}` : '', b.checked ? 'is-checked' : '']
      .filter(Boolean)
      .join(' ');
    const label = t({ heading: '見出し', todo: 'ToDo', bullet: '箇条書き', number: '番号付き', text: '本文' }[b.type]);
    const placeholder =
      blocks.length === 1 && !b.text ? esc(t('目標を書く（# で見出し、[] で ToDo、/ でメニュー）')) : '';
    const month =
      b.type === 'todo'
        ? (() => {
            const now = thisMonth();
            const past = b.month && b.month < now && !b.checked;
            return `<button type="button" class="nb-month ${b.month ? 'is-set' : ''} ${past ? 'is-past' : ''}" data-month="${i}"
              aria-label="${esc(b.month ? t('やる月：{month}', { month: monthText(b.month, now) }) : t('やる月'))}">${
                b.month ? esc(monthText(b.month, now)) : CAL_ICON
              }</button>`;
          })()
        : '';
    return `<div class="${cls}" data-id="${b._k}" style="--ind:${b.indent || 0}">
      ${dragHandle(esc(label))}
      ${markerHtml(b, i)}
      <div class="gb-input" contenteditable="true" role="textbox" aria-multiline="false" data-i="${i}"
           aria-label="${esc(label)}" ${placeholder ? `data-placeholder="${placeholder}"` : ''}>${inlineToHtml(b.text)}</div>
      ${month}
    </div>`;
  }

  /** 全体を描き直す。focus に [行, カーソル位置] を渡すとそこにカーソルを置く */
  function render(focus) {
    editor.innerHTML = blocks.map(blockHtml).join('');
    if (focus) focusAt(...focus);
  }

  function inputAt(i) {
    return editor.querySelector(`.gb-input[data-i="${i}"]`);
  }

  function focusAt(i, pos) {
    const host = inputAt(i);
    if (!host) return;
    setCaret(host, pos ?? Infinity);
  }

  /** 画面の内容をブロックに取り込む（描き直す前に必ず呼ぶ） */
  function pull(i) {
    const host = inputAt(i);
    if (host) blocks[i].text = inlineFromHtml(host.innerHTML);
  }

  // ---- 入力 ----
  editor.addEventListener('input', (e) => {
    const host = e.target.closest('.gb-input');
    if (!host) return;
    const i = Number(host.dataset.i);
    const b = blocks[i];
    b.text = inlineFromHtml(host.innerHTML);

    // 「/」でブロックの種類のメニュー
    if (b.text.startsWith('/')) {
      openSlash(i, b.text.slice(1));
      saveLater();
      return;
    }
    closeSlash();

    const sc = shortcutFor(b);
    if (sc) {
      Object.assign(b, sc);
      render([i, 0]);
    } else {
      host.closest('.gb').classList.toggle('is-blank', !b.text);
    }
    saveLater();
  });

  /** Enter で作る次の行（ToDo・箇条書き・番号付きは同じ種類） */
  function newSibling(b, text) {
    const base = { indent: b.indent ?? 0, text };
    if (b.type === 'todo') return { ...base, type: 'todo', checked: false, month: null };
    if (b.type === 'bullet') return { ...base, type: 'bullet' };
    if (b.type === 'number') return { ...base, type: 'number' };
    return { type: 'text', indent: 0, text };
  }

  editor.addEventListener('keydown', (e) => {
    const host = e.target.closest('.gb-input');
    if (!host || e.isComposing || e.keyCode === 229) return; // 日本語の変換中は何もしない
    const i = Number(host.dataset.i);
    const b = blocks[i];

    if (e.key === 'Enter') {
      e.preventDefault();
      if (slash.hidden === false) return;
      // 空の ToDo・箇条書き・番号付きで Enter → まず入れ子を浅く、次に本文に戻す（Notion と同じ）
      if (!host.textContent && b.type !== 'text' && b.type !== 'heading') {
        if ((b.indent ?? 0) > 0) blocks[i] = { ...b, indent: b.indent - 1 };
        else blocks[i] = { type: 'text', indent: 0, text: '', _k: b._k };
        render([i, 0]);
        saveLater();
        return;
      }
      const { head, tail } = splitAtCaret(host);
      b.text = head;
      blocks.splice(i + 1, 0, { ...newSibling(b, tail), _k: key() });
      render([i + 1, 0]);
      saveLater();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      pull(i);
      indentBy(i, e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === 'Backspace' && caretOffset(host) === 0 && window.getSelection()?.isCollapsed) {
      if ((b.indent ?? 0) > 0) {
        e.preventDefault();
        pull(i);
        indentBy(i, -1);
        return;
      }
      if (b.type !== 'text') {
        // 行頭で削除 → まず記号を外して本文に
        e.preventDefault();
        pull(i);
        blocks[i] = { type: 'text', indent: 0, text: b.text, _k: b._k };
        render([i, 0]);
        saveLater();
        return;
      }
      if (i > 0) {
        // 前の行とつなぐ
        e.preventDefault();
        pull(i);
        const prev = blocks[i - 1];
        const at = inputAt(i - 1)?.textContent.length ?? 0;
        prev.text += b.text;
        blocks.splice(i, 1);
        render([i - 1, at]);
        saveLater();
      }
    }
  });

  /** 入れ子の深さを変える（先頭の行と見出し・本文は変えない） */
  function indentBy(i, dir) {
    const b = blocks[i];
    if (b.type === 'text' || b.type === 'heading') return;
    const prev = blocks[i - 1];
    const max = prev && prev.type !== 'text' && prev.type !== 'heading' ? Math.min(MAX_INDENT, (prev.indent ?? 0) + 1) : 0;
    const next = Math.max(0, Math.min(dir > 0 ? max : MAX_INDENT, (b.indent ?? 0) + dir));
    if (next === (b.indent ?? 0)) return;
    b.indent = next;
    const at = caretOffset(inputAt(i));
    render([i, at]);
    saveLater();
  }

  // ---- 貼り付け（書式は持ち込まず、行ごとに分ける）----
  editor.addEventListener('paste', (e) => {
    const host = e.target.closest('.gb-input');
    if (!host) return;
    e.preventDefault();
    const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
    if (!text) return;
    const i = Number(host.dataset.i);
    const lines = text.split('\n');
    if (lines.length === 1) {
      document.execCommand('insertText', false, text);
      blocks[i].text = inlineFromHtml(host.innerHTML);
      saveLater();
      return;
    }
    const { head, tail } = splitAtCaret(host);
    const b = blocks[i];
    const first = b.type === 'text' && !head ? lineToBlock(lines[0]) : { ...b, text: head + lines[0] };
    const rest = lines.slice(1).map(lineToBlock);
    if (tail) rest.push({ ...newSibling(b, tail) });
    blocks.splice(i, 1, ...[first, ...rest].map((x) => ({ ...x, _k: key() })));
    // 続く空行は1つにまとめる
    blocks = blocks.filter((x, k) => !(x.type === 'text' && !x.text && blocks[k - 1]?.type === 'text' && !blocks[k - 1]?.text));
    render([Math.min(i + lines.length - 1, blocks.length - 1)]);
    saveLater();
  });

  // ---- チェック・やる月 ----
  editor.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-check]');
    if (!cb) return;
    const b = blocks[Number(cb.dataset.check)];
    b.checked = cb.checked;
    cb.closest('.gb').classList.toggle('is-checked', cb.checked);
    save();
  });

  editor.addEventListener('click', (e) => {
    const mb = e.target.closest('[data-month]');
    if (mb) openMonthSheet(Number(mb.dataset.month));
  });

  // ---- 並べ替え ----
  makeSortable(editor, {
    onSort: (ids) => {
      const byKey = new Map(blocks.map((b) => [String(b._k), b]));
      blocks = ids.map((id) => byKey.get(id)).filter(Boolean);
      render();
      save();
    },
  });

  // ---- 書式ボタン ----
  let lastFocus = null;
  tools.addEventListener('pointerdown', (e) => e.preventDefault());
  tools.addEventListener('mousedown', (e) => e.preventDefault());
  tools.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tool]');
    const host = document.activeElement?.closest?.('.gb-input') ?? lastFocus;
    if (!btn || !host) return;
    const i = Number(host.dataset.i);
    const b = blocks[i];
    const tool = TOOLS.find((x) => x.key === btn.dataset.tool);

    if (tool.kind === 'mark') {
      // 選んだ文字だけに太字・打ち消しをかける
      host.focus();
      try {
        document.execCommand('styleWithCSS', false, 'false');
      } catch {
        /* 使えない環境では既定のまま */
      }
      document.execCommand(tool.key === 'bold' ? 'bold' : 'strikeThrough');
      blocks[i].text = inlineFromHtml(host.innerHTML);
      saveLater();
      return;
    }
    if (tool.kind === 'indent') {
      pull(i);
      indentBy(i, tool.key === 'indent' ? 1 : -1);
      return;
    }
    pull(i);
    const at = caretOffset(host);
    blocks[i] = { ...changeType(b, b.type === tool.key ? 'text' : tool.key), _k: b._k };
    render([i, at]);
    save();
  });

  // 書いている間だけ書式ボタンを出す
  el.addEventListener('focusin', (e) => {
    if (!e.target.closest('.gb-input')) return;
    lastFocus = e.target;
    tools.hidden = false;
  });
  el.addEventListener('focusout', () => {
    setTimeout(() => {
      if (el.contains(document.activeElement) && document.activeElement.closest('.gb-input')) return;
      tools.hidden = true;
      closeSlash();
      save();
    }, 0);
  });

  // ---- 「/」メニュー ----
  let slashFor = -1;
  function openSlash(i, query) {
    const list = BLOCK_TYPES.filter((x) => !query || t(x.label).toLowerCase().includes(query.toLowerCase()) || x.key.startsWith(query));
    if (!list.length) return closeSlash();
    slashFor = i;
    slash.innerHTML = list
      .map((x) => `<button type="button" role="option" data-pick="${x.key}">${t(x.label)}</button>`)
      .join('');
    slash.hidden = false;
    const r = inputAt(i)?.getBoundingClientRect();
    if (r) {
      slash.style.top = `${r.bottom + 4}px`;
      slash.style.left = `${Math.max(8, r.left)}px`;
    }
  }
  function closeSlash() {
    slash.hidden = true;
    slashFor = -1;
  }
  slash.addEventListener('pointerdown', (e) => e.preventDefault());
  slash.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn || slashFor < 0) return;
    const i = slashFor;
    blocks[i] = { ...changeType({ ...blocks[i], text: '' }, btn.dataset.pick), _k: blocks[i]._k };
    closeSlash();
    render([i, 0]);
    save();
  });

  // 下の余白をタップ → 最後の行の続きを書く
  el.querySelector('[data-tail]').addEventListener('click', () => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'text' && !last.text) {
      focusAt(blocks.length - 1, 0);
    } else {
      blocks.push({ type: 'text', indent: 0, text: '', _k: key() });
      render([blocks.length - 1, 0]);
    }
  });

  /** ToDo の「やる月」を選ぶシート */
  function openMonthSheet(i) {
    const b = blocks[i];
    if (!b || b.type !== 'todo') return;
    const cur = b.month ?? thisMonth();
    const sheet = openSheet({
      title: t('やる月'),
      body: `
        <p class="sheet-lead">${esc(b.text)}</p>
        <div class="row month-pick">
          <select class="select" name="year" aria-label="${t('年')}">${yearOptions(cur)}</select>
          <select class="select" name="mon" aria-label="${t('月')}">${monthOptions(cur)}</select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary btn-block" data-set>${t('保存')}</button>
          ${b.month ? `<button type="button" class="btn btn-block" data-clear>${t('月を外す')}</button>` : ''}
        </div>`,
    });
    const set = (month) => {
      b.month = month;
      save();
      sheet.close();
      render();
    };
    sheet.el.querySelector('[data-set]').addEventListener('click', () => {
      set(`${sheet.el.querySelector('[name="year"]').value}-${sheet.el.querySelector('[name="mon"]').value}`);
    });
    sheet.el.querySelector('[data-clear]')?.addEventListener('click', () => set(null));
  }

  // アプリを離れる時は保存
  const onHide = () => document.visibilityState === 'hidden' && save();
  document.addEventListener('visibilitychange', onHide);

  // 読み込み。復元などでほかから変わった時も描き直す（書いている最中は書いている内容を優先）
  const stop = watch(getNoteText, (text) => {
    if (text === saved) return;
    if (saved !== null && el.contains(document.activeElement)) return;
    saved = text;
    blocks = toEditBlocks(text).map((b) => ({ ...b, _k: key() }));
    render();
  });

  return () => {
    stop();
    save();
    document.removeEventListener('visibilitychange', onHide);
  };
}

// ===== カーソルの位置を扱う小さな関数 =====

/** 入力欄の中で、カーソルが何文字目にあるか（見えている文字で数える） */
function caretOffset(host) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !host) return 0;
  const r = sel.getRangeAt(0);
  if (!host.contains(r.endContainer)) return 0;
  const pre = document.createRange();
  pre.selectNodeContents(host);
  pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}

/** 入力欄の offset 文字目にカーソルを置く（Infinity で末尾） */
function setCaret(host, offset) {
  host.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  let left = offset;
  let done = false;
  (function walk(node) {
    if (done) return;
    if (node.nodeType === 3) {
      const len = node.nodeValue.length;
      if (left <= len) {
        range.setStart(node, left);
        done = true;
        return;
      }
      left -= len;
      return;
    }
    for (const c of node.childNodes) {
      walk(c);
      if (done) return;
    }
  })(host);
  if (done) range.collapse(true);
  else {
    range.selectNodeContents(host);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** カーソルより後ろを切り取り、前half・後ろ half をそれぞれ Markdown で返す */
function splitAtCaret(host) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return { head: inlineFromHtml(host.innerHTML), tail: '' };
  const r = sel.getRangeAt(0);
  const tail = document.createRange();
  tail.selectNodeContents(host);
  try {
    tail.setStart(r.endContainer, r.endOffset);
  } catch {
    return { head: inlineFromHtml(host.innerHTML), tail: '' };
  }
  const tmp = document.createElement('div');
  tmp.append(tail.extractContents());
  return { head: inlineFromHtml(host.innerHTML), tail: inlineFromHtml(tmp.innerHTML) };
}
