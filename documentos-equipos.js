/* ============================================================
 * documentos-equipos.js — Trae a cada proyecto los documentos de sus equipos
 *
 * Al guardar los Datos del Proyecto (inversor, batería, paneles) copia los
 * documentos de esos equipos hacia 1. INGENIERIA DE DETALLE y genera las
 * declaraciones de Diseño (5) y Construcción (5.1) si todavía no existen.
 *
 * También trae de la carpeta contractual del proyecto (0. DOCUMENTACION CONTRACTUAL) la cédula (6),
 * el certificado de tradición y libertad (7) y la disponibilidad del transformador (10) si están ahí, y
 * de la biblioteca GENERAL el certificado de experiencia del constructor (12).
 *
 * Los documentos de equipos salen de la biblioteca:
 *   3. SEING / 1. DOCUMENTACION OR / 0. BIBLIOTECA POR EQUIPO /
 *       INVERSORES / <equipo> /   2. CERTIFICADO..., 3-4. Declaracion CNO...,
 *                                 8. FICHA TÉCNICA..., 8.2. MANUAL...
 *       BATERIAS   / <equipo> /   8.1. FICHA TÉCNICA BATERÍA...
 *       PANELES    / <equipo> /   9. FICHA TECNICA PANEL...
 * Cada archivo YA tiene el nombre y el inciso que lleva dentro del proyecto,
 * así que solo se copia tal cual (sin renombrar). Para sumar un equipo: crear
 * su carpeta con los archivos así nombrados y agregar una regla abajo.
 *
 * Nunca pisa nada: si el inciso ya tiene archivo, lo deja como está.
 * Usa globals de index.html (projects, currentHandle, CONFIG, archivosDelItem,
 * getProjectInfo, guardarArchivo, renderActaTemplate, scan, showToast...).
 * ============================================================ */
(function () {
    'use strict';

    const CARPETA = '1. DOCUMENTACION OR';
    const BIBLIOTECA_DIR = '0. BIBLIOTECA POR EQUIPO';

    // test: expresión sobre "marca referencia" en minúsculas y sin tildes. El orden importa.
    const REGLAS = {
        INVERSORES: [
            { test: /20\s?ktl/, carpeta: 'HUAWEI SUN2000-20KTL-M3' },
            { test: /50\s?ktl/, carpeta: 'HUAWEI SUN2000-50KTL-M3' },
            { test: /huawei.*lc0|lc0/, carpeta: 'HUAWEI SUN2000-8K-10K-LC0' },
            { test: /huawei.*(5|6)\s?ktl|(5|6)\s?ktl/, carpeta: 'HUAWEI SUN2000-5K-6KTL-L1' },
            { test: /deye.*8\s?k|8k-sg02/, carpeta: 'DEYE SUN-8K-SG02LP2-US-AM2' },
            { test: /deye|12k-sg02|sg02lp2.*am3/, carpeta: 'DEYE SUN-12K-SG02LP2-US-AM3' },
            { test: /tensite|ivgm/, carpeta: 'TENSITE IVGM8KLP2G1' },
            { test: /hesp4860|srne.*(3\.6|4\s?k|5\s?k|6\s?k)/, carpeta: 'SRNE HESP 3.6K-6K' },
            { test: /hesp48(80|120)|srne/, carpeta: 'SRNE HESP 8K-12K' }
        ],
        BATERIAS: [
            { test: /srne|205\s?ah|lithium|litio/, carpeta: 'SRNE LITHIUM 51.2V 205AH' },
            { test: /fla48314|16\s?kwh|314/, carpeta: 'FELICITY FLA48314-EU 16kWh' },
            { test: /fla48(100|171|230|250)/, carpeta: 'FELICITY FLA48230-EU' },
            { test: /felicity.*10|10\s?kwh/, carpeta: 'FELICITY 10kWh' },
            { test: /dyness/, carpeta: 'DYNESS POWER BRICK PLUS' },
            { test: /rack/, carpeta: 'RACK GREEN POINT 100AH-200AH' }
        ],
        PANELES: [
            { test: /trina|tsm/, carpeta: 'TRINA SOLAR TSM-NEG19RC.20' },
            { test: /jinko|jkm|tiger/, carpeta: 'JINKO SOLAR JKM620N-66HL4M-BDV' },
            { test: /jam72/, carpeta: 'JA SOLAR JAM72D42-625-LB' },
            { test: /jam66/, carpeta: 'JA SOLAR JAM66D45-LB' },
            { test: /gcl|nt12/, carpeta: 'GCL NT12R-66GDF 625W' }
        ]
    };

    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const reglaPara = (lista, texto) => { const t = norm(texto); return t ? lista.find(r => r.test.test(t)) || null : null; };

    async function entrar(dir, nombre) {
        const buscado = norm(nombre);
        for await (const e of dir.values()) if (e.kind === 'directory' && norm(e.name) === buscado) return e;
        return null;
    }

    // Clasifica por el nombre (los proyectos numeran distinto: "1. CC ...", "5. CTL ...", "CC Normedys...").
    async function traerContractuales(p, info) {
        const folder = p.contractualFolder;
        if (!folder || !p.ingFolder) return [];
        const proyecto = limpiarNombreProyecto(p.name);
        const archivos = [];
        for await (const f of folder.values()) if (f.kind === 'file' && !/^desktop\.ini$/i.test(f.name) && !/^~\$/.test(f.name)) archivos.push(f);
        const n = (f) => norm(f.name);
        const esPdf = (f) => /\.pdf$/i.test(f.name);
        const imagen = (f) => /\.(jpe?g|png)$/i.test(f.name);
        const cedula = (f) => /(^|[^a-z])(cc|cedula)([^a-z]|$)/.test(n(f)) && !/poliza|rut|camara/.test(n(f));
        const ctl = (f) => !cedula(f) && /(^|[^a-z])ctl([^a-z]|$)|tradicion|libertad/.test(n(f));
        const disp = (f) => /disponibilidad/.test(n(f));
        const util = (f) => esPdf(f) || imagen(f);
        const copiados = [];
        const copiar = async (inc, lista) => {
            const item = (p.ingItemsTodos || []).find(i => i.id === inc);
            if (!item || item.found || !lista.length) return;
            const { texto } = nombreBoveda(inc, info, proyecto);
            const archivosF = []; for (const h of lista) archivosF.push(await h.getFile());
            const exts = archivosF.map(a => (a.name.match(/\.[^.]+$/) || ['.pdf'])[0].toLowerCase());
            const nombres = nombresParaSubida(item, texto, exts);
            for (let k = 0; k < archivosF.length; k++) { await guardarArchivo(p.ingFolder, nombres[k], archivosF[k]); copiados.push(nombres[k]); }
            item.found = true;
        };
        // Si el mismo documento está en PDF y en imagen, se prefiere el PDF.
        const preferirPdf = (l) => (l.some(esPdf) ? l.filter(esPdf) : l);
        await copiar('6.', preferirPdf(archivos.filter(f => util(f) && cedula(f))).sort((a, b) => a.name.localeCompare(b.name)));
        await copiar('7.', preferirPdf(archivos.filter(f => util(f) && ctl(f))).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 1));
        await copiar('10.', archivos.filter(f => util(f) && disp(f)).slice(0, 1));
        return copiados;
    }

    async function sincronizarDocumentosEquipo(projectId, opts) {
        opts = opts || {};
        const avisar = (m) => { if (opts.avisar) showToast(m); else console.info('[equipos]', m); };
        const p = projects.find(x => x.id === projectId);
        if (!p || !p.ingFolder || !currentHandle) return { copiados: 0 };
        const info = (await getProjectInfo(projectId)) || {};

        let biblioteca;
        try {
            const raiz = await currentHandle.getDirectoryHandle(CARPETA);
            biblioteca = await entrar(raiz, BIBLIOTECA_DIR);
        } catch (e) { biblioteca = null; }
        if (!biblioteca) { avisar(`No se encontró "${CARPETA}/${BIBLIOTECA_DIR}" dentro de la ruta maestra.`); return { copiados: 0 }; }

        const equipos = [
            ['INVERSORES', reglaPara(REGLAS.INVERSORES, `${info.marcaFabricante || ''} ${info.referenciaInversor || ''}`)],
            ['BATERIAS', reglaPara(REGLAS.BATERIAS, `${info.referenciaBateria || ''} ${info.potenciaBateria || ''}`)],
            ['PANELES', reglaPara(REGLAS.PANELES, `${info.marcaPaneles || ''} ${info.referenciaPanel || ''}`)]
        ].filter(([, r]) => r);

        let copiados = 0; const detalle = [];
        for (const [tipo, regla] of equipos) {
            const dirTipo = await entrar(biblioteca, tipo);
            const dirEquipo = dirTipo && await entrar(dirTipo, regla.carpeta);
            if (!dirEquipo) { console.warn(`Falta la carpeta ${tipo}/${regla.carpeta} en la biblioteca`); continue; }
            for await (const f of dirEquipo.values()) {
                if (f.kind !== 'file' || /^desktop\.ini$/i.test(f.name)) continue;
                // El inciso lo dice el propio nombre del archivo ("8.2. MANUAL...", "3-4. Declaracion...").
                const item = (p.ingItemsTodos || []).find(c => archivosDelItem(c, [{ n: f.name }]).length > 0);
                if (!item || item.found) continue;                 // el inciso ya tiene archivo: no se toca
                await guardarArchivo(p.ingFolder, f.name, await f.getFile());
                item.found = true;                                  // evita repetir si dos archivos caen en el mismo inciso
                copiados++; detalle.push(f.name);
            }
        }

        // Documentos generales (los mismos en todos los proyectos): certificado de experiencia del constructor.
        try {
            const general = await entrar(biblioteca, 'GENERAL');
            if (general) for await (const f of general.values()) {
                if (f.kind !== 'file' || /^desktop\.ini$/i.test(f.name)) continue;
                const item = (p.ingItemsTodos || []).find(c => archivosDelItem(c, [{ n: f.name }]).length > 0);
                if (!item || item.found) continue;
                await guardarArchivo(p.ingFolder, f.name, await f.getFile());
                item.found = true; copiados++; detalle.push(f.name);
            }
        } catch (e) { console.warn('GENERAL:', e); }

        // Cédula (6), CTL (7) y disponibilidad del transformador (10) desde la carpeta contractual del proyecto.
        try {
            const r = await traerContractuales(p, info);
            copiados += r.length; detalle.push(...r);
        } catch (e) { console.warn('Carpeta contractual:', e); }

        // Declaraciones de diseño (5) y construcción (5.1): se generan una sola vez; después es "Regenerar".
        let generadas = 0;
        if (info.dueno) {
            for (const id of ['5.', '5.1.']) {
                const it = (p.ingItemsTodos || []).find(i => i.id === id);
                if (it && !it.found && !it.generated) {
                    const ok = await renderActaTemplate(id, projectId, await datosDeclaracionCumplimiento(projectId), { configArr: CONFIG.ing, folderKey: 'ingFolder', sinEscaneo: true });
                    if (ok) generadas++;
                }
            }
        }

        if (copiados || generadas) {
            await scan();
            const partes = [];
            if (copiados) partes.push(`${copiados} documento${copiados > 1 ? 's' : ''} de equipos copiado${copiados > 1 ? 's' : ''}`);
            if (generadas) partes.push(`${generadas} declaración${generadas > 1 ? 'es' : ''} generada${generadas > 1 ? 's' : ''}`);
            showToast(partes.join(' y ') + ' en Ingeniería');
        } else if (opts.avisar) {
            showToast(equipos.length ? 'Ingeniería ya tiene los documentos de estos equipos.' : 'Faltan el inversor, la batería o los paneles en Datos del Proyecto (o no están en la biblioteca).');
        }
        return { copiados, generadas, detalle };
    }

    window.sincronizarDocumentosEquipo = sincronizarDocumentosEquipo;
    window.REGLAS_EQUIPOS = REGLAS;
})();
