// 金額入力の電卓
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initCalc, applyKey, calcDisplay, calcExpression } from '../js/domain/calc.js';

const press = (keys, start = '') => keys.split(' ').reduce((s, k) => applyKey(s, k), initCalc(start));

test('数字を並べて入れられる。先頭の0は消える', () => {
  assert.equal(calcDisplay(press('1 2 8 0')), '1280');
  assert.equal(calcDisplay(press('0 5')), '5');
  assert.equal(calcDisplay(press('1 00')), '100');
});

test('足し算：レシートの2つの金額を足す', () => {
  assert.equal(calcDisplay(press('1 2 8 0 + 3 9 8 =')), '1678');
});

test('続けて計算できる（＝のあとに演算子を押す）', () => {
  assert.equal(calcDisplay(press('1 0 0 + 2 0 = + 5 =')), '125');
});

test('演算子を押すたびに前までの結果が出る', () => {
  const s = press('1 0 0 + 2 0 +');
  assert.equal(calcDisplay(s), '120');
  assert.equal(calcExpression(s), '120 +');
});

test('引き算・掛け算・割り算。小数は四捨五入', () => {
  assert.equal(calcDisplay(press('5 0 0 − 1 2 0 =')), '380');
  assert.equal(calcDisplay(press('2 9 8 × 3 =')), '894');
  assert.equal(calcDisplay(press('1 0 0 0 ÷ 3 =')), '333');
});

test('マイナスにはならない（0で止まる）', () => {
  assert.equal(calcDisplay(press('1 0 0 − 5 0 0 =')), '0');
});

test('0で割ると空になる', () => {
  assert.equal(calcDisplay(press('1 0 0 ÷ 0 =')), '');
});

test('⌫ は1文字消す。計算直後は丸ごと消える', () => {
  assert.equal(calcDisplay(press('1 2 3 ⌫')), '12');
  assert.equal(calcDisplay(press('1 + 1 = ⌫')), '');
  assert.equal(calcDisplay(press('1 2 3 C')), '');
});

test('演算子を押し直せる', () => {
  assert.equal(calcDisplay(press('1 0 0 + × 3 =')), '300');
});

test('計算のあとに数字を打つと新しい数になる', () => {
  assert.equal(calcDisplay(press('1 0 0 + 5 = 7')), '7');
});

test('途中式は計算中だけ出る', () => {
  assert.equal(calcExpression(press('1 2 8 0 +')), '1,280 +');
  assert.equal(calcExpression(press('1 2 8 0')), '');
  assert.equal(calcExpression(press('1 + 2 =')), '');
});
