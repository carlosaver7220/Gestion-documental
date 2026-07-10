// Service worker mínimo — solo existe para que Chrome considere la app
// "instalable". No hace caché agresivo porque esta app siempre debe
// mostrar la última versión y depende de datos leídos en vivo del disco.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

// Passthrough: deja pasar todas las peticiones directo a la red,
// sin interceptar ni cachear nada.
self.addEventListener('fetch', () => {});
