// Service Worker — офлайн-режим Rawdat At-Tullab.
// При обновлении файлов приложения меняй CACHE_VERSION, чтобы старый кэш очистился.
const CACHE_VERSION = 'v2';
const SHELL_CACHE = 'rawdat-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'rawdat-runtime-' + CACHE_VERSION;

// Ядро приложения — кэшируется сразу при установке (должно быть маленьким и быстрым).
const SHELL_FILES = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icons/logo.PNG',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Прокси для Claude API — никогда не кэшируем, всегда только сеть
  if (url.hostname.endsWith('.workers.dev')) return;

  // PDF-файлы и запросы с диапазоном байт (Range) — не перехватываем, отдаём браузеру
  // напрямую. PDF.js грузит книги кусками через Range-запросы, чтобы показать страницу
  // сразу, не дожидаясь всего файла; если кэшировать такой ответ под обычным URL, следующий
  // Range-запрос совпадёт с этим кэшем и вернёт не тот кусок — PDF.js откатится на загрузку
  // файла целиком, и книга будет заметно дольше открываться.
  if (url.pathname.endsWith('.pdf') || request.headers.has('range')) return;

  // Ядро приложения: сначала сеть (чтобы обновления доходили сразу), при офлайне — кэш
  if (url.origin === self.location.origin && (request.mode === 'navigate' || SHELL_FILES.includes(url.pathname))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Обложки книг и PDF.js с CDN: сначала кэш, а если нет — сеть и сохранить на будущее
  if (url.origin === self.location.origin || url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(request));
    return;
  }
});

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = (await cache.match(request, { ignoreSearch: true })) || (await cache.match('/index.html'));
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  // Кэшируем только полноценные ответы — частичный контент (206) Cache API не принимает,
  // а ошибочные ответы кэшировать незачем.
  if (fresh.ok && fresh.status === 200) {
    cache.put(request, fresh.clone()).catch(() => {});
  }
  return fresh;
}
