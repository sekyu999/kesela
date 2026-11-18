// 版を上げる・オフライン用のファイル一覧を作り直す
//
//   node tools/release.mjs 1.14.0   … 版を 1.14.0 にする（js/lib/version.js と sw.js の CACHE をそろえる）
//   node tools/release.mjs          … 版はそのまま、sw.js の APP_FILES だけ作り直す
//
// APP_FILES は実際にあるファイルから作るので、ファイルを足した・消した時に手で直さなくてよい。
import { readFileSync, writeFileSync } from 'node:fs';
import { appFiles, ROOT } from './appFiles.mjs';

const VERSION_FILE = `${ROOT}/js/lib/version.js`;
const SW_FILE = `${ROOT}/sw.js`;

const next = process.argv[2];
if (next && !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`版は 1.14.0 のような形で指定してください: ${next}`);
  process.exit(1);
}

let version = readFileSync(VERSION_FILE, 'utf8');
let sw = readFileSync(SW_FILE, 'utf8');

if (next) {
  version = version.replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${next}'`);
  sw = sw.replace(/const CACHE = 'kesela-[^']*'/, `const CACHE = 'kesela-${next}'`);
}

const list = appFiles().map((f) => `  '${f}',`).join('\n');
sw = sw.replace(/const APP_FILES = \[[\s\S]*?\n\];/, `const APP_FILES = [\n${list}\n];`);

writeFileSync(VERSION_FILE, version);
writeFileSync(SW_FILE, sw);
const current = version.match(/APP_VERSION = '([^']*)'/)[1];
console.log(`版 ${current}・オフライン用ファイル ${appFiles().length} 件`);
