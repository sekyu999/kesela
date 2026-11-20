import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNote,
  toEditBlocks,
  fromEditBlocks,
  lineToBlock,
  shortcutFor,
  changeType,
  numberFor,
  inlineToHtml,
  inlineFromHtml,
} from '../js/domain/note.js';

test('目標：Notion から貼り付けた文をブロックに分ける', () => {
  const b = parseNote('# Goal\n\n* [ ] ~~韓国旅行~~\n- [x] 睡眠トラッキング\n美\n- 箇条書き');
  assert.deepEqual(
    b.map((x) => x.type),
    ['heading', 'blank', 'todo', 'todo', 'text', 'bullet']
  );
  assert.equal(b[0].level, 1);
  assert.deepEqual(b[2], { type: 'todo', checked: false, text: '~~韓国旅行~~', month: null, indent: 0, line: 2 });
  assert.equal(b[3].checked, true);
});

test('目標：やる月', () => {
  const b = parseNote('- [ ] 韓国旅行 @2027-03\n- [ ] 焼肉 @2027-13');
  assert.equal(b[0].month, '2027-03');
  assert.equal(b[0].text, '韓国旅行');
  assert.equal(b[1].month, null);
});

test('目標：編集ブロックとの変換（打ち消し・空行・やる月）', () => {
  const blocks = toEditBlocks('\n# Goal\n\n\n* [ ] ~~韓国旅行~~ @2027-03\n- [x] 睡眠\n~~尊敬~~\n一部~~だけ~~\n\n');
  assert.deepEqual(blocks, [
    { type: 'heading', level: 1, indent: 0, text: 'Goal' },
    { type: 'text', indent: 0, text: '' },
    { type: 'todo', checked: false, month: '2027-03', indent: 0, text: '~~韓国旅行~~' },
    { type: 'todo', checked: true, month: null, indent: 0, text: '睡眠' },
    { type: 'text', indent: 0, text: '~~尊敬~~' },
    { type: 'text', indent: 0, text: '一部~~だけ~~' },
  ]);
  assert.equal(fromEditBlocks(blocks), '# Goal\n\n- [ ] ~~韓国旅行~~ @2027-03\n- [x] 睡眠\n~~尊敬~~\n一部~~だけ~~');
  assert.deepEqual(toEditBlocks(''), [{ type: 'text', indent: 0, text: '' }]);
  assert.equal(lineToBlock('- 箇条').type, 'bullet');
  assert.equal(fromEditBlocks([{ type: 'heading', level: 2, indent: 0, text: '美' }]), '## 美');
});

test('目標：入れ子（インデント）と番号付きリスト（v1.15）', () => {
  const blocks = toEditBlocks('- 親\n  - 子\n    - 孫\n1. いち\n2. に\n  1. 中の1');
  assert.deepEqual(
    blocks.map((b) => [b.type, b.indent, b.text]),
    [
      ['bullet', 0, '親'],
      ['bullet', 1, '子'],
      ['bullet', 2, '孫'],
      ['number', 0, 'いち'],
      ['number', 0, 'に'],
      ['number', 1, '中の1'],
    ]
  );
  // 保存し直しても同じ形に戻る（番号は 1. で保存し、表示の時に数え直す）
  assert.deepEqual(toEditBlocks(fromEditBlocks(blocks)), blocks);
  assert.equal(numberFor(blocks, 3), 1);
  assert.equal(numberFor(blocks, 4), 2);
  assert.equal(numberFor(blocks, 5), 1);
});

test('目標：行の中の太字・打ち消しと HTML の行き来（v1.15）', () => {
  assert.equal(inlineToHtml('本文**太字**と~~消し~~'), '本文<strong>太字</strong>と<s>消し</s>');
  assert.equal(inlineToHtml('a<b>&'), 'a&lt;b&gt;&amp;');
  assert.equal(inlineFromHtml('本文<strong>太字</strong>と<s>消し</s>'), '本文**太字**と~~消し~~');
  // ブラウザが入れる b / strike / span / br も読み取れる
  assert.equal(inlineFromHtml('<b>太</b><strike>消</strike><span style="x">普通</span><br>'), '**太**~~消~~普通');
  assert.equal(inlineFromHtml('a&lt;b&gt;&amp;&nbsp;c'), 'a<b>& c');
  // 一周して元に戻る
  const src = '朝**5時**起き ~~夜更かし~~ しない';
  assert.equal(inlineFromHtml(inlineToHtml(src)), src);
});

test('目標：ブロックの種類を変えても文と入れ子は残る', () => {
  const b = { type: 'bullet', indent: 2, text: '走る' };
  assert.deepEqual(changeType(b, 'todo'), { type: 'todo', indent: 2, text: '走る', checked: false, month: null });
  // 見出しは入れ子にしない
  assert.deepEqual(changeType(b, 'heading'), { type: 'heading', indent: 0, text: '走る', level: 2 });
});

test('目標：書きながらの記号の変換', () => {
  assert.deepEqual(shortcutFor({ type: 'text', text: '## 美' }), { type: 'heading', level: 2, text: '美' });
  assert.deepEqual(shortcutFor({ type: 'text', text: '[] 旅行' }), { type: 'todo', checked: false, month: null, text: '旅行' });
  assert.deepEqual(shortcutFor({ type: 'text', text: '- [ ] ' }), { type: 'todo', checked: false, month: null, text: '' });
  assert.deepEqual(shortcutFor({ type: 'text', text: '- ' }), { type: 'bullet', text: '' });
  assert.deepEqual(shortcutFor({ type: 'bullet', text: '[ ] a' }), { type: 'todo', checked: false, month: null, text: 'a' });
  assert.deepEqual(shortcutFor({ type: 'text', text: '1. 一つ目' }), { type: 'number', text: '一つ目' });
  assert.equal(shortcutFor({ type: 'text', text: '#見出しではない' }), null);
  assert.equal(shortcutFor({ type: 'heading', text: '# a' }), null);
});
