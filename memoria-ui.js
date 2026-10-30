/* ============================================================
 * memoria-ui.js — Formulario y flujo de la Memoria de Cálculo (inciso 15)
 *
 * Usa globals de index.html (projects, getProjectInfo, getProjectData,
 * saveProjectField, supabaseClient, guardarArchivo, nombreBoveda, scan,
 * showToast, limpiarNombreProyecto, escaparHtml) y los motores
 * MemoriaCalc / MemoriaPDF.
 *
 * Los equipos (paneles, inversores, baterías) salen de memoria-equipos.js
 * (los que más se usan en SEING) + los que se agreguen con "Agregar equipo",
 * que se guardan en Supabase (tabla proyectos, fila "__equipos__").
 * ============================================================ */
(function () {
    'use strict';

    const FILA_EQUIPOS = '__equipos__';
    const RESPONSABLE = { nombre: 'OSCAR ANDRES GODOY RODRIGUEZ', matricula: 'CN250-136788', nombreCorto: 'OSCAR GODOY' };
    // Altura y datos de sitio que ya se han usado; el resto se escribe a mano.
    const ALTURAS = { valledupar: 168, 'puerto colombia': 15 };
    const CLIMA = { tempProm: 28.4, tempRango: '33°C-37°C', tempMax: 33, tmin: 15 };

    let equipos = null;              // lista combinada
    let extras = { paneles: [], inversores: [], baterias: [] };
    let est = null;                  // estado del modal abierto

    const $ = (id) => document.getElementById(id);
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
    const esc = (s) => escaparHtml(s);

    // ------------------------------------------------------------
    // Base de datos de equipos
    // ------------------------------------------------------------
    async function cargarEquipos(forzar) {
        const base = JSON.parse(JSON.stringify(window.MEMORIA_EQUIPOS || { paneles: [], inversores: [], baterias: [] }));
        let guardados = {};
        try { guardados = ((await getProjectData(FILA_EQUIPOS, { fresh: !!forzar })) || {}).equipos || {}; } catch (e) { }
        extras = { paneles: guardados.paneles || [], inversores: guardados.inversores || [], baterias: guardados.baterias || [] };
        const unir = (a, b) => { const m = new Map(a.map(x => [x.id, x])); b.forEach(x => m.set(x.id, x)); return [...m.values()]; };
        equipos = { paneles: unir(base.paneles, extras.paneles), inversores: unir(base.inversores, extras.inversores), baterias: unir(base.baterias || [], extras.baterias) };
        return equipos;
    }

    async function guardarEquiposEnSupabase() {
        if (!supabaseClient) throw new Error('Supabase no está disponible.');
        const actual = (await getProjectData(FILA_EQUIPOS, { fresh: true })) || {};
        actual.equipos = extras;
        const { error } = await supabaseClient.from('proyectos').upsert(
            { codigo: FILA_EQUIPOS, nombre: 'EQUIPOS (base de datos)', datos: actual }, { onConflict: 'codigo' });
        if (error) throw new Error(error.message);
    }

    function mejorCoincidencia(lista, ...textos) {
        const t = norm(textos.join(' '));
        if (!t) return null;
        let mejor = null, punt = 0;
        const candidatos = [];
        lista.forEach(e => {
            const claves = [e.referencia, e.modelo, e.fabricante].filter(Boolean).map(norm);
            let s = 0;
            claves.forEach((c, i) => { if (c && (t.includes(c) || c.includes(t))) s += i === 2 ? 1 : 10; });
            // tokens del modelo ("8_10K-LC0" encaja con SUN2000-8K-LC0 y con -10K-LC0)
            String(textos[textos.length - 1] || '').split(/[^A-Za-z0-9.]+/).filter(x => x.length > 2).forEach(tok => {
                if (norm(e.referencia || e.modelo).includes(norm(tok))) s += 3;
            });
            if (s >= 3) candidatos.push({ e, s });
            if (s > punt) { punt = s; mejor = e; }
        });
        mejor = punt >= 3 ? mejor : null;
        // Si hay varios que encajan (ficha "8_10K-LC0"), gana el de potencia más cercana a la del proyecto.
        const pot = mejorCoincidencia.potenciaW;
        if (pot && candidatos.length > 1 && candidatos[0].e.pAC) {
            candidatos.sort((a, b) => Math.abs(a.e.pAC - pot) - Math.abs(b.e.pAC - pot));
            mejor = candidatos[0].e;
        }
        return mejor;
    }

    // ------------------------------------------------------------
    // Modal principal
    // ------------------------------------------------------------
    function inyectarHtml() {
        if ($('memoriaModal')) return;
        document.body.insertAdjacentHTML('beforeend', `
        <div id="memoriaModal" class="hidden fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="w-full max-w-4xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
            <div class="p-5 border-b border-slate-100 flex justify-between items-center">
              <div>
                <p class="text-[10px] font-black text-blue-600 uppercase tracking-widest">Ingeniería de detalle</p>
                <h3 class="text-lg font-black text-slate-900">Generar Ingeniería</h3>
              </div>
              <button type="button" onclick="cerrarMemoria()" class="p-2 hover:bg-slate-100 rounded-full text-slate-400 text-xl leading-none">✕</button>
            </div>
            <div class="flex-1 overflow-y-auto p-5 space-y-5">
              <p class="text-[10px] text-slate-400 leading-relaxed">Los datos del proyecto, los equipos y las potencias se toman de <b class="text-slate-500">Datos del Proyecto</b>. Aquí confirmas lo que falta y se generan la memoria de cálculo y el plan de mantenimiento en PDF. Los documentos de los equipos y de la carpeta contractual ya se trajeron al abrir.</p>
              <div id="memResumen" class="p-3 bg-slate-50 border border-slate-200 rounded-md text-[10px] text-slate-500 leading-relaxed"></div>
              <div id="memChecklist"></div>

              <section>
                <h4 class="memh">Equipos</h4>
                <div class="grid grid-cols-2 gap-3">
                  <label class="meml">Panel solar<select id="memPanel" class="memi"></select></label>
                  <label class="meml">Inversor<select id="memInversor" class="memi"></select></label>
                  <label class="meml">N.º de módulos<input id="memNumMod" type="number" min="1" class="memi"></label>
                  <label class="meml">N.º de inversores<input id="memNumInv" type="number" min="1" class="memi"></label>
                  <label class="meml">Potencia DC (kWp)<input id="memPotDC" type="number" step="0.001" class="memi"></label>
                  <label class="meml">Potencia AC (kW)<input id="memPotAC" type="number" step="0.001" class="memi"></label>
                </div>
                <button type="button" onclick="abrirEquipoNuevo()" class="mt-2 text-[10px] font-black text-blue-600 uppercase hover:underline">＋ Agregar equipo (panel, inversor, batería)</button>
                <p id="memAvisoEquipo" class="text-[10px] font-bold text-amber-600 mt-1 hidden"></p>
              </section>

              <section>
                <h4 class="memh">Proyecto y sitio</h4>
                <div class="grid grid-cols-3 gap-3">
                  <label class="meml">Tipo de predio<select id="memPredio" class="memi"><option value="residencial">Residencial</option><option value="comercial">Comercial</option></select></label>
                  <label class="meml">Operador de red<input id="memOperador" class="memi"></label>
                  <label class="meml">Fecha de emisión<input id="memFecha" class="memi" placeholder="dd-mm-aaaa"></label>
                  <label class="meml">Municipio<input id="memMunicipio" class="memi"></label>
                  <label class="meml">Departamento<input id="memDepto" class="memi"></label>
                  <label class="meml">Altura s. n. m. (m)<input id="memAltura" type="number" class="memi"></label>
                  <label class="meml col-span-3">Dirección<input id="memDireccion" class="memi"></label>
                  <label class="meml">Latitud<input id="memLat" class="memi"></label>
                  <label class="meml">Longitud<input id="memLng" class="memi"></label>
                  <label class="meml">Marca de la estructura<input id="memEstructura" class="memi" value="Alurack"></label>
                  <label class="meml">Temp. promedio (°C)<input id="memTempProm" type="number" step="0.1" class="memi"></label>
                  <label class="meml">Rango temp. media máx.<input id="memTempRango" class="memi"></label>
                  <label class="meml">Temp. mínima de diseño (°C)<input id="memTmin" type="number" class="memi"></label>
                </div>
              </section>

              <section>
                <div class="flex items-center justify-between">
                  <h4 class="memh">Strings y cables</h4>
                  <div class="flex items-center gap-3">
                    <label class="text-[10px] font-bold text-slate-500">Cable DC
                      <select id="memCable" class="ml-1 p-1 border border-slate-200 rounded text-[11px]"><option value="4">PV 4 mm²</option><option value="6">PV 6 mm²</option></select></label>
                    <button type="button" onclick="memAutoStrings()" class="text-[10px] font-black text-blue-600 uppercase hover:underline">Auto-distribuir</button>
                  </div>
                </div>
                <div id="memStrings" class="space-y-3 mt-2"></div>
                <div id="memChequeo" class="mt-3 p-3 rounded-md text-[11px] leading-relaxed bg-slate-50 border border-slate-200"></div>
              </section>

              <section>
                <h4 class="memh">Cuadro de cargas</h4>
                <div id="memCuadroZona" tabindex="0" class="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center text-[11px] text-slate-400 font-bold cursor-pointer hover:border-blue-400 focus:border-blue-500 outline-none">
                  <div id="memCuadroTexto">Arrastra aquí la imagen del cuadro de cargas, pégala con <span class="text-slate-600">Ctrl + V</span> o haz clic para elegir un archivo (imagen o PDF)</div>
                  <img id="memCuadroPrev" class="hidden mx-auto mt-2 max-h-56 border border-slate-200 rounded bg-white">
                </div>
                <input id="memCuadroFile" type="file" accept="image/*,application/pdf" class="hidden">
                <div class="flex items-center justify-between mt-1.5">
                  <label id="memCuadroGuardarWrap" class="text-[10px] font-bold text-slate-500 hidden"><input id="memCuadroGuardar" type="checkbox" checked class="mr-1">Guardar también en el inciso 11 (Cuadro de cargas)</label>
                  <button type="button" id="memCuadroQuitar" onclick="memQuitarCuadro()" class="text-[10px] font-black text-rose-500 uppercase hidden">Quitar imagen</button>
                </div>
              </section>

              <section>
                <h4 class="memh">Plan de mantenimiento</h4>
                <div class="grid grid-cols-4 gap-3">
                  <label class="meml">Tipo de acometida<select id="memPmAcom" class="memi"><option value="2|Monofásica">2Φ Monofásica</option><option value="3|Trifásica">3Φ Trifásica</option></select></label>
                  <label class="meml">Tipo de usuario<select id="memPmUsuario" class="memi"><option>Residencial</option><option>Comercial</option><option>Industrial</option></select></label>
                  <label class="meml">Tensión del predio (V)<input id="memPmNivel" class="memi" placeholder="240/120"></label>
                  <label class="meml">Selección (V)<input id="memPmSel" class="memi" placeholder="240"></label>
                </div>
              </section>

              <section>
                <h4 class="memh">Diagrama unifilar</h4>
                <p class="text-[10px] text-slate-400 mb-2">Los datos de la red y del transformador salen de la plataforma del operador de red: no tienen valor por defecto. La tensión del sistema es la "Selección" de arriba.</p>
                <div class="grid grid-cols-4 gap-3">
                  <label class="meml">Cuenta (NIC)<input id="unNic" class="memi"></label>
                  <label class="meml">Trafo (kVA)<input id="unKva" type="number" class="memi"></label>
                  <label class="meml">Tensión nominal primaria<input id="unTensionPrim" class="memi" placeholder="13.2kV"></label>
                  <label class="meml">Fases del trafo<select id="unFasesTrafo" class="memi"><option value="2">2 fases</option><option value="3">3 fases</option></select></label>
                  <label class="meml">Tensión secundaria<input id="unTensionSec" class="memi" placeholder="120/240V"></label>
                  <label class="meml">Código del trafo<input id="unCodigo" class="memi"></label>
                  <label class="meml">Matrícula del trafo<input id="unMatricula" class="memi"></label>
                  <label class="meml">Acometida existente (AWG)<input id="unAwgAco" type="number" class="memi" value="8"></label>
                  <label class="meml">Canalización AC<select id="unAcTipo" class="memi"><option>EMT</option><option>IMC</option><option>PVC</option><option>PVC empotrado</option><option>Bandeja</option></select></label>
                  <label class="meml">Diámetro AC<input id="unAcDim" class="memi" value='1"'></label>
                  <label class="meml">Canalización DC<select id="unDcTipo" class="memi"><option>IMC</option><option>EMT</option><option>PVC</option><option>PVC empotrado</option><option>Bandeja</option></select></label>
                  <label class="meml">Diámetro DC<input id="unDcDim" class="memi" value='1"'></label>
                  <label class="meml">Caja de paso → inversor (m)<input id="unDistCaja" type="number" step="0.1" class="memi" value="1.7"></label>
                  <label class="meml">Inversor → tablero AC (m)<input id="unDistInv" type="number" step="0.1" class="memi" value="1.5"></label>
                  <label class="meml">Cable RS485 (m)<input id="unDistRs" type="number" step="0.1" class="memi" value="1.5"></label>
                </div>
                <div id="unBatBox" class="hidden mt-3">
                  <p class="text-[10px] font-black text-slate-500 uppercase mb-2">Batería (inversor híbrido)</p>
                  <div class="grid grid-cols-4 gap-3">
                    <label class="meml col-span-2">Batería<select id="unBat" class="memi"></select></label>
                    <label class="meml">Cantidad<input id="unBatCant" type="number" min="1" class="memi" value="1"></label>
                    <label class="meml">Corriente máx. (A)<input id="unBatImax" type="number" class="memi"></label>
                    <label class="meml">Cable batería (mm²)<input id="unBatCable" type="number" class="memi" value="50"></label>
                    <label class="meml">Distancia batería → inversor (m)<input id="unBatDist" type="number" step="0.1" class="memi" value="0.8"></label>
                  </div>
                </div>
              </section>
            </div>
            <div class="p-5 border-t border-slate-100 flex items-center justify-between gap-3">
              <p class="text-[10px] text-slate-400">Los PDF se guardan en 1. INGENIERIA DE DETALLE con el nombre y el inciso de la Bóveda.</p>
              <button type="button" id="memGenerar" onclick="generarMemoria()" class="px-6 py-3 bg-blue-600 text-white font-black text-xs uppercase rounded-md hover:bg-blue-700 shadow-lg shadow-blue-200">Generar ingeniería</button>
            </div>
          </div>
        </div>

        <div id="memEquipoModal" class="hidden fixed inset-0 bg-slate-900/50 z-[60] flex items-center justify-center p-4">
          <div class="w-full max-w-2xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
            <div class="p-5 border-b border-slate-100 flex justify-between items-center">
              <h3 class="text-base font-black text-slate-900">Agregar equipo</h3>
              <button type="button" onclick="document.getElementById('memEquipoModal').classList.add('hidden')" class="p-2 text-slate-400 text-xl leading-none">✕</button>
            </div>
            <div class="p-5 overflow-y-auto space-y-3">
              <label class="meml">Tipo de equipo<select id="eqTipo" onchange="eqPintarCampos()" class="memi"><option value="panel">Panel solar</option><option value="inversor">Inversor</option><option value="bateria">Batería</option></select></label>
              <div id="eqCampos" class="grid grid-cols-3 gap-3"></div>
              <p class="text-[10px] text-slate-400">Los datos salen de la ficha técnica del fabricante. Queda guardado para todos los proyectos y todos los equipos de la oficina.</p>
            </div>
            <div class="p-5 border-t border-slate-100 text-right">
              <button type="button" onclick="eqGuardar()" class="px-5 py-2.5 bg-slate-900 text-white font-black text-xs uppercase rounded-md hover:bg-blue-600">Guardar equipo</button>
            </div>
          </div>
        </div>
        <style>
          .memh{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#0f172a;margin-bottom:.5rem}
          .meml{display:block;font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8}
          .memi{width:100%;margin-top:.25rem;padding:.55rem .65rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.375rem;font-size:.8rem;font-weight:400;text-transform:none;color:#0f172a;outline:none}
          .memi:focus{box-shadow:0 0 0 2px #3b82f6}
          .memi-s{width:100%;padding:.3rem .4rem;background:#fff;border:1px solid #e2e8f0;border-radius:.3rem;font-size:.75rem;text-align:center}
        </style>`);
        $('memCuadroZona').addEventListener('click', () => $('memCuadroFile').click());
        $('memCuadroFile').addEventListener('change', (e) => { if (e.target.files[0]) tomarArchivoCuadro(e.target.files[0]); e.target.value = ''; });
        const z = $('memCuadroZona');
        z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('border-blue-500'); });
        z.addEventListener('dragleave', () => z.classList.remove('border-blue-500'));
        z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('border-blue-500'); const f = e.dataTransfer.files[0]; if (f) tomarArchivoCuadro(f); });
        // Pegar (Ctrl+V) con el modal abierto
        document.addEventListener('paste', (e) => {
            if ($('memoriaModal').classList.contains('hidden') || !$('memEquipoModal').classList.contains('hidden')) return;
            const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
            if (it) { e.preventDefault(); tomarArchivoCuadro(it.getAsFile()); }
        });
        ['memPanel', 'memInversor', 'memNumMod', 'memNumInv', 'memTmin', 'memCable'].forEach(id => $(id).addEventListener('change', () => {
            if (id === 'memPanel' || id === 'memInversor' || id === 'memNumMod' || id === 'memNumInv') memAutoStrings(); else refrescarChequeo();
        }));
    }

    // ------------------------------------------------------------
    // Cuadro de cargas: imagen o primera página de un PDF
    // ------------------------------------------------------------
    function cargarScript(src) {
        return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('No cargó ' + src)); document.head.appendChild(s); });
    }
    async function pdfAImagen(file) {
        if (!window.pdfjsLib) {
            await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: g, viewport: vp }).promise;
        return recortarBlanco(c).toDataURL('image/png');
    }
    // Páginas de un PDF como imágenes JPEG (para las fichas técnicas dentro de la memoria).
    async function pdfPaginas(file, cuantas) {
        if (!window.pdfjsLib) {
            await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const out = [];
        for (let n = 1; n <= Math.min(cuantas, pdf.numPages); n++) {
            const page = await pdf.getPage(n);
            const vp = page.getViewport({ scale: 1.7 });
            const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
            const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: g, viewport: vp }).promise;
            out.push(c.toDataURL('image/jpeg', 0.82));
        }
        return out;
    }
    // Ficha técnica que el proyecto ya tiene en Ingeniería (incisos 8 y 9): la memoria la usa como imagen.
    async function fichaDelProyecto(p, inciso, paginas) {
        const item = (p.ingItemsTodos || p.ingItems || []).find(i => i.id === inciso);
        const pdf = item && (item.files || []).find(f => /\.pdf$/i.test(f.n)) || (item && item.handle ? { h: item.handle } : null);
        if (!pdf || !pdf.h) return [];
        try { return await pdfPaginas(await pdf.h.getFile(), paginas); }
        catch (e) { console.warn('No se pudo leer la ficha del inciso ' + inciso + ':', e); return []; }
    }

    // Quita el margen blanco alrededor del contenido.
    function recortarBlanco(c) {
        const g = c.getContext('2d'); const { width: w, height: h } = c;
        const d = g.getImageData(0, 0, w, h).data;
        let x0 = w, y0 = h, x1 = 0, y1 = 0;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
            const i = (y * w + x) * 4;
            if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 <= x0 || y1 <= y0) return c;
        const m = 12; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w, x1 + m); y1 = Math.min(h, y1 + m);
        const o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0;
        o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
        return o;
    }
    function archivoADataUrl(file) {
        return new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
    }
    async function tomarArchivoCuadro(file, origen) {
        try {
            const url = (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) ? await pdfAImagen(file) : await archivoADataUrl(file);
            est.cuadro = url; est.cuadroOrigen = origen || 'nuevo';
            pintarCuadro();
        } catch (e) { showToast('No se pudo leer el cuadro de cargas: ' + e.message); }
    }
    function pintarCuadro() {
        const hay = !!est.cuadro;
        $('memCuadroPrev').classList.toggle('hidden', !hay);
        if (hay) $('memCuadroPrev').src = est.cuadro;
        $('memCuadroTexto').classList.toggle('hidden', hay);
        $('memCuadroQuitar').classList.toggle('hidden', !hay);
        $('memCuadroGuardarWrap').classList.toggle('hidden', !(hay && est.cuadroOrigen === 'nuevo' && !est.hayInciso11));
    }
    window.memQuitarCuadro = () => { est.cuadro = null; est.cuadroOrigen = null; pintarCuadro(); };

    // ------------------------------------------------------------
    // Strings
    // ------------------------------------------------------------
    function equipoSel(tipo, id) { return (equipos[tipo] || []).find(e => e.id === id); }
    function panelSel() { return equipoSel('paneles', $('memPanel').value); }
    function inversorSel() { return equipoSel('inversores', $('memInversor').value); }

    function pintarStrings() {
        const cont = $('memStrings');
        cont.innerHTML = est.config.map((inv, ii) => `
            <div class="p-3 border border-slate-200 rounded-md">
              <p class="text-[10px] font-black text-slate-500 uppercase mb-2">Inversor ${ii + 1}</p>
              <div class="grid grid-cols-12 gap-2 text-[9px] font-black text-slate-400 uppercase text-center mb-1"><span class="col-span-2">MPPT</span><span class="col-span-3">Strings en paralelo</span><span class="col-span-3">Módulos en serie</span><span class="col-span-4">Longitud cable DC (m)</span></div>
              ${inv.strings.map((s, si) => `
                <div class="grid grid-cols-12 gap-2 items-center mb-1">
                  <span class="col-span-2 text-center text-xs font-bold text-slate-600">MPPT ${s.mppt}</span>
                  <input type="number" min="1" value="${s.paralelos}" data-i="${ii}" data-s="${si}" data-k="paralelos" class="memi-s col-span-3">
                  <input type="number" min="1" value="${s.series}" data-i="${ii}" data-s="${si}" data-k="series" class="memi-s col-span-3">
                  <input type="number" min="1" value="${s.longitud}" data-i="${ii}" data-s="${si}" data-k="longitud" class="memi-s col-span-4">
                </div>`).join('')}
              <div class="grid grid-cols-12 gap-2 items-center mt-2">
                <span class="col-span-8 text-[10px] font-bold text-slate-500 text-right">Longitud cable AC hasta el tablero (m)</span>
                <input type="number" min="1" value="${inv.longitudAC}" data-i="${ii}" data-k="longitudAC" class="memi-s col-span-4">
              </div>
            </div>`).join('');
        cont.querySelectorAll('input').forEach(inp => inp.addEventListener('input', () => {
            const i = +inp.dataset.i, k = inp.dataset.k, v = parseFloat(inp.value) || 0;
            if (k === 'longitudAC') est.config[i].longitudAC = v; else est.config[i].strings[+inp.dataset.s][k] = v;
            refrescarChequeo();
        }));
        refrescarChequeo();
    }
    window.memAutoStrings = () => {
        const P = panelSel(), I = inversorSel();
        if (!P || !I) return;
        const nMod = parseInt($('memNumMod').value, 10) || 0, nInv = Math.max(1, parseInt($('memNumInv').value, 10) || 1);
        if (!nMod) { est.config = []; pintarStrings(); return; }
        est.config = window.MemoriaCalc.distribuirAuto(nMod, nInv, I.mppt || 2, P, I, num($('memTmin').value) ?? 15);
        pintarStrings();
    };

    function refrescarChequeo() {
        const box = $('memChequeo');
        try {
            const P = panelSel(), I = inversorSel();
            const av = $('memAvisoEquipo');
            $('unBatBox').classList.toggle('hidden', !(I && I.tipoSistema === 'hibrido'));
            if (I && I.tipoSistema === 'hibrido') { av.textContent = 'Inversor híbrido: la memoria sale igual que las anteriores de SEING (el cálculo es el del lado solar, sin sección de baterías).'; av.classList.remove('hidden'); }
            else av.classList.add('hidden');
            if (!P || !I || !est.config.length) { box.textContent = 'Elige los equipos y el número de módulos.'; return; }
            const C = window.MemoriaCalc.calcular({ panel: P, inversor: I, inversores: est.config, tmin: num($('memTmin').value) ?? 15, cablePV: +$('memCable').value });
            const nMod = parseInt($('memNumMod').value, 10) || 0;
            const filas = C.distribucion.flatMap(d => d.filas);
            const malos = filas.filter(f => !f.okVoc || !f.okVmp || !f.okIsc);
            const lineas = [];
            lineas.push(`${C.totalModulos === nMod ? '✓' : '⚠'} Módulos configurados: <b>${C.totalModulos}</b>${C.totalModulos === nMod ? '' : ` (el proyecto tiene ${nMod})`} · ${(C.totalWp / 1000).toFixed(3)} kWp`);
            lineas.push(`${C.vocCorregido <= I.vdcMax ? '✓' : '⚠'} Voc corregido a ${C.tmin} °C: <b>${C.vocCorregido} V</b> (máx. inversor ${I.vdcMax} V)`);
            lineas.push(`${malos.length ? '⚠' : '✓'} Verificación de MPPT (Voc / Vmp / Isc): <b>${malos.length ? 'hay strings que no cumplen' : 'cumplen'}</b>`);
            const cumple = C.ocupacion.every(o => o.cumple);
            lineas.push(`${cumple ? '✓' : '⚠'} Ocupación de canalizaciones ≤ 40 %`);
            box.innerHTML = lineas.join('<br>');
            box.className = 'mt-3 p-3 rounded-md text-[11px] leading-relaxed border ' + (C.totalModulos === nMod && !malos.length && C.vocCorregido <= I.vdcMax && cumple ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800');
        } catch (e) { box.textContent = 'No se pudo calcular: ' + e.message; }
    }

    // ------------------------------------------------------------
    // Abrir el modal
    // ------------------------------------------------------------
    function llenarSelects(selPanel, selInv) {
        $('memPanel').innerHTML = equipos.paneles.map(e => `<option value="${esc(e.id)}">${esc(e.fabricante)} ${esc(e.referencia)} (${e.pmax} W)</option>`).join('');
        $('memInversor').innerHTML = equipos.inversores.map(e => `<option value="${esc(e.id)}">${esc(e.fabricante)} ${esc(e.modelo)}${e.tipoSistema === 'hibrido' ? ' (híbrido)' : ''}</option>`).join('');
        if (selPanel) $('memPanel').value = selPanel;
        if (selInv) $('memInversor').value = selInv;
    }

    window.abrirMemoriaCalculo = async (projectId) => {
        inyectarHtml();
        const p = projects.find(x => x.id === projectId);
        if (!p) return;
        est = { projectId, p, config: [], cuadro: null, cuadroOrigen: null, hayInciso11: false, solo: '' };
        await cargarEquipos(true);
        const datos = (await getProjectData(projectId)) || {};
        const info = datos.project_info || {};
        const guardado = datos.memoria || {};
        const coords = datos.coordinates || {};

        const mp = mejorCoincidencia(equipos.paneles, info.marcaPaneles, info.referenciaPanel);
        mejorCoincidencia.potenciaW = (num(info.potenciaAC) || 0) * 1000 / Math.max(1, parseInt(info.numInversores, 10) || 1);
        const mi = mejorCoincidencia(equipos.inversores, info.marcaFabricante, info.referenciaInversor);
        mejorCoincidencia.potenciaW = 0;
        llenarSelects(guardado.panel || (mp && mp.id), guardado.inversor || (mi && mi.id));

        const dep = String(info.departamento || '');
        const orDefecto = /atl[aá]ntico|magdalena|guajira/i.test(dep) ? 'AIR-E' : 'AFINIA';
        const hoy = new Date(); const dd = (n) => String(n).padStart(2, '0');
        const v = (k, def) => (guardado[k] !== undefined && guardado[k] !== '' ? guardado[k] : def);
        $('memNumMod').value = v('numMod', info.numPaneles || '');
        $('memNumInv').value = v('numInv', info.numInversores || 1);
        const P0 = panelSel(), I0 = inversorSel();
        $('memPotDC').value = v('potDC', info.potenciaDC || (P0 && $('memNumMod').value ? (P0.pmax * $('memNumMod').value / 1000).toFixed(3) : ''));
        $('memPotAC').value = v('potAC', info.potenciaAC || (I0 ? (I0.pAC * ($('memNumInv').value || 1) / 1000) : ''));
        $('memPredio').value = v('predio', /residencial|vivienda|casa/i.test(info.clasificacionServicio || '') ? 'residencial' : (info.clasificacionServicio ? 'comercial' : 'residencial'));
        $('memOperador').value = v('operador', info.operadorRed || orDefecto);
        $('memFecha').value = v('fecha', `${dd(hoy.getDate())}-${dd(hoy.getMonth() + 1)}-${hoy.getFullYear()}`);
        $('memMunicipio').value = v('municipio', info.municipio || '');
        $('memDepto').value = v('departamento', dep);
        $('memDireccion').value = v('direccion', info.direccion || '');
        $('memAltura').value = v('altura', ALTURAS[String(info.municipio || '').toLowerCase().trim()] || '');
        $('memLat').value = v('lat', coords.lat != null ? coords.lat : '');
        $('memLng').value = v('lng', coords.lng != null ? coords.lng : '');
        $('memEstructura').value = v('estructura', 'Alurack');
        $('memTempProm').value = v('tempProm', CLIMA.tempProm);
        $('memTempRango').value = v('tempRango', CLIMA.tempRango);
        $('memTmin').value = v('tmin', CLIMA.tmin);
        $('memCable').value = String(v('cable', 4));
        // Plan de mantenimiento: valores por defecto (o los últimos usados)
        try {
            const pmd = await window.__pmApi.datosDe(projectId);
            const pm = guardado.plan || {};
            $('memPmAcom').value = pm.acom || `${pmd.fases}|${pmd.acometida}`;
            $('memPmUsuario').value = pm.usuario || pmd.usuario;
            $('memPmNivel').value = pm.nivel || pmd.nivelTension;
            $('memPmSel').value = pm.seleccion || pmd.seleccion;
        } catch (e) { console.warn('Plan de mantenimiento:', e); }
        // Unifilar: lo guardado la última vez; el NIC sale de Datos del Proyecto
        const un = guardado.unifilar || {};
        const setU = (id, k, def) => { $(id).value = (un[k] !== undefined && un[k] !== '') ? un[k] : (def !== undefined ? def : ''); };
        setU('unNic', 'nic', info.nicTrf || ''); setU('unKva', 'kva'); setU('unTensionPrim', 'tensionPrim'); setU('unFasesTrafo', 'fases', '2');
        setU('unTensionSec', 'tensionSec'); setU('unCodigo', 'codigo'); setU('unMatricula', 'matricula'); setU('unAwgAco', 'awgAco', 8);
        setU('unAcTipo', 'acTipo', 'EMT'); setU('unAcDim', 'acDim', '1"'); setU('unDcTipo', 'dcTipo', 'IMC'); setU('unDcDim', 'dcDim', '1"');
        setU('unDistCaja', 'distCaja', 1.7); setU('unDistInv', 'distInv', 1.5); setU('unDistRs', 'distRs', 1.5);
        $('unBat').innerHTML = (equipos.baterias || []).map(e => `<option value="${esc(e.id)}">${esc(e.fabricante)} ${esc(e.modelo)}${e.capacidadKwh ? ' (' + e.capacidadKwh + ' kWh)' : ''}</option>`).join('');
        const mb = mejorCoincidencia(equipos.baterias || [], info.marcaBateria || '', info.referenciaBateria || '');
        if (un.bateria || mb) $('unBat').value = un.bateria || mb.id;
        setU('unBatCant', 'batCant', info.numBaterias || 1); setU('unBatImax', 'batImax'); setU('unBatCable', 'batCable', 50); setU('unBatDist', 'batDist', 0.8);
        pintarChecklist(p);

        $('memResumen').innerHTML = [['Cliente', info.dueno], ['Proyecto', limpiarNombreProyecto(p.name)], ['Panel', `${info.marcaPaneles || ''} ${info.referenciaPanel || ''}`.trim()], ['Inversor', `${info.marcaFabricante || ''} ${info.referenciaInversor || ''}`.trim()]]
            .map(([k, val]) => `<span class="font-bold text-slate-600">${k}:</span> ${val ? esc(val) : '<span class="text-red-400">falta</span>'}`).join(' &nbsp;·&nbsp; ');

        if (guardado.config && guardado.config.length) { est.config = guardado.config; pintarStrings(); } else memAutoStrings();

        // Cuadro de cargas: si ya está el inciso 11 en la carpeta se usa solo.
        const item11 = (p.ingItemsTodos || p.ingItems || []).find(i => i.id === '11.');
        est.hayInciso11 = !!(item11 && item11.found);
        pintarCuadro();
        { const gb = $('memGenerar'); gb.dataset.texto = ''; gb.textContent = 'Generar ingeniería'; }
        $('memoriaModal').classList.remove('hidden');
        if (est.hayInciso11 && item11.handle) {
            try { const f = await item11.handle.getFile(); await tomarArchivoCuadro(f, 'inciso11'); } catch (e) { console.warn('No se pudo leer el inciso 11:', e); }
        }
        refrescarChequeo();
    };
    window.cerrarMemoria = () => $('memoriaModal').classList.add('hidden');

    // ------------------------------------------------------------
    // Estado de la Ingeniería de Detalle del proyecto
    // ------------------------------------------------------------
    // Estos incisos dependen del sitio (techo, fotos, planos): se agregan a mano.
    const MANUALES = { '10.': 1, '13.': 1, '14.': 1, '16.': 1 };
    const PROXIMOS = { '18.': 1 };
    function pintarChecklist(p, banner) {
        const items = (p.ingItems || []).filter(i => !i.sinValor);
        const ok = items.filter(i => i.found).length;
        const fila = (i) => {
            const e = i.found ? ['✓', 'text-emerald-600', 'listo']
                : i.generated ? ['◐', 'text-amber-600', 'borrador: falta firmar y subir el PDF']
                : PROXIMOS[i.id] ? ['○', 'text-slate-400', 'próximamente se genera aquí']
                : MANUALES[i.id] ? ['○', 'text-rose-500', 'se agrega a mano'] : ['○', 'text-rose-500', 'falta'];
            return `<span class="inline-flex items-center gap-1 mr-3 mb-0.5 text-[10px] ${e[1]}" title="${esc(i.label)} — ${e[2]}"><b>${e[0]}</b>${esc(i.id)} ${esc(i.label)}</span>`;
        };
        $('memChecklist').innerHTML = `
            ${banner ? `<div class="p-3 mb-2 bg-emerald-50 border border-emerald-200 rounded-md text-[11px] font-bold text-emerald-800 leading-relaxed">${banner}</div>` : ''}
            <div class="p-3 bg-white border border-slate-200 rounded-md">
              <p class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Ingeniería de detalle: ${ok} de ${items.length} incisos</p>
              <div>${items.map(fila).join('')}</div>
            </div>`;
    }

    // Regenerar un solo archivo (unifilar, memoria de cálculo o plan de mantenimiento) de un proyecto que ya tiene ingeniería.
    const NOMBRE_SOLO = { unifilar: 'el unifilar', memoria: 'la memoria de cálculo', plan: 'el plan de mantenimiento' };
    window.abrirRegenerar = async (projectId, que) => {
        await window.abrirMemoriaCalculo(projectId);
        est.solo = que;
        const b = $('memGenerar');
        b.textContent = `Regenerar ${NOMBRE_SOLO[que] || 'archivo'}`;
        b.dataset.texto = b.textContent;
    };

    // Botón único: primero trae los documentos (equipos, contractual, declaraciones) y luego abre el formulario.
    window.abrirGenerarIngenieria = async (projectId) => {
        try {
            showToast('Trayendo los documentos del proyecto…');
            if (window.sincronizarDocumentosEquipo) await window.sincronizarDocumentosEquipo(projectId);
        } catch (e) { console.warn('No se pudieron traer los documentos:', e); }
        await window.abrirMemoriaCalculo(projectId);
    };

    // ------------------------------------------------------------
    // Agregar equipo
    // ------------------------------------------------------------
    const CAMPOS = {
        panel: [['fabricante', 'Fabricante', 'text'], ['referencia', 'Referencia / modelo', 'text'], ['pmax', 'Pmax (W)', 'number'], ['vmpp', 'Vmpp (V)', 'number'], ['imp', 'Imp (A)', 'number'], ['voc', 'Voc (V)', 'number'], ['isc', 'Isc (A)', 'number'],
            ['eficiencia', 'Eficiencia (%)', 'number'], ['coefVoc', 'Coef. temp. Voc (%/°C)', 'number'], ['vmaxSist', 'Tensión máx. sistema (V)', 'number', 1500], ['peso', 'Peso (kg)', 'number'], ['dimL', 'Largo (mm)', 'number'], ['dimA', 'Ancho (mm)', 'number'], ['dimE', 'Espesor (mm)', 'number']],
        inversor: [['fabricante', 'Fabricante', 'text'], ['modelo', 'Modelo', 'text'], ['tipoSistema', 'Tipo', 'select', ['on-grid', 'hibrido']], ['pAC', 'Potencia AC nominal (W)', 'number'], ['vNom', 'Tensión de red (V)', 'number', 220], ['fases', 'Fases (conductores de fase)', 'number', 2],
            ['iSalida', 'Corriente máx. salida (A)', 'number'], ['interruptor', 'Interruptor recomendado (A)', 'number'], ['vdcMax', 'Tensión máx. DC (V)', 'number'], ['vmpptMin', 'MPPT mín. (V)', 'number'], ['vmpptMax', 'MPPT máx. (V)', 'number'],
            ['iEntMppt', 'Corriente máx. entrada por MPPT (A)', 'number'], ['iscMppt', 'Isc máx. por MPPT (A)', 'number'], ['mppt', 'N.º de MPPT', 'number', 2], ['conexion', 'Conexión a la red', 'text', '220 V 2F+T']],
        bateria: [['fabricante', 'Fabricante', 'text'], ['modelo', 'Modelo', 'text'], ['tension', 'Tensión (V)', 'number'], ['capacidadAh', 'Capacidad (Ah)', 'number'], ['capacidadKwh', 'Capacidad (kWh)', 'number']]
    };
    window.abrirEquipoNuevo = () => { inyectarHtml(); $('eqTipo').value = 'panel'; eqPintarCampos(); $('memEquipoModal').classList.remove('hidden'); };
    window.eqPintarCampos = () => {
        const t = $('eqTipo').value;
        $('eqCampos').innerHTML = CAMPOS[t].map(([k, label, tipo, def]) => tipo === 'select'
            ? `<label class="meml">${label}<select id="eq_${k}" class="memi">${def.map(o => `<option value="${o}">${o}</option>`).join('')}</select></label>`
            : `<label class="meml">${label}<input id="eq_${k}" type="${tipo}" step="any" class="memi" ${def !== undefined ? `value="${def}"` : ''}></label>`).join('')
            + (t === 'panel' || t === 'inversor' ? '<label class="meml col-span-3">Características (opcional, una por línea)<textarea id="eq_bullets" rows="3" class="memi"></textarea></label>' : '');
    };
    window.eqGuardar = async () => {
        const t = $('eqTipo').value;
        const val = (k) => $('eq_' + k).value.trim();
        const falta = CAMPOS[t].filter(([k, , tipo]) => tipo !== 'select' && !['peso', 'eficiencia', 'capacidadAh', 'capacidadKwh'].includes(k) && !val(k)).map(c => c[1]);
        if (falta.length) return alert('Faltan datos: ' + falta.join(', '));
        const e = { tipo: t };
        CAMPOS[t].forEach(([k, , tipo]) => { e[k] = tipo === 'number' ? num(val(k)) : val(k); });
        if (t === 'panel') {
            e.dim = [e.dimL, e.dimA, e.dimE]; delete e.dimL; delete e.dimA; delete e.dimE;
            e.coefVoc = -Math.abs(e.coefVoc || 0.26);
            e.id = norm(e.fabricante + e.referencia);
        } else e.id = norm(e.fabricante + e.modelo);
        if (t === 'inversor') { e.vNom = e.vNom || 220; e.mppt = e.mppt || 2; }
        const b = $('eq_bullets'); e.bullets = b ? b.value.split('\n').map(x => x.trim()).filter(Boolean) : [];
        const lista = t === 'panel' ? extras.paneles : t === 'inversor' ? extras.inversores : extras.baterias;
        const i = lista.findIndex(x => x.id === e.id); if (i >= 0) lista[i] = e; else lista.push(e);
        try {
            await guardarEquiposEnSupabase();
            await cargarEquipos(true);
            const sp = $('memPanel').value, si = $('memInversor').value;
            llenarSelects(t === 'panel' ? e.id : sp, t === 'inversor' ? e.id : si);
            $('memEquipoModal').classList.add('hidden');
            showToast('Equipo guardado en la base de datos');
            memAutoStrings();
        } catch (err) { alert('No se pudo guardar el equipo: ' + err.message); }
    };

    // ------------------------------------------------------------
    // Generar
    // ------------------------------------------------------------
    function leerFormulario() {
        const g = (id) => $(id).value.trim();
        return {
            numMod: parseInt(g('memNumMod'), 10) || 0, numInv: parseInt(g('memNumInv'), 10) || 1,
            panel: g('memPanel'), inversor: g('memInversor'), potDC: g('memPotDC'), potAC: g('memPotAC'),
            predio: g('memPredio'), operador: g('memOperador'), fecha: g('memFecha'), municipio: g('memMunicipio'), departamento: g('memDepto'),
            direccion: g('memDireccion'), altura: g('memAltura'), lat: g('memLat'), lng: g('memLng'), estructura: g('memEstructura'),
            tempProm: g('memTempProm'), tempRango: g('memTempRango'), tmin: g('memTmin'), cable: g('memCable'), config: est.config
        };
    }

    function leerUnifilar() {
        const g = (id) => $(id).value.trim();
        return {
            nic: g('unNic'), kva: g('unKva'), tensionPrim: g('unTensionPrim'), fases: parseInt(g('unFasesTrafo'), 10) || 2, tensionSec: g('unTensionSec'),
            codigo: g('unCodigo'), matricula: g('unMatricula'), awgAco: parseInt(g('unAwgAco'), 10) || 8,
            acTipo: g('unAcTipo'), acDim: g('unAcDim'), dcTipo: g('unDcTipo'), dcDim: g('unDcDim'),
            distCaja: parseFloat(g('unDistCaja')) || 1.7, distInv: parseFloat(g('unDistInv')) || 1.5, distRs: parseFloat(g('unDistRs')) || 1.5,
            bateria: g('unBat'), batCant: parseInt(g('unBatCant'), 10) || 1, batImax: parseFloat(g('unBatImax')) || '', batCable: parseFloat(g('unBatCable')) || 50, batDist: parseFloat(g('unBatDist')) || 0.8
        };
    }

    window.generarMemoria = async () => {
        const btn = $('memGenerar');
        try {
            if (!window.MemoriaPDF || !window.jspdf) throw new Error('No se cargó el motor del PDF (memoria-pdf.js / jsPDF).');
            const f = leerFormulario();
            const P = equipoSel('paneles', f.panel), I = equipoSel('inversores', f.inversor);
            const faltan = [];
            if (!P) faltan.push('panel'); if (!I) faltan.push('inversor');
            ['municipio', 'departamento', 'direccion', 'altura', 'lat', 'lng'].forEach(k => { if (!f[k]) faltan.push(k); });
            if (!f.numMod) faltan.push('n.º de módulos');
            if (faltan.length) return alert('Faltan datos: ' + faltan.join(', '));
            if (!est.config.length) return alert('Configura los strings (botón Auto-distribuir).');

            btn.disabled = true; btn.textContent = 'Generando...';
            const hechos = [];
            const p = projects.find(x => x.id === est.projectId) || est.p;   // el escaneo de los documentos renovó el proyecto
            const D = {
                nombre: limpiarNombreProyecto(p.name).toUpperCase(), potDC: parseFloat(f.potDC) || 0, potAC: f.potAC, municipio: f.municipio, departamento: f.departamento,
                direccion: f.direccion, tipoPredio: f.predio, operadorRed: f.operador, fecha: f.fecha, lat: f.lat, lng: f.lng,
                tempProm: f.tempProm, tempRango: f.tempRango, tempMax: parseFloat((f.tempRango.match(/\d+/) || [33])[0]), altura: f.altura, tmin: parseFloat(f.tmin) || 15,
                cablePV: +f.cable, estructuraMarca: f.estructura, panel: P, inversor: I, inversores: est.config, responsable: RESPONSABLE, cuadroFuente: est.cuadro
            };
            const info = (await getProjectInfo(est.projectId)) || {};
            const folder = p.ingFolder;
            if (!folder) throw new Error('No se encontró la carpeta de Ingeniería de Detalle del proyecto.');
            const solo = est.solo || '';   // '' = todo; 'memoria' | 'plan' | 'unifilar' = solo ese archivo

            if (!solo || solo === 'memoria') {
                // Las fichas técnicas salen de los PDF del propio proyecto (incisos 9 y 8).
                btn.textContent = 'Leyendo fichas técnicas...';
                D.fichaPanel = await fichaDelProyecto(p, '9.', 1);
                D.fichaInv = await fichaDelProyecto(p, '8.', 2);
                btn.textContent = 'Generando...';
                const r = await window.MemoriaPDF.generar(D);

                const { texto } = nombreBoveda('15.', info, limpiarNombreProyecto(p.name));
                const nombre = `15. ${texto}.pdf`;
                await guardarArchivo(folder, nombre, new Uint8Array(await r.blob.arrayBuffer()));

                // El cuadro de cargas pegado se guarda también como inciso 11 si todavía no existe.
                if (est.cuadro && est.cuadroOrigen === 'nuevo' && !est.hayInciso11 && $('memCuadroGuardar').checked) {
                    const blob = await (await fetch(est.cuadro)).blob();
                    const n11 = nombreBoveda('11.', info, limpiarNombreProyecto(p.name)).texto;
                    await guardarArchivo(folder, `11. ${n11}.png`, new Uint8Array(await blob.arrayBuffer()));
                }

                hechos.push(`Memoria de cálculo (${r.paginas} págs.)`);
                if (est.cuadro && est.cuadroOrigen === 'nuevo' && !est.hayInciso11) hechos.push('Cuadro de cargas');
            }

            if (!solo || solo === 'plan') {
                // Plan de mantenimiento (inciso 17) con lo que se confirmó aquí
                btn.textContent = 'Plan de mantenimiento...';
                const pmd = await window.__pmApi.datosDe(est.projectId);
                const [fases, acometida] = $('memPmAcom').value.split('|');
                Object.assign(pmd, {
                    nombre: `${D.nombre} ${f.potDC} kWp - ${f.potAC}kW`.replace(/\s+/g, ' '), fases, acometida, usuario: $('memPmUsuario').value,
                    nivelTension: $('memPmNivel').value.trim(), seleccion: $('memPmSel').value.trim(), inversores: f.numInv, paneles: f.numMod
                });
                const nombrePlan = await window.__pmApi.guardarPdf(p, info, window.PlanMantenimiento.generar(pmd));
                hechos.push('Plan de mantenimiento');
            }

            // Diagrama unifilar (PDF + DXF): on-grid (hoja grande) o híbrido (A3)
            const u = leerUnifilar();
            const noHechos = [];
            const faltaTrafo = [['nic', 'cuenta'], ['kva', 'kVA'], ['tensionPrim', 'tensión primaria'], ['tensionSec', 'tensión secundaria'], ['codigo', 'código'], ['matricula', 'matrícula']].filter(([k]) => !u[k]).map(x => x[1]);
            if (solo && solo !== 'unifilar') { /* solo se regenera otro archivo */ }
            else if (!window.Unifilar) noHechos.push('Unifilar (no se cargó el motor)');
            else if (I.tipoSistema === 'hibrido' && !equipoSel('baterias', u.bateria)) noHechos.push('Unifilar (elige la batería)');
            else if (faltaTrafo.length) noHechos.push(`Unifilar (faltan datos del transformador: ${faltaTrafo.join(', ')})`);
            else {
                btn.textContent = 'Unifilar...';
                const Cc = window.MemoriaCalc.calcular({ panel: P, inversor: I, inversores: est.config, tmin: D.tmin, cablePV: D.cablePV });
                const hib = I.tipoSistema === 'hibrido';
                let extra = {};
                if (hib) {
                    const B = equipoSel('baterias', u.bateria);
                    const kwh = B.capacidadKwh || (B.capacidadAh && B.tension ? +(B.capacidadAh * B.tension / 1000).toFixed(2) : '');
                    btn.textContent = 'Logo y firmas...';
                    const logo = await window.MemoriaPDF.cargarImagen('img/logo.png', { png: true, maxW: 900 });
                    const firmas = window.cargarFirmasIngenieria ? await window.cargarFirmasIngenieria() : {};
                    const nB = u.batCant, nI = est.config.length;
                    extra = {
                        bateria: { marca: B.fabricante, modelo: B.modelo, kwh, ah: B.capacidadAh || '', cantidad: nB, cableMm2: u.batCable, distancia: u.batDist, imax: u.batImax },
                        tipoSistemaTxt: 'Híbrido', direccion: f.direccion, municipio: f.municipio, lat: f.lat, lng: f.lng, logo,
                        descripcion: [`- Sistema solar fotovoltaico compuesto por ${f.numMod} paneles solares de ${P.pmax}W`, `- Marca: ${P.fabricante} ${P.referencia || ''}`.trim(),
                            `- Sistema solar fotovoltaico compuesto por ${nI > 1 ? nI + ' Inversores Solares' : '1 Inversor Solar'} ${I.fabricante} ${I.modelo} y ${nB > 1 ? nB + ' baterías' : 'una batería'} ${B.fabricante} ${B.modelo}${kwh ? ' ' + kwh + 'kWh' : ''}`],
                        firmas: Object.assign({
                            consNombre: 'ING. ' + RESPONSABLE.nombre, consMp: RESPONSABLE.matricula,
                            disNombre: 'ING. HASSITH MUEGUES', disMp: 'SN285-187274'
                        }, firmas)
                    };
                }
                const U = window.Unifilar.generar(Object.assign({
                    nombre: D.nombre, potDC: f.potDC, potAC: f.potAC, operador: f.operador, nic: u.nic,
                    trafo: { tensionPrim: u.tensionPrim, kva: u.kva, fases: u.fases, tensionSec: u.tensionSec, codigo: u.codigo, matricula: u.matricula },
                    panel: P, inversor: I, inversores: est.config, calc: Cc,
                    canal: { acTipo: u.acTipo, acDim: u.acDim, acBandeja: /bandeja/i.test(u.acTipo), dcTipo: u.dcTipo, dcDim: u.dcDim, dcBandeja: /bandeja/i.test(u.dcTipo) },
                    dist: { cajaInversor: u.distCaja, invTablero: u.distInv, rs485: u.distRs, tableroGeneral: est.config[0].longitudAC },
                    acometida: { awg: u.awgAco }, vSistema: parseInt($('memPmSel').value, 10) || I.vNom
                }, extra));
                const nU = nombreBoveda('1.', info, limpiarNombreProyecto(p.name)).texto;
                await guardarArchivo(folder, `1. ${nU}.pdf`, new Uint8Array(await U.pdf.arrayBuffer()));
                await guardarArchivo(folder, `1. ${nU}.dxf`, new TextEncoder().encode(U.dxf));
                hechos.push('Diagrama unifilar (PDF y DXF)');
            }

            const guardar = Object.assign({}, f, { cuadro: undefined, unifilar: u, plan: { acom: $('memPmAcom').value, usuario: $('memPmUsuario').value, nivel: $('memPmNivel').value.trim(), seleccion: $('memPmSel').value.trim() } });
            await saveProjectField(est.projectId, 'memoria', guardar);
            await refrescarProyecto(est.projectId);
            const pf = projects.find(x => x.id === est.projectId) || p;
            const pendientes = (pf.ingItems || []).filter(i => !i.found && !i.sinValor).map(i => i.id + ' ' + i.label);
            pintarChecklist(pf, `Generado: ${hechos.join(', ')}.${noHechos.length ? ' No se pudo: ' + noHechos.join('; ') + '.' : ''}${pendientes.length ? ' Falta: ' + pendientes.join(', ') + '.' : ' Ingeniería completa.'}`);
            $('memChecklist').scrollIntoView({ behavior: 'smooth', block: 'start' });
            showToast(`Ingeniería generada: ${hechos.length} documentos`);
        } catch (e) {
            console.error('Error generando la memoria:', e);
            alert('No se pudo generar la memoria: ' + e.message);
        } finally {
            btn.disabled = false; btn.textContent = btn.dataset.texto || 'Generar ingeniería';
        }
    };
})();
