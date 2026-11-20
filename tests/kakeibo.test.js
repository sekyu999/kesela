// 家計簿の計算（月の集計・予算・カテゴリ別・貯金ペース・達成見込み）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthRange,
  monthOf,
  summarize,
  byCategory,
  donutSlices,
  monthsBetween,
  savingsPace,
  validateTransactionInput,
  validateYenOrEmpty,
} from '../js/domain/kakeibo.js';

const tx = (type, amount, extra = {}) => ({ type, amount, date: '2026-11-10', categoryId: 'c1', source: 'manual', ...extra });

test('月の範囲は末日まで（うるう年も）', () => {
  assert.deepEqual(monthRange('2026-11'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(monthOf('2026-11-10'), '2026-11');
});

test('貯金額は収入−支出、固定費は支出に含まれる（二重に数えない）', () => {
  const s = summarize([
    tx('income', 300000, { source: 'fixed' }),
    tx('expense', 80000, { source: 'fixed' }),
    tx('expense', 12000, { source: 'fixed' }),
    tx('expense', 32000),
  ]);
  assert.equal(s.income, 300000);
  assert.equal(s.expense, 124000);
  assert.equal(s.fixed, 92000);
  assert.equal(s.variable, 32000);
  assert.equal(s.savings, 176000);
});

test('使えるお金は収入−支出−貯金目標。目標がなければ出さない', () => {
  const rows = [tx('income', 300000), tx('expense', 120000)];
  assert.equal(summarize(rows, { savingsGoal: 50000 }).free, 130000);
  assert.equal(summarize(rows, { savingsGoal: 50000 }).toGoal, -130000);
  assert.equal(summarize(rows).free, null);
  assert.equal(summarize(rows, { savingsGoal: 0 }).free, null);
});

test('収入が1件も無いと分かる（固定収入の未登録を知らせる用）', () => {
  assert.equal(summarize([tx('expense', 1000)]).hasIncome, false);
  assert.equal(summarize([tx('income', 1)]).hasIncome, true);
});

test('カテゴリ別は多い順、割合は支出合計に対して', () => {
  const cats = [
    { id: 'c1', name: '食費', colorIndex: 0 },
    { id: 'c2', name: '日用品', colorIndex: 1 },
  ];
  const rows = byCategory([tx('expense', 30000), tx('expense', 10000, { categoryId: 'c2' }), tx('income', 99999)], cats, []);
  assert.deepEqual(
    rows.map((r) => [r.name, r.amount, Math.round(r.ratio * 100)]),
    [
      ['食費', 30000, 75],
      ['日用品', 10000, 25],
    ]
  );
});

test('固定費はカテゴリではなく固定費の名前と色でまとめる', () => {
  const cats = [{ id: 'c1', name: '食費', colorIndex: 0 }];
  const fixed = [{ id: 'f1', name: '家賃', colorIndex: 4 }];
  const rows = byCategory(
    [
      tx('expense', 80000, { categoryId: null, fixedCostId: 'f1', source: 'fixed' }),
      tx('expense', 12000, { categoryId: null, fixedCostId: 'f1', source: 'fixed' }),
      tx('expense', 30000),
    ],
    cats,
    fixed
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.amount, r.colorIndex, r.fixedCostId]),
    [
      ['家賃', 92000, 4, 'f1'],
      ['食費', 30000, 0, null],
    ]
  );
});

test('ドーナツの区切りは前の分だけずれる', () => {
  const slices = donutSlices([{ ratio: 0.5 }, { ratio: 0.3 }, { ratio: 0.2 }]);
  assert.deepEqual(
    slices.map((s) => [s.length, s.offset]),
    [
      [50, 0],
      [30, 50],
      [20, 80],
    ]
  );
});

test('貯金ペースは新しい方から3か月の平均', () => {
  const monthly = [
    { month: '2026-08', savings: 100 },
    { month: '2026-09', savings: 20000 },
    { month: '2026-10', savings: 30000 },
    { month: '2026-11', savings: 40000 },
  ];
  assert.equal(savingsPace(monthly), 30000);
  assert.equal(savingsPace([]), null);
  assert.equal(monthsBetween('2026-11', '2027-03'), 4);
});

test('記録の入力：金額は1円以上の整数、カテゴリと日付は必須', () => {
  const base = { type: 'expense', amount: '1,280', categoryId: 'c1', date: '2026-11-20' };
  assert.equal(validateTransactionInput(base).value.amount, 1280);
  assert.equal(validateTransactionInput({ ...base, amount: '' }).errors.amount, '金額を入力してください');
  assert.equal(validateTransactionInput({ ...base, amount: '0' }).ok, false);
  assert.equal(validateTransactionInput({ ...base, amount: '1.5' }).ok, false);
  assert.equal(validateTransactionInput({ ...base, categoryId: '' }).ok, false);
  assert.equal(validateTransactionInput({ ...base, date: '2026-13-01' }).ok, false);
  assert.equal(validateTransactionInput({ ...base, type: 'income' }).value.type, 'income');
});

test('金額の入力（貯金目標）：空欄は「設定しない」', () => {
  assert.deepEqual(validateYenOrEmpty(''), { ok: true, value: null });
  assert.deepEqual(validateYenOrEmpty('200,000'), { ok: true, value: 200000 });
  assert.equal(validateYenOrEmpty('-1').ok, false);
});
