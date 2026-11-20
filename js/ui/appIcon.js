// アプリアイコン（3種類から選ぶ。端末ごとの好みなので localStorage に保存する）
//
// ・タブやブックマークのアイコン（ファビコン）はその場で変わる
// ・iPhone のホーム画面のアイコンは「ホーム画面に追加」した時の絵が使われるため、
//   すでに追加してある場合は、一度消してから追加し直すと変わる
const KEY = 'yuteli.appIcon';

export const APP_ICONS = [
  { key: 'a', label: 'K' },
  { key: 'b', label: '丸と弧' },
  { key: 'c', label: '半分の丸' },
];

export function appIcon() {
  try {
    const v = localStorage.getItem(KEY);
    return APP_ICONS.some((o) => o.key === v) ? v : 'a';
  } catch {
    return 'a';
  }
}

export function setAppIcon(key) {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* 保存できなくても動作には影響しない */
  }
  applyAppIcon();
}

/** 今選んでいるアイコンを <link> に反映する */
export function applyAppIcon() {
  const k = appIcon();
  const set = (selector, href) => {
    const el = document.querySelector(selector);
    if (el) el.href = href;
  };
  set('link[rel="icon"][type="image/svg+xml"]', `icons/${k}/favicon.svg`);
  set('link[rel="icon"][sizes="32x32"]', `icons/${k}/favicon-32.png`);
  set('link[rel="icon"][sizes="16x16"]', `icons/${k}/favicon-16.png`);
  set('link[rel="apple-touch-icon"]', `icons/${k}/apple-touch-icon.png`);
}
