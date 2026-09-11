/* ============================================================================
 * sw.js — Service Worker
 * ----------------------------------------------------------------------------
 * Existe por dos razones:
 *
 *   1. Sin un service worker, el navegador NO ofrece instalar la app en el
 *      teléfono. Es requisito para que aparezca "Agregar a pantalla de inicio"
 *      como aplicación (con su icono, sin barra de direcciones).
 *   2. Instalada como app, el almacenamiento pasa a ser persistente y el
 *      navegador deja de reciclarlo — que es justo lo que hace que la sesión
 *      de Google y la carpeta elegida sobrevivan entre usos.
 *
 * Lo que este archivo NO hace, a propósito:
 *
 *   - No cachea NADA de otro origen. Las llamadas a Google, a Supabase y a los
 *     CDN pasan derecho a la red. Un service worker metiéndose en medio del
 *     login de Google es una forma segura de romperlo de maneras difíciles de
 *     depurar.
 *   - No sirve contenido viejo cuando hay red. La estrategia es "primero la
 *     red, caché solo si falla": así un despliegue nuevo en Vercel se ve de
 *     inmediato, sin quedar atrapado en una versión antigua.
 * ==========================================================================*/

// Subir esta versión al cambiar la lista de archivos: al cambiar el nombre de
// la caché, la vieja se borra en la activación.
const CACHE = 'gestion-doc-v1';

// El esqueleto de la app: lo mínimo para que abra sin conexión.
const SHELL = [
    './',
    './index.html',
    './manifest.json',
    './informe-pdf.js',
    './drive-fs.js',
    './drive-ui.js',
    './libs/pizzip.min.js',
    './libs/docxtemplater.min.js',
    './libs/imagemodulo.js',
    './img/logo.png',
    './img/logo2.png',
    './img/icon-192.png',
    './img/icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE)
            // addAll aborta entero si UN archivo falla; se guardan uno a uno
            // para que un recurso ausente no impida instalar la app.
            .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;

    // Solo lecturas del propio sitio. Todo lo demás (Google, Supabase, CDN)
    // ni se toca: va directo a la red.
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // Primero la red; si no hay, lo que haya en caché.
    e.respondWith(
        fetch(req)
            .then(res => {
                // Solo se guardan respuestas propias y correctas.
                if (res && res.ok && res.type === 'basic') {
                    const copia = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copia));
                }
                return res;
            })
            .catch(async () => {
                const enCache = await caches.match(req);
                if (enCache) return enCache;
                // Navegación sin conexión y sin copia exacta: se devuelve la
                // portada, que sí está precacheada.
                if (req.mode === 'navigate') {
                    const portada = await caches.match('./index.html');
                    if (portada) return portada;
                }
                return new Response('Sin conexión', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                });
            })
    );
});
