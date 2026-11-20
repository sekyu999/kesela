// カレンダーの週の始まり（端末ごとの好み。localStorage に保存する）
const KEY = 'yuteli.weekStart';

export const WEEK_OPTIONS = [
  { key: 'sun', label: '日曜' },
  { key: 'mon', label: '月曜' },
];

/** 週の始まりの曜日番号（0＝日曜、1＝月曜） */
export function weekStart() {
  try {
    return localStorage.getItem(KEY) === 'mon' ? 1 : 0;
  } catch {
    return 0;
  }
}

export function setWeekStart(key) {
  try {
    localStorage.setItem(KEY, key === 'mon' ? 'mon' : 'sun');
  } catch {
    /* 保存できなくても動作には影響しない */
  }
}

/** 曜日の見出しを、週の始まりに合わせて並べ替える */
export function weekDays(labels) {
  const s = weekStart();
  return labels.slice(s).concat(labels.slice(0, s));
}
