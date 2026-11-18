// オフラインでも開けるように Service Worker が最初に保存するファイルの一覧
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

/** 公開するファイルが入っているフォルダと、その中で対象にする拡張子 */
const DIRS = [
  ['css', /\.css$/],
  ['data', /\.json$/],
  ['icons', /\.png$/],
  ['js', /\.js$/],
  ['vendor', /\.m?js$/],
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** @returns {string[]} './' と index.html などに続けて、フォルダ内のファイルを名前順で */
export function appFiles() {
  const files = DIRS.flatMap(([dir, re]) =>
    walk(join(ROOT, dir))
      .map((p) => relative(ROOT, p).split('\\').join('/'))
      .filter((p) => re.test(p))
  ).sort();
  return ['./', 'index.html', 'manifest.webmanifest', ...files];
}
