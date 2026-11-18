#!/bin/sh
# vendor/dexie.mjs と vendor/dexie-cloud-addon.mjs を作り直す（Dexie を更新する時だけ使う）
#   sh tools/build-dexie-cloud.sh 4.4.7 4.4.16   … dexie の版・dexie-cloud-addon の版
# dexie-cloud-addon は中で yjs や rxjs を使うので、esbuild で1ファイルにまとめる。
# dexie 本体はまとめず vendor/dexie.mjs を読むように書き換える（Dexie が2つになると動かないため）
set -e
DEXIE=${1:?dexie version}
ADDON=${2:?dexie-cloud-addon version}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
cd "$WORK"
npm init -y >/dev/null
npm i -s "dexie@$DEXIE" "dexie-cloud-addon@$ADDON" esbuild >/dev/null
echo "export { default } from 'dexie-cloud-addon';" > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --minify --target=safari15 --external:dexie \
  --conditions=production --outfile=out.mjs \
  --banner:js="/* dexie-cloud-addon $ADDON (Apache-2.0, https://dexie.org) を esbuild で1ファイルにまとめたもの。同梱：yjs・y-dexie・y-protocols・lib0（MIT）、rxjs（Apache-2.0）、dexie-cloud-common（Apache-2.0）。再生成は tools/build-dexie-cloud.sh */"
sed 's/from"dexie"/from".\/dexie.mjs"/g' out.mjs > "$ROOT/vendor/dexie-cloud-addon.mjs"
cp node_modules/dexie/dist/dexie.mjs "$ROOT/vendor/dexie.mjs"
rm -rf "$WORK"
echo "vendor/dexie.mjs ($DEXIE) と vendor/dexie-cloud-addon.mjs ($ADDON) を更新しました"
