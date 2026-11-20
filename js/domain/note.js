// 目標メモ：自分で掲げた目標・信念を書いておき、起動時に見る。他の機能とはつながらない独立した機能。
// 書き方は Notion からコピーした文と同じ（Markdown の一部）。画面や DB には依存しない純粋な関数。
//   # 見出し（## ### も可）
//   - [ ] ToDo　- [x] 済みの ToDo（- の代わりに * でも可）
//   - [ ] ToDo @2027-03 … 行の最後の @年-月 は「やる月」
//   - 箇条書き　1. 番号付き
//   行頭の空白2つでひとつ分の入れ子（インデント。最大3段）
//   **太字** ~~打ち消し~~（行の一部にもかけられる。v1.15）
//   それ以外の行は本文

/** 文字数の上限（バックアップや表示が重くならないように） */
export const NOTE_MAX = 5000;
/** インデントの上限 */
export const MAX_INDENT = 3;

const RE_HEADING = /^(#{1,3})\s+(.*)$/;
const RE_TODO = /^(\s*)[-*+]\s+\[( |x|X)\]\s?(.*)$/;
const RE_NUMBER = /^(\s*)\d+\.\s+(.*)$/;
const RE_BULLET = /^(\s*)[-*+]\s+(.*)$/;
/** ToDo の行の最後の「@2027-03」（やる月） */
const RE_MONTH = /\s*@(\d{4}-(?:0[1-9]|1[0-2]))\s*$/;

const indentOf = (spaces) => Math.min(MAX_INDENT, Math.floor(String(spaces ?? '').replace(/\t/g, '  ').length / 2));

/**
 * @typedef {{type:'heading', level:number, text:string, indent:number, line:number}
 *   | {type:'todo', checked:boolean, text:string, month:string|null, indent:number, line:number}
 *   | {type:'bullet'|'number'|'text', text:string, indent:number, line:number}
 *   | {type:'blank', line:number}} NoteBlock
 */

/**
 * 文を行ごとのブロックにする（line は元の文の何行目か）
 * @returns {NoteBlock[]}
 */
export function parseNote(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw, line) => {
      if (!raw.trim()) return { type: 'blank', line };
      let m = raw.match(RE_HEADING);
      if (m) return { type: 'heading', level: m[1].length, text: m[2].trim(), indent: 0, line };
      m = raw.match(RE_TODO);
      if (m) {
        const mm = m[3].match(RE_MONTH);
        const body = mm ? m[3].slice(0, mm.index) : m[3];
        return { type: 'todo', checked: m[2] !== ' ', text: body.trim(), month: mm ? mm[1] : null, indent: indentOf(m[1]), line };
      }
      m = raw.match(RE_NUMBER);
      if (m) return { type: 'number', text: m[2].trim(), indent: indentOf(m[1]), line };
      m = raw.match(RE_BULLET);
      if (m) return { type: 'bullet', text: m[2].trim(), indent: indentOf(m[1]), line };
      return { type: 'text', text: raw.trim(), indent: 0, line };
    });
}

/**
 * 画面で直接編集するためのブロック（1行 = 1ブロック）
 * @typedef {{type:'heading'|'todo'|'bullet'|'number'|'text', level?:number, checked?:boolean,
 *            month?:string|null, indent:number, text:string}} EditBlock
 * text は Markdown のまま持つ（**太字**・~~打ち消し~~ を含む）。
 * 空行は空の本文ブロック（続く空行は1つにまとめる）
 */

/** 文 → 編集ブロック。何も書いていなければ空の本文ブロック1つ */
export function toEditBlocks(text) {
  const out = [];
  for (const b of parseNote(text)) {
    if (b.type === 'blank') {
      if (out.length && out[out.length - 1].type === 'text' && out[out.length - 1].text === '') continue;
      out.push({ type: 'text', indent: 0, text: '' });
      continue;
    }
    const base = { type: b.type, indent: b.indent ?? 0, text: b.text };
    if (b.type === 'heading') base.level = b.level;
    if (b.type === 'todo') Object.assign(base, { checked: b.checked, month: b.month });
    out.push(base);
  }
  // 最初と最後の空行は除く
  while (out.length && out[0].type === 'text' && !out[0].text) out.shift();
  while (out.length > 1 && out[out.length - 1].type === 'text' && !out[out.length - 1].text) out.pop();
  return out.length ? out : [{ type: 'text', indent: 0, text: '' }];
}

/** 1行の文 → 編集ブロック（貼り付け用） */
export function lineToBlock(line) {
  return toEditBlocks(line)[0];
}

/** 編集ブロック → 保存する文 */
export function fromEditBlocks(blocks) {
  return blocks
    .map((b) => {
      const pad = '  '.repeat(Math.min(MAX_INDENT, b.indent ?? 0));
      switch (b.type) {
        case 'heading':
          return `${'#'.repeat(b.level || 2)} ${b.text}`;
        case 'todo':
          return `${pad}- [${b.checked ? 'x' : ' '}] ${b.text}${b.month ? ` @${b.month}` : ''}`;
        case 'bullet':
          return `${pad}- ${b.text}`;
        case 'number':
          return `${pad}1. ${b.text}`;
        default:
          return b.text;
      }
    })
    .join('\n')
    .replace(/\n+$/, '');
}

/** 番号付きリストの、画面に出す番号（同じ深さで続いている分を数える） */
export function numberFor(blocks, i) {
  const me = blocks[i];
  let n = 1;
  for (let k = i - 1; k >= 0; k--) {
    const b = blocks[k];
    if (b.type === 'number' && b.indent === me.indent) n++;
    else if ((b.type === 'number' || b.type === 'bullet' || b.type === 'todo') && b.indent > me.indent) continue;
    else break;
  }
  return n;
}

/**
 * 書きながらの記号の変換（Notion と同じ）。行の先頭に
 *   「# 」「## 」「### 」→ 見出し、「[] 」「[ ] 」「- [ ] 」→ ToDo、
 *   「- 」「* 」→ 箇条書き、「1. 」→ 番号付き
 * @param {EditBlock} block
 * @returns {Partial<EditBlock>|null} 変える内容（text は記号を除いた残り）。変えなければ null
 */
export function shortcutFor(block) {
  const v = block.text;
  if (block.type === 'text') {
    let m = v.match(/^(#{1,3}) (.*)$/s);
    if (m) return { type: 'heading', level: m[1].length, text: m[2] };
    m = v.match(/^(?:[-*] )?\[ ?\] (.*)$/s);
    if (m) return { type: 'todo', checked: false, month: null, text: m[1] };
    m = v.match(/^[-*] (.*)$/s);
    if (m) return { type: 'bullet', text: m[1] };
    m = v.match(/^\d+\. (.*)$/s);
    if (m) return { type: 'number', text: m[1] };
  }
  if (block.type === 'bullet' || block.type === 'number') {
    const m = v.match(/^\[ ?\] (.*)$/s);
    if (m) return { type: 'todo', checked: false, month: null, text: m[1] };
  }
  return null;
}

// ===== 行の中の装飾（**太字**・~~打ち消し~~）と HTML の行き来 =====
// 画面は contenteditable なので、保存する Markdown と表示する HTML を変換する。

const escapeHtml = (s) =>
  String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Markdown の1行 → 表示する HTML */
export function inlineToHtml(src) {
  return escapeHtml(src)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>');
}

/** 表示していた HTML → 保存する Markdown の1行 */
export function inlineFromHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<br\s*\/?>/gi, '');
  s = s.replace(/<(?:b|strong)(?:\s[^>]*)?>|<\/(?:b|strong)>/gi, '\u0001');
  s = s.replace(/<(?:s|del|strike)(?:\s[^>]*)?>|<\/(?:s|del|strike)>/gi, '\u0002');
  s = s.replace(/<[^>]*>/g, ''); // ほかのタグ（div・span など）は外す
  s = s.replaceAll('\u0001', '**').replaceAll('\u0002', '~~');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&'); // & は最後に戻す
  return s.replaceAll('****', '').replaceAll('~~~~', '');
}

/** ブロックの種類（「/」メニューと書式ボタンで使う） */
export const BLOCK_TYPES = [
  { key: 'text', label: '本文' },
  { key: 'heading', label: '見出し' },
  { key: 'todo', label: 'ToDo' },
  { key: 'bullet', label: '箇条書き' },
  { key: 'number', label: '番号付き' },
];

/** 種類を変えた新しいブロックを作る（text と indent は引き継ぐ） */
export function changeType(block, type, level = 2) {
  const base = { type, indent: type === 'heading' ? 0 : (block.indent ?? 0), text: block.text };
  if (type === 'heading') base.level = level;
  if (type === 'todo') Object.assign(base, { checked: block.checked ?? false, month: block.month ?? null });
  return base;
}
