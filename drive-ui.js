/* ============================================================================
 * drive-ui.js — Selector de carpeta de Google Drive
 * ----------------------------------------------------------------------------
 * Un modal propio para navegar carpetas de Drive y elegir la Ruta Maestra.
 *
 * Se hace a mano en vez de usar el Google Picker oficial por dos razones:
 * el Picker exige una API Key aparte del Client ID (una cosa más que
 * configurar y que se puede quedar mal puesta), y en celular su interfaz es
 * incómoda. Aquí solo se navegan carpetas, que es lo único que hace falta.
 *
 * Uso:  const carpeta = await DriveUI.pickFolder();   // {id, name} o null
 * ==========================================================================*/
(function () {
    'use strict';

    const MI_UNIDAD = { id: 'root', name: 'Mi unidad' };

    let overlay = null;
    let state = null;   // { path: [{id,name}], resolve, buscando }

    function el(tag, cls, html) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (html != null) n.innerHTML = html;
        return n;
    }

    const ICON_FOLDER = '<svg class="w-5 h-5 shrink-0 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z"/></svg>';
    const ICON_DRIVE = '<svg class="w-5 h-5 shrink-0 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M7.7 3l-5.6 9.7L4.9 18l5.6-9.7L7.7 3zm2.1 0l5.6 9.7h5.6L15.4 3H9.8zM6.2 19h11.2l2.8-4.9H9L6.2 19z"/></svg>';

    function build() {
        overlay = el('div', 'fixed inset-0 z-[9999] hidden items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4');
        overlay.id = 'driveFolderPicker';
        overlay.innerHTML = `
            <div class="bg-white w-full max-w-lg rounded-lg shadow-2xl flex flex-col overflow-hidden" style="max-height:85vh">
                <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                    <div>
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-wider">Google Drive</p>
                        <h3 class="text-base font-bold text-slate-800">Elegir Ruta Maestra</h3>
                    </div>
                    <button data-act="cerrar" class="text-slate-400 hover:text-slate-700 text-2xl leading-none px-2" aria-label="Cerrar">&times;</button>
                </div>

                <div class="px-5 pt-3 shrink-0">
                    <input data-el="buscar" type="text" placeholder="Buscar carpeta por nombre..."
                        class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-md text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                </div>

                <div data-el="ruta" class="px-5 py-2.5 flex items-center gap-1 flex-wrap text-xs shrink-0"></div>

                <div data-el="lista" class="flex-1 overflow-y-auto px-3 pb-2 min-h-[200px]"></div>

                <div class="px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 bg-slate-50">
                    <p data-el="seleccion" class="text-xs text-slate-500 truncate flex-1"></p>
                    <div class="flex gap-2 shrink-0">
                        <button data-act="cerrar" class="px-4 py-2.5 text-xs font-bold uppercase text-slate-600 hover:text-slate-900 transition-colors">Cancelar</button>
                        <button data-act="usar" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black uppercase rounded transition-colors active:scale-95">Usar esta carpeta</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cerrar(null);
            const act = e.target.closest('[data-act]');
            if (!act) return;
            if (act.dataset.act === 'cerrar') cerrar(null);
            if (act.dataset.act === 'usar') {
                const actual = state.path[state.path.length - 1];
                if (actual && actual.id !== '__raices__') cerrar({ id: actual.id, name: actual.name });
            }
        });

        const buscar = overlay.querySelector('[data-el="buscar"]');
        let debounce;
        buscar.addEventListener('input', () => {
            clearTimeout(debounce);
            const texto = buscar.value.trim();
            debounce = setTimeout(() => {
                if (texto.length >= 2) mostrarBusqueda(texto);
                else render();
            }, 350);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) cerrar(null);
        });
    }

    function cerrar(valor) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        const r = state && state.resolve;
        state = null;
        if (r) r(valor);
    }

    // ------------------------------------------------------------- pintado
    function renderRuta() {
        const cont = overlay.querySelector('[data-el="ruta"]');
        cont.innerHTML = '';
        state.path.forEach((nodo, i) => {
            if (i > 0) cont.appendChild(el('span', 'text-slate-300', '/'));
            const esUltimo = i === state.path.length - 1;
            const b = el('button', esUltimo
                ? 'font-bold text-slate-800 px-1'
                : 'text-blue-600 hover:underline px-1', nodo.name);
            b.onclick = () => { state.path = state.path.slice(0, i + 1); render(); };
            cont.appendChild(b);
        });
    }

    function renderSeleccion() {
        const actual = state.path[state.path.length - 1];
        const p = overlay.querySelector('[data-el="seleccion"]');
        const btn = overlay.querySelector('[data-act="usar"]');
        const valida = actual && actual.id !== '__raices__';
        p.textContent = valida ? 'Seleccionada: ' + actual.name : 'Entra en una carpeta para poder elegirla';
        btn.disabled = !valida;
    }

    function filaCarpeta(nodo, icono, subtitulo) {
        const fila = el('button', 'w-full flex items-center gap-3 px-3 py-3 rounded-md hover:bg-slate-100 transition-colors text-left');
        fila.innerHTML = icono + '<span class="flex-1 min-w-0">'
            + '<span class="block text-sm font-semibold text-slate-700 truncate">' + escapar(nodo.name) + '</span>'
            + (subtitulo ? '<span class="block text-[10px] text-slate-400 truncate">' + escapar(subtitulo) + '</span>' : '')
            + '</span>'
            + '<svg class="w-4 h-4 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';
        fila.onclick = () => { state.path.push({ id: nodo.id, name: nodo.name }); render(); };
        return fila;
    }

    function escapar(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function mensaje(texto, clase) {
        return el('p', 'text-center text-xs py-10 ' + (clase || 'text-slate-400'), escapar(texto));
    }

    async function render() {
        const lista = overlay.querySelector('[data-el="lista"]');
        overlay.querySelector('[data-el="buscar"]').value = '';
        renderRuta();
        renderSeleccion();
        lista.innerHTML = '';
        lista.appendChild(mensaje('Cargando...'));

        const actual = state.path[state.path.length - 1];
        try {
            if (actual.id === '__raices__') {
                const unidades = await DriveFS.listSharedDrives();
                lista.innerHTML = '';
                lista.appendChild(filaCarpeta(MI_UNIDAD, ICON_DRIVE, 'Tu Drive personal'));
                unidades.forEach(u => lista.appendChild(filaCarpeta(u, ICON_DRIVE, 'Unidad compartida')));
                return;
            }

            const carpetas = await DriveFS.listFolders(actual.id);
            lista.innerHTML = '';
            if (!carpetas.length) {
                lista.appendChild(mensaje('Esta carpeta no tiene subcarpetas. Si es la que buscas, pulsa "Usar esta carpeta".'));
                return;
            }
            carpetas.forEach(c => lista.appendChild(filaCarpeta(c, ICON_FOLDER)));
        } catch (e) {
            lista.innerHTML = '';
            lista.appendChild(mensaje('No se pudo leer Drive: ' + (e && e.message ? e.message : e), 'text-red-500'));
        }
    }

    async function mostrarBusqueda(texto) {
        const lista = overlay.querySelector('[data-el="lista"]');
        lista.innerHTML = '';
        lista.appendChild(mensaje('Buscando...'));
        try {
            const res = await DriveFS.searchFolders(texto);
            lista.innerHTML = '';
            if (!res.length) {
                lista.appendChild(mensaje('Ninguna carpeta se llama así.'));
                return;
            }
            res.forEach(c => {
                const fila = filaCarpeta(c, ICON_FOLDER, 'Resultado de búsqueda');
                // Desde una búsqueda no conocemos la ruta completa, así que la
                // barra de navegación se reinicia con la carpeta encontrada.
                fila.onclick = () => { state.path = [{ id: '__raices__', name: 'Drive' }, { id: c.id, name: c.name }]; render(); };
                lista.appendChild(fila);
            });
        } catch (e) {
            lista.innerHTML = '';
            lista.appendChild(mensaje('Error al buscar: ' + (e && e.message ? e.message : e), 'text-red-500'));
        }
    }

    // ------------------------------------------------------------- público
    window.DriveUI = {
        /** Abre el selector. Devuelve {id, name} o null si se cancela. */
        pickFolder(inicio) {
            if (!overlay) build();
            return new Promise((resolve) => {
                const path = [{ id: '__raices__', name: 'Drive' }];
                if (inicio && inicio.id) path.push({ id: inicio.id, name: inicio.name || 'Carpeta' });
                state = { path, resolve };
                overlay.classList.remove('hidden');
                overlay.classList.add('flex');
                render();
            });
        }
    };
})();
