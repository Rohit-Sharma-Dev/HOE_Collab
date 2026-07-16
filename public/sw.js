const CACHE_NAME = "collab-editor-cache-v1";
const STATIC_PRECACHE = [
  "/",
  "/dashboard",
  "/login",
  "/register"
];

// On install, precache standard pages
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Allow individual assets to fail precaching without breaking installation
      return Promise.allSettled(
        STATIC_PRECACHE.map((url) =>
          cache.add(url).catch((err) => console.warn(`Failed to precache ${url}:`, err))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests and local scope
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // Ignore Next.js hot reloading and APIs
  if (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.includes("hot-update")
  ) {
    return;
  }

  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".woff2");

  if (isStatic) {
    // Stale-While-Revalidate for static resources
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                cache.put(event.request, networkResponse.clone());
              }
              return networkResponse;
            })
            .catch(() => null);

          return cachedResponse || fetchPromise;
        });
      })
    );
  } else {
    // Network-First strategy for page routes
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline, check cache
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;

            // Fallback for editor subpaths
            if (url.pathname.startsWith("/editor/")) {
              // Match /editor/[id] page shell via the cached /dashboard as a fallback or return root
              return caches.match("/dashboard").then((fallback) => {
                return fallback || caches.match("/");
              });
            }

            return caches.match("/");
          });
        })
    );
  }
});
