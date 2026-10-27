/* ============================================================
 * memoria-pdf.js — Genera la Memoria de Cálculo (Anexo B, RETIE 10.1) en PDF
 *
 * Mismo estilo de las memorias hechas en Word (encabezado con logo, índice,
 * RETIE 10.1 literales A–W), pero con los datos del proyecto y las tablas de
 * cálculo dibujadas como tablas reales (MemoriaCalc).
 *
 * Requiere jsPDF (window.jspdf) y memoria-calc.js. Expone window.MemoriaPDF.
 * ============================================================ */
(function () {
    'use strict';

    const PW = 215.9, PH = 279.4;                 // Carta
    const ML = 30, MR = 29, MT = 41, MB = 25;     // márgenes (mm)
    const CW = PW - ML - MR;
    const AZUL = [37, 99, 201], AZUL_CLARO = [214, 227, 247], GRIS = [90, 90, 90];
    const ASSETS = 'img/memoria/';

    // ------------------------------------------------------------
    // Utilidades de texto
    // ------------------------------------------------------------
    const UNI = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince',
        'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
    const DEC = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    function palabras(n) {
        n = Math.round(n);
        if (n < 30) return UNI[n];
        if (n < 100) { const d = Math.floor(n / 10), u = n % 10; return DEC[d] + (u ? ' y ' + (u === 1 ? 'un' : UNI[u]) : ''); }
        return String(n);
    }
    const conLetras = (n) => `${palabras(n)} (${n})`;
    const fmt = (n, d) => Number(n).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
    const kwp3 = (n) => Number(n).toFixed(3);

    // ------------------------------------------------------------
    // Carga de imágenes -> dataURL (JPEG o PNG) con tamaño
    // ------------------------------------------------------------
    const _cache = {};
    async function cargarImagen(src, opts) {
        opts = opts || {};
        if (!src) return null;
        const key = typeof src === 'string' && !src.startsWith('data:') ? src : null;
        if (key && _cache[key]) return _cache[key];
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const url = typeof src === 'string' ? src : URL.createObjectURL(src);
        const res = await new Promise((ok) => { img.onload = () => ok(true); img.onerror = () => ok(false); img.src = url; });
        if (typeof src !== 'string') URL.revokeObjectURL(url);
        if (!res) return null;
        const maxW = opts.maxW || 1400;
        const k = Math.min(1, maxW / img.naturalWidth);
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d');
        const png = !!opts.png;
        if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(img, 0, 0, c.width, c.height);
        const out = { data: c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88), w: c.width, h: c.height, fmt: png ? 'PNG' : 'JPEG' };
        if (key) _cache[key] = out;
        return out;
    }

    // ------------------------------------------------------------
    // Texto fijo del literal 10.1 (tabla de aplicabilidad)
    // ------------------------------------------------------------
    const RETIE_TABLA = [
        ['a. Análisis y cuadro de cargas iniciales y futuras, incluyendo análisis de factor de potencia y armónicos', 'NO', 'Las cargas del proyecto fueron definidas en el momento de su dimensionamiento, el sistema fotovoltaico permite alimentar las cargas existentes. El factor de potencia del sistema es el cociente entre la potencia activa y la potencia aparente a la salida del inversor. Los inversores deben generar energía a una determinada calidad, de tal forma que contenga una baja distorsión armónica y bajas interferencias electromagnéticas, por lo que se maneja un factor de potencia igual a 1.'],
        ['b. Coordinación de aislamiento eléctrico', 'SI', 'Ver memorias de cálculo.'],
        ['c. Análisis de Cortocircuito y Falla a Tierra', 'NO', 'A pesar de que los inversores no aportan un nivel de cortocircuito significativo al sistema, el análisis se hace desde las protecciones en AC, las cuales se seleccionan en función de los niveles de cortocircuito del punto de conexión existente. Aun así, los inversores vienen equipados con un dispositivo de interrupción de falla a tierra por monitorización de aislamiento.'],
        ['d. Análisis de nivel de riesgo por rayos y medidas de protección contra rayos', 'SI', 'Ver memorias de cálculo.'],
        ['e. Análisis de Riesgos de Origen Eléctrico y Medidas para Mitigarlos', 'SI', 'Ver memorias de cálculo.'],
        ['f. Análisis del Nivel de Tensión', 'SI', 'Ver memorias de cálculo.'],
        ['g. Cálculo de Campos Electromagnéticos', 'NO', 'Las instalaciones del sistema eléctrico del cliente son en baja tensión, por lo que a 60hz se pueden producir campos electromagnéticos a un nivel imperceptible, lo cual no tiene efectos nocivos para los seres vivos.'],
        ['h. Cálculo del Transformador', 'NO', 'El alcance de estas memorias no comprende el dimensionamiento de transformadores.'],
        ['i. Cálculo del Sistema de Puesta a Tierra', 'SI', 'Ver memorias de cálculo.'],
        ['j. Cálculo económico de conductores', 'SI', 'Los conductores seleccionados cumplen técnica y económicamente. Por lo que se anexa el literal "k" para el soporte del mismo.'],
        ['k. Verificación de conductores elegidos', 'SI', 'Ver memorias de cálculo.'],
        ['l. Cálculo Mecánico de Estructura y Elementos de Sujeción de Equipos', 'SI', 'Ver plano de fijaciones mecánicas.'],
        ['m. Cálculo de Coordinación de Protecciones contra Sobre corrientes', 'SI', 'Ver memorias de cálculo.'],
        ['n. Cálculo de canalizaciones', 'SI', 'Ver memorias de cálculo.'],
        ['o. Cálculo de Pérdidas de Energía', 'SI', 'Ver memorias de cálculo.'],
        ['p. Cálculo de Regulación', 'SI', 'Ver memorias de cálculo.'],
        ['q. Clasificación de Áreas', 'NO', 'La ubicación de los equipos se encuentra totalmente aislada de áreas críticas.'],
        ['r. Diagrama Unifilar', 'SI', 'Ver diagrama unifilar.'],
        ['s. Planos y Esquemas Eléctricos para la Construcción', 'SI', 'Ver plano de rutas de cableado, fijaciones mecánicas y puesta a tierra.'],
        ['t. Especificaciones de Construcción Complementarias a los Planos, Incluyendo las de Tipo Técnico de Equipos, Materiales y sus Condiciones Particulares.', 'SI', 'Ver plano de comunicaciones y etiquetado.'],
        ['u. Distancias de Seguridad Requeridas', 'SI', 'Ver plano de rutas de cableado y ubicación de equipos.'],
        ['v. Justificación Técnica de Desviación de la NTC 2050 Cuando sea Permitido, Siempre y Cuando no Comprometa la Seguridad de las Personas o de la Instalación.', 'NO', 'No existen desviaciones a la norma.'],
        ['w. Los demás estudios que el tipo de instalación requiera para su correcta y segura operación, tales como condiciones sísmicas, acústicas, mecánicas o térmicas', 'NO', 'No está dentro del alcance del sistema fotovoltaico.']
    ];

    const RIESGOS_OPERACIONALES = [
        ['INSPECCION GENERAL', 'Electrización con sistemas energizados, contactos directos, equipos defectuosos, contactos indirectos', 'Guardar distancias de seguridad eléctricas con los sistemas RETIE Art. 13. En caso de realizar actividades intrusivas, emplee elementos de protección individual para riesgo eléctrico. Reportar y cambiar equipos en mal estado. En caso de tomar medidas, usar equipos y herramientas certificadas'],
        ['CONSTRUCCION DE ESTRUCTURA Y MONTAJE DE EQUIPOS DEL SISTEMA FOTOVOLTAICO', 'Descargas atmosféricas, arco eléctrico, contactos directos e indirectos, equipos defectuosos', 'En caso de lluvia y/o descargas atmosféricas, interrumpa temporalmente las actividades. Guardar Distancias de seguridad, usar botas dieléctricas y dotación personal para electricistas. Aplicar protocolo de pruebas previo a la instalación, montar hoja de vida de los equipos. Reportar y cambiar equipos en mal estado. Cumplir reglamentación de trabajos en alturas.'],
        ['DESENERGIZACIÓN DE INSTALACIONES PARA CONEXIÓN AL SISTEMA', 'Cortocircuitos, arcos eléctricos, contactos directos, Contactos Indirectos, equipos defectuosos, descargas atmosféricas', 'Use guantes dieléctricos clase 00, gafas de seguridad con filtro UV, camisa para arco eléctrico categoría 1 y protección facial para arco eléctrico. Abstenerse de hacer maniobras eléctricas en caso de lluvia y/o presencia de descargas atmosféricas. Reportar y cambiar equipos en mal estado. Cumplir cinco reglas de oro'],
        ['CONEXIÓN', 'Quemaduras o electrización por Contactos directos, contactos indirectos, cortocircuitos, arco eléctrico, equipos defectuosos, descargas atmosféricas', 'Use guantes dieléctricos clase 00, gafas de seguridad con filtro UV, camisa para arco eléctrico categoría 1 y protección facial para arco eléctrico. Abstenerse de hacer maniobras eléctricas en caso de lluvia y/o presencia de descargas atmosféricas. Reportar y cambiar equipos en mal estado. Verificar que los niveles de tensión sean los adecuados para los equipos y protecciones.'],
        ['ENERGIZACIÓN', 'Equipos defectuosos, daño de equipos, incendios, quemaduras, cortocircuitos, arcos eléctricos', 'Montar hoja de vida de los equipos. Reportar y cambiar equipos en mal estado. Use guantes dieléctricos clase 00, gafas de seguridad con filtro UV, camisa para arco eléctrico categoría 1 y protección facial para arco eléctrico. Cumplir los procedimientos del fabricante.'],
        ['PUESTA EN SERVICIO Y PRUEBAS', 'Equipos defectuosos, daño de equipos, incendios, quemaduras, cortocircuitos, arcos eléctricos', 'Montar hoja de vida de los equipos. Reportar y cambiar equipos en mal estado. Use guantes dieléctricos clase 00, gafas de seguridad con filtro UV, camisa para arco eléctrico categoría 1 y protección facial para arco eléctrico. Seguir procedimiento del fabricante.']
    ];

    // ============================================================
    // GENERADOR
    // datos: ver construirDatosMemoria() en index.html
    // calc: resultado de MemoriaCalc.calcular
    // assets: imágenes ya cargadas { logo, firma, cuadro, panel, inversor, datasheet[], ... }
    // ============================================================
    function construir(doc, D, C, A, toc) {
        const registro = [];
        let y = MT;
        const lh = (size) => size * 0.3528 * 1.32;       // alto de línea en mm

        const nuevaPagina = () => { doc.addPage(); y = MT; };
        const resto = () => PH - MB - y;
        const asegurar = (h) => { if (resto() < h) nuevaPagina(); };
        const pagina = () => doc.getNumberOfPages();

        function fuente(size, estilo, color) {
            doc.setFont('times', estilo || 'normal'); doc.setFontSize(size);
            const c = color || [0, 0, 0]; doc.setTextColor(c[0], c[1], c[2]);
        }

        // Párrafo justificado (se parte entre páginas por líneas)
        function p(texto, o) {
            o = o || {};
            const size = o.size || 10.5, estilo = o.estilo || 'normal';
            fuente(size, estilo, o.color);
            const x = ML + (o.sangria || 0), w = CW - (o.sangria || 0);
            const lineas = doc.splitTextToSize(String(texto), w);
            const alto = lh(size);
            lineas.forEach((ln, i) => {
                asegurar(alto + (i === 0 ? (o.antes || 0) : 0));
                if (i === 0) y += (o.antes || 0);
                const ultima = i === lineas.length - 1;
                if (o.centrar) doc.text(ln, ML + CW / 2, y + alto * 0.75, { align: 'center' });
                else if (!ultima && !o.izq && ln.indexOf(' ') > 0) {
                    const pal = ln.split(' ');
                    const anchoTxt = pal.reduce((a, s) => a + doc.getTextWidth(s), 0);
                    const esp = (w - anchoTxt) / (pal.length - 1);
                    let cx = x;
                    pal.forEach(s => { doc.text(s, cx, y + alto * 0.75); cx += doc.getTextWidth(s) + esp; });
                } else doc.text(ln, x, y + alto * 0.75);
                y += alto;
            });
            y += o.despues != null ? o.despues : 2.2;
        }
        function vineta(texto, o) { p('•  ' + texto, Object.assign({ sangria: 5, izq: false, despues: 1.2 }, o || {})); }

        function titulo(texto, nivel, noTOC) {
            const size = nivel === 1 ? 12.5 : nivel === 2 ? 11.5 : 10.5;
            fuente(size, 'bold', nivel === 1 ? [20, 20, 20] : [30, 30, 30]);
            const lineas = doc.splitTextToSize(texto, CW);
            asegurar(lh(size) * lineas.length + (nivel === 3 ? 30 : 16));
            y += nivel === 1 ? 4 : 3;
            if (!noTOC) registro.push({ tipo: 'h', texto, pagina: pagina() });
            lineas.forEach(ln => { doc.text(ln, ML, y + lh(size) * 0.75); y += lh(size); });
            y += 2;
        }
        function etiqueta(tipo, texto) {   // pie de tabla/figura (se lista en los índices)
            fuente(8.5, 'italic', [60, 100, 160]);
            asegurar(6);
            registro.push({ tipo, texto, pagina: pagina() });
            doc.text(texto, ML + CW / 2, y + 3, { align: 'center' });
            y += 7;
        }

        // Tabla genérica con ajuste de texto y salto de página por fila.
        function tabla(o) {
            const cols = o.cols, tot = cols.reduce((a, b) => a + b, 0);
            const anchos = cols.map(c => c / tot * (o.ancho || CW));
            const size = o.size || 8.5, pad = 1.4, alto = lh(size) * 0.92;
            const x0 = ML + (CW - (o.ancho || CW)) / 2;
            const dibujarFila = (celdas, estilo) => {
                // celdas: array de string | {t, span, fill, bold, align}
                fuente(size, estilo.bold ? 'bold' : 'normal', estilo.color);
                const items = []; let ci = 0;
                celdas.forEach(c => {
                    const cel = typeof c === 'object' && c !== null ? c : { t: c };
                    const span = cel.span || 1;
                    const w = anchos.slice(ci, ci + span).reduce((a, b) => a + b, 0);
                    doc.setFont('times', (cel.bold || estilo.bold) ? 'bold' : 'normal');
                    const lineas = doc.splitTextToSize(String(cel.t == null ? '' : cel.t), w - pad * 2);
                    items.push({ cel, w, ci, lineas, h: lineas.length * alto + pad * 2 });
                    ci += span;
                });
                const h = Math.max(...items.map(i => i.h), 6);
                if (resto() < h) nuevaPagina();
                let x = x0;
                items.forEach(it => {
                    const fill = it.cel.fill || estilo.fill;
                    if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, y, it.w, h, 'F'); }
                    doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.15); doc.rect(x, y, it.w, h);
                    doc.setFont('times', (it.cel.bold || estilo.bold) ? 'bold' : 'normal'); doc.setFontSize(size);
                    const col = it.cel.color || estilo.color || [0, 0, 0]; doc.setTextColor(col[0], col[1], col[2]);
                    const al = it.cel.align || estilo.align || o.align || 'left';
                    const ty = y + pad + alto * 0.75 + (h - it.h) / 2;
                    it.lineas.forEach((ln, k) => {
                        const tx = al === 'center' ? x + it.w / 2 : x + pad;
                        doc.text(ln, tx, ty + k * alto, { align: al === 'center' ? 'center' : 'left' });
                    });
                    x += it.w;
                });
                y += h;
            };
            if (o.titulo) dibujarFila([{ t: o.titulo, span: cols.length }], { bold: true, fill: AZUL, color: [255, 255, 255], align: 'center' });
            if (o.head) dibujarFila(o.head, { bold: true, fill: o.headFill || AZUL_CLARO, align: 'center' });
            o.rows.forEach(r => {
                if (r && r.__estilo) dibujarFila(r.celdas, r.__estilo);
                else dibujarFila(r, { align: o.align || 'left' });
            });
            y += 2;
        }

        // Imagen centrada (ancho en mm, alto proporcional); se ajusta al espacio disponible.
        function imagen(im, anchoMax, o) {
            if (!im) return;
            o = o || {};
            let w = Math.min(anchoMax || CW, CW), h = w * im.h / im.w;
            const maxH = PH - MT - MB - 12;
            if (h > maxH) { h = maxH; w = h * im.w / im.h; }
            asegurar(h + 2);
            doc.addImage(im.data, im.fmt, ML + (CW - w) / 2, y, w, h);
            y += h + 2;
        }

        // ---------- Datos derivados ----------
        const P = D.panel, I = D.inversor, nInv = D.inversores.length;
        const plural = nInv > 1;
        const titulo3 = `SSFV ${D.nombre} ${kwp3(D.potDC)} kWp - ${D.potAC} kW`;
        const lugar = `${D.municipio}, ${D.departamento}`;
        const residencial = D.tipoPredio === 'residencial';
        const predioTxt = residencial ? `la casa ${D.nombre}` : `el predio ${D.nombre}`;
        const establecimiento = residencial ? 'establecimiento residencial' : 'establecimiento';
        const inversoresTxt = plural ? `${conLetras(nInv)} inversores` : 'un (1) inversor';
        const modelosInv = I.modelo;
        const dist = C.distribucion[0];
        const conv = C.ocupacion[0];
        const tOp = (D.tempMax || 33) + 22;

        // ===================== PÁGINA 1: PORTADA =====================
        fuente(13, 'bold'); y = MT + 4;
        ['PLANTA SOLAR FOTOVOLTAICA INTERCONECTADA A LA RED', `PROYECTO ${titulo3}`].forEach(t => {
            doc.splitTextToSize(t, CW).forEach(ln => { doc.text(ln, ML + CW / 2, y, { align: 'center' }); y += 6; });
        });
        y += 4;
        fuente(11, 'bold'); doc.text('ÍNDICE DE MODIFICACIONES', ML + CW / 2, y, { align: 'center' }); y += 4;
        tabla({ cols: [22, 40, 32, 62], size: 9, align: 'center', head: ['Índice de Revisión', 'Sección Modificada', 'Fecha de Modificación', 'Observaciones'],
            rows: [['0', 'Emisión Original', D.fecha, ''], ['', '', '', ''], ['', '', '', '']] });
        y += 6;
        fuente(11, 'bold'); doc.text('REVISIÓN Y APROBACIÓN', ML + CW / 2, y, { align: 'center' }); y += 5;
        const firmante = (rol) => {
            const hFirma = 30;
            asegurar(hFirma + 20);
            const w1 = 52, w2 = CW - w1;
            [[`Responsable por ${rol}`, D.responsable.nombre], ['Matrícula profesional', D.responsable.matricula]].forEach(f => {
                doc.setFillColor(AZUL_CLARO[0], AZUL_CLARO[1], AZUL_CLARO[2]);
                doc.rect(ML, y, w1, 7, 'F'); doc.setDrawColor(150); doc.rect(ML, y, w1, 7); doc.rect(ML + w1, y, w2, 7);
                fuente(9, 'bold'); doc.text(f[0], ML + 2, y + 4.8); fuente(9, 'normal'); doc.text(f[1], ML + w1 + 2, y + 4.8);
                y += 7;
            });
            doc.rect(ML, y, CW, hFirma);
            if (A.firma) { const fw = 38, fh = fw * A.firma.h / A.firma.w; doc.addImage(A.firma.data, 'PNG', ML + CW / 2 - fw / 2, y + 1, fw, Math.min(fh, 17)); }
            doc.setDrawColor(0); doc.line(ML + CW / 2 - 35, y + 19, ML + CW / 2 + 35, y + 19);
            fuente(8.5, 'bold'); doc.text(D.responsable.nombreCorto, ML + CW / 2, y + 23, { align: 'center' });
            fuente(8.5, 'normal'); doc.text('SMART ENERGY ING', ML + CW / 2, y + 27, { align: 'center' });
            y += hFirma + 6;
        };
        firmante('elaboración'); firmante('construcción');

        // ===================== PÁGINA 2: PORTADA INTERNA + ÍNDICES =====================
        nuevaPagina();
        fuente(12, 'bold');
        ['PROYECTO SISTEMA SOLAR FOTOVOLTAICO INTERCONECTADO A LA RED', titulo3, 'ANEXO B. INFORME DE INGENIERÍA DETALLADA'].forEach(t => {
            doc.splitTextToSize(t, CW).forEach(ln => { doc.text(ln, ML + CW / 2, y, { align: 'center' }); y += 6; });
            y += 1;
        });
        y += 3;
        const listar = (tituloLista, tipo) => {
            fuente(11, 'bold'); asegurar(10); doc.text(tituloLista, ML, y + 4); y += 8;
            const items = (toc || []).filter(r => r.tipo === tipo);
            items.forEach(r => {
                fuente(8.8, 'normal'); asegurar(5);
                const t = doc.splitTextToSize(r.texto, CW - 12)[0];
                doc.text(t, ML, y + 3.2);
                const ancho = doc.getTextWidth(t), numw = doc.getTextWidth(String(r.pagina));
                const dotsW = CW - ancho - numw - 3;
                if (dotsW > 3) doc.text('.'.repeat(Math.floor(dotsW / doc.getTextWidth('.'))), ML + ancho + 1.5, y + 3.2);
                doc.text(String(r.pagina), ML + CW, y + 3.2, { align: 'right' });
                y += 4.6;
            });
            y += 3;
        };
        listar('TABLA DE CONTENIDO', 'h');
        listar('ÍNDICE DE FIGURAS', 'fig');
        listar('ÍNDICE DE TABLAS', 'tab');

        // ===================== RETIE 10.1 =====================
        nuevaPagina();
        tabla({ cols: [11, 52, 14, 80], size: 8.2, head: ['ÍTEM', 'NUMERAL 10.1. RETIE', 'APLICA', 'JUSTIFICACIÓN'],
            rows: RETIE_TABLA.map((r, i) => [{ t: String(i + 1), align: 'center' }, r[0], { t: r[1], align: 'center', bold: true }, r[2]]) });

        // ===================== TABLAS 1 - 4 =====================
        nuevaPagina();
        tabla({ cols: [70, 70], size: 9, titulo: 'ESPECIFICACIONES DEL SISTEMA FOTOVOLTAICO', head: ['ITEM', 'DESCRIPCIÓN'], ancho: 140, rows: [
            ['CANTIDAD DE MÓDULOS FOTOVOLTAICOS (FV)', String(C.totalModulos)],
            ['REFERENCIA DEL MÓDULO FV', P.fabricante],
            ['POTENCIA NOMINAL TOTAL DC', `${kwp3(D.potDC)} kWp`],
            [`NÚMERO DE INVERSORES ${I.fabricante} ${I.modelo}`, String(nInv)],
            ['POTENCIA NOMINAL TOTAL AC', `${D.potAC} kW`],
            ['OPERADOR DE RED', D.operadorRed]] });
        etiqueta('tab', 'Tabla 1. Especificaciones del sistema FV.');
        tabla({ cols: [70, 70], size: 9, titulo: 'DATOS DE LA UBICACIÓN DEL PROYECTO', ancho: 140, rows: [
            ['LATITUD', String(D.lat)], ['LONGITUD', String(D.lng)],
            ['TEMPERATURA PROMEDIO [°C]', `${D.tempProm}°C`], ['RANGO DE TEMPERATURA MEDIA MAX [°C]', D.tempRango],
            ['ALTURA SOBRE EL NIVEL DEL MAR', `${D.altura} m`]] });
        etiqueta('tab', 'Tabla 2. Datos Georreferencia del proyecto');
        tabla({ cols: [70, 70], size: 9, titulo: 'ESPECIFICACIONES DEL MÓDULO FOTOVOLTAICO', ancho: 140, rows: [
            ['FABRICANTE', P.fabricante], ['REFERENCIA', P.referencia],
            ['POTENCIA MÁXIMA (Pmax)', `${P.pmax} W`], ['TENSIÓN DE MÁXIMA POTENCIA (Vmpp)', `${P.vmpp} V`],
            ['INTENSIDAD MÁXIMA DE POTENCIA (Imp)', `${P.imp} A`], ['TENSIÓN DE CIRCUITO ABIERTO (Voc)', `${P.voc} V`],
            ['INTENSIDAD DE CORTOCIRCUITO (Isc)', `${P.isc} A`], ['EFICIENCIA DEL MÓDULO EN STC (%)', `${P.eficiencia} %`],
            ['TEMPERATURA DE OPERACIÓN', '-40°C ~ + 85°C'], ['MÁXIMA TENSIÓN DEL SISTEMA', `${P.vmaxSist || 1500} V`],
            ['CAPACIDAD MÁXIMA DE FUSIBLE', '20 A'], ['TOLERANCIA DE POTENCIA', '0~+5W'],
            ['COEFICIENTE DE TEMPERATURA DE Voc', `${String(P.coefVoc).replace('.', ',')}%/°C`],
            ['PESO', `${String(P.peso).replace('.', ',')} kg`], ['DIMENSIONES', `${P.dim[0]}×${P.dim[1]}×${P.dim[2]} mm`], ['CONECTOR', 'MC4']] });
        etiqueta('tab', 'Tabla 3. Especificaciones de los Módulos Fotovoltaicos');
        tabla({ cols: [70, 70], size: 9, titulo: 'ESPECIFICACIONES INVERSOR', ancho: 140, rows: [
            ['FABRICANTE', I.fabricante], ['MODELO', I.modelo],
            ['CORRIENTE MAX. DE ENTRADA, POR MMPT', `${I.iEntMppt} A`], ['CORRIENTE MAX. DE CORTOCIRCUITO, POR MMPT', `${I.iscMppt} A`],
            ['RANGO DE TENSIÓN DC', `${I.vmpptMin} – ${I.vmpptMax} V`], ['TENSIÓN MÁXIMA DC', `${I.vdcMax} V`],
            ['POTENCIA NOMINAL DE SALIDA AC', `${I.pAC} W`], ['CORRIENTE MAX. SALIDA', `${I.iSalida} A`],
            ['TENSIÓN NOMINAL DE LA RED', `${I.vNom} V`], ['INTERRUPTOR RECOMENDADO', `${I.interruptor} A`],
            ['CONEXIÓN A LA RED', I.conexion || `${I.vNom} V 2F+T`], ['FRECUENCIA', '60 Hz']] });
        etiqueta('tab', `Tabla 4. Especificación de inversor${plural ? 'es' : ''}.`);

        // ===================== 1. INTRODUCCIÓN =====================
        nuevaPagina();
        titulo('1. Introducción', 2);
        p('En un contexto mundial en el que el 81% del total de la energía consumida proviene de fuentes fósiles y tan solo un 19% de fuentes renovables, durante los últimos 30 y 40 años se ha venido desarrollando una etapa de transición hacia el aprovechamiento de estas últimas con el fin de reducir la dependencia en la importación de energéticos fósiles de precios ampliamente volátiles, disminuir las emisiones de efecto invernadero producidas por el sector energético y contribuir así a la mitigación del cambio climático.');
        p('Colombia es un país que goza de una matriz energética relativamente rica tanto en combustibles fósiles como en recursos renovables, sin embargo, debe tenerse en cuenta que la demanda energética está prevista para ser cubierta por la oferta doméstica tan solo por el orden de 7 años más para el caso del petróleo y 15 años más para el caso del gas natural.');
        p('En este contexto el gobierno colombiano desarrolla la Ley 1715 del 13 de mayo de 2014 por medio de la cual se regula la integración de las energías renovables no convencionales en el sistema energético nacional. La finalidad de esta ley es la de establecer el marco legal y los instrumentos para la promoción del aprovechamiento de las fuentes renovables de energía, el fomento de la inversión, investigación y desarrollo de tecnologías limpias para producción de energía.');
        p(`La instalación fotovoltaica está ubicada en el municipio de ${D.municipio}, ${D.departamento} en la ${D.direccion} está realizada con el objetivo de generar parte de la energía en el ${establecimiento}, compuesta por una planta de energía solar fotovoltaica de ${kwp3(D.potDC)} kWp y cuenta con una acometida de sistema solar fotovoltaico conectada a la red por medio de ${inversoresTxt} de ${D.potAC} kW On-Grid. La instalación consta de una distribución de (${C.totalModulos}) módulos de generación eléctrica DC los cuales se encuentran fijados sobre las cubiertas disponibles del edificio. Desde este espacio se realiza la ruta de cableado DC hacia el punto de conexión del tablero Fotovoltaico que agrupa la potencia del sistema, ${plural ? 'los inversores se conectan' : 'el inversor se conecta'} con el gabinete AC por medio de protecciones de la instalación, este tablero se ubica en la subestación.`);
        titulo('2. Objetivo', 2);
        p(`El objetivo fundamental para cualquier instalación eléctrica es garantizar la seguridad las personas y de las instalaciones existentes de ${predioTxt} mediante la selección adecuada de los componentes de la instalación eléctrica acorde con los lineamientos del Reglamento Técnico de Instalaciones Eléctricas RETIE, NTC 2050 y NEC 2014/2017 para garantizar la seguridad de la instalación y su correcto funcionamiento.`);
        titulo('3. Descripción General y Localización del Proyecto', 2);
        p(`En este proyecto se diseña y se describe con detalle el sistema interconectado llamado “Planta solar fotovoltaica de ${kwp3(D.potDC)} kWp para Autogeneración a Pequeña Escala ${'SSFV ' + D.nombre}”, con el cual, la planta suplirá las necesidades energéticas por medio de esta tecnología de generación de energía eléctrica. La planta cuenta con ${palabras(C.totalModulos)} (${C.totalModulos}) módulos solares.`);
        p(`La instalación está ubicada en el municipio de ${lugar}`);
        p(`Se debe disponer de un espacio en la cubierta de ${C.areaCubierta} m2 distribuidos en la cubierta para la ubicación de ${C.totalModulos} módulos fotovoltaicos de ${P.pmax} W.`);
        p(`Adicionalmente, un espacio de 6 m2 para la ubicación ${plural ? 'de los inversores' : 'del inversor'} ${I.fabricante} ${modelosInv}.`);
        p('La ubicación de los módulos se encuentra distribuida como se detalla en las siguientes tablas:');
        C.distribucion.forEach(d => {
            const rows = d.filas.map(f => [f.mppt, f.paralelos, f.series, f.paneles, f.wp, fmt(f.pctTotal * 100, 2) + '%', fmt(f.ratio, 6), f.okVoc ? 'CUMPLE' : 'NO CUMPLE', f.okVmp ? 'CUMPLE' : 'NO CUMPLE', f.okIsc ? 'CUMPLE' : 'NO CUMPLE', f.vmpp]);
            rows.push({ __estilo: { bold: true, fill: [240, 240, 240], align: 'center' }, celdas: [{ t: 'TOTAL', span: 3 }, d.totalPaneles, d.totalWp, '100,00%', fmt(d.ratioTotal, 5), '', '', '', ''] });
            tabla({ cols: [13, 13, 11, 12, 15, 17, 17, 16, 16, 16, 14], size: 7, align: 'center', titulo: `INVERSOR No. ${d.inversor}  -  REFERENCIA: ${I.modelo}  -  P Nominal ${I.vNom}V AC (W): ${I.pAC}`,
                head: ['', 'Paralelos', 'Series', 'Paneles', 'Potencia (Wp)', 'Porcentaje del total instalado', 'Relación de potencia DC/AC', 'Verificación Voc', 'Verificación Vmp', 'Verificación Isc', 'Vmp STC'], rows });
        });
        etiqueta('tab', 'Tabla 5. Distribución de Paneles.');

        titulo('3.1 Características generales de los equipos de generación y acondicionamiento de la energía.', 2);
        p(`Se seleccionaron ${C.totalModulos} módulos solares marca ${P.fabricante} con las siguientes características:`);
        if (P.bullets && P.bullets.length) { listaConImagen(A.panel, P.bullets, 52); etiqueta('tab', 'Tabla 6. Características Equipo de Generación Fotovoltaica.'); }
        p(`Los ${C.totalModulos} módulos se proponen distribuir según las strings establecidas en la tabla 5. En el unifilar adjunto se puede observar la conexión del sistema solar fotovoltaico propuesto para el proyecto ${'SSFV ' + D.nombre}`);
        p('Las especificaciones técnicas del módulo se muestran en las fichas técnicas, anexas a este informe, para la codificación de los planos se utiliza la mostrada en la figura 1. En la codificación usada, el primer dígito indica el número del inversor, el segundo el número de entrada MPPT en el que será conectada (en caso de que tenga más de una), el tercer dígito indica el número de la cadena y el cuarto dígito el número del módulo dentro de la cadena.');
        imagen(A.nomenclatura, 95);
        etiqueta('fig', 'Fig 1.  Nomenclatura de Strings');
        if (I.bullets && I.bullets.length) { listaConImagen(A.inversorImg, I.bullets, 52); etiqueta('tab', 'Tabla 7. Características Equipo de Conversión de energía DC/AC'); }
        p('Estos equipos fueron distribuidos desde las salidas de los inversores al punto de conexión por medio de bandeja tipo escalera y cable AC los cuales se mencionan más adelante en cumplimiento a Reglamento Técnico de Instalaciones Eléctricas (RETIE) resolución No. 9 0708 de agosto del 2013 numeral 10.1 Diseño detallado.');

        // ===================== MEMORIA DE CÁLCULO ELÉCTRICA =====================
        titulo('4. Memoria de Cálculo Eléctrica', 2);
        p('Acorde con el numeral 10.1 del RETIE verifican los ítems aplicables al proyecto los cuales se describen a continuación');
        p('10.1.1 Diseño Detallado: El Diseño detallado debe ser ejecutado por profesionales de la ingeniería cuya especialidad esté relacionada con el tipo de obra a desarrollar y la competencia otorgada por su matrícula profesional, conforme a las Leyes 51 de 1986 y 842 de 2003. Las partes involucradas con el diseño deben atender y respetar los derechos de autor y propiedad intelectual de los diseños.');

        if (A.cuadro) asegurar(CW * 0.9 * A.cuadro.h / A.cuadro.w + 32);   // el título no queda solo al pie de la página
        titulo('A. Análisis y cuadro de cargas iniciales y futuras incluyendo análisis de factor de potencia y armónicos.', 3);
        if (A.cuadro) { imagen(A.cuadro, CW * 0.9); etiqueta('tab', 'Tabla 8. Cuadro de cargas'); }
        else { p('(Cuadro de cargas pendiente de anexar.)', { estilo: 'italic', color: GRIS }); etiqueta('tab', 'Tabla 8. Cuadro de cargas'); }
        p('Los datos relevantes para los paneles solares instalados en el sistema y el inversor se anexan en las fichas técnicas, adicional a esto cumplen con toda la normatividad internacional y nacional como lo son UL1741, IEC62804, IEC 61730, IEC61215, OHSAS 18001, ISO 9001 y ISO14001.');
        p('Para el análisis de armónicos se recurre al modelamiento del sistema implementado y en el cual se podrá cuantificar la magnitud de los armónicos que generará el sistema una vez que empiece a inyectar activos al sistema energéticos, este estudio se basará en la norma NTC 5001 en donde se establecen los valores de referencia para los armónicos de tensión y corriente.');
        p('Las cargas del proyecto fueron definidas en el momento de su dimensionamiento. El sistema fotovoltaico permite alimentar las cargas existentes. El factor de potencia del sistema es el cociente entre la potencia activa y potencia aparente a la salida del inversor. Los inversores deben generar energía a una determinada calidad, de tal forma que contenga una baja distorsión armónica y bajas interferencias electromagnéticas, por lo que se maneja un factor de potencia igual a 1.');
        titulo('Armónicos de Tensión', 3, true);
        p('Los armónicos de tensión son ondas senoidales cuyas frecuencias son múltiplos enteros de la frecuencia fundamental (60 Hz). La presente definición cubre armónicos de larga duración o estado estable, excluyendo fenómenos transitorios aislados.');
        p('Los armónicos son causados por dispositivos cuya característica tensión/corriente es no lineal, por ejemplo, convertidores electrónicos de potencia para variadores de velocidad de motores, rectificadores, hornos de arco, etc.');
        titulo('Metodología de evaluación', 3, true);
        p('Las medidas serán efectuadas en el PCC (Punto de Conexión Común).');
        p('En las condiciones normales de operación, se deben calcular los percentiles al 95 % de los valores de distorsión armónica individual de tensión (Dv) y distorsión armónica total de tensión (THDv), para cada fase. Los percentiles calculados para cada fase deben ser menor o igual a los valores de referencia.');
        p('La distorsión individual de tensión (Dv) y la distorsión armónica total de tensión (THDv), se calculan de la siguiente manera:');
        p('Distorsión Armónica Individual de Tensión:', { estilo: 'bold' });
        ecuacion('Dv = ( Vh / V1 ) x 100 %'); etiqueta('tab', 'Ecuación 1. Distorsión Armónica Individual de Tensión');
        p('Distorsión Armónica Total de Tensión:', { estilo: 'bold' });
        ecuacion('THDv = ( raíz( suma de Vh² , h = 2 … 40 ) / V1 ) x 100 %'); etiqueta('tab', 'Ecuación 2. Distorsión Armónica Total de Tensión');
        p('Donde: Vh = magnitud de la componente armónica individual (Voltios rms); h = orden del Armónico (A menos que aplique una condición específica, será como mínimo igual a 40); V1 = magnitud de la componente fundamental (Voltios rms).');
        p('Con base a la información anterior, se toma los valores de referencia del THDv permitidos por la NTC 5001');
        tabla({ cols: [50, 50, 50], size: 8.5, align: 'center', ancho: 120, head: ['Rango de Tensión', 'Distorsión armónica individual (%)', 'Distorsión armónica Total THDv (%)'],
            rows: [['1 kV < Vn < 69 kV', '3,0', '5,0'], ['69 kV < Vn < 161 kV', '1,5', '2,5'], ['Vn > 161 kV', '1,0', '1,5']] });
        etiqueta('tab', 'Tabla 9. Valores de referencia del THDv');
        titulo('Armónicos de corriente', 3, true);
        p('Las cargas no lineales conectadas al sistema de suministro eléctrico producen corrientes armónicas que se propagan al sistema de potencia y causan distorsiones armónicas de tensión que afectan a otros usuarios.');
        p('Los armónicos son causados por dispositivos cuya característica tensión/corriente es no lineal, por ejemplo, convertidores electrónicos de potencia para variadores de velocidad de motores, rectificadores, hornos de arco, etc.');
        p('La distorsión total de demanda, TDD, refleja la importancia de las distorsiones armónicas de corriente respecto a la carga máxima del sistema medido, ya que podrían presentarse altas distorsiones de corriente, es decir una medida de THDi elevada, con bajos niveles de carga, que no afectarían en igual proporción al sistema.');
        p('La distorsión armónica total en corriente se define de la siguiente forma:');
        ecuacion('THDi = ( raíz( suma de Ih² , h = 2 … 40 ) / I1 ) x 100 %'); etiqueta('tab', 'Ecuación 3. Distorsión Armónica en corriente');
        ecuacion('TDD = THDi x ( I1 / IL )'); etiqueta('tab', 'Ecuación 4. Distorsión total de demanda');
        p('Donde: Ih = magnitud de la componente armónica individual (Corriente rms); h = orden del Armónico (A menos que aplique una condición específica, será como mínimo igual a 40); I1 = magnitud de la componente fundamental (Corriente rms); IL = corriente de carga de demanda máxima en el PCC (componente de frecuencia fundamental, amperios rms).');
        p('Con la información mencionada anteriormente sobre los armónicos de corriente se procede a medir el sistema fotovoltaico con el fin de calcular la componente armónica en corriente en el punto de conexión común e identificar la magnitud de esta.');
        p('Para determinar si cumple el valor de referencia de distorsión armónica en corrientes, es necesario recurrir a la siguiente ecuación.');
        ecuacion('R = Isc / IL'); etiqueta('tab', 'Ecuación 5. Referencia de Distorsión Armónica');
        p('Donde: Isc = corriente de cortocircuito; IL = corriente de carga.');
        p(`Tomando la hoja de datos técnicos del inversor se observa la distorsión armónica producida bajo su operación (THD máxima menor o igual a 3 %).`);
        (A.datasheet || []).forEach(im => imagen(im, CW * 0.8));

        p('Los conductores en DC se dividirán en dos tramos:');
        p('Tramo 1: del arreglo fotovoltaico a la string box, denominado circuito fotovoltaico fuente.', { sangria: 5, despues: 1 });
        p('Tramo 2: del arreglo fotovoltaico a la string box al inversor, denominado circuito fotovoltaico de salida.', { sangria: 5 });
        p('En la figura 5 se muestra un esquema del tramo 1 (Circuitos de una fuente fotovoltaica) y tramo 2 (Circuito fotovoltaico de salida)');
        imagen(A.esquema, 110);
        etiqueta('fig', 'Fig.5.Esquema Eléctrico (tomado de la ANLA)');
        p('A continuación, se muestra el cálculo del calibre para el conductor de cada tramo.');
        p('Circuito fotovoltaico fuente.', { estilo: 'bold' });
        p('La ampacidad de los cables se calcula, de la siguiente manera:');
        p('La corriente máxima del circuito fotovoltaico (CFV) que se puede presentar en una instalación, corresponde al 125% de la corriente de cortocircuito, tal como lo indica la sección 690.8(A)(1) del NEC 2014. Este ajuste de corriente al 125% se debe a que los módulos fotovoltaicos, los circuitos de la fuente fotovoltaica y los circuitos de salida pueden generar corrientes mayores a la nominal con una duración de más de 3 horas cerca al medio día.');
        ecuacion(`Imax CFVF = 1,25 x Isc = 1,25 x ${P.isc} A = ${fmt(C.imaxCFV, 2)} A`);
        p('Para calcular la corriente que debe soportar el conductor, se procede multiplicar el valor obtenido en la ecuación anterior por un factor del 125% tal como se indica en la sección 690.8 (B)(1) del NEC 2014:');
        ecuacion(`I Conductor = 1,25 x Imax CFVF = ${fmt(C.iConductor, 2)} A`);
        p(`Para la base de cálculo se toma la temperatura promedio máxima absoluta registrada por el IDEAM para el municipio de ${D.municipio} en el segundo trimestre del año 2019, la cual es ${String(D.tempProm).replace('.', ',')}°C y después de realizar la corrección se tiene una temperatura de operación del conductor de ${tOp}°C (${D.tempMax || 33}+22).`);
        tabla({ cols: [60, 30], size: 8.5, align: 'center', ancho: 90, titulo: 'Temperatura de ajuste para canalizaciones expuestas en azoteas', head: ['Distancia', '(°C)'],
            rows: [['0 - 13 mm', '33'], ['13 - 90 mm', '22'], ['90 - 300 mm', '17'], ['300 - 900 mm', '14']] });
        p('De acuerdo con la temperatura del sitio y según la tabla 690.31(E) del NEC 2014 se debe corregir la ampacidad nominal del conductor seleccionado con el factor de derrateo por temperatura que corresponda.');
        tabla({ cols: [30, 30, 30, 30], size: 8.5, align: 'center', ancho: 120, titulo: 'Temperatura nominal del conductor', head: ['Temperatura ambiente (°C)', '60°C', '75°C', '90°C'],
            rows: [['21-25', '1,08', '1,05', '1,04'], ['26-30', '1,00', '1,00', '1,00'], ['31-35', '0,91', '0,94', '0,96'], ['36-40', '0,82', '0,88', '0,91'], ['41-45', '0,71', '0,82', '0,87'], ['46-50', '0,58', '0,75', '0,82'], ['51-55', '0,41', '0,67', '0,76']] });
        etiqueta('tab', 'Tabla 10. Tabla 690.31(E) NEC 2014. Factores de corrección de ampacidad por temperatura');
        p('Adicionalmente se debe tener en cuenta el factor de corrección de corriente por agrupamiento de acuerdo con la tabla 310.15(B)(3)(a) del NEC 2014 (en caso de instalación en ductos) o lo especificado en la sección 392 del NEC 2014 (en caso de instalación en bandeja portacable).');
        tabla({ cols: [60, 60], size: 8.5, align: 'center', ancho: 120, head: ['Número de conductores', 'Factor de corrección de corriente por agrupamiento al conductor seleccionado [%]'],
            rows: [['1-3', '100'], ['4–6', '80'], ['7–9', '70'], ['10–20', '50'], ['21–30', '45'], ['31–40', '40'], ['41 o más', '35']] });
        etiqueta('tab', 'Tabla 11. Tabla 310.15(B)(3)(a) NEC 2014 Factores de corrección de ampacidad por agrupamiento de más de tres cables portadores de corriente en ductos');
        const mm = (D.cablePV || 4);
        p(`Usando el valor obtenido en la corriente del conductor, los factores de derrateo por temperatura y agrupamiento y la ampacidad de conductores presentada en la tabla 310.15(B)(16) a 75°C se selecciona un conductor calibre ${mm}mm2 los cuales cumplen con esta capacidad de corriente y regulación de tensión. El tipo de cable que se usará para hacer las conexiones será ${C.cablePV.replace('CABLE PV ', 'CABLE PV ').replace('4mm2 ', mm + 'mm2 ').replace(/^CABLE PV \d+mm2/, 'CABLE PV ' + mm + 'mm2')} con nivel de aislamiento igual o superior a 600 ó 1000 VDC dependiendo del caso.`);
        p('Estas conexiones se harán a través de conectores MC4 los cuales son especiales para este fin.');
        p('En la figura 2, se ilustran los conectores.');
        imagen(A.mc4, 60);
        etiqueta('fig', 'Fig. 2 Conectores MC4.');
        p('De acuerdo con la sección 690.9(B) del NEC 2014 en la que se especifica la corriente nominal de los dispositivos de protección contra sobre corriente, se selecciona la corriente nominal de los fusibles los cuales no deben ser inferiores al 125% de la corriente calculada en la sección 690.8(A) del NEC 2014.');
        ecuacion(`I Fusibles = 1,25 x 1,25 x Isc x 1 = ${fmt(C.iConductor, 2)} A`);
        p(`De acuerdo con el valor obtenido en la ecuación anterior se selecciona un valor comercial de corriente de ${C.fusible} A para los fusibles y está integrado a ${plural ? 'los inversores' : 'los inversores'}.`);
        p(`Para el cableado DC de los módulos FV, se emplea cable fotovoltaico CU ${mm}mm2 Flex XLPE 1800VDC a 90°C, el cual cuenta con su certificado RETIE.`);
        p('Circuito de salida de los inversores', { estilo: 'bold' });
        p(`A la salida ${plural ? 'de los inversores' : 'del inversor'} ${I.modelo} será canalizados a través de Tubería ${conv.ac.tipo} ${conv.ac.dim}, ${conv.ac.cant + conv.ac.gndCant} conductores; dos (2) fases, un (1) Tierra y un (1) Neutro hasta el tablero de conexión a la red.`);
        p('La salida y entrada de cableado de los equipos debe realizarse por la parte inferior de los mismos empleando tubería flexible metálica con conectores curvos o rectos para evitar el ingreso de agua en su interior y estos a su vez deben de sellarse con poliuretano para evitar ingreso de cualquier material particulado a los equipos.');
        p('El calibre, la dimensión de la canalización y los cálculos por caída de tensión se presentan en el documento más adelante.');
        p('Con respecto a los conductores, para este caso se utilizan conductores tipo THHN, THHW -2, el cual es un conductor suave, cableado concéntrico clase B con aislamiento en Policloruro de Vinilo PVC, retardante a la llama, resistente al calor, la abrasión y la humedad, adicionalmente cuenta con una chaqueta en Nylon, resistente a la gasolina y aceites Tipo II. Este conductor cuenta con su certificado RETIE.');

        titulo('B. Coordinación de aislamiento eléctrico', 3);
        p(`En baja tensión, el nivel Básico de Aislamiento (BIL) se especifica para los equipos correspondientes al usuario y están normalizados en la norma NTC 4552-1 Tabla E.3. (Tensión al impulso que deben soportar los equipos), el punto de inyección y la salida AC Los inversores poseen un nivel de tensión de ${I.vNom}V.`);
        tabla({ cols: [34, 22, 36, 36, 22], size: 8, align: 'center', ancho: 150, head: ['Nivel de tensión de operación de los equipos V', 'Contadores Categoría IV', 'Tableros, interruptores, cables, etc. Categoría III', 'Electrodomésticos, herramientas portátiles Categoría II', 'Equipo electrónico Categoría I'],
            rows: [['120 – 240 / 120 / 208', '4', '2,5', '1,5', '0,8'], ['254 / 440 / 277 / 480', '6', '4', '2,5', '1,5']] });
        p('De la anterior tabla se especifica:');
        vineta('Tableros, interruptores y cables: Categoría III, BIL: 2.5kV (Clase C)');
        p(`El nivel de tensión asociado al proyecto es de ${I.vNom} V, por lo tanto, el nivel básico de aislamiento usado en todos los elementos del proyecto es mayor a 2.5 kV. (Ver fichas técnicas y certificados de conformidad de producto).`);
        titulo('C. Análisis de Cortocircuito y Falla a Tierra', 3);
        p('No aplica.', { estilo: 'bold', despues: 1 });
        p('A pesar de que el inversor no aporta un nivel de cortocircuito significativo al sistema, el análisis se hace desde las protecciones en AC, las cuales se seleccionan en función de los niveles de cortocircuito del punto de conexión existente.');
        titulo('D. Análisis de nivel de riesgo por rayos y medidas de protección contra rayos', 3);
        p('No aplica debido a que la instalación eléctrica ya ha sido construida y certificada, lo que indica que ha pasado por un proceso de evaluación y verificación previa para asegurar su cumplimiento con las normas y regulaciones vigentes para instalaciones colombianas. Esto implica que se han tenido en cuenta las medidas de protección necesarias, incluyendo aquellas relacionadas con el riesgo de rayos, por ende, el constructor o responsable de la instalación eléctrica tenía la obligación de cumplir con los requisitos de seguridad establecidos en el RETIE antes de su construcción y certificación.');
        titulo('E. Análisis de Riesgos de Origen Eléctrico y Medidas para Mitigarlos', 3);
        [A.riesgo1, A.riesgo2, A.riesgo3, A.riesgo4, A.riesgo5].forEach(im => imagen(im, CW));
        tabla({ cols: [34, 50, 73], size: 7.6, titulo: 'ANALISIS DE RIESGOS OPERACIONALES', head: ['TAREA', 'RIESGOS POTENCIALES', 'MEDIDAS DE CONTROL'], rows: RIESGOS_OPERACIONALES });

        titulo('F. Análisis del Nivel de Tensión', 3);
        p('En un sistema fotovoltaico el voltaje máximo en DC se calcula como la suma del voltaje a circuito abierto de los módulos en serie pertenecientes a la cadena más larga, ajustada a la menor temperatura ambiente registrada en el sitio.');
        p(`El número máximo de módulos en serie está formado por ${C.maxSeries} paneles, cada panel tiene un voltaje de circuito abierto a condiciones estándar de ${P.voc} VDC (Temperatura de la celda 25ºC, irradiancia 1000W/m2, AM=1,5). En la ecuación siguiente se realiza el ajuste por temperatura a la mínima registrada en la región donde será instalado el proyecto.`);
        ecuacion('Voc (T = min °C) = Voc stc x ( 1 + Coef. Temp. Voc x ( Tmin - 25 ) )');
        p(`Por tanto, el voltaje máximo del sistema será el valor obtenido multiplicado por la cantidad de módulos en serie. Para ${C.maxSeries} módulos en serie el valor de la tensión corregida a ${C.tmin} ºC es de ${fmt(C.vocCorregido, 1)} V, valor que ${C.vocCorregido <= I.vdcMax ? 'se encuentra dentro de los rangos de operación del inversor' : 'EXCEDE la tensión máxima del inversor, revisar la configuración de strings'}.`);
        p('Para este proyecto, el nivel de tensión en AC es suministrado por el operador de red de la zona. El sistema FV se acoplará al nivel de tensión de la instalación cumpliendo con sus valores nominales y así, poder inyectar los activos a todo el sistema eléctrico del usuario.');
        p(`El nivel de tensión del punto de conexión es de ${I.vNom} VAC. Con este nivel de tensión el sistema fotovoltaico se puede acoplar al sistema eléctrico de la instalación y así inyectar todos los activos.`);
        titulo('G. Cálculo de Campos Electromagnéticos', 3);
        p('No aplica. Las instalaciones del sistema eléctrico del cliente son en baja tensión, por lo que a 60 Hz se pueden producir campos electromagnéticos a un nivel imperceptible, lo cual no tiene efectos nocivos en seres vivos.');
        titulo('H. Cálculo del Transformador', 3);
        p('No aplica.', { estilo: 'bold', despues: 1 });
        p('El alcance de estas memorias no contempla dimensionamiento de transformadores.');
        titulo('I. Cálculo del Sistema de Puesta a Tierra', 3);
        p('Los conductores de puesta a tierra de protección para equipos se seleccionan de acuerdo con la tabla 250-95 de la NTC2050, o en su defecto del mismo calibre de los conductores portadores de corriente');
        imagen(A.calibres, CW);
        p('Para el caso de la puesta a tierra en las instalaciones, se utiliza cable de cobre desnudo No 10 AWG con el fin de equipotencializar las estructuras y los paneles en el exterior como lo expresa la norma NEC 2014 en sus numerales 250.118 y 250.15(2). Adicionalmente a esto, para evitar una tierra flotante debido a la instalación exterior, se toma como base la puesta a tierra existente en el lado AC de la instalación la cual está ubicada en el tablero que viene del gabinete principal para aterrizar el sistema FV con este.');
        p('Para la puesta a tierra del sistema AC y DC se toma en cuenta lo estipulado en el NEC 2014 sección 690.47. C.3, para lo cual solo se toma un conductor de puesta a tierra.');
        p('SISTEMAS DE PUESTA A TIERRA COMBINADOS', { estilo: 'bold', centrar: true });
        imagen(A.puestaTierra, 110);

        titulo('J. Cálculo Económico de Conductores', 3);
        tablasPerdidas();
        titulo('K. Verificación de Conductores Elegidos', 3);
        p('Se verificó la capacidad de corriente de los interruptores forma que garantice la protección de su respectiva acometida, dicha verificación se realizó con una comparación entre el calibre del conductor seleccionado para cada circuito y revisando su correspondencia conforme a lo establecido en la tabla 310-16 de la NTC 2050 que compara la capacidad de corriente permisible con el calibre necesario para dicha corriente.');
        p('Con lo anterior, se garantiza que las protecciones de sobrecorriente no realizaron disparos por calentamiento del conductor, de igual forma se indica la capacidad de los conductores para soportar la corriente de falla asociada teniendo en cuenta el tiempo de despeje de las protecciones en un tiempo estándar (220 ms) y de esta manera garantizar que la acometida no sufrirá daños.');
        titulo('L. Cálculo Mecánico de Estructura y Elementos de Sujeción de Equipos', 3);
        p(`La estructura que se utiliza para realizar la instalación es de la marca ${D.estructuraMarca || 'Alurack'}. La estructura consta de sujetadores de aluminio que descansan sobre cada cresta del techo donde se suspenderán los paneles.`);
        p('Los elementos de sujeción adecuados al sistema FV contienen un conductor de Grounding para la equipotencialización y conexión a tierra del marco de los módulos FV el cual se realiza con cable de cobre #10 AWG');
        imagen(A.estructura1, 110); etiqueta('fig', 'Fig.  3. Estructura de soporte de módulos fotovoltaicos – ensamble final.');
        imagen(A.estructura2, 110); etiqueta('fig', 'Fig. 4. Componentes del sistema Estructural');
        titulo('M. Cálculo de Coordinación de Protecciones contra Sobrecorrientes', 3);
        p('En baja tensión se permite la coordinación con las características de limitación de corriente de los dispositivos según IEC 60947-2 Anexo A.');
        p('Se conserva el principio que se tiene en la instalación antes de que la planta entre en funcionamiento. Todas las protecciones que allí se encuentran instaladas están definidas para una corriente de cortocircuito igual a 10kA, por lo que los dispositivos que se instalan tienen igual nivel de soportabilidad. Los equipos que se utilizan, a la hora de existir una falla, no son capaces de entregar una corriente mayor a la máxima definida por el fabricante, por lo que no afecta la coordinación de protecciones de la instalación.');
        p('En caso de existir una sobrecorriente, este sistema no sería capaz de aportar más de su corriente nominal, por lo que se puede omitir este ítem; además, los inversores cuentan con un esquema de protecciones que en caso de existir sobre o sub-tensiones o bien sobre o sub-frecuencias (características cuando se presenta una sobrecorriente por falla), desconecte y aísle el equipo del sistema. Esta información se encuentra más detallada en los certificados del equipo.');

        titulo('N. Cálculo de Canalizaciones', 3);
        C.ocupacion.forEach(o => {
            tabla({ cols: [22, 14, 14, 58, 14, 20, 14, 12], size: 7.4, align: 'center', titulo: `OCUPACION CANALIZACIONES${plural ? ' - INVERSOR ' + o.inversor : ''}`,
                head: ['Tipo de Canalización', 'Dimensión', 'Tipo Corriente', 'Tipo Cable', 'Cant. Conductores', 'Área cableado [mm²]', '% de Ocupación', 'Cumple'],
                rows: [
                    [`Tubería ${o.ac.tipo}`, `Ø ${o.ac.dim}`, 'AC', o.ac.cable, o.ac.cant, fmt(o.ac.area, 2), { t: o.ac.pct + '%', bold: true }, { t: o.ac.pct <= 40 ? 'SI' : 'NO', bold: true, fill: o.ac.pct <= 40 ? [198, 224, 180] : [240, 170, 170] }],
                    ['', '', 'GND', o.ac.gnd, o.ac.gndCant, fmt(o.ac.gndArea, 2), '', ''],
                    [`Tubería ${o.dc.tipo}`, `Ø ${o.dc.dim}`, 'DC', o.dc.cable, o.dc.cant, fmt(o.dc.area, 2), { t: o.dc.pct + '%', bold: true }, { t: o.dc.pct <= 40 ? 'SI' : 'NO', bold: true, fill: o.dc.pct <= 40 ? [198, 224, 180] : [240, 170, 170] }],
                    ['', '', 'GND', o.dc.gnd, o.dc.gndCant, fmt(o.dc.gndArea, 2), '', '']] });
        });
        titulo('O. Cálculo de Pérdidas de Energía', 3);
        tablasPerdidas();
        titulo('P. Cálculo de Regulación', 3);
        tabla({ cols: [26, 14, 14, 16, 14, 14, 14, 14, 54], size: 7.2, align: 'center', titulo: 'REGULACION DC',
            head: ['Referencia', 'String', 'Entrada Inversor', 'Longitud [m]', 'Módulos', 'Isc*1,25 [A]', 'Voc [V]', 'Regulación %', 'Calibre Cable [mm2]'],
            rows: C.regDC.map(r => [`${I.modelo}`, r.string, r.entrada, r.longitud, r.modulos, fmt(r.iscx, 1), fmt(r.voc, 1), fmt(r.reg, 2), r.calibre]) });
        tabla({ cols: [22, 12, 14, 13, 13, 12, 12, 30, 13, 8, 11, 13], size: 6.8, align: 'center', titulo: 'REGULACION AC',
            head: ['Referencia', 'Potencia AC [kW]', 'Conexión', 'Corriente Nominal (A)', 'Corriente Nominal *1,25 [A]', 'Protección AC', 'Conductores (F/N/T)', 'Conductor', 'Ampacidad a 75°C', 'FP', 'Longitud [m]', 'Caída de Tensión [V] / Regulación [%]'],
            rows: C.regAC.map(r => [r.modelo, r.potencia, r.conexion, r.corriente, fmt(r.corriente125, 2), r.proteccion, `F${r.fases} / N${r.neutro} / T${r.tierra}`, `${r.conductor}  (T: ${r.tierraCond})`, r.amp, r.fp, r.longitud, `${fmt(r.caida, 2)} V / ${fmt(r.reg, 2)} %`]) });
        titulo('Q. Clasificación de Áreas', 3);
        p('No aplica.', { estilo: 'bold', despues: 1 }); p('El cliente no cuenta con áreas clasificadas');
        titulo('R. Diagrama Unifilar', 3);
        p('El diagrama unifilar correspondiente al proyecto se encuentra en los planos correspondientes.');
        vineta(`Diagrama Unifilar_${titulo3}`);
        titulo('S. Planos y Esquemas Eléctricos para la Construcción', 3);
        p('El diseño eléctrico de este proyecto cuenta con el siguiente juego de planos donde aplica la norma vigente RETIE 2013 y NTC 2050 1ra actualización.');
        vineta(`Diagrama Unifilar_${titulo3}`);
        titulo('T. Especificaciones de Construcción Complementarias a los Planos, Incluyendo las de Tipo Técnico de Equipos, Materiales y sus Condiciones Particulares.', 3);
        p('Todos los elementos utilizados para la construcción del sistema eléctrico deben tener certificado de conformidad RETIE vigente.');
        p('Todas las acometidas en el proyecto, la principal desde la subestación eléctrica existente hasta el tablero agrupador general del proyecto y las parciales desde el tablero agrupador hasta el inversor y módulos fotovoltaicos son en cobre.');
        titulo('U. Distancias de Seguridad Requeridas', 3);
        p('La localización de los tableros eléctricos cumple con la normatividad de fácil acceso frontal y la distancia mínima de trabajo conforme RETIE');
        titulo('V. Justificación Técnica de Desviación de la NTC 2050 Cuando sea Permitido, Siempre y Cuando no Comprometa la Seguridad de las Personas o de la Instalación.', 3);
        p('No aplica.', { estilo: 'bold', despues: 1 }); p('El diseño de este proyecto no presenta desviación de la norma.');
        titulo('W. Los demás estudios que el tipo de instalación requiera para su correcta y segura operación, tales como condiciones sísmicas, acústicas, mecánicas o térmicas', 3);
        p('No aplica.', { estilo: 'bold', despues: 1 }); p('En este proyecto no se aplican estudios adicionales.');

        // ---------- helpers que usan el estado de arriba ----------
        function ecuacion(txt) {
            fuente(10.5, 'italic'); asegurar(9);
            doc.setFillColor(245, 247, 252); doc.rect(ML + 10, y, CW - 20, 7.5, 'F');
            doc.text(txt, ML + CW / 2, y + 5, { align: 'center' });
            y += 9.5;
        }
        function listaConImagen(im, bullets, anchoImg) {
            if (!im) anchoImg = 0;
            const textoW = CW - anchoImg - 6;
            fuente(9, 'normal');
            const items = (bullets || []).map((b, i) => doc.splitTextToSize(`${i + 1}. ${b}`, textoW));
            const altoTexto = items.reduce((a, l) => a + l.length * lh(9) + 1.6, 0);
            const altoImg = im ? anchoImg * im.h / im.w : 0;
            const alto = Math.max(altoTexto, altoImg) + 2;
            asegurar(alto);
            doc.setDrawColor(150); doc.setLineWidth(0.15); doc.rect(ML, y, CW, alto);
            if (im) doc.addImage(im.data, im.fmt, ML + 2, y + 1, anchoImg, altoImg);
            let ty = y + 1.5;
            items.forEach(lines => { lines.forEach(ln => { doc.text(ln, ML + (anchoImg ? anchoImg + 5 : 3), ty + lh(9) * 0.75); ty += lh(9); }); ty += 1.6; });
            y += alto + 1;
        }
        function tablasPerdidas() {
            C.perdAC.forEach(r => {
                tabla({ cols: [26, 14, 18, 14, 40, 16, 18, 20, 22], size: 7.2, align: 'center', titulo: 'INVERSOR - PUNTO DE CONEXIÓN', head: ['# INVERSOR', 'Longitud (m)', 'Corriente de carga (A)', 'Voltaje acometida', 'Calibre conductor', 'Impedancia (Ohm/Km)', 'Perdidas de potencia', 'Perdidas de energía (KWh/mes)', 'Valor perdidas energía mes (COP)'],
                    rows: [[r.modelo + (plural ? ` (${r.inversor})` : ''), r.longitud, r.corriente, r.voltaje, r.calibre, fmt(r.z, 3), fmt(r.perdidas, 2), fmt(r.kwh, 2), '$ ' + fmt(r.cop, 0)]] });
            });
            tabla({ cols: [20, 12, 12, 13, 14, 12, 40, 14, 13, 15, 17], size: 6.8, align: 'center', titulo: 'MODULOS FOTOVOLTAICOS - INVERSOR', head: ['# INVERSOR', 'String', 'Longitud (m)', 'Corriente de carga (A)', 'Número de módulos en serie', 'Tensión Vmpp', 'Calibre conductor', 'Resistividad (Ohm/Km)', 'Perdidas de potencia', 'Perdidas de energía (KWh/mes)', 'Valor perdidas energía mes (COP)'],
                rows: C.perdDC.map(r => [I.modelo, r.string, r.longitud, r.corriente, r.modulos, r.vmpp, r.calibre, fmt(r.r, 1), fmt(r.perdidas, 2), fmt(r.kwh, 2), '$ ' + fmt(r.cop, 0)]) });
        }

        return registro;
    }

    // Encabezado y pie en todas las páginas
    function marcos(doc, D, A) {
        const n = doc.getNumberOfPages();
        for (let i = 1; i <= n; i++) {
            doc.setPage(i);
            if (A.logo) doc.addImage(A.logo.data, A.logo.fmt, ML - 2, 9, 26, 14.5);
            doc.setTextColor(0);
            doc.setFont('times', 'normal'); doc.setFontSize(9);
            doc.text(`Sistema Solar Fotovoltaico Conectada a Red ${D.operadorRed}`, PW - MR, 14, { align: 'right' });
            doc.setFont('times', 'bold'); doc.setFontSize(9.5);
            doc.text(`SSFV ${D.nombre} ${kwp3(D.potDC)} kWp - ${D.potAC} kW`, PW - MR, 19, { align: 'right' });
            doc.text('Memorias de cálculo', PW - MR, 24, { align: 'right' });
            doc.setDrawColor(90); doc.setLineWidth(0.4); doc.line(ML - 2, 30, PW - MR + 2, 30);
            doc.line(ML - 2, PH - 18, PW - MR + 2, PH - 18);
            doc.setFont('times', 'bold'); doc.setFontSize(8.5);
            doc.text(`Página ${i} de ${n}`, PW - MR, PH - 13, { align: 'right' });
        }
    }

    async function cargarAssets(D, extra) {
        const L = (f, o) => cargarImagen(ASSETS + f, o);
        const A = {
            logo: await L('logo.jpg', { maxW: 500 }),
            firma: await L('firma.png', { png: true, maxW: 500 }),
            nomenclatura: await L('nomenclatura.jpg'), esquema: await L('esquema-fv.jpg'), mc4: await L('mc4.jpg', { maxW: 600 }),
            riesgo1: await L('riesgo-1.jpg'), riesgo2: await L('riesgo-2.jpg'), riesgo3: await L('riesgo-3.jpg'), riesgo4: await L('riesgo-4.jpg'), riesgo5: await L('riesgo-5.jpg'),
            calibres: await L('calibres.jpg'), puestaTierra: await L('puesta-tierra.jpg'), estructura1: await L('estructura-1.jpg'), estructura2: await L('estructura-2.jpg')
        };
        const fuentes = Object.assign({ panel: D.panel.img, inversorImg: D.inversor.img, cuadro: D.cuadroFuente }, extra || {});
        for (const k of Object.keys(fuentes)) A[k] = fuentes[k] ? await cargarImagen(fuentes[k], { maxW: k === 'cuadro' ? 1600 : 800 }) : null;
        A.datasheet = [];
        for (const f of (D.inversor.datasheet || [])) { const im = await cargarImagen(f, { maxW: 1100 }); if (im) A.datasheet.push(im); }
        return A;
    }

    async function generar(D, extraAssets) {
        const { jsPDF } = window.jspdf;
        const C = window.MemoriaCalc.calcular({ panel: D.panel, inversor: D.inversor, inversores: D.inversores, tmin: D.tmin, cablePV: D.cablePV });
        const A = await cargarAssets(D, extraAssets);
        let toc = [], doc;
        for (let pase = 0; pase < 3; pase++) {
            doc = new jsPDF({ unit: 'mm', format: 'letter' });
            const reg = construir(doc, D, C, A, toc);
            const igual = JSON.stringify(reg) === JSON.stringify(toc);
            toc = reg;
            if (igual) break;
        }
        marcos(doc, D, A);
        return { blob: doc.output('blob'), calc: C, paginas: doc.getNumberOfPages() };
    }

    window.MemoriaPDF = { generar, cargarImagen, palabras };
})();
