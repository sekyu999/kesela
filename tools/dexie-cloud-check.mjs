// Dexie Cloud に何件入っているかを確認する（読むだけ）
//   node tools/dexie-cloud-check.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const keys = JSON.parse(readFileSync(fileURLToPath(new URL('../dexie-cloud.key', import.meta.url)), 'utf8'));
const [dbUrl, { clientId, clientSecret }] = Object.entries(keys)[0];
const TABLES = ['categories', 'products', 'stores', 'storeShelfOrders', 'shoppingListItems', 'priceRecords', 'foodGroups', 'plans', 'meta'];

async function call(path, init = {}) {
  const res = await fetch(dbUrl + path, init);
  const text = await res.text();
  return { status: res.status, body: text };
}

const tk = await call('/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scopes: ['ACCESS_DB', 'GLOBAL_READ'] }),
});
if (tk.status !== 200) {
  console.log('token', tk.status, tk.body.slice(0, 300));
  process.exit(1);
}
const auth = { Authorization: `Bearer ${JSON.parse(tk.body).accessToken}` };
for (const t of TABLES) {
  const r = await call(`/all/${t}`, { headers: auth });
  let info = r.body.slice(0, 160);
  if (r.status === 200) {
    const j = JSON.parse(r.body);
    const arr = Array.isArray(j) ? j : j.data ?? j.result ?? [];
    info = `${arr.length}件（返事の形：${Array.isArray(j) ? '配列' : Object.keys(j).join(',')}）`;
  }
  console.log(`${t.padEnd(18)} ${r.status} ${info}`);
}
const users = await call('/users', { headers: auth });
console.log('users', users.status, users.body.slice(0, 300));
