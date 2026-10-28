/* ============================================================
 * plan-mantenimiento-ui.js — Botón y formulario del Plan de Mantenimiento (inciso 17)
 *
 * generarPlanMantenimientoAuto(projectId) lo arma con lo que ya tiene el proyecto
 * (para el botón único "Generar ingeniería"); abrirPlanMantenimiento(projectId)
 * muestra un formulario pequeño para confirmar la acometida y la tensión.
 * Usa globals de index.html (projects, getProjectData, nombreBoveda, guardarArchivo, scan...).
 * ============================================================ */
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const esc = (s) => escaparHtml(s);

    function inyectar() {
        if ($('planMantModal')) return;
        document.body.insertAdjacentHTML('beforeend', `
        <div id="planMantModal" class="hidden fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="w-full max-w-xl bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
            <div class="p-5 border-b border-slate-100 flex justify-between items-center">
              <div><p class="text-[10px] font-black text-blue-600 uppercase tracking-widest">Ingeniería · inciso 17</p>
              <h3 class="text-lg font-black text-slate-900">Plan de Mantenimiento</h3></div>
              <button type="button" onclick="document.getElementById('planMantModal').classList.add('hidden')" class="p-2 text-slate-400 text-xl leading-none">✕</button>
            </div>
            <div class="p-5 overflow-y-auto space-y-3">
              <label class="meml block">Nombre en el documento<input id="pmNombre" class="memi"></label>
              <div class="grid grid-cols-2 gap-3">
                <label class="meml block">Tipo de acometida<select id="pmAcometida" class="memi"><option value="2|Monofásica">2Φ Monofásica</option><option value="3|Trifásica">3Φ Trifásica</option></select></label>
                <label class="meml block">Tipo de usuario<select id="pmUsuario" class="memi"><option>Residencial</option><option>Comercial</option><option>Industrial</option></select></label>
                <label class="meml block">Nivel de tensión del predio (V)<input id="pmNivel" class="memi" placeholder="240/120"></label>
                <label class="meml block">Selección (V)<input id="pmSeleccion" class="memi" placeholder="240"></label>
                <label class="meml block">N.º de inversores<input id="pmInv" type="number" min="1" class="memi"></label>
                <label class="meml block">N.º de paneles<input id="pmPan" type="number" min="1" class="memi"></label>
              </div>
              <p class="text-[10px] text-slate-400">El resto del documento es el texto fijo de las memorias de SEING.</p>
            </div>
            <div class="p-5 border-t border-slate-100 text-right">
              <button type="button" id="pmGenerar" onclick="generarPlanMantenimiento()" class="px-6 py-3 bg-blue-600 text-white font-black text-xs uppercase rounded-md hover:bg-blue-700">Generar Plan PDF</button>
            </div>
          </div>
        </div>`);
        // los estilos .meml/.memi los define memoria-ui.js; si no están, se agregan
        if (!document.querySelector('style[data-pm]')) {
            document.head.insertAdjacentHTML('beforeend', '<style data-pm>.meml{font-size:10px;font-weight:900;text-transform:uppercase;color:#94a3b8}.memi{width:100%;margin-top:.25rem;padding:.55rem .65rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.375rem;font-size:.8rem;font-weight:400;text-transform:none;color:#0f172a;outline:none}</style>');
        }
    }

    // Datos por defecto a partir de Datos del Proyecto (y de la memoria, si ya se hizo)
    async function datosDe(projectId) {
        const p = projects.find(x => x.id === projectId);
        const datos = (await getProjectData(projectId)) || {};
        const info = datos.project_info || {};
        const mem = datos.memoria || {};
        const equipos = (window.MEMORIA_EQUIPOS && window.MEMORIA_EQUIPOS.inversores) || [];
        const inv = equipos.find(e => e.id === mem.inversor);
        const dc = String(info.potenciaDC || mem.potDC || '').trim(), ac = String(info.potenciaAC || mem.potAC || '').trim();
        const residencial = /residencial|vivienda|casa/i.test(info.clasificacionServicio || '') || !info.clasificacionServicio;
        const sel = inv && inv.vNom ? String(inv.vNom) : '240';
        return {
            p, info,
            nombre: `${limpiarNombreProyecto(p.name).toUpperCase()} ${dc} kWp - ${ac}kW`.replace(/\s+/g, ' '),
            acometida: 'Monofásica', fases: 2,
            nivelTension: '240/120', seleccion: sel,
            usuario: residencial ? 'Residencial' : (/industrial/i.test(info.clasificacionServicio || '') ? 'Industrial' : 'Comercial'),
            inversores: parseInt(info.numInversores, 10) || 1,
            paneles: parseInt(info.numPaneles, 10) || parseInt(mem.numMod, 10) || ''
        };
    }

    async function guardarPdf(p, info, blob) {
        const { texto } = nombreBoveda('17.', info, limpiarNombreProyecto(p.name));
        const nombre = `17. ${texto}.pdf`;
        if (!p.ingFolder) throw new Error('No se encontró la carpeta de Ingeniería de Detalle del proyecto.');
        await guardarArchivo(p.ingFolder, nombre, new Uint8Array(await blob.arrayBuffer()));
        return nombre;
    }

    window.abrirPlanMantenimiento = async (projectId) => {
        inyectar();
        const d = await datosDe(projectId);
        window.__pmProyecto = projectId;
        $('pmNombre').value = d.nombre;
        $('pmAcometida').value = `${d.fases}|${d.acometida}`;
        $('pmUsuario').value = d.usuario;
        $('pmNivel').value = d.nivelTension; $('pmSeleccion').value = d.seleccion;
        $('pmInv').value = d.inversores; $('pmPan').value = d.paneles;
        $('planMantModal').classList.remove('hidden');
    };

    window.generarPlanMantenimiento = async () => {
        const btn = $('pmGenerar');
        try {
            const projectId = window.__pmProyecto;
            const d = await datosDe(projectId);
            const [fases, acometida] = $('pmAcometida').value.split('|');
            Object.assign(d, {
                nombre: $('pmNombre').value.trim(), fases, acometida, usuario: $('pmUsuario').value,
                nivelTension: $('pmNivel').value.trim(), seleccion: $('pmSeleccion').value.trim(),
                inversores: $('pmInv').value, paneles: $('pmPan').value
            });
            if (!d.paneles) return alert('Falta el número de paneles.');
            btn.disabled = true; btn.textContent = 'Generando...';
            const nombre = await guardarPdf(d.p, d.info, window.PlanMantenimiento.generar(d));
            $('planMantModal').classList.add('hidden');
            showToast('Plan de mantenimiento generado: ' + nombre);
            await scan();
        } catch (e) {
            console.error(e); alert('No se pudo generar el plan de mantenimiento: ' + e.message);
        } finally { btn.disabled = false; btn.textContent = 'Generar Plan PDF'; }
    };

    window.__pmApi = { datosDe, guardarPdf };

    // Sin preguntar nada: para el botón único "Generar ingeniería". Devuelve el nombre del archivo o null.
    window.generarPlanMantenimientoAuto = async (projectId) => {
        const d = await datosDe(projectId);
        if (!d.paneles) return null;
        return guardarPdf(d.p, d.info, window.PlanMantenimiento.generar(d));
    };
})();
