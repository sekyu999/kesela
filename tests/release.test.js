// 版の食い違い・オフライン用ファイルの書き忘れを見つける
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appFiles, ROOT } from '../tools/appFiles.mjs';

const sw = readFileSync(`${ROOT}/sw.js`, 'utf8');
const version = readFileSync(`${ROOT}/js/lib/version.js`, 'utf8');

test('js/lib/version.js と sw.js の CACHE の版が同じ', () => {
  const app = version.match(/APP_VERSION = '([^']*)'/)[1];
  const cache = sw.match(/const CACHE = 'kesela-([^']*)'/)[1];
  assert.equal(cache, app, 'node tools/release.mjs <版> で両方をそろえてください');
});

test('sw.js の APP_FILES が実際のファイルと一致する', () => {
  const listed = [...sw.match(/const APP_FILES = \[([\s\S]*?)\n\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, appFiles(), 'node tools/release.mjs で作り直してください');
});
