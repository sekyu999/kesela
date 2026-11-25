// オフライン対応（Service Worker）
// 方針：ネットにつながる時は常に最新のファイルを取り、つながらない時だけ保存済みのものを使う。
// そのため、ファイルを更新したときにキャッシュが原因で古い画面が出る、ということが起きにくい。

// 版は node tools/release.mjs <版> で js/lib/version.js と一緒に上げる（APP_FILES もそのコマンドで作り直す）
const CACHE = 'kesela-1.20.1';

// オフラインでも開けるように最初に保存しておくファイル
const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'css/components.css',
  'css/themes.css',
  'data/foods.json',
  'icons/a/apple-touch-icon.png',
  'icons/a/favicon-16.png',
  'icons/a/favicon-32.png',
  'icons/a/favicon.svg',
  'icons/a/icon-192.png',
  'icons/a/icon-512.png',
  'icons/b/apple-touch-icon.png',
  'icons/b/favicon-16.png',
  'icons/b/favicon-32.png',
  'icons/b/favicon.svg',
  'icons/b/icon-192.png',
  'icons/b/icon-512.png',
  'icons/c/apple-touch-icon.png',
  'icons/c/favicon-16.png',
  'icons/c/favicon-32.png',
  'icons/c/favicon.svg',
  'icons/c/icon-192.png',
  'icons/c/icon-512.png',
  'js/app.js',
  'js/content/dri2025.js',
  'js/content/healthRecommendations.en.js',
  'js/content/healthRecommendations.js',
  'js/data/backup.js',
  'js/data/categoryRepo.js',
  'js/data/db.js',
  'js/data/expenseCategoryRepo.js',
  'js/data/fixedCostRepo.js',
  'js/data/foodDb.js',
  'js/data/groupRepo.js',
  'js/data/metaRepo.js',
  'js/data/noteRepo.js',
  'js/data/planRepo.js',
  'js/data/priceRepo.js',
  'js/data/productRepo.js',
  'js/data/shoppingRepo.js',
  'js/data/storage.js',
  'js/data/storeRepo.js',
  'js/data/sync.js',
  'js/data/syncConfig.js',
  'js/data/transactionRepo.js',
  'js/domain/backupFormat.js',
  'js/domain/calc.js',
  'js/domain/categories.js',
  'js/domain/consumption.js',
  'js/domain/cost.js',
  'js/domain/fixedCost.js',
  'js/domain/groups.js',
  'js/domain/kakeibo.js',
  'js/domain/note.js',
  'js/domain/nutrition.js',
  'js/domain/plans.js',
  'js/domain/pricing.js',
  'js/domain/product.js',
  'js/domain/shelf.js',
  'js/domain/shoppingList.js',
  'js/domain/units.js',
  'js/i18n/en.js',
  'js/i18n/en/budget.js',
  'js/i18n/en/common.js',
  'js/i18n/en/kakeibo.js',
  'js/i18n/en/meals.js',
  'js/i18n/en/note.js',
  'js/i18n/en/settings.js',
  'js/i18n/en/shopping.js',
  'js/lib/i18n.js',
  'js/lib/util.js',
  'js/lib/version.js',
  'js/screens/budget.js',
  'js/screens/goals.js',
  'js/screens/groupSheet.js',
  'js/screens/health.js',
  'js/screens/kakeibo.js',
  'js/screens/kakeiboSettings.js',
  'js/screens/kakeiboSheet.js',
  'js/screens/loginSheet.js',
  'js/screens/meals.js',
  'js/screens/nutritionSheet.js',
  'js/screens/priceSheet.js',
  'js/screens/prices.js',
  'js/screens/productSheet.js',
  'js/screens/profileSheet.js',
  'js/screens/settings.js',
  'js/screens/shopping.js',
  'js/screens/shoppingTab.js',
  'js/screens/stock.js',
  'js/ui/appIcon.js',
  'js/ui/calcPad.js',
  'js/ui/fontSize.js',
  'js/ui/form.js',
  'js/ui/live.js',
  'js/ui/monthPick.js',
  'js/ui/moveDrag.js',
  'js/ui/sheet.js',
  'js/ui/sortable.js',
  'js/ui/startScreen.js',
  'js/ui/storeBadge.js',
  'js/ui/themeList.js',
  'js/ui/toast.js',
  'js/ui/weekStart.js',
  'vendor/dexie-cloud-addon.mjs',
  'vendor/dexie.mjs',
];

self.addEventListener('install', (event) => {
  // 新しい版のファイルをブラウザのキャッシュを通さずに取り直して保存する
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_FILES.map((f) => new Request(f, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 古い版のキャッシュを削除
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    // cache: 'no-cache' … ブラウザ自身のキャッシュ（GitHub Pages は10分）を使わず、毎回サーバーに新しいか確認する。
    // 変わっていなければ中身は送られてこないので、通信量はほとんど増えない
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
