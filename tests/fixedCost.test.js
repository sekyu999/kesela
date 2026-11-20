// 固定費（有効判定・日付の丸め・毎月の自動計上・二重計上の防止）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isActiveIn, dateInMonth, fixedRowId, monthsToGenerate, rowsToCreate, validateFixedCostInput } from '../js/domain/fixedCost.js';

const rent = { id: 'a', type: 'expense', name: '家賃', amount: 80000, categoryId: 'c1', dayOfMonth: 27, startMonth: '2026-01', endMonth: null };

test('始まりの月より前・終わりの月より後は作らない', () => {
  assert.equal(isActiveIn(rent, '2026-01'), true);
  assert.equal(isActiveIn(rent, '2025-12'), false);
  assert.equal(isActiveIn({ ...rent, endMonth: '2026-10' }, '2026-10'), true);
  assert.equal(isActiveIn({ ...rent, endMonth: '2026-10' }, '2026-11'), false);
});

test('その月に無い日は末日に丸める', () => {
  assert.equal(dateInMonth('2026-11', 27), '2026-11-27');
  assert.equal(dateInMonth('2026-02', 31), '2026-02-28');
  assert.equal(dateInMonth('2028-02', 31), '2028-02-29');
  assert.equal(dateInMonth('2026-11', null), '2026-11-01');
});

test('記録の ID は固定費と月から決まる（別の端末でも同じ）', () => {
  assert.equal(fixedRowId('a', '2026-11'), 'fx-2026-11-a');
});

test('作るべき月：前回の次から今月まで。初回は今月だけ', () => {
  assert.deepEqual(monthsToGenerate(null, '2026-11'), ['2026-11']);
  assert.deepEqual(monthsToGenerate('2026-08', '2026-11'), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(monthsToGenerate('2026-11', '2026-11'), []);
  assert.deepEqual(monthsToGenerate('2026-12', '2026-11'), []);
});

test('間が空きすぎた時は新しい方の月を上限まで（必ず今月を含む）', () => {
  const months = monthsToGenerate('2020-01', '2026-11');
  assert.equal(months.length, 24);
  assert.equal(months[months.length - 1], '2026-11');
  assert.equal(months[0], '2024-12');
});

test('同じ月に二度作らない（何度呼んでも増えない）', () => {
  const first = rowsToCreate([rent], [], '2026-11', 'T');
  assert.equal(first.length, 1);
  assert.deepEqual(
    [first[0].id, first[0].date, first[0].amount, first[0].source, first[0].type],
    ['fx-2026-11-a', '2026-11-27', 80000, 'fixed', 'expense']
  );
  assert.deepEqual(rowsToCreate([rent], first, '2026-11', 'T'), []);
});

test('手で入れた記録があっても固定費は作られる（別物として扱う）', () => {
  const manual = [{ id: 'x', fixedCostId: null, type: 'expense', amount: 80000 }];
  assert.equal(rowsToCreate([rent], manual, '2026-11', 'T').length, 1);
});

test('固定収入（給与）も同じ形で作る', () => {
  const pay = { ...rent, id: 'b', type: 'income', name: '給与', amount: 300000, dayOfMonth: 25 };
  const rows = rowsToCreate([pay], [], '2026-11', 'T');
  assert.equal(rows[0].type, 'income');
  assert.equal(rows[0].date, '2026-11-25');
});

test('固定費の入力：名前・金額・カテゴリは必須、終わりの月は始まりより後', () => {
  const base = { type: 'expense', name: '家賃', amount: '80,000', categoryId: 'c1', dayOfMonth: '27', startMonth: '2026-01' };
  const r = validateFixedCostInput(base, '2026-11');
  assert.equal(r.value.amount, 80000);
  assert.equal(r.value.dayOfMonth, 27);
  assert.equal(r.value.endMonth, null);
  assert.equal(validateFixedCostInput({ ...base, name: '' }, '2026-11').ok, false);
  assert.equal(validateFixedCostInput({ ...base, amount: '0' }, '2026-11').ok, false);
  assert.equal(validateFixedCostInput({ ...base, dayOfMonth: '32' }, '2026-11').errors.dayOfMonth, '1〜31の日を選んでください');
  assert.equal(validateFixedCostInput({ ...base, ended: true, endMonth: '2025-12' }, '2026-11').errors.endMonth, '始まりの月より後にしてください');
  assert.equal(validateFixedCostInput({ ...base, ended: true, endMonth: '2026-06' }, '2026-11').value.endMonth, '2026-06');
});

test('年平均：空欄は数に入れず、四捨五入した整数の円にする', async () => {
  const { averageAmount } = await import('../js/domain/fixedCost.js');
  assert.deepEqual(averageAmount(['8,000', '12000', '', '10000']), { average: 10000, count: 3 });
  assert.deepEqual(averageAmount(['1000', '1001']), { average: 1001, count: 2 });
  assert.deepEqual(averageAmount(['', '0', 'abc']), { average: 0, count: 0 });
});

test('隔月：いつからの月を基準に、間隔の月だけ有効', async () => {
  const { isActiveIn, cycleOf, cycleLabel } = await import('../js/domain/fixedCost.js');
  const water = { ...rent, name: '水道', startMonth: '2026-11', everyMonths: 2 };
  assert.deepEqual(
    ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'].map((m) => isActiveIn(water, m)),
    [false, true, false, true, false]
  );
  // 3か月ごと
  const g = { ...rent, startMonth: '2026-01', everyMonths: 3 };
  assert.deepEqual(['2026-01', '2026-02', '2026-04', '2026-07'].map((m) => isActiveIn(g, m)), [true, false, true, true]);
  // 指定なし・おかしい値は毎月あつかい
  assert.equal(cycleOf({}), 1);
  assert.equal(cycleOf({ everyMonths: 5 }), 1);
  assert.equal(isActiveIn({ ...rent, everyMonths: undefined }, '2026-12'), true);
  assert.equal(cycleLabel({ everyMonths: 1 }), '');
});

test('隔月の固定費は、来ない月には記録を作らない', async () => {
  const { rowsToCreate } = await import('../js/domain/fixedCost.js');
  const water = { ...rent, id: 'w', startMonth: '2026-11', everyMonths: 2, amount: 5200 };
  assert.equal(rowsToCreate([water], [], '2026-11', 'T').length, 1);
  assert.equal(rowsToCreate([water], [], '2026-12', 'T').length, 0);
  assert.equal(rowsToCreate([water], [], '2027-01', 'T').length, 1);
});
