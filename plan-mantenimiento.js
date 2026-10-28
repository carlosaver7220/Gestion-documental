/* ============================================================
 * plan-mantenimiento.js — Plan de Mantenimiento (inciso 17) en PDF
 *
 * Es el mismo documento que se venía haciendo en Word: casi todo es texto fijo
 * (plan-mantenimiento-texto.js) y solo cambian el nombre del proyecto, el tipo
 * de acometida, la tensión, el tipo de usuario y los números de inversores y
 * paneles. Requiere jsPDF. Expone window.PlanMantenimiento.
 * ============================================================ */
(function () {
    'use strict';

    const PW = 215.9, PH = 279.4;
    const ML = 12.7, MR = 19.05, MT = 16, MB = 14;
    const CW = PW - ML - MR;
    const SIZE = 9;                 // 9 pt como el Word original (Arial -> Helvetica)
    const LH = SIZE * 0.3528 * 1.18;

    function generar(d) {
        const T = window.PLAN_MANTENIMIENTO_TEXTO;
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: 'letter' });
        let y = MT + 14;
        const resto = () => PH - MB - y;
        const nueva = () => { doc.addPage(); y = MT; };
        const asegurar = (h) => { if (resto() < h) nueva(); };
        const fuente = (estilo) => { doc.setFont('helvetica', estilo || 'normal'); doc.setFontSize(SIZE); doc.setTextColor(0, 0, 0); };

        // Divide un texto en líneas respetando un ancho distinto para la primera (por la numeración).
        function lineas(texto, ancho, anchoPrimera) {
            const pal = String(texto).split(/\s+/).filter(Boolean);
            const out = []; let cur = '', lim = anchoPrimera;
            pal.forEach(w => {
                const t = cur ? cur + ' ' + w : w;
                if (doc.getTextWidth(t) <= lim || !cur) cur = t;
                else { out.push(cur); cur = w; lim = ancho; }
            });
            if (cur) out.push(cur);
            return out;
        }
        function justificada(ln, x, yy, ancho, ultima) {
            if (ultima || ln.indexOf(' ') < 0) { doc.text(ln, x, yy); return; }
            const pal = ln.split(' ');
            const tot = pal.reduce((a, s) => a + doc.getTextWidth(s), 0);
            const esp = (ancho - tot) / (pal.length - 1);
            let cx = x; pal.forEach(s => { doc.text(s, cx, yy); cx += doc.getTextWidth(s) + esp; });
        }
        const borde = () => { doc.setDrawColor(0); doc.setLineWidth(0.25); };

        // Celda de texto (alto calculado). o: { w, t, align, bold, num }
        function medir(c) {
            fuente(c.bold ? 'bold' : 'normal');
            const pad = 1.6;
            let numW = 0;
            if (c.num) { fuente('bold'); numW = doc.getTextWidth(c.num + ' '); fuente(c.bold ? 'bold' : 'normal'); }
            const ls = lineas(c.t, c.w - pad * 2, c.w - pad * 2 - numW);
            return { ls, numW, h: Math.max(ls.length, 1) * LH + pad * 2 - 0.6 };
        }
        function pintarCelda(c, m, x, y0, h) {
            borde(); doc.rect(x, y0, c.w, h);
            const pad = 1.6;
            const vcent = c.vcenter !== false;
            const alto = m.ls.length * LH;
            let ty = y0 + (vcent ? (h - alto) / 2 : pad - 0.3) + LH * 0.78;
            m.ls.forEach((ln, i) => {
                const primera = i === 0;
                let tx = x + pad;
                if (primera && c.num) { fuente('bold'); doc.text(c.num, tx, ty); fuente(); tx += m.numW; }
                fuente(c.bold ? 'bold' : 'normal');
                const disp = c.w - pad * 2 - (primera ? m.numW : 0);
                if (c.align === 'center') doc.text(ln, x + c.w / 2, ty, { align: 'center' });
                else if (c.align === 'justify') justificada(ln, tx, ty, disp, i === m.ls.length - 1);
                else doc.text(ln, tx, ty);
                ty += LH;
            });
        }
        // Fila: arreglo de celdas con ancho propio
        function fila(celdas, o) {
            o = o || {};
            const ms = celdas.map(medir);
            const h = Math.max(...ms.map(m => m.h), 6.5);
            if (!o.sinSalto) asegurar(h);
            let x = ML;
            celdas.forEach((c, i) => { if (c.fill) { doc.setFillColor(...c.fill); doc.rect(x, y, c.w, h, 'F'); } pintarCelda(c, ms[i], x, y, h); x += c.w; });
            y += h;
            return h;
        }
        function titulo(txt) {
            fuente('bold');
            const ls = doc.splitTextToSize('•   ' + txt, CW - 4);
            asegurar(ls.length * LH + 50);               // el título no queda solo al pie de la página
            y += 3;
            ls.forEach(l => { doc.text(l, ML + 2, y + LH * 0.78); y += LH; });
            y += 1.5;
        }

        // ---------- Introducción ----------
        fuente();
        const intro = lineas(T.intro, CW, CW);
        intro.forEach((ln, i) => { justificada(ln, ML, y + LH * 0.78, CW, i === intro.length - 1); y += LH; });
        y += 3;
        titulo('Datos de la Instalación:');

        // ---------- Tabla INSTALACIÓN ----------
        const gris = [235, 235, 235];
        const w5 = [66, 12, 34, 30, 42.15];
        fila([{ w: CW, t: 'INSTALACIÓN', align: 'center', bold: true, fill: gris }], { sinSalto: true });
        fila([{ w: CW, t: `Nombre de Proyecto: ${d.nombre}`, align: 'center' }], { sinSalto: true });
        // "2Φ": la Φ se dibuja (la letra no incluye el símbolo)
        const yFila = y;
        fila([{ w: w5[0], t: 'Tipo de acometida', align: 'center' }, { w: w5[1], t: '', align: 'center' }, { w: w5[2] + w5[3] + w5[4], t: d.acometida, align: 'center' }], { sinSalto: true });
        const fx = ML + w5[0] + w5[1] / 2, fy = yFila + 3.25;
        fuente(); doc.text(String(d.fases), fx - 3.2, fy + 1.2);
        doc.setLineWidth(0.25); doc.circle(fx + 1.4, fy, 1.5); doc.line(fx + 1.4, fy - 2.3, fx + 1.4, fy + 2.3);
        fila([{ w: w5[0], t: 'Nivel de tensión del predio', align: 'center' }, { w: w5[1], t: '(V)', align: 'center' }, { w: w5[2], t: d.nivelTension, align: 'center' }, { w: w5[3], t: 'Selección', align: 'center' }, { w: w5[4], t: d.seleccion, align: 'center' }], { sinSalto: true });
        fila([{ w: w5[0], t: 'Tipo de usuario', align: 'center' }, { w: CW - w5[0], t: d.usuario, align: 'center' }], { sinSalto: true });
        fila([{ w: CW - w5[4], t: 'Número de Inversores Implementados en la Instalación', align: 'center' }, { w: w5[4], t: String(d.inversores), align: 'center' }], { sinSalto: true });
        fila([{ w: CW - w5[4], t: 'Número de Paneles Implementados en la Instalación', align: 'center' }, { w: w5[4], t: String(d.paneles), align: 'center' }], { sinSalto: true });
        y += 2;

        // ---------- Medidas de seguridad ----------
        titulo('Para el desarrollo del mantenimiento se lleva a cabo la toma de medidas de seguridad:');
        const S = T.seg, lw = 34, rw = CW - lw;
        fila([{ w: CW, t: 'MEDIDAS DE SEGURIDAD', align: 'center', bold: true, fill: gris }], { sinSalto: true });
        fila([{ w: lw, t: S[1][0], align: 'center' }, { w: rw, t: S[1][1], align: 'justify' }], { sinSalto: true });
        // "Medidas de Seguridad Personal": una celda de rótulo que abarca dos filas
        const personal = S[3].slice(1), pw = rw / personal.length;
        const m1 = medir({ w: rw, t: S[2][1], align: 'justify' });
        const mm = personal.map(t => medir({ w: pw, t, align: 'center' }));
        const h1 = Math.max(m1.h, 6.5), h2 = Math.max(...mm.map(m => m.h), 6.5);
        asegurar(h1 + h2);
        const ml = medir({ w: lw, t: S[2][0], align: 'center' });
        pintarCelda({ w: lw, t: S[2][0], align: 'center' }, ml, ML, y, h1 + h2);
        pintarCelda({ w: rw, t: S[2][1], align: 'justify' }, m1, ML + lw, y, h1);
        personal.forEach((t, i) => pintarCelda({ w: pw, t, align: 'center' }, mm[i], ML + lw + i * pw, y + h1, h2));
        y += h1 + h2;
        const inst = S[4].slice(1), iw = rw / inst.length;
        fila([{ w: lw, t: S[4][0], align: 'center' }].concat(inst.map(t => ({ w: iw, t, align: 'justify' }))), { sinSalto: false });
        y += 3;

        // ---------- Tablas de procedimientos ----------
        const fw = 24;
        function tablaProc(tituloTabla, items) {
            fila([{ w: CW, t: tituloTabla, align: 'center', bold: true, fill: gris }]);
            fila([{ w: CW - fw, t: 'Procedimiento', align: 'center', bold: true }, { w: fw, t: 'Frecuencia', align: 'center', bold: true }]);
            items.forEach((t, i) => fila([{ w: CW - fw, t, align: 'justify', num: (i + 1) + '.' }, { w: fw, t: d.frecuencia || '6 meses', align: 'center' }]));
            y += 3;
        }
        titulo(T.titulos[0]);
        tablaProc(T.tituloDC, T.dc);
        titulo(T.titulos[1]);
        tablaProc(T.tituloAC, T.ac);

        return doc.output('blob');
    }

    window.PlanMantenimiento = { generar };
})();
