/* ============================================================================
 * drive-fs.js — Capa de Google Drive para Gestión Documental
 * ----------------------------------------------------------------------------
 * La app entera está escrita contra la File System Access API del navegador
 * (showDirectoryPicker + handle.values() + getFileHandle + createWritable).
 * Eso solo existe en Chrome/Edge de escritorio: en celular no hay nada de eso.
 *
 * En vez de reescribir las ~40 llamadas a archivos que hay en index.html,
 * este archivo expone DOS CLASES QUE IMITAN ESA MISMA INTERFAZ pero hablando
 * con la API de Google Drive:
 *
 *     DriveDirectoryHandle  ->  .kind .name .values() .getFileHandle()
 *                               .getDirectoryHandle() .queryPermission()
 *     DriveFileHandle       ->  .kind .name .getFile() .createWritable()
 *
 * Así scan(), analyze(), la generación de actas y las subidas siguen
 * funcionando SIN CAMBIARLES UNA LÍNEA: solo se les entrega un handle
 * distinto en currentHandle.
 *
 * Lo otro que resuelve este archivo es el rendimiento. analyze() recorre cada
 * proyecto carpeta por carpeta; hecho ingenuamente contra Drive son cientos de
 * peticiones y Google responde 403 rateLimitExceeded (esa es la razón típica
 * de "escaneaba pero salían errores"). Aquí el árbol se trae por NIVELES y en
 * LOTE — una sola consulta pregunta por hasta 20 carpetas a la vez — y queda
 * en caché, de modo que analyze() después hace CERO peticiones de red.
 * ==========================================================================*/
(function () {
    'use strict';

    // ---------------------------------------------------------------- config
    // Alcance completo de Drive. No sirve "drive.file": ese solo deja ver
    // archivos creados por esta misma app, y aquí hay que leer una carpeta
    // maestra que ya existía desde antes.
    const SCOPE = 'https://www.googleapis.com/auth/drive';
    const API = 'https://www.googleapis.com/drive/v3';
    const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
    const FOLDER_MIME = 'application/vnd.google-apps.folder';

    // Un acceso directo NO es una carpeta: es un tipo de archivo aparte que
    // apunta a otra cosa. Es lo que crea Drive con "Añadir acceso directo a
    // Drive" sobre algo que te compartieron. Hay que tratarlos o la carpeta
    // compartida simplemente no aparece por ningún lado.
    const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

    // Campos mínimos: pedir menos hace las respuestas mucho más livianas y el
    // escaneo notablemente más rápido. shortcutDetails hace falta para saber
    // a dónde apunta cada acceso directo.
    const FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink,shortcutDetails(targetId,targetMimeType))';
    const FIELDS_CARPETA = 'nextPageToken,files(id,name,mimeType,parents,shortcutDetails(targetId,targetMimeType))';

    const LS = {
        token: 'gd_drive_token',
        rootId: 'gd_drive_root_id',
        rootName: 'gd_drive_root_name',
        email: 'gd_drive_email',
        mode: 'gd_source_mode'   // "local" | "drive" | null
    };

    // Cuántas carpetas caben en una sola consulta con varios "in parents".
    // 20 va sobrado bajo el límite de longitud de query de Drive.
    const BATCH = 20;
    // Consultas en paralelo. Más de 5 empieza a provocar rateLimitExceeded.
    const CONCURRENCY = 5;

    // ------------------------------------------------------------- utilidades
    function notFound(name) {
        const e = new Error('No se encontró "' + name + '".');
        e.name = 'NotFoundError';
        return e;
    }

    function chunk(arr, n) {
        const out = [];
        for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
        return out;
    }

    // Ejecuta fn sobre items con un tope de tareas simultáneas.
    async function pool(items, limit, fn) {
        const out = new Array(items.length);
        let i = 0;
        const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (i < items.length) {
                const idx = i++;
                out[idx] = await fn(items[idx], idx);
            }
        });
        await Promise.all(workers);
        return out;
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Escapa comillas simples dentro de un valor de query de Drive.
    const qesc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    // Windows no distingue mayúsculas en nombres de archivo y la app fue
    // escrita con esa costumbre; Drive sí distingue. Se compara primero
    // exacto y luego sin distinguir, para no romper nombres ya existentes.
    const eqi = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

    // ------------------------------------------------------------------ auth
    let tokenClient = null;
    let gisReady = null;
    let accessToken = null;
    let tokenExpiresAt = 0;
    let currentUser = null;   // { email, name, picture }

    function clientId() {
        return window.DRIVE_CLIENT_ID || '';
    }

    function loadGis() {
        if (gisReady) return gisReady;
        gisReady = new Promise((resolve, reject) => {
            if (window.google && window.google.accounts && window.google.accounts.oauth2) {
                resolve();
                return;
            }
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.async = true;
            s.defer = true;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error('No se pudo cargar el script de Google. ¿Hay conexión a internet?'));
            document.head.appendChild(s);
        });
        return gisReady;
    }

    function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

    function loadSavedToken() {
        try {
            const raw = localStorage.getItem(LS.token);
            if (!raw) return;
            const t = JSON.parse(raw);
            if (t && t.access_token && t.expires_at > Date.now()) {
                accessToken = t.access_token;
                tokenExpiresAt = t.expires_at;
            }
        } catch (e) { /* localStorage bloqueado o JSON corrupto: se ignora */ }
    }

    function saveToken(resp) {
        // Google devuelve expires_in en segundos. Se resta un minuto de margen
        // para no usar un token que caduca en pleno vuelo.
        const expires_at = Date.now() + ((Number(resp.expires_in) || 3600) - 60) * 1000;
        accessToken = resp.access_token;
        tokenExpiresAt = expires_at;
        lsSet(LS.token, JSON.stringify({ access_token: accessToken, expires_at }));
    }

    function clearToken() {
        accessToken = null;
        tokenExpiresAt = 0;
        lsDel(LS.token);
    }

    const tokenValid = () => !!accessToken && Date.now() < tokenExpiresAt;

    async function initTokenClient() {
        // Se valida ANTES de abrir nada. Con un Client ID inválido, Google abre
        // la ventana emergente, muestra dentro un "Error 401: invalid_client" y
        // al cerrarla GIS solo informa "Popup window closed": el motivo real
        // nunca sale del popup y el error despista por completo.
        const id = clientId();
        if (!id || /^PEGAR_AQUI/.test(id) || !/\.apps\.googleusercontent\.com$/.test(id)) {
            const e = new Error(
                'Falta pegar el Client ID de Google en index.html (la línea de window.DRIVE_CLIENT_ID). '
                + 'Se saca de Google Cloud Console > Credenciales y termina en .apps.googleusercontent.com. '
                + 'Está explicado en CONFIGURAR-DRIVE.md, paso 4.'
            );
            e.name = 'DriveAuthError';
            e.code = 'no_client_id';
            throw e;
        }

        await loadGis();
        if (tokenClient) return tokenClient;
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId(),
            scope: SCOPE,
            callback: () => { }   // se reemplaza en cada requestToken()
        });
        return tokenClient;
    }

    /**
     * Pide un token de acceso.
     * @param {boolean} interactive  false = intento silencioso (sin popup).
     *   El intento silencioso funciona si el usuario ya dio permiso antes y
     *   sigue con sesión de Google abierta en ese navegador. Es lo que hace
     *   que "quede iniciada" la sesión: al abrir la app se renueva sola.
     */
    async function requestToken(interactive) {
        const client = await initTokenClient();
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (msg, code) => {
                if (settled) return;
                settled = true;
                const e = new Error(msg);
                e.name = 'DriveAuthError';
                e.code = code || 'auth_failed';
                reject(e);
            };

            client.callback = (resp) => {
                if (settled) return;
                if (resp && resp.access_token) {
                    settled = true;
                    saveToken(resp);
                    resolve(resp.access_token);
                } else {
                    fail((resp && resp.error_description) || 'No se obtuvo el token de Google.',
                        (resp && resp.error) || 'no_token');
                }
            };
            client.error_callback = (err) => {
                fail((err && err.message) || 'Falló la autenticación con Google.',
                    (err && err.type) || 'auth_failed');
            };

            const opts = interactive ? { prompt: 'consent' } : { prompt: '' };
            // hint evita el selector de cuenta cuando ya sabemos cuál es.
            const savedEmail = lsGet(LS.email);
            if (savedEmail) opts.hint = savedEmail;

            try {
                client.requestAccessToken(opts);
            } catch (e) {
                fail(e && e.message ? e.message : String(e), 'request_failed');
            }

            // Un intento silencioso que no responde en 12 s se da por fallido:
            // GIS a veces no invoca ningún callback si el navegador bloquea el
            // iframe oculto (Safari con prevención de rastreo, por ejemplo).
            if (!interactive) {
                setTimeout(() => fail('El inicio de sesión silencioso no respondió.', 'silent_timeout'), 12000);
            }
        });
    }

    async function ensureToken() {
        if (tokenValid()) return accessToken;
        return requestToken(false);
    }

    // -------------------------------------------------- sesión persistente
    // Varias llamadas simultáneas no deben disparar varias renovaciones: se
    // comparte la misma promesa.
    let renovacionEnCurso = null;

    function renovarSilencioso() {
        if (renovacionEnCurso) return renovacionEnCurso;
        renovacionEnCurso = requestToken(false)
            .catch(e => { throw e; })
            .finally(() => { renovacionEnCurso = null; });
        return renovacionEnCurso;
    }

    /**
     * Renueva el token ANTES de que caduque, en vez de esperar a que una
     * petición falle con 401. Sin esto, al volver a la app después de un rato
     * la primera acción se siente lenta (falla, renueva, reintenta) y en el
     * peor caso muestra un error antes de recuperarse.
     *
     * Se engancha a tres momentos:
     *   - cada 5 minutos mientras la pestaña está a la vista;
     *   - al volver a la app (cambio de pestaña, desbloquear el teléfono);
     *   - al recuperar la conexión.
     */
    function iniciarRenovacionAutomatica() {
        const MARGEN = 5 * 60 * 1000;   // renovar si le quedan menos de 5 min

        const revisar = () => {
            if (document.hidden) return;          // en segundo plano no vale la pena
            if (!lsGet(LS.rootId)) return;        // no hay nada conectado por Drive
            if (tokenExpiresAt - Date.now() > MARGEN) return;
            renovarSilencioso().catch(() => {
                // Si falla, no se molesta al usuario aquí: la próxima petición
                // real volverá a intentarlo y ahí sí se puede informar.
            });
        };

        setInterval(revisar, 5 * 60 * 1000);
        document.addEventListener('visibilitychange', revisar);
        window.addEventListener('online', revisar);
    }

    // ------------------------------------------------------------ capa HTTP
    /**
     * fetch contra la API de Drive con el token puesto, reintento automático
     * si el token caducó (401) y espera progresiva si Google pide calma (403
     * rateLimitExceeded / 429). Sin esto último, un escaneo grande falla a
     * mitad de camino con errores que parecen aleatorios.
     */
    async function driveFetch(url, options, _retry) {
        _retry = _retry || 0;
        const token = await ensureToken();
        const opts = Object.assign({}, options);
        opts.headers = Object.assign({}, options && options.headers, {
            Authorization: 'Bearer ' + token
        });

        let res;
        try {
            res = await fetch(url, opts);
        } catch (e) {
            // Fallo de red: un reintento por si fue un microcorte.
            if (_retry < 2) {
                await sleep(500 * (_retry + 1));
                return driveFetch(url, options, _retry + 1);
            }
            throw new Error('Sin conexión con Google Drive.');
        }

        if (res.status === 401 && _retry < 2) {
            clearToken();
            await requestToken(false);
            return driveFetch(url, options, _retry + 1);
        }

        if ((res.status === 403 || res.status === 429) && _retry < 5) {
            const body = await res.clone().text().catch(() => '');
            if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(body) || res.status === 429) {
                // Espera exponencial con algo de aleatoriedad, como recomienda Google.
                await sleep(Math.pow(2, _retry) * 500 + Math.random() * 400);
                return driveFetch(url, options, _retry + 1);
            }
        }

        if (!res.ok) {
            let detail = '';
            try {
                const j = await res.json();
                detail = (j.error && j.error.message) || '';
            } catch (e) { }
            const err = new Error('Drive respondió ' + res.status + (detail ? ': ' + detail : ''));
            err.status = res.status;
            throw err;
        }
        return res;
    }

    const driveJson = async (url, options) => (await driveFetch(url, options)).json();

    // ------------------------------------------------- caché del árbol
    // folderId -> array de metadatos de hijos (ya traídos de Drive).
    // Que un id esté en el mapa significa "esta carpeta ya se leyó"; un array
    // vacío significa "se leyó y está vacía", que no es lo mismo que "no leída".
    const childrenCache = new Map();

    function cacheAdd(parentId, meta) {
        const list = childrenCache.get(parentId);
        if (!list) return;
        const i = list.findIndex(x => x.id === meta.id);
        if (i >= 0) list[i] = meta; else list.push(meta);
    }

    function cacheRemove(parentId, id) {
        const list = childrenCache.get(parentId);
        if (!list) return;
        const i = list.findIndex(x => x.id === id);
        if (i >= 0) list.splice(i, 1);
    }

    /**
     * Convierte un acceso directo en aquello a lo que apunta, conservando el
     * nombre que se ve en Drive.
     *
     * Con esto, el resto del código nunca se entera de que existen los accesos
     * directos: ve una carpeta o un archivo normal. Es justo lo que hace falta
     * cuando la Ruta Maestra es una carpeta compartida a la que se le puso un
     * acceso directo en "Mi unidad" para que Drive Desktop la sincronice.
     */
    function resolverAcceso(f) {
        if (f.mimeType !== SHORTCUT_MIME) return f;
        const d = f.shortcutDetails;
        if (!d || !d.targetId) return f;   // acceso directo roto: se deja como está
        return Object.assign({}, f, {
            id: d.targetId,
            mimeType: d.targetMimeType || FOLDER_MIME,
            _esAcceso: true
        });
    }

    /** Lista los hijos de varias carpetas de una sola vez. */
    async function listChildrenOf(parentIds) {
        const query = '(' + parentIds.map(id => "'" + qesc(id) + "' in parents").join(' or ') + ')'
            + ' and trashed = false';
        const files = [];
        let pageToken = '';
        do {
            const url = API + '/files'
                + '?q=' + encodeURIComponent(query)
                + '&fields=' + encodeURIComponent(FIELDS)
                + '&pageSize=1000'
                + '&orderBy=folder,name'
                + '&supportsAllDrives=true&includeItemsFromAllDrives=true'
                + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
            const data = await driveJson(url);
            if (data.files) files.push.apply(files, data.files);
            pageToken = data.nextPageToken || '';
        } while (pageToken);
        return files;
    }

    /** Reparte los hijos traídos en lote a la caché de cada carpeta padre. */
    function distribute(parentIds, files) {
        // Marcar todas como leídas (aunque queden vacías).
        parentIds.forEach(id => { if (!childrenCache.has(id)) childrenCache.set(id, []); });
        const wanted = new Set(parentIds);
        for (const f of files) {
            // Un archivo puede tener varios padres; nos interesa el que pedimos.
            // El padre se mira en el original: un acceso directo cuelga de donde
            // está el acceso, no de donde vive la carpeta a la que apunta.
            const parent = (f.parents || []).find(p => wanted.has(p));
            if (!parent) continue;
            childrenCache.get(parent).push(resolverAcceso(f));
        }
    }

    /**
     * Trae el subárbol completo bajo rootId, nivel por nivel y en lote.
     * Esto es lo que hace que el escaneo sea viable: en vez de una petición
     * por carpeta, son unas pocas decenas para todo el árbol.
     */
    async function prefetchTree(rootId, onProgress, maxDepth) {
        maxDepth = maxDepth || 8;
        childrenCache.clear();
        let level = [rootId];
        let depth = 0;
        let folders = 0;
        // Un acceso directo puede apuntar a una carpeta que ya visitamos (o
        // incluso a un ancestro). Sin esto, el recorrido daría vueltas en
        // círculo o repetiría ramas enteras.
        const vistas = new Set([rootId]);

        while (level.length && depth < maxDepth) {
            const batches = chunk(level, BATCH);
            const results = await pool(batches, CONCURRENCY, b => listChildrenOf(b));

            const next = [];
            batches.forEach((b, i) => {
                const files = results[i] || [];
                distribute(b, files);
                for (const bruto of files) {
                    const f = resolverAcceso(bruto);
                    if (f.mimeType !== FOLDER_MIME) continue;
                    if (vistas.has(f.id)) continue;
                    vistas.add(f.id);
                    next.push(f.id);
                    folders++;
                }
            });

            if (onProgress) onProgress({ depth: depth + 1, folders });
            level = next;
            depth++;
        }
        return folders;
    }

    /** Hijos de una carpeta: de caché si ya se leyó, si no se pide a Drive. */
    async function childrenOf(folderId) {
        if (childrenCache.has(folderId)) return childrenCache.get(folderId);
        const files = await listChildrenOf([folderId]);
        distribute([folderId], files);
        return childrenCache.get(folderId);
    }

    // ------------------------------------------------------------- handles
    function toHandle(meta, parentId) {
        return meta.mimeType === FOLDER_MIME
            ? new DriveDirectoryHandle(meta, parentId)
            : new DriveFileHandle(meta, parentId);
    }

    // Documentos nativos de Google (Docs/Sheets/Slides) no se pueden descargar
    // con alt=media; hay que exportarlos. La carpeta maestra sincronizada con
    // Drive Desktop normalmente tiene .docx/.pdf de verdad, pero si alguno se
    // convirtió alguna vez, esto evita un 403 sin explicación.
    const EXPORT_MIME = {
        'application/vnd.google-apps.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.google-apps.presentation': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.google-apps.drawing': 'application/pdf'
    };

    class DriveFileHandle {
        constructor(meta, parentId) {
            this.kind = 'file';
            this.name = meta.name;
            this.id = meta.id || null;
            this.mimeType = meta.mimeType || null;
            this.webViewLink = meta.webViewLink || null;
            this.size = meta.size ? Number(meta.size) : 0;
            this._parentId = parentId || (meta.parents && meta.parents[0]) || null;
            this._isDrive = true;
        }

        async getFile() {
            if (!this.id) throw notFound(this.name);
            let url;
            const exportAs = EXPORT_MIME[this.mimeType];
            if (exportAs) {
                url = API + '/files/' + this.id + '/export?mimeType=' + encodeURIComponent(exportAs);
            } else {
                url = API + '/files/' + this.id + '?alt=media&supportsAllDrives=true';
            }
            const res = await driveFetch(url);
            const blob = await res.blob();
            return new File([blob], this.name, {
                type: blob.type || this.mimeType || 'application/octet-stream',
                lastModified: this.modifiedTime ? Date.parse(this.modifiedTime) : Date.now()
            });
        }

        /**
         * Imita FileSystemWritableFileStream: se acumula en memoria y se sube
         * entero al hacer close(). Los archivos que maneja la app (docx, pdf,
         * json) son chicos, así que no hace falta subida por partes.
         */
        async createWritable() {
            const self = this;
            const parts = [];
            return {
                async write(data) {
                    if (data && typeof data === 'object' && data.type === 'write' && 'data' in data) {
                        parts.push(data.data);
                    } else {
                        parts.push(data);
                    }
                },
                async seek() { throw new Error('seek() no está soportado en modo Drive.'); },
                async truncate() { parts.length = 0; },
                async abort() { parts.length = 0; },
                async close() { await self._commit(new Blob(parts)); }
            };
        }

        async _commit(blob) {
            const meta = await uploadBlob(blob, {
                id: this.id,
                name: this.name,
                parentId: this._parentId
            });
            const era = this.id;
            this.id = meta.id;
            this.mimeType = meta.mimeType || this.mimeType;
            this.webViewLink = meta.webViewLink || this.webViewLink;
            this.size = blob.size;
            if (!era && this._parentId) cacheAdd(this._parentId, meta);
        }

        async isSameEntry(other) { return !!other && other.id === this.id; }
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
    }

    class DriveDirectoryHandle {
        constructor(meta, parentId) {
            this.kind = 'directory';
            this.name = meta.name;
            this.id = meta.id;
            this._parentId = parentId || (meta.parents && meta.parents[0]) || null;
            this._isDrive = true;
        }

        async *values() {
            const kids = await childrenOf(this.id);
            // Copia: la caché puede mutar mientras se itera (al crear archivos).
            for (const meta of kids.slice()) yield toHandle(meta, this.id);
        }

        async *keys() {
            for (const meta of (await childrenOf(this.id)).slice()) yield meta.name;
        }

        async *entries() {
            for (const meta of (await childrenOf(this.id)).slice()) {
                yield [meta.name, toHandle(meta, this.id)];
            }
        }

        async _find(name, isFolder) {
            const kids = await childrenOf(this.id);
            const matches = kids.filter(k => (k.mimeType === FOLDER_MIME) === isFolder);
            return matches.find(k => k.name === name) || matches.find(k => eqi(k.name, name)) || null;
        }

        async getDirectoryHandle(name, opts) {
            const found = await this._find(name, true);
            if (found) return new DriveDirectoryHandle(found, this.id);
            if (!opts || !opts.create) throw notFound(name);
            const meta = await createFolder(name, this.id);
            cacheAdd(this.id, meta);
            childrenCache.set(meta.id, []);   // recién creada, se sabe vacía
            return new DriveDirectoryHandle(meta, this.id);
        }

        async getFileHandle(name, opts) {
            const found = await this._find(name, false);
            if (found) return new DriveFileHandle(found, this.id);
            if (!opts || !opts.create) throw notFound(name);
            // Todavía no se crea en Drive: se crea al hacer el primer write/close.
            // Así getFileHandle({create:true}) es barato y no deja archivos
            // vacíos si algo falla antes de escribir.
            return new DriveFileHandle({ name, id: null }, this.id);
        }

        async removeEntry(name, opts) {
            const kids = await childrenOf(this.id);
            const found = kids.find(k => k.name === name) || kids.find(k => eqi(k.name, name));
            if (!found) throw notFound(name);
            if (found.mimeType === FOLDER_MIME && (!opts || !opts.recursive)) {
                const inner = await childrenOf(found.id);
                if (inner.length) throw new Error('La carpeta "' + name + '" no está vacía.');
            }
            await driveFetch(API + '/files/' + found.id + '?supportsAllDrives=true', { method: 'DELETE' });
            cacheRemove(this.id, found.id);
            childrenCache.delete(found.id);
        }

        async isSameEntry(other) { return !!other && other.id === this.id; }
        // La app llama a estos para el flujo de "Reconectar" de la API local.
        // En Drive el permiso lo da el token, así que siempre está concedido.
        async queryPermission() { return 'granted'; }
        async requestPermission() { return 'granted'; }
    }

    // --------------------------------------------------------- escritura
    async function createFolder(name, parentId) {
        return driveJson(API + '/files?supportsAllDrives=true&fields=id,name,mimeType,parents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] })
        });
    }

    /**
     * Sube un blob. Si viene id, reemplaza el contenido de ese archivo; si no,
     * crea uno nuevo dentro de parentId.
     * Se usa multipart/related armado a mano porque es el formato que Drive
     * documenta; FormData manda multipart/form-data y no siempre lo acepta.
     */
    async function uploadBlob(blob, { id, name, parentId }) {
        const metadata = id ? { name } : { name, parents: [parentId] };
        const boundary = '----gdfs' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        const body = new Blob([
            '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
            JSON.stringify(metadata),
            '\r\n--' + boundary + '\r\nContent-Type: ' + (blob.type || 'application/octet-stream') + '\r\n\r\n',
            blob,
            '\r\n--' + boundary + '--\r\n'
        ]);

        const url = UPLOAD + '/files' + (id ? '/' + id : '')
            + '?uploadType=multipart&supportsAllDrives=true'
            + '&fields=id,name,mimeType,size,modifiedTime,parents,webViewLink';

        return driveJson(url, {
            method: id ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
            body
        });
    }

    // ------------------------------------------------------------- sesión
    async function fetchUser() {
        const data = await driveJson(API + '/about?fields=user');
        currentUser = data.user || null;
        if (currentUser && currentUser.emailAddress) {
            lsSet(LS.email, currentUser.emailAddress);
        }
        return currentUser;
    }

    async function signIn({ interactive = true } = {}) {
        await requestToken(!!interactive);
        await fetchUser();
        return currentUser;
    }

    /** Reanuda la sesión al abrir la app, sin molestar al usuario. */
    async function resumeSession() {
        loadSavedToken();
        if (tokenValid()) {
            try {
                await fetchUser();
                return currentUser;
            } catch (e) {
                clearToken();   // el token guardado ya no sirve
            }
        }
        try {
            await requestToken(false);
            await fetchUser();
            return currentUser;
        } catch (e) {
            return null;
        }
    }

    function signOut() {
        const t = accessToken;
        clearToken();
        currentUser = null;
        childrenCache.clear();
        lsDel(LS.rootId);
        lsDel(LS.rootName);
        if (t && window.google && window.google.accounts && window.google.accounts.oauth2) {
            try { window.google.accounts.oauth2.revoke(t); } catch (e) { }
        }
    }

    // -------------------------------------------------- carpeta recordada
    function savedRoot() {
        const id = lsGet(LS.rootId);
        return id ? { id, name: lsGet(LS.rootName) || 'Drive' } : null;
    }

    function rememberRoot(id, name) {
        lsSet(LS.rootId, id);
        lsSet(LS.rootName, name || '');
    }

    function forgetRoot() {
        lsDel(LS.rootId);
        lsDel(LS.rootName);
    }

    /**
     * Devuelve el handle raíz de la carpeta recordada y precarga el árbol.
     * Es lo que se le asigna a currentHandle en index.html.
     */
    async function getRootHandle(onProgress) {
        const saved = savedRoot();
        if (!saved) return null;
        const meta = await driveJson(
            API + '/files/' + saved.id + '?fields=id,name,mimeType,parents&supportsAllDrives=true'
        );
        rememberRoot(meta.id, meta.name);   // por si la renombraron en Drive
        await prefetchTree(meta.id, onProgress);
        return new DriveDirectoryHandle(meta, null);
    }

    /** Vuelve a leer el árbol completo (lo llama scan() en cada refresco). */
    async function refreshTree(rootId, onProgress) {
        return prefetchTree(rootId, onProgress);
    }

    // ------------------------------------------------ búsqueda de carpetas
    // Las consultas piden carpetas Y accesos directos. Después de resolverlos
    // se descarta lo que no acabe siendo una carpeta: así un acceso directo a
    // una carpeta compartida se ve y se navega como una carpeta normal.
    const SOLO_CARPETAS = "(mimeType = '" + FOLDER_MIME + "' or mimeType = '" + SHORTCUT_MIME + "')";

    function soloCarpetas(files) {
        return (files || []).map(resolverAcceso).filter(f => f.mimeType === FOLDER_MIME);
    }

    async function listFolders(parentId) {
        const query = "'" + qesc(parentId) + "' in parents and " + SOLO_CARPETAS + " and trashed = false";
        const url = API + '/files?q=' + encodeURIComponent(query)
            + '&fields=' + encodeURIComponent(FIELDS_CARPETA)
            + '&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true';
        const data = await driveJson(url);
        return soloCarpetas(data.files);
    }

    /**
     * Carpetas que otras personas compartieron contigo.
     * Estas NO están en "Mi unidad": viven en "Compartido conmigo", y sin este
     * listado no habría forma de llegar a ellas desde el selector.
     */
    async function listSharedWithMe() {
        const query = "sharedWithMe = true and mimeType = '" + FOLDER_MIME + "' and trashed = false";
        const url = API + '/files?q=' + encodeURIComponent(query)
            + '&fields=' + encodeURIComponent(FIELDS_CARPETA)
            + '&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true';
        const data = await driveJson(url);
        return data.files || [];
    }

    async function searchFolders(text) {
        // La búsqueda por nombre alcanza todo lo que la cuenta puede ver,
        // incluido lo compartido, así que sirve de atajo cuando no se sabe
        // en qué rama está la carpeta.
        const query = SOLO_CARPETAS + " and trashed = false and name contains '" + qesc(text) + "'";
        const url = API + '/files?q=' + encodeURIComponent(query)
            + '&fields=' + encodeURIComponent(FIELDS_CARPETA)
            + '&pageSize=50&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true';
        const data = await driveJson(url);
        return soloCarpetas(data.files);
    }

    async function listSharedDrives() {
        try {
            const data = await driveJson(API + '/drives?pageSize=100&fields=drives(id,name)');
            return data.drives || [];
        } catch (e) {
            return [];   // cuenta personal sin unidades compartidas
        }
    }

    // ------------------------------------------------------------- público
    window.DriveFS = {
        SCOPE,
        DriveDirectoryHandle,
        DriveFileHandle,
        // sesión
        signIn,
        signOut,
        resumeSession,
        isSignedIn: () => tokenValid() && !!currentUser,
        getUser: () => currentUser,
        // carpeta raíz
        savedRoot,
        rememberRoot,
        forgetRoot,
        getRootHandle,
        refreshTree,
        // navegación para el selector
        listFolders,
        searchFolders,
        listSharedDrives,
        listSharedWithMe,
        // modo activo (local / drive), compartido con index.html
        getMode: () => lsGet(LS.mode) || null,
        setMode: (m) => { m ? lsSet(LS.mode, m) : lsDel(LS.mode); },
        // utilidades
        isDriveHandle: (h) => !!(h && h._isDrive),
        clearCache: () => childrenCache.clear()
    };

    iniciarRenovacionAutomatica();
})();
