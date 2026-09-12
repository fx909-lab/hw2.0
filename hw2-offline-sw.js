'use strict';

/*
  檔案集散地 2.0｜alpha.209 專用離線 Service Worker
  - 僅在註冊 scope（部署於 /hw2.0test/ 時就是 /hw2.0test/）內生效。
  - 不碰 /hw1.3test/，也不清除其他 Service Worker 的快取。
  - 導航採 Network First：有網路優先拿最新版，離線才回退本機快取。
*/

const CACHE_NAME = 'file-hub-v2-alpha209-offline-v1';
const CORE_FALLBACK = './';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.add(new Request(CORE_FALLBACK, { cache: 'reload' }));
    } catch (_) {
      // 根目錄快取失敗不阻止 SW 安裝；目前頁面會由 CACHE_CURRENT_PAGE 補進去。
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 只清除本 2.0 SW 自己的舊 alpha209 前綴快取，不動其他專案／舊版快取。
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('file-hub-v2-alpha209-') && k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'CACHE_CURRENT_PAGE' || !data.url) return;

  event.waitUntil((async () => {
    try {
      const url = new URL(data.url);
      if (url.origin !== self.location.origin) return;

      const cache = await caches.open(CACHE_NAME);
      const req = new Request(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'reload'
      });
      const res = await fetch(req);
      if (res && res.ok) await cache.put(url.href, res.clone());
    } catch (_) {
      // 若此時剛好斷線，保留既有快取即可。
    }
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 只處理同源資源，Firebase / Google Fonts 等跨來源資源交回瀏覽器正常處理。
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          await cache.put(req, fresh.clone());
          return fresh;
        }
        throw new Error('navigation response not ok');
      } catch (_) {
        return (
          await cache.match(req) ||
          await cache.match(req, { ignoreSearch: true }) ||
          await cache.match(CORE_FALLBACK) ||
          Response.error()
        );
      }
    })());
    return;
  }

  // 其他同源靜態資源：先用快取，線上時背景更新。
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) {
      event.waitUntil(
        fetch(req).then(res => {
          if (res && res.ok) return cache.put(req, res.clone());
        }).catch(() => {})
      );
      return cached;
    }

    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) await cache.put(req, fresh.clone());
      return fresh;
    } catch (_) {
      return Response.error();
    }
  })());
});
