/* ============================================================
 * documentos-equipos.js — Trae a cada proyecto los documentos de sus equipos
 *
 * Al guardar los Datos del Proyecto (inversor, batería, paneles), copia desde
 * la biblioteca "1. DOCUMENTACION OR" (hermana de los años, dentro de
 * 3. SEING) las fichas técnicas, certificados y declaraciones CNO que le
 * tocan a esos equipos hacia 1. INGENIERIA DE DETALLE, con el nombre y el
 * índice que usa la Bóveda. Después genera las declaraciones de Diseño (5) y
 * Construcción (5.1) si todavía no existen.
 *
 * La biblioteca NO se reorganiza: aquí abajo, en BIBLIOTECA, queda escrito qué
 * archivo es qué (ficha, certificado, CNO) para cada familia de equipos.
 * Para sumar un equipo nuevo basta con agregar otra regla.
 *
 * Nunca pisa nada: si el inciso ya tiene archivo, lo deja como está.
 * Usa globals de index.html (projects, currentHandle, getProjectInfo,
 * nombreBoveda, nombresParaSubida, guardarArchivo, renderActaTemplate, scan...).
 * ============================================================ */
(function () {
    'use strict';

    const CARPETA = '1. DOCUMENTACION OR';
    const H = '2. DOCUMENTOS HUAWEI/';
    const CNO_HUAWEI = H + 'DECLARACIÓN DE CUMPLIMIENTO ACUERDO CNO 2233 DE 2026.pdf';
    const BAT = '7. FICHA TECNICA BATERIA RACK GREEN POINT/';

    // inciso de la Bóveda -> archivos (rutas dentro de la biblioteca)
    //   '8.'  ficha técnica del inversor     '2.'   certificados del inversor
    //   '3-4.' declaración CNO               '8.1.' ficha técnica de la batería
    //   '9.'  ficha técnica del panel
    const BIBLIOTECA = {
        inversores: [
            { id: 'huawei-8-10k-lc0', test: /huawei.*lc0|lc0/, docs: {
                '8.': [H + '8 - 10 Kw/1.0 FICHA TÉCNICA INVERSOR - HUAWEI - 8_10K-LC0.pdf'],
                '2.': [H + '8 - 10 Kw/1.2 CERTIFICADO DE INVERSOR - HUWEI - 8_10K-LC0 (IEEE1547) - Afinia.pdf',
                       H + '8 - 10 Kw/1.1  CERTIFICADO DE INVERSOR - HUAWEI - 8_10K-LC0 (IEC62109-1_IEC62109-2).pdf',
                       H + '8 - 10 Kw/1.4 CERTIFICADO DEL INVERSOR - HUAWEI - 8_10K-LC0 (IEC61727-IEC62116).pdf'],
                '3-4.': [CNO_HUAWEI] } },
            { id: 'huawei-5-6ktl-l1', test: /huawei.*(5|6)\s?ktl|(5|6)\s?ktl.*l1/, docs: {
                '8.': [H + '6 Kw/1.0 FICHA TÉCNICA INVERSOR - HUAWEI - 5_6KTL-L1.pdf'],
                '2.': [H + '6 Kw/1.3 CERTIFICADO DE INVERSOR - HUWEI - 5_6KTL-USL0 (UL1741_IEEE1547_UL62109-1) - Afinia.PDF',
                       H + '6 Kw/1.2 CERTIFICADO DE INVERSOR - HUAWEI 5_6KTL-L1 (IEC62109-1).pdf',
                       H + '6 Kw/1.1 CERTIFICADO DE INVERSOR - HUAWEI - 5_6KTL-L1 (IEC61727_IEC62116).PDF'],
                '3-4.': [CNO_HUAWEI] } },
            { id: 'huawei-20ktl-m3', test: /20\s?ktl/, docs: {
                '8.': [H + '20-50 kw/1. FICHA TECNICA INVERSOR HUAWEI 20KW.pdf'],
                '2.': [H + '20-50 kw/1.2 CERTIFICADO SUN2000-20KTL-M3_IEC61727_IEC62116.pdf'],
                '3-4.': [CNO_HUAWEI, H + '20-50 kw/1.5 Declaracion Cumplimiento Acuerdo CNO 1862 - HUAWEI 20KTL_2025.pdf'] } },
            { id: 'deye-sg02', test: /deye|sun-?(5|8|12)k-?sg/, docs: {
                '2.': ['6. DOCUMENTOS DEYE/1.CERTIFICADO SUN-8K-SG02LP2-US-AM2 UL1741.pdf'],
                '3-4.': ['6. DOCUMENTOS DEYE/Declaration CNO 2233-UL_1.pdf', '6. DOCUMENTOS DEYE/Declaration CNO 2233-IEC.pdf'] } },
            { id: 'srne-4-7kw', test: /hesp4860/, docs: {
                '8.': ['5. DOCUMENTOS SRNE/1. Ficha Técnica Inversor Hibrido 4kW-7kW 48V.pdf'],
                '2.': ['5. DOCUMENTOS SRNE/2. Certificado 61727 Inversor Híbrido 6kW.pdf', '5. DOCUMENTOS SRNE/2.2 Certificado 62116 Inversor Híbrido 6kW.pdf'],
                '3-4.': ['5. DOCUMENTOS SRNE/CNO2233 Inversores Hibridos SRNE 2026.pdf'] } },
            { id: 'srne-8-12kw', test: /hesp48(80|120)|srne/, docs: {
                '8.': ['5. DOCUMENTOS SRNE/2. Ficha Técnica Inversor Hibrido 8-12kW 48V - ESPAÑOL.pdf'],
                '2.': ['5. DOCUMENTOS SRNE/3. Certificado 61727 + 62116 Inversor Híbrido 8.8kW~12kW.pdf', '5. DOCUMENTOS SRNE/4. Certificado UL1741 + IEEE1547 Inversores Híbridos 8.8kW - 12kW.pdf'],
                '3-4.': ['5. DOCUMENTOS SRNE/CNO2233 Inversores Hibridos SRNE 2026.pdf'] } },
            { id: 'tensite-8k', test: /tensite|ivgm/, docs: {
                '8.': ['8. DOCUMENTOS FELICITY/Inversor 8k/ficha-tecnica-inversor-tensite-hibrido-8000W (1).pdf'],
                '2.': ['8. DOCUMENTOS FELICITY/Certificado de Conformidad TENSITE Inversores PR1-101240 06-04-2026.pdf', '8. DOCUMENTOS FELICITY/Inversor 8k/Normativas UL1741_ 5K-8K.pdf'],
                '3-4.': ['8. DOCUMENTOS FELICITY/CNO 2233 DE 2026 FELICITY SOLAR.pdf'] } },
            { id: 'growatt', test: /growatt/, docs: {
                '8.': ['1. DOCUMENTOS GROWATT/3.0 FICHA TECNICA GROWATT MIN 3600-6000TL-X.pdf'],
                '2.': ['1. DOCUMENTOS GROWATT/1.0 Certificado Growatt_MIN_2500-6000TL-X_UL1741_IEEE1547A.pdf'],
                '3-4.': ['1. DOCUMENTOS GROWATT/2.0 Growatt - Parametros Voltaje y Frecuencia CNO1862.pdf'] } },
            { id: 'solis', test: /solis/, docs: {
                '8.': ['3. DOCUMENTOS SOLIS/1. FICHA TECNICA INVERSOR -  SOLIS 25-30-36 KW.pdf'],
                '2.': ['3. DOCUMENTOS SOLIS/2. CERTIFICADO INVERSOR - SOLIS  - UL_1741_C22,2_IEEE_1547_UL_1699B_UL_1998_GC (25-30-36-60-70 KW).pdf'],
                '3-4.': ['3. DOCUMENTOS SOLIS/3. PARAMETRIZACION DE VOLTAJE Y FRECUENCIA -SOLIS.pdf'] } }
        ],
        baterias: [
            { id: 'srne-205ah', test: /srne|205\s?ah|lithium/, docs: { '8.1.': [BAT + '8.1. 205AH - 314Ah 51.2V BATERIA LITIO SRNE.pdf'] } },
            { id: 'felicity-16kwh', test: /fla48314|16\s?kwh|314/, docs: { '8.1.': [BAT + 'ficha_técnica_batería_litio_felicity_solar_16kWh_51,2V_314A_FLA48314.pdf'] } },
            { id: 'felicity-fla48', test: /fla48(100|171|230|250)/, docs: { '8.1.': [BAT + 'FLA48100-EU FLA48171-EU FLA48230-EU FLA48250-EU  Datasheet - EN (1).pdf'] } },
            { id: 'felicity-10kwh', test: /felicity.*10|10\s?kwh/, docs: { '8.1.': [BAT + 'Felicity 10kWh.pdf'] } }
        ],
        // Fichas técnicas de paneles: la biblioteca todavía no tiene carpeta de módulos.
        paneles: []
    };

    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

    function reglaPara(lista, texto) {
        const t = norm(texto);
        if (!t) return null;
        return lista.find(r => r.test.test(t)) || null;
    }

    // Camina la ruta dentro de la biblioteca tolerando mayúsculas, tildes y espacios dobles.
    async function resolverArchivo(raiz, ruta) {
        const partes = ruta.split('/');
        let dir = raiz;
        for (let i = 0; i < partes.length; i++) {
            const buscado = norm(partes[i]);
            let hallado = null;
            for await (const e of dir.values()) {
                if (norm(e.name) === buscado && e.kind === (i === partes.length - 1 ? 'file' : 'directory')) { hallado = e; break; }
            }
            if (!hallado) return null;
            dir = hallado;
        }
        return dir;
    }

    async function sincronizarDocumentosEquipo(projectId, opts) {
        opts = opts || {};
        const avisar = (m) => { if (opts.avisar) showToast(m); else console.info('[equipos]', m); };
        const p = projects.find(x => x.id === projectId);
        if (!p || !p.ingFolder || !currentHandle) return { copiados: 0 };
        const info = (await getProjectInfo(projectId)) || {};

        let raiz;
        try { raiz = await currentHandle.getDirectoryHandle(CARPETA); }
        catch (e) { avisar(`No se encontró la carpeta "${CARPETA}" dentro de la ruta maestra.`); return { copiados: 0 }; }

        const reglas = [
            reglaPara(BIBLIOTECA.inversores, `${info.marcaFabricante || ''} ${info.referenciaInversor || ''}`),
            reglaPara(BIBLIOTECA.baterias, `${info.referenciaBateria || ''}`),
            reglaPara(BIBLIOTECA.paneles, `${info.marcaPaneles || ''} ${info.referenciaPanel || ''}`)
        ].filter(Boolean);

        // Lo que pide cada inciso, sin repetir archivos.
        const porInciso = {};
        reglas.forEach(r => Object.entries(r.docs).forEach(([inc, rutas]) => {
            porInciso[inc] = porInciso[inc] || [];
            rutas.forEach(x => { if (!porInciso[inc].includes(x)) porInciso[inc].push(x); });
        }));

        const proyecto = limpiarNombreProyecto(p.name);
        let copiados = 0; const faltantes = [];
        for (const [inc, rutas] of Object.entries(porInciso)) {
            const item = (p.ingItemsTodos || []).find(i => i.id === inc);
            if (!item || item.found) continue;                    // ya tiene archivo: no se toca
            const archivos = [];
            for (const ruta of rutas) {
                try {
                    const h = await resolverArchivo(raiz, ruta);
                    if (h) archivos.push(await h.getFile()); else faltantes.push(ruta.split('/').pop());
                } catch (e) { faltantes.push(ruta.split('/').pop()); }
            }
            if (!archivos.length) continue;
            const { texto } = nombreBoveda(inc, info, proyecto);
            const exts = archivos.map(a => (a.name.match(/\.[^.]+$/) || ['.pdf'])[0].toLowerCase());
            const nombres = nombresParaSubida(item, texto, exts);
            for (let k = 0; k < archivos.length; k++) { await guardarArchivo(p.ingFolder, nombres[k], archivos[k]); copiados++; }
        }

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
            showToast(reglas.length ? 'Ingeniería ya tiene los documentos de estos equipos.' : 'No hay documentos en la biblioteca para estos equipos (revisa marca y referencia en Datos del Proyecto).');
        }
        if (faltantes.length && opts.avisar) console.warn('No se encontraron en la biblioteca:', faltantes);
        return { copiados, generadas, faltantes };
    }

    window.sincronizarDocumentosEquipo = sincronizarDocumentosEquipo;
    window.BIBLIOTECA_EQUIPOS = BIBLIOTECA;
})();
