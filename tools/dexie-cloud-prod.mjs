// Dexie Cloud のユーザーを「本番ユーザー」にする（無料プランは3人まで）
//   node tools/dexie-cloud-prod.mjs you@example.com
// お試しユーザーのままだと、使った日が30日たつと同期が止まるため。
// dexie-cloud.key（npx dexie-cloud create で作られる秘密の鍵。GitHub には上げない）を読んで REST API を呼ぶ。
// 同期のログインを一度してから実行する（ログインした時にユーザーが作られるため）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('使い方：node tools/dexie-cloud-prod.mjs 同期でログインしたメールアドレス');
  process.exit(1);
}

const keyFile = fileURLToPath(new URL('../dexie-cloud.key', import.meta.url));
const keys = JSON.parse(readFileSync(keyFile, 'utf8'));
const [dbUrl, { clientId, clientSecret }] = Object.entries(keys)[0];

async function call(path, init = {}) {
  const res = await fetch(dbUrl + path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const { accessToken } = await call('/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scopes: ['ACCESS_DB', 'GLOBAL_READ', 'GLOBAL_WRITE'],
  }),
});
const auth = { Authorization: `Bearer ${accessToken}` };
const show = (u) => `${u.userId}：${u.type === 'prod' ? '本番ユーザー' : u.type === 'eval' ? 'お試しユーザー' : u.type}`;

const before = await call(`/users/${encodeURIComponent(email)}`, { headers: auth }).catch(() => null);
if (!before) {
  console.error(`${email} のユーザーが見つかりません。先にアプリの「同期を始める」でこのメールアドレスでログインしてください`);
  process.exit(1);
}
console.log(`変更前　${show(before)}`);
if (before.type !== 'prod') {
  await call('/users', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ userId: before.userId, type: 'prod' }]),
  });
}
const after = await call(`/users/${encodeURIComponent(before.userId)}`, { headers: auth });
console.log(`変更後　${show(after)}`);
