// 起動時に出す画面（端末ごとの好み。localStorage に保存する）
// v1.15 で「起動時に目標を表示（yuteli.noteOnLaunch）」から置き換えた。初期値は家計。
const KEY = 'yuteli.startScreen';

export const START_OPTIONS = [
  { key: 'budget', label: '家計' },
  { key: 'goals', label: '目標' },
  { key: 'last', label: '最後に見た画面' },
];

export function startScreen() {
  try {
    const v = localStorage.getItem(KEY);
    return START_OPTIONS.some((o) => o.key === v) ? v : 'budget';
  } catch {
    return 'budget';
  }
}

export function setStartScreen(key) {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* 保存できなくても動作には影響しない */
  }
}
