// 同期のログイン画面（メールアドレス → メールに届いたコード）
// 同期用の部品（Dexie Cloud）が「メールアドレスを入れて」などを求めてきたら、シートで表示する。
import { openSheet } from '../ui/sheet.js';
import { watchLoginRequests } from '../data/sync.js';
import { esc } from '../lib/util.js';
import { t } from '../lib/i18n.js';

const TITLES = {
  email: '同期にログイン',
  otp: '確認コードを入力',
  'message-alert': 'お知らせ',
  'logout-confirmation': 'ログアウトの確認',
};

const SUBMIT_LABELS = {
  email: 'コードを送る',
  otp: 'ログイン',
  'logout-confirmation': 'ログアウトする',
};

const FIELD_LABELS = {
  email: 'メールアドレス',
  otp: '確認コード（メールに届いた数字）',
};

/** 同期用の部品が出すお知らせの種類ごとの文 */
const ALERTS = {
  OTP_SENT: '{email} に確認コードを送りました。メールを確認してください',
  INVALID_OTP: 'コードが違います。もう一度入力してください',
  INVALID_EMAIL: 'メールアドレスの形が正しくありません',
  LICENSE_LIMIT_REACHED: '無料プランで使える人数を超えています',
  NO_SEATS_AVAILABLE: '無料プランで使える人数を超えています',
  USER_NOT_REGISTERED: 'このメールアドレスでは使えません',
  USER_NOT_ACCEPTED: 'このメールアドレスでは使えません',
  USER_DEACTIVATED: 'このメールアドレスでは使えません',
  LOGOUT_CONFIRMATION: 'まだ同期していない変更があります。ログアウトすると失われます',
};

function alertText(a) {
  const key = ALERTS[a.messageCode];
  if (key) return t(key, { email: a.messageParams?.email ?? '' });
  return a.message; // そのほかは同期用の部品の文（英語）をそのまま出す
}

function fieldHtml(name, field) {
  const label = FIELD_LABELS[name] ? t(FIELD_LABELS[name]) : field.label ?? name;
  const attrs =
    name === 'email'
      ? 'type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false"'
      : name === 'otp'
        ? 'type="text" inputmode="numeric" autocomplete="one-time-code"'
        : field.type === 'password'
          ? 'type="password"'
          : 'type="text"';
  return `<div class="field">
    <label for="login-${esc(name)}">${esc(label)}</label>
    <input id="login-${esc(name)}" name="${esc(name)}" class="input" ${attrs} required>
  </div>`;
}

/** 起動時に1回呼ぶ。以後、ログインが必要になるたびにシートを出す */
export function bindLoginSheet() {
  let current = null;
  return watchLoginRequests((ui) => {
    if (current) {
      current.replaced = true;
      current.sheet.close();
      current = null;
    }
    if (!ui) return;
    const entry = { replaced: false, submitted: false, sheet: null };
    const fields = Object.entries(ui.fields ?? {});
    entry.sheet = openSheet({
      title: t(TITLES[ui.type] ?? '同期'),
      body: `
        <form novalidate class="login-form">
          ${(ui.alerts ?? [])
            .map((a) => `<p class="${a.type === 'error' ? 'notice' : 'note'}" style="margin-bottom:12px">${esc(alertText(a))}</p>`)
            .join('')}
          ${ui.type === 'email' ? `<p class="note" style="margin-bottom:12px">${t('パスワードは不要です。入力したメールアドレスに確認コードが届きます')}</p>` : ''}
          ${fields.map(([name, f]) => fieldHtml(name, f)).join('')}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-block">${esc(t(SUBMIT_LABELS[ui.type] ?? 'OK'))}</button>
            ${ui.cancelLabel ? `<button type="button" class="btn btn-block" data-cancel>${t('キャンセル')}</button>` : ''}
          </div>
        </form>`,
      onClose: () => {
        // ほかの画面に置き換わった・送信した時以外（× や背景のタップ）はキャンセル扱い
        if (!entry.replaced && !entry.submitted) ui.onCancel();
      },
    });
    const form = entry.sheet.el.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const [name] of fields) values[name] = form.elements[name].value.trim();
      if (fields.some(([name]) => !values[name])) {
        form.querySelector('input')?.focus();
        return;
      }
      entry.submitted = true;
      ui.onSubmit(values);
    });
    form.querySelector('[data-cancel]')?.addEventListener('click', () => entry.sheet.close());
    setTimeout(() => form.querySelector('input')?.focus(), 50);
    current = entry;
  });
}
