/* ============================================================
 * unifilar.js — Diagrama unifilar por bloques (PDF + DXF)
 *
 * Un solo dibujo, escrito como primitivas (línea, rectángulo, círculo, texto...),
 * que sale en dos formatos:
 *   - PDF vectorial (jsPDF), hoja de 1000 x 707 mm
 *   - DXF (AutoCAD R2000), editable en AutoCAD / LibreCAD / QCAD
 *
 * El dibujo se arma con bloques que se repiten según el proyecto:
 *   RED (transformador, medida, CT)  ·  TABLERO AC SFV (un breaker por inversor)
 *   INVERSOR + STRINGS + CAJA DE PASO  (uno por inversor, apilados)
 * Las medidas internas están tomadas del unifilar de referencia (Pan de Vida) y al
 * final todo se escala para llenar la hoja.
 *
 * Expone window.Unifilar. Requiere jsPDF solo para generarPDF().
 * ============================================================ */
(function (root) {
    'use strict';

    const HOJA = { w: 1000, h: 707 };
    const NEGRO = [0, 0, 0], AZUL = [0, 0, 255], VERDE = [0, 170, 0], ROJO = [220, 0, 0], NARANJA = [217, 140, 50], GRIS = [90, 90, 90];
    const COLOR_STRING = [[0, 0, 220], [0, 150, 0], [210, 40, 40], [220, 120, 20], [140, 60, 190], [0, 150, 160]];

    // Código de color de AutoCAD (ACI) más cercano, para el DXF
    const ACI = (c) => {
        const t = [[[0, 0, 0], 7], [[255, 0, 0], 1], [[0, 0, 255], 5], [[0, 170, 0], 3], [[217, 140, 50], 30], [[0, 0, 100], 176], [[150, 150, 205], 171], [[90, 90, 90], 8], [[140, 60, 190], 6], [[0, 150, 160], 4]];
        let best = 7, d = 1e9;
        t.forEach(([rgb, n]) => { const dd = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2; if (dd < d) { d = dd; best = n; } });
        return best;
    };

    // ------------------------------------------------------------
    // Dibujo: lista de primitivas en mm (origen arriba a la izquierda, y hacia abajo)
    // ------------------------------------------------------------
    class Dib {
        constructor() { this.it = []; this.hoja = { w: HOJA.w, h: HOJA.h }; }
        line(x1, y1, x2, y2, o) { this.it.push({ t: 'l', x1, y1, x2, y2, o: o || {} }); return this; }
        poly(pts, o) { this.it.push({ t: 'p', pts, o: o || {} }); return this; }
        rect(x, y, w, h, o) { this.it.push({ t: 'r', x, y, w, h, o: o || {} }); return this; }
        circle(x, y, r, o) { this.it.push({ t: 'c', x, y, r, o: o || {} }); return this; }
        text(x, y, s, o) { this.it.push({ t: 't', x, y, s: String(s), o: o || {} }); return this; }
        img(x, y, w, h, data, fmt, nombre) { this.it.push({ t: 'i', x, y, w, h, data, fmt, nombre, o: {} }); return this; }
        // Bordes del contenido (sin el marco ni el título) para escalar
        bbox() {
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
            this.it.forEach(i => {
                if (i.o.marco) return;
                if (i.t === 'l') { add(i.x1, i.y1); add(i.x2, i.y2); }
                else if (i.t === 'p') i.pts.forEach(p => add(p[0], p[1]));
                else if (i.t === 'r' || i.t === 'i') { add(i.x, i.y); add(i.x + i.w, i.y + i.h); }
                else if (i.t === 'c') { add(i.x - i.r, i.y - i.r); add(i.x + i.r, i.y + i.r); }
                else if (i.t === 't') {
                    const sz = i.o.size || 3.7, w = i.s.length * sz * 0.6;
                    const ax = i.o.align === 'center' ? i.x - w / 2 : i.o.align === 'right' ? i.x - w : i.x;
                    if (i.o.rot) { add(i.x - sz, i.y - w); add(i.x + sz, i.y); } else { add(ax, i.y - sz); add(ax + w, i.y + sz * 0.25); }
                }
            });
            return { x0, y0, x1, y1 };
        }
    }

    // ------------------------------------------------------------
    // Símbolos
    // ------------------------------------------------------------
    const S = {
        // marcas de cantidad de conductores (rayitas oblicuas) sobre una línea; n rayitas, punto en la 2.ª si neutro
        marcas(d, x, y, n, vertical, neutro) {
            for (let k = 0; k < n; k++) {
                const o = k * 2.7;
                if (vertical) d.line(x - 3.2, y + o + 0.7, x + 3.2, y + o - 0.7);
                else d.line(x + o - 0.7, y + 3.2, x + o + 0.7, y - 3.2);
            }
            if (neutro && vertical && n >= 2) d.circle(x + 3.4, y + 2.7 + 0.3, 0.6, { fill: NEGRO });
        },
        // marcas de conductores como en el cuadro de convenciones: fases (rayas), neutro (raya con círculo), tierra (raya con barra)
        cond(d, x, y, vertical, o) {
            const n = [];
            for (let k = 0; k < (o.f || 0); k++) n.push('f');
            if (o.n) n.push('n');
            if (o.t) n.push('t');
            n.forEach((tipo, k) => {
                const p = k * 2.7;
                let a, b;
                if (vertical) { a = [x - 2.6, y + p + 1.4]; b = [x + 2.6, y + p - 1.4]; } else { a = [x + p - 1.4, y + 2.6]; b = [x + p + 1.4, y - 2.6]; }
                d.line(a[0], a[1], b[0], b[1], { w: 0.3 });
                if (tipo === 'n') d.circle(b[0] + (vertical ? 0.2 : 0.5), b[1] - (vertical ? 0.8 : 0.6), 0.7, { w: 0.25 });
                if (tipo === 't') d.line(b[0] - (vertical ? 0.6 : 1.4), b[1], b[0] + (vertical ? 2.8 : 1.4), b[1], { w: 0.3 });
            });
        },
        // dos cables de un string: raya roja con "+" y raya gris con "|"
        polar(d, x, y) {
            d.line(x - 1.5, y - 2.4, x + 1.5, y + 2.4, { color: ROJO, w: 0.3 });
            d.line(x - 2.4, y - 4.6, x - 0.6, y - 4.6, { color: ROJO, w: 0.25 }); d.line(x - 1.5, y - 5.5, x - 1.5, y - 3.7, { color: ROJO, w: 0.25 });
            d.line(x + 2.0, y - 2.4, x + 5.0, y + 2.4, { color: GRIS, w: 0.3 });
            d.line(x + 2.6, y - 5.4, x + 2.6, y - 3.6, { color: GRIS, w: 0.25 });
        },
        // interruptor termomagnético vertical: terminal superior en (x,y); ocupa 11 mm
        breaker(d, x, y) {
            d.line(x, y, x, y + 2.4);
            d.line(x - 0.8, y + 1.6, x + 0.8, y + 3.2); d.line(x - 0.8, y + 3.2, x + 0.8, y + 1.6);
            d.line(x, y + 11, x - 3.4, y + 4.6);
            d.line(x, y + 11, x, y + 11.01);
        },
        fusible(d, x, y, w, h) {
            d.rect(x, y, w, h, { w: 0.5 });
            d.rect(x + w * 0.18, y + h * 0.35, w * 0.64, h * 0.3, { w: 0.5 });
            d.line(x + w * 0.18, y + h * 0.5, x + w * 0.82, y + h * 0.5, { w: 0.5 });
        },
        cuadrado(d, x, y, s) { d.rect(x - s / 2, y - s / 2, s, s, { fill: NEGRO }); },
        tierra(d, x, y, o) {   // tres rayas decrecientes bajo el punto (x,y)
            const c = (o && o.color) || VERDE, w = (o && o.w) || 1.2;
            d.line(x - 4.6, y, x + 4.6, y, { color: c, w, layer: 'TIERRA' });
            d.line(x - 3.0, y + 2.4, x + 3.0, y + 2.4, { color: c, w, layer: 'TIERRA' });
            d.line(x - 1.4, y + 4.8, x + 1.4, y + 4.8, { color: c, w, layer: 'TIERRA' });
        },
        tierraCirculo(d, x, y) {
            d.circle(x, y, 1.9);
            d.line(x - 1.2, y - 0.4, x + 1.2, y - 0.4, { w: 0.35 }); d.line(x - 0.8, y + 0.5, x + 0.8, y + 0.5, { w: 0.35 }); d.line(x - 0.4, y + 1.3, x + 0.4, y + 1.3, { w: 0.35 });
        },
        flecha(d, x, y) {      // triángulo apuntando hacia arriba (marca de conducto)
            d.poly([[x - 2.6, y + 4.2], [x + 2.6, y + 4.2], [x, y]], { closed: true, w: 0.2, fill: [150, 150, 205], color: [150, 150, 205] });
        }
    };

    // "Tubería metálica IMC de 1"" / "Tubería PVC empotrada de 1""
    function txtTubo(tipo, dim) {
        return /pvc/i.test(tipo) ? `Tubería ${/empotr/i.test(tipo) ? 'PVC empotrada' : 'PVC'} de ${dim}` : `Tubería metálica ${tipo} de ${dim}`;
    }

    function lineas(d, x, y, arr, o) {
        o = o || {}; const gap = o.gap || (o.size || 3.7) * 1.17;
        arr.forEach((t, i) => d.text(x, y + i * gap, t, Object.assign({ size: 3.7 }, o)));
    }

    // ------------------------------------------------------------
    // Construcción del dibujo
    // D = { nombre, potDC, potAC, operador, nic, trafo:{tensionPrim,kva,fases,tensionSec,codigo,matricula},
    //       panel, inversor, inversores:[{strings:[{mppt,paralelos,series,longitud}], longitudAC}],
    //       calc (MemoriaCalc.calcular), canal:{dcTipo,dcDim,acTipo,acDim,acBandeja,dcBandeja},
    //       dist:{cajaInversor,invTablero,rs485,tableroGeneral}, acometida:{awg}, vSistema }
    // ------------------------------------------------------------
    function construir(D) {
        const d = new Dib();
        const P = D.panel, I = D.inversor, N = D.inversores.length, C = D.calc;
        const dist = Object.assign({ cajaInversor: 1.7, invTablero: 1.5, rs485: 1.5, tableroGeneral: 11 }, D.dist || {});
        const canal = Object.assign({ dcTipo: 'IMC', dcDim: '1"', acTipo: 'EMT', acDim: '1"' }, D.canal || {});
        const awgAc = (C.regAC[0].conductor.match(/^(\d+)/) || [0, 8])[1];
        const awgTierraAc = (C.regAC[0].tierraCond.match(/^(\d+)/) || [0, 10])[1];
        const awgAco = (D.acometida && D.acometida.awg) || 8;
        const tf = D.trafo || {};
        const vac = D.vSistema || I.vNom;
        const nF = I.fases || 2;
        const acCanal = canal.acBandeja ? 'Bandeja portacable' : `${canal.acTipo} ${canal.acDim}`;
        const dcCanal = canal.dcBandeja ? 'Bandeja portacable' : `${canal.dcTipo} ${canal.dcDim}`;

        // Alto de cada bloque de inversor (según sus strings)
        const SP = 59.8;                                    // separación entre strings
        const bloque = D.inversores.map(inv => Math.max(168, inv.strings.reduce((a, s) => a + s.paralelos, 0) * SP + 48));
        const bY = []; bloque.reduce((a, h, i) => { bY[i] = a; return a + h; }, 0);
        const dB = 12 * (N - 1);                            // el tablero AC crece con cada inversor
        const dx = 36 * (N - 1);                            // y se corre a la derecha

        // ===================== RED (arriba a la derecha) =====================
        const xR = 642.8 + dx;
        d.text(xR, 21.2, `RED ELECTRICA ${D.operador || 'AFINIA'}`, { size: 4.6, align: 'center' });
        d.text(xR, 26.6, `${tf.tensionPrim || '13.2kV'} EXISTENTE`, { size: 4.6, align: 'center' });
        d.poly([[xR - 6.6, 29.7], [xR + 6.7, 29.7], [xR + 0.1, 40]], { closed: true, fill: NEGRO });
        d.text(xR + 12.2, 37.3, `CUENTA: ${D.nic || ''}`, { size: 4.2 });
        d.line(xR, 39.1, xR, 53.3);
        d.circle(xR + 0.2, 62.2, 8.8); d.circle(xR + 0.2, 73.6, 8.8);
        d.text(xR + 12.8, 61.1, 'TRANSFORMADOR', { size: 5.1, under: true, bold: true });
        lineas(d, xR + 12.8, 67.2, [`TRAFO ${tf.kva || ''} KVA EXISTENTE`, `${tf.fases || 2} FASES - ${tf.tensionSec || '120/240V'}`, `CODIGO: ${tf.codigo || ''}`, `MATRICULA: ${tf.matricula || ''}`], { size: 4.2, gap: 4.7 });
        // puesta a tierra del poste
        d.rect(xR - 77.4, 62.5, 5, 5); d.line(xR - 77.4, 62.5, xR - 72.4, 67.5); d.line(xR - 72.4, 62.5, xR - 77.4, 67.5);
        d.line(xR - 72.4, 65, xR - 63.6, 65, { color: VERDE, layer: 'TIERRA', dash: true });
        d.line(xR - 74.9, 67.5, xR - 74.9, 72, { color: VERDE, layer: 'TIERRA' });
        d.line(xR - 76.2, 77.9, xR - 68.3, 77.9, { w: 0.75 }); d.line(xR - 75.2, 79.4, xR - 69.1, 79.4, { w: 0.75 }); d.line(xR - 74.9, 72, xR - 74.9, 77.9, { color: VERDE, layer: 'TIERRA' });
        d.text(xR - 65.5, 75.1, 'PUESTA A TIERRA', { size: 3.7 }); d.text(xR - 65.5, 79.5, 'POSTE', { size: 3.7 });
        // acometida -> medidor -> CT
        d.line(xR, 81.1, xR, 162.1);
        S.marcas(d, xR - 2.8, 132.4, 3, false); d.circle(xR + 0.3, 134, 0.6, { fill: NEGRO });
        lineas(d, xR + 8.6, 135.2, [`2xNo.${awgAco} AWG Cu.THHN/THWN-2 (F)`, `1xNo.${awgAco} AWG Cu.THHN/THWN-2 (N)`, `1xNo.${awgAco} AWG Cu.THHN/THWN-2 (T)`], { size: 3.7, gap: 4.35 });
        d.rect(xR - 11.4, 162.1, 22.7, 24.4, { w: 0.75 });
        d.line(xR - 6.8, 165.2, xR + 7.3, 165.2, { w: 0.5 }); d.line(xR + 11.2, 167.5, xR - 11.4, 167.5, { w: 0.5 });
        d.text(xR - 5.2, 176.5, 'kVAh', { size: 4.2 }); d.text(xR - 10.3, 181.6, 'kWh-VArh', { size: 4.2 });
        d.line(xR, 186.4, xR, 305.5);
        // nota del medidor
        d.rect(xR - 105.5, 155.1, 82.4, 42.7, { w: 0.6, color: NARANJA });
        lineas(d, xR - 104.2, 162.5, ['EQUIPO DE MEDIDA DIRECTA', 'SE REEMPLAZA POR MEDIDOR', 'BIDIRECCIONAL CALIBRADO Y', 'HOMOLOGADO POR OPERADOR DE', 'RED Y COMERCIALIZADOR DE', 'ENERGIA'], { size: 4.9, gap: 6.7 });
        S.marcas(d, xR - 3.7, 230.3, 3, false); d.circle(xR - 0.4, 232, 0.6, { fill: NEGRO });
        lineas(d, xR + 7.1, 232.2, [`2xNo.${awgAco} AWG Cu.THHN/THWN-2 (F)`, `1xNo.${awgAco} AWG Cu.THHN/THWN-2 (N)`, `1xNo.${awgAco} AWG Cu.THHN/THWN-2 (T)`], { size: 3.7, gap: 4.35 });
        d.circle(xR, 262.2, 6, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        lineas(d, xR + 8.6, 259.8, ['2XCT', '250A', '50mA'], { size: 3.7, gap: 4.3 });
        // línea de la red hacia el tablero general existente
        const xG = 811.6 + dx;
        d.line(xR, 305.5, xG + 20.6, 305.5);
        d.line(xG + 20.6, 305.5, xG + 20.6, 316.5);

        // ===================== TABLERO GENERAL EXISTENTE =====================
        d.rect(xG, 316.5, 40.4, 40.4, { w: 1.5 });
        d.poly([[xG, 316.5], [xG + 40.4, 316.5], [xG + 40.4, 356.9]], { closed: true, fill: GRIS });
        d.text(xG + 20, 362.3, 'TABLERO GENERAL', { size: 3.3, align: 'center' }); d.text(xG + 20, 366.1, 'EXISTENTE', { size: 3.3, align: 'center' });

        // ===================== TABLERO AC SFV =====================
        const xTab0 = 511.9, xTab1 = 731.2 + dx;
        const yBus = 387.2 + dB;
        d.rect(xTab0, 322.2, xTab1 - xTab0, 142.4 + dB, { color: ROJO, w: 0.5, dash: true, layer: 'TABLERO' });
        d.text(514.5, 329, 'TABLERO AC SFV', { size: 4.2 }); d.text(514.5, 333.7, `BARRAJE ${nF}F`, { size: 4.2 });
        d.text(xTab1 - 31, 330.1, `TPSFV - ${vac}V`, { size: 3.7 });
        const xBusEnd = 697.6 + dx;
        d.line(518.1, yBus, xBusEnd, yBus, { w: 0.95 });
        d.text(518.5, yBus + 4.8, `BARRAJE 160A - ${vac}V`, { size: 2.8 }); d.text(518.5, yBus + 8.1, `${nF}F - 4H`, { size: 2.8 });

        // un breaker por inversor
        for (let i = 0; i < N; i++) {
            const yt = 348 + 12 * i, xt = 492.3 + 8 * i, xb = 523.5 + 40 * (N - 1 - i);
            const yo = 421.6 + bY[i];                       // salida AC del inversor i
            d.line(402.8, yo, xt, yo);
            if (i === 0) { S.marcas(d, 459.1 + 0, yo - 3.1, 3, false); }
            else S.marcas(d, 459.1, yo - 3.1, 3, false);
            d.line(xt, yo, xt, yt); d.line(xt, yt, xb, yt); d.line(xb, yt, xb, yt + 0.01);
            const yb = yt + 2.4;
            S.breaker(d, xb, yt + 3);   // símbolo bajo el codo
            d.line(xb, yt, xb, yt + 3);
            d.line(xb, yt + 14, xb, yBus);
            lineas(d, xb + 2.7, yt + 17, ['Interruptor', 'termomagnético', `${nF}X${C.regAC[0].proteccion}A - 10kA`], { size: 3.3, gap: 3.8 });
        }
        // medidor inteligente (Smart Meter) + CT, comunicación RS485 al inversor
        const xs = 571.8 + dx;
        d.line(xs, yBus, xs, yBus - 11.5);
        S.breaker(d, xs, yBus - 22.5);
        d.line(xs, yBus - 22.5, xs, 357.8 + dB);
        d.rect(566.8 + dx, 325.6 + dB * 0, 47.2, 32.2 + dB, { color: ROJO, w: 0.5, dash: true, layer: 'TABLERO' });
        d.rect(572 + dx, 333.5 + dB * 0, 36, 15, { w: 0.6 }); d.text(590 + dx, 342, 'SMART METER', { size: 3.3, align: 'center' });
        lineas(d, xs + 7.7, yBus - 24.4, ['Interruptor', 'termomagnético', `${nF}X16A - 10kA`], { size: 3.3, gap: 3.8 });
        S.marcas(d, xs - 3.4, yBus - 13.5, 3, false); d.circle(xs + 0.3, yBus - 11.5, 0.6, { fill: NEGRO });
        d.text(xs + 4.7, yBus - 11, `2xNo. 12 AWG Cu.THHN/THWN-2 (F)`, { size: 3.3 }); d.text(xs + 4.7, yBus - 7.2, `1xNo. 12 AWG Cu.THHN/THWN-2 (N)`, { size: 3.3 });
        // RS485 (azul) del medidor al inversor 1
        const xInvTop = 389.3;
        d.line(569.1 + dx, 333.5, 569.1 + dx, 262.2, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        d.line(569.1 + dx, 262.2, xInvTop, 262.2, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        d.line(xInvTop, 262.2, xInvTop, 347.8, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        S.marcas(d, 482.2, 262.2 - 3.1, 2, false);
        lineas(d, 394.1, 268.4, ['2xNo.18 AWG', 'Cable RS485 (+)(-)', `Conducto: EMT 3/4"`, `Distancia: ${dist.rs485}m`], { size: 3.7, gap: 4.3 });
        // CT -> medidor (azul)
        d.line(xR - 6, 262.2, 611.3 + dx, 262.2, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        d.line(611.3 + dx, 262.2, 611.3 + dx, 340, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        d.line(611.3 + dx, 340, 608 + dx, 340, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        S.marcas(d, 608.1 + dx, 296.4, 2, false); d.text(616.1 + dx, 300.5, '4xNo.18 AWG', { size: 3.3 });

        // ramal al tablero general (TPSFV)
        const xt2 = 687.4 + dx;
        d.line(xt2, yBus, xt2, yBus - 25.7 + 0);
        S.breaker(d, xt2, yBus - 31.7);
        d.line(xt2, yBus - 31.7, xt2, 320); d.line(xt2, 320, xG, 320);
        lineas(d, xt2 + 9.4, yBus - 29.7, ['Interruptor', 'termomagnético', `${nF}X50A - 10kA`], { size: 3.3, gap: 3.8 });
        S.marcas(d, 758.7 + dx, 316.6, 3, false);
        lineas(d, 736.7 + dx, 329.2, [`2xNo.${awgAc} AWG Cu.THHN/THWN-2 (F)`, `1xNo.${awgTierraAc} AWG Cu.THHN/THWN-2 (N)`, `1xNo.${awgTierraAc} AWG Cu.THHN/THWN-2 (T)`, `Conducto: ${acCanal}`, `Distancia: ${dist.tableroGeneral} m`], { size: 3.3, gap: 3.85 });

        // DPS
        const xd = 652.6 + dx;
        d.line(xd, yBus, xd, yBus + 24.8 + 0);
        S.marcas(d, xd - 3.2, yBus + 7, 3, false);
        d.line(xd, yBus + 24.8, xd, yBus + 30);
        S.breaker(d, xd, yBus + 24.5 - 0);
        d.line(xd, yBus + 35.5, xd, yBus + 38.3);
        d.rect(xd - 2.6, yBus + 38.1, 5.2, 10.5, { w: 0.6 }); d.line(xd - 1.6, yBus + 47, xd + 1.6, yBus + 40);
        d.line(xd, yBus + 48.6, xd, 458.7 + dB);
        d.text(xd + 5, yBus + 11.5, '2XNo.10 AWG (F)', { size: 3.3 });
        lineas(d, xd + 5.2, yBus + 27.3, ['Interruptor', 'termomagnético', `${nF}X20A - 10kA`], { size: 3.3, gap: 3.8 });
        lineas(d, xd - 28.4, yBus + 43.2, ['DPS Clase 2', '  175V-20kA', 'IEC 61643-11'], { size: 3.3, gap: 3.8 });
        // barraje PE y electrodo
        const yPE = 458.7 + dB;
        d.line(xd - 17.7, yPE, xd + 17.4, yPE, { w: 0.95 });
        d.text(xd - 66.4, yPE - 2.8, 'BARRAJE PE PARA #8 AWG', { size: 3.3 });
        d.line(xd - 66.4, yPE - 1.2, xd - 24, yPE - 1.2, { color: [56, 80, 158], w: 0.5 });
        d.text(xd + 9.3, yPE - 9.6, '1XNo.10 AWG (T)', { size: 3.3 });
        d.line(xd, yPE, xd, yPE + 24.8, { color: VERDE, layer: 'TIERRA', dash: true });
        d.line(xd - 2.3, yPE + 17.5, xd + 2.3, yPE + 17.5);
        S.tierra(d, xd, yPE + 24.8, { w: 2.25 });
        d.text(xd + 12.7, yPE + 17, '1XNo.8 AWG (T)', { size: 3.7 });
        d.text(xd + 14.2, yPE + 27.2, 'ELECTRODO DE PUESTA A TIERRA,', { size: 3.7 }); d.text(xd + 14.2, yPE + 31.6, 'VARILLA COPPERWELD 3/8 - 2.4m', { size: 3.7 });
        // tierra del tablero general existente
        d.line(xG + 20, 356.9, xG + 20, yPE + 6, { color: VERDE, layer: 'TIERRA', dash: true });
        d.line(xG + 20, yPE + 6, xd + 17.4, yPE + 6, { color: VERDE, layer: 'TIERRA', dash: true });
        d.line(xd + 17.4, yPE + 6, xd + 17.4, yPE, { color: VERDE, layer: 'TIERRA', dash: true });

        // ===================== INVERSORES + STRINGS =====================
        const unaCaja = [];
        D.inversores.forEach((inv, i) => {
            const dy = bY[i];
            // lista plana de strings (en paralelo dentro de cada MPPT)
            const rows = [];
            inv.strings.forEach(s => { for (let k = 0; k < s.paralelos; k++) rows.push({ mppt: s.mppt, series: s.series, largo: s.longitud }); });
            const y0 = 360.8 + dy;
            rows.forEach((r, k) => { r.y = y0 + SP * k; });
            const yFirst = rows[0].y, yLast = rows[rows.length - 1].y;
            const nStr = rows.length;
            const imax = P.imp;

            rows.forEach((r, k) => {
                const col = COLOR_STRING[k % COLOR_STRING.length], y = r.y;
                d.text(31.8, y - 8, `STRING ${k + 1} - ${r.series} MODULOS ${P.pmax}Wp`, { size: 4.2, color: col });
                // símbolo del string
                d.rect(31.9, y - 6.8, 30.8, 14.5, { w: 0.75 });
                d.line(62.7, y - 6.8, 54.1, y + 0.4, { w: 0.75 }); d.line(54.1, y + 0.4, 62.7, y + 7.7, { w: 0.75 });
                lineas(d, 31.8, y + 14.2, [`I${i + 1}M${r.mppt}S${k + 1}`, 'STC: 1000W/m2 25°C, AM1.5', `Voc: ${(r.series * P.voc).toFixed(1)}V`, `Isc: ${P.isc}A`, `Vmp: ${(r.series * P.vmpp).toFixed(1)}V`, `Imp: ${P.imp}A`], { size: 4.2, gap: 4.7 });
                // cable hacia la caja de paso
                d.line(62.7, y, 170.9, y);
                lineas(d, 113.6, y + 6.7, ['2xNo.4mm²PV (+)(-)', `Imax: ${imax}A`, `Distancia: ${r.largo}m`], { size: 3.7, gap: 4.3 });
                // fusibles dentro de la caja
                S.cuadrado(d, 170.9, y, 3); S.cuadrado(d, 206.5, y, 3);
                d.rect(176.6, y - 7.9, 21.4, 16.6, { w: 0.4 }); S.fusible(d, 180, y - 3.2, 14.6, 6.4);
                d.text(175.9, y + 12.6, '2XFUSIBLE 20A', { size: 3.3 });
                // cable de la caja al inversor
                d.line(206.5, y, 312.5, y);
                lineas(d, 247.7, y + 6.7, ['2xNo.4mm²PV (+)(-)', `Imax: ${imax}A`, `Conducto: ${dcCanal}`, `Distancia: ${dist.cajaInversor}m`], { size: 3.7, gap: 4.3 });
                S.cuadrado(d, 312.5, y, 3);
            });
            // conductos (rectángulos largos) y rótulos
            [[102.4, 87.5], [221.5, 206.6]].forEach(([xr, xl]) => {
                d.rect(xr, yFirst - 3.5, 4.4, yLast - yFirst + 33.9, { w: 0.6 });
                S.flecha(d, xr + 2.2, yLast + 31.2);
                d.text(xl, yLast + 39.2, `Conducto: ${dcCanal}`, { size: 3.7 });
            });
            // caja de paso
            const cTop = yFirst - 22.2, cBot = yLast + 27.7;
            d.rect(170.9, cTop, 35.6, cBot - cTop, { w: 0.9 });
            d.text(157.9, cTop - 9.5, 'CAJA DE PASO FV-INVERSOR', { size: 4.2 });
            d.text(161, cTop - 4.8, `${nStr * 2} FUSIBLES 20A-1000VDC`, { size: 4.2 });
            S.cuadrado(d, 170.9, cTop + 4.5, 3);
            d.circle(174.5, yLast + 21, 1.2, { fill: NEGRO }); S.tierraCirculo(d, 177.4, yLast + 21);
            // inversor
            const bTop = yFirst - 13, bBot = yLast + 76.6;
            d.rect(312.5, bTop, 109.9, bBot - bTop, { w: 0.9 });
            d.text(312.2, bTop - 1.7, N > 1 ? `INVERSOR ${i + 1}` : 'INVERSOR', { size: 4.2 });
            // barra de bornes azul
            d.rect(309.8, yFirst - 3.5, 5.5, yLast - yFirst + 7, { color: AZUL, w: 0.6, layer: 'COMUNICACION' });
            rows.forEach(r => S.cuadrado(d, 312.5, r.y, 3));
            // MPPT
            const mpptY = {}; rows.forEach(r => { if (mpptY[r.mppt] === undefined) mpptY[r.mppt] = r.y; });
            Object.keys(mpptY).forEach(m => {
                const y = mpptY[m];
                d.rect(328.8, y - 7.6, 7.5, 16, { w: 0.6 });
                d.text(334, y + 6.8, `MPPT ${m}`, { size: 3.7, rot: 90 });
                d.line(312.5, y, 328.8, y); d.line(336.3, y, 344, y);
            });
            const ms = Object.keys(mpptY).map(Number);
            const yMppt2 = mpptY[ms[ms.length - 1]];
            d.line(344, mpptY[ms[0]], 344, yMppt2 + 33.4);
            d.line(344, yMppt2, 349.6, yMppt2); d.line(349.6, yMppt2 + 0.6, 355.5, yMppt2 - 3.9); d.line(355.5, yMppt2 - 3.9, 355.5, yMppt2 - 3.9);
            d.line(356.2, yMppt2 + 0.8, 365.3, yMppt2 + 0.8);
            d.text(346.1, yMppt2 + 6.7, 'Seccionador', { size: 2.4 }); d.text(346.1, yMppt2 + 9.6, 'integrado', { size: 2.4 });
            d.line(344, yMppt2 + 33.4, 353.3, yMppt2 + 33.4); d.rect(350.5, yMppt2 + 33.4, 4.6, 6, { w: 0.5 });
            // símbolo del inversor (rectángulo con diagonal)
            d.rect(365.3, yMppt2 - 22.5, 37.3, 45.2, { w: 0.9 });
            d.line(365.3, yMppt2 + 22.7, 402.6, yMppt2 - 22.5, { w: 0.9 });
            d.text(389, yMppt2 - 14, '~', { size: 5.5, align: 'center' }); d.text(375, yMppt2 + 17, '=', { size: 5.5, align: 'center' });
            // datos del inversor
            lineas(d, 361.3, bTop + 7.4, [`REF: ${I.modelo}`, `Potencia Max: ${I.pAC}W`, `Conexión: ${nF}L+PE`, `Vac:${vac}V`, `Imax: ${I.iSalida}A`], { size: 4.2, gap: 4.7 });
            // salida AC
            const a = C.regAC[i] || C.regAC[0];
            lineas(d, 435.2, yMppt2 + 8.6, [`${nF}xNo.${awgAc} AWG Cu.THHN/THWN-2 (F)`, `1xNo.${awgTierraAc} AWG Cu.THHN/THWN-2 (T)`, `Imax: ${I.iSalida} A`, `Vac: ${vac}V`, `Conducto: ${acCanal}`, `Distancia: ${dist.invTablero} m`], { size: 3.3, gap: 3.85 });
            // tierra del inversor y del bloque (línea verde de puesta a tierra)
            d.circle(326, yLast + 56, 1.2, { fill: NEGRO }); S.tierraCirculo(d, 326, yLast + 59.6);
            const yG = yLast + 61.2;
            const xV = 616 + 7 * i;
            d.line(170.9, cTop + 4.5, 27.5, cTop + 4.5, { color: VERDE, layer: 'TIERRA', dash: true });
            d.line(27.5, cTop + 4.5, 27.5, yG, { color: VERDE, layer: 'TIERRA', dash: true });
            d.line(27.5, yG, xV + dx * 0, yG, { color: VERDE, layer: 'TIERRA', dash: true });
            d.line(xV, yG, xV, yPE, { color: VERDE, layer: 'TIERRA', dash: true });
            if (xV + dx > xd - 17.7) { /* el barraje PE cubre hasta aquí */ }
            d.text(126.4, yG + 0.8, '1XNo.10 AWG (T)', { size: 3.7 }); d.text(514, yG + 0.8, '1XNo.10 AWG (T)', { size: 3.7 });
            d.line(121.8, cTop + 5.2, 123.2, cTop + 1.1, { w: 0.5 }); d.text(121.8, cTop + 10.6, '1XNo.10 AWG (T)', { size: 3.7 });
            d.line(521.5, yG - 4, 522.9, yG + 0.5, { w: 0.5 });
            d.line(326, yLast + 61.2 - 1.6, 326, yLast + 61.2, { color: VERDE, layer: 'TIERRA' });
            unaCaja.push(yG);
        });
        // el barraje PE llega hasta donde suben las tierras de los inversores
        d.line(616 - 2, yPE, xd - 17.7, yPE, { w: 0.95 });
        return d;
    }

    // ------------------------------------------------------------
    // Marco y título de la hoja (no se escalan)
    // ------------------------------------------------------------
    function marco(d, titulo) {
        const m = { marco: true };
        d.rect(12.4, 3.2, 977.2, 700.6, { w: 1.0, marco: true, layer: 'MARCO' });
        d.rect(19.3, 9.7, 963.6, 687.6, { w: 0.8, marco: true, layer: 'MARCO' });
        for (let k = 1; k < 18; k++) {
            const y = 9.7 + k * (687.6 / 18);
            d.line(12.4, y, 19.3, y, { w: 0.5, marco: true, layer: 'MARCO' }); d.line(982.9, y, 989.6, y, { w: 0.5, marco: true, layer: 'MARCO' });
        }
        for (let k = 1; k < 24; k++) {
            const x = 19.3 + k * (963.6 / 24);
            d.line(x, 3.2, x, 9.7, { w: 0.5, marco: true, layer: 'MARCO' }); d.line(x, 697.3, x, 703.8, { w: 0.5, marco: true, layer: 'MARCO' });
        }
        d.rect(19.3, 9.7, 963.6, 18.8, { w: 0.6, marco: true, layer: 'MARCO' });
        d.text(501, 22.3, titulo, { size: 8.2, align: 'center', marco: true, layer: 'TEXTO' });
    }

    // ------------------------------------------------------------
    // Escala para llenar la hoja
    // ------------------------------------------------------------
    function ajuste(d, area) {
        const b = d.bbox();
        const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
        const s = Math.min(area.w / bw, area.h / bh, 1.45);
        return { s, tx: area.x + (area.w - bw * s) / 2 - b.x0 * s, ty: area.y + (area.h - bh * s) / 2 - b.y0 * s };
    }
    function aplicar(d, T) {      // devuelve un dibujo nuevo ya escalado
        const o = new Dib();
        const f = (x, y) => [x * T.s + T.tx, y * T.s + T.ty];
        d.it.forEach(i => {
            if (i.o.marco) { o.it.push(i); return; }
            const oo = Object.assign({}, i.o);
            if (oo.w) oo.w = Math.max(oo.w * Math.min(T.s, 1.2), 0.2);
            if (i.t === 'l') { const a = f(i.x1, i.y1), b = f(i.x2, i.y2); o.it.push({ t: 'l', x1: a[0], y1: a[1], x2: b[0], y2: b[1], o: oo }); }
            else if (i.t === 'p') o.it.push({ t: 'p', pts: i.pts.map(p => f(p[0], p[1])), o: oo });
            else if (i.t === 'r') { const a = f(i.x, i.y); o.it.push({ t: 'r', x: a[0], y: a[1], w: i.w * T.s, h: i.h * T.s, o: oo }); }
            else if (i.t === 'i') { const a = f(i.x, i.y); o.it.push(Object.assign({}, i, { x: a[0], y: a[1], w: i.w * T.s, h: i.h * T.s })); }
            else if (i.t === 'c') { const a = f(i.x, i.y); o.it.push({ t: 'c', x: a[0], y: a[1], r: i.r * T.s, o: oo }); }
            else if (i.t === 't') { const a = f(i.x, i.y); oo.size = (oo.size || 3.7) * T.s; o.it.push({ t: 't', x: a[0], y: a[1], s: i.s, o: oo }); }
        });
        return o;
    }

    // ------------------------------------------------------------
    // Salida PDF
    // ------------------------------------------------------------
    function toPDF(d) {
        const { jsPDF } = root.jspdf;
        const doc = new jsPDF({ unit: 'mm', format: [d.hoja.w, d.hoja.h], orientation: 'landscape' });
        d.it.forEach(i => {
            if (i.t === 'i') { try { doc.addImage(i.data, i.fmt || 'PNG', i.x, i.y, i.w, i.h); } catch (e) { } return; }
            const o = i.o, col = o.color || NEGRO;
            const fc = Array.isArray(o.fill) ? o.fill : col;
            doc.setDrawColor(col[0], col[1], col[2]); doc.setFillColor(fc[0], fc[1], fc[2]);
            doc.setLineWidth(o.w || 0.5); doc.setLineCap(o.dash ? 0 : 2); doc.setLineJoin(0);
            doc.setLineDashPattern(o.dash ? [2.2, 1.4] : [], 0);
            if (i.t === 'l') doc.line(i.x1, i.y1, i.x2, i.y2);
            else if (i.t === 'r') doc.rect(i.x, i.y, i.w, i.h, o.fill ? 'FD' : 'S');
            else if (i.t === 'c') doc.circle(i.x, i.y, i.r, o.fill ? 'F' : 'S');
            else if (i.t === 'p') {
                const p = i.pts;
                if (o.fill) { doc.lines(p.slice(1).map((q, k) => [q[0] - p[k][0], q[1] - p[k][1]]), p[0][0], p[0][1], [1, 1], 'F', true); }
                else { doc.lines(p.slice(1).map((q, k) => [q[0] - p[k][0], q[1] - p[k][1]]), p[0][0], p[0][1], [1, 1], 'S', !!o.closed); }
            } else if (i.t === 't') {
                const sz = o.size || 3.7;
                doc.setFont(o.helv ? 'helvetica' : 'courier', o.bold ? 'bold' : 'normal'); doc.setFontSize(sz / 0.3528);
                doc.setTextColor(col[0], col[1], col[2]);
                if (o.rot) doc.text(i.s, i.x, i.y, { angle: o.rot });
                else doc.text(i.s, i.x, i.y, { align: o.align || 'left' });
                if (o.under) { const w = doc.getTextWidth(i.s); const x0 = o.align === 'center' ? i.x - w / 2 : i.x; doc.setLineDashPattern([], 0); doc.setLineWidth(0.3); doc.line(x0, i.y + sz * 0.15, x0 + w, i.y + sz * 0.15); }
            }
        });
        doc.setLineDashPattern([], 0);
        return doc;
    }

    // ------------------------------------------------------------
    // Salida DXF (AutoCAD R2000, ASCII)
    // ------------------------------------------------------------
    function toDXF(d) {
        const out = [];
        // R2000 no lee UTF-8: todo carácter no ASCII va como \U+XXXX, que AutoCAD sí entiende
        const asc = (v) => String(v).replace(/[^\x20-\x7e]/g, (c) => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
        const g = (c, v) => { out.push(String(c)); out.push(typeof v === 'string' ? asc(v) : String(v)); };
        const Y = (y) => (d.hoja.h - y).toFixed(3);
        const X = (x) => x.toFixed(3);
        let hnd = 0x100;
        const H = () => (hnd++).toString(16).toUpperCase();
        // Espesores de línea válidos en DXF (centésimas de mm)
        const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
        const lwv = (w) => LW.reduce((m, v) => (Math.abs(v - w * 100) < Math.abs(m - w * 100) ? v : m), 25);
        const capas = { CONDUCTORES: 7, TEXTO: 7, SIMBOLOS: 7, TIERRA: 3, COMUNICACION: 5, TABLERO: 1, MARCO: 7 };

        g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1015'); g(9, '$INSUNITS'); g(70, 4); g(9, '$LWDISPLAY'); g(290, 1); g(0, 'ENDSEC');
        g(0, 'SECTION'); g(2, 'TABLES');
        const tabla = (nombre, cant, filas) => {
            const th = H();
            g(0, 'TABLE'); g(2, nombre); g(5, th); g(330, 0); g(100, 'AcDbSymbolTable'); g(70, cant);
            filas(th);
            g(0, 'ENDTAB');
        };
        tabla('APPID', 1, (th) => { g(0, 'APPID'); g(5, H()); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbRegAppTableRecord'); g(2, 'ACAD'); g(70, 0); });
        tabla('LTYPE', 2, (th) => {
            g(0, 'LTYPE'); g(5, H()); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbLinetypeTableRecord'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
            g(0, 'LTYPE'); g(5, H()); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbLinetypeTableRecord'); g(2, 'DASHED'); g(70, 0); g(3, 'Dashed'); g(72, 65); g(73, 2); g(40, 3.6); g(49, 2.2); g(74, 0); g(49, -1.4); g(74, 0);
        });
        tabla('LAYER', Object.keys(capas).length, (th) => {
            Object.entries(capas).forEach(([n, c]) => { g(0, 'LAYER'); g(5, H()); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbLayerTableRecord'); g(2, n); g(70, 0); g(62, c); g(6, 'CONTINUOUS'); });
        });
        tabla('STYLE', 1, (th) => { g(0, 'STYLE'); g(5, H()); g(330, th); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbTextStyleTableRecord'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, ''); });
        g(0, 'ENDSEC');
        g(0, 'SECTION'); g(2, 'ENTITIES');
        // Cabecera común de una entidad
        const ent = (tipo, i, capaDef, sub) => {
            const o = i.o;
            g(0, tipo); g(5, H()); g(100, 'AcDbEntity'); g(8, o.layer || capaDef);
            if (o.dash) g(6, 'DASHED');
            g(62, ACI(Array.isArray(o.fill) ? o.fill : (o.color || NEGRO)));
            if (o.w) g(370, lwv(o.w));
            g(100, sub);
        };
        const poli = (pts, cerrado, i) => {
            ent('LWPOLYLINE', i, 'CONDUCTORES', 'AcDbPolyline'); g(90, pts.length); g(70, cerrado ? 1 : 0);
            pts.forEach(p => { g(10, X(p[0])); g(20, Y(p[1])); });
        };
        const solido = (i, pts) => { ent('SOLID', i, 'SIMBOLOS', 'AcDbTrace'); pts.forEach((p, k) => { g(10 + k, X(p[0])); g(20 + k, Y(p[1])); g(30 + k, 0); }); };
        d.it.forEach(i => {
            if (i.t === 'i') {   // las imágenes no viajan en el DXF: queda un recuadro con su nombre
                poli([[i.x, i.y], [i.x + i.w, i.y], [i.x + i.w, i.y + i.h], [i.x, i.y + i.h]], true, { o: { layer: 'MARCO', w: 0.2 } });
                ent('TEXT', { o: { layer: 'TEXTO' } }, 'TEXTO', 'AcDbText'); g(10, X(i.x + 1)); g(20, Y(i.y + i.h / 2)); g(30, 0); g(40, '1.800'); g(1, i.nombre || 'IMAGEN'); g(7, 'STANDARD'); g(100, 'AcDbText'); g(73, 0);
                return;
            }
            if (i.t === 'l') { ent('LINE', i, 'CONDUCTORES', 'AcDbLine'); g(10, X(i.x1)); g(20, Y(i.y1)); g(30, 0); g(11, X(i.x2)); g(21, Y(i.y2)); g(31, 0); }
            else if (i.t === 'r') {
                if (i.o.fill && !(Array.isArray(i.o.fill) && i.o.fill[0] > 240)) solido(i, [[i.x, i.y], [i.x + i.w, i.y], [i.x, i.y + i.h], [i.x + i.w, i.y + i.h]]);
                else poli([[i.x, i.y], [i.x + i.w, i.y], [i.x + i.w, i.y + i.h], [i.x, i.y + i.h]], true, i);
            }
            else if (i.t === 'c') {
                if (i.o.fill) solido(i, [[i.x - i.r, i.y], [i.x, i.y - i.r], [i.x, i.y + i.r], [i.x + i.r, i.y]]);
                else { ent('CIRCLE', i, 'SIMBOLOS', 'AcDbCircle'); g(10, X(i.x)); g(20, Y(i.y)); g(30, 0); g(40, i.r.toFixed(3)); }
            }
            else if (i.t === 'p') {
                if (i.o.fill && i.pts.length === 3) solido(i, [i.pts[0], i.pts[1], i.pts[2], i.pts[2]]);
                else if (i.o.fill && i.pts.length > 3) { for (let k = 1; k < i.pts.length - 1; k++) solido(i, [i.pts[0], i.pts[k], i.pts[k + 1], i.pts[k + 1]]); }
                else poli(i.pts, !!i.o.closed, i);
            }
            else if (i.t === 't') {
                const sz = (i.o.size || 3.7) * 0.72;
                ent('TEXT', i, 'TEXTO', 'AcDbText');
                g(10, X(i.x)); g(20, Y(i.y)); g(30, 0); g(40, sz.toFixed(3)); g(1, i.s);
                if (i.o.rot) g(50, i.o.rot);
                g(7, 'STANDARD');
                const al = i.o.align === 'center' ? 1 : i.o.align === 'right' ? 2 : 0;
                if (al) { g(72, al); g(11, X(i.x)); g(21, Y(i.y)); g(31, 0); }
                g(100, 'AcDbText'); g(73, 0);
            }
        });
        g(0, 'ENDSEC'); g(0, 'EOF');
        return out.join('\r\n');
    }

    // Red, transformador y medidor (arriba a la derecha). redEnd = y donde termina la línea hacia el tablero.
    function bloqueRedHibrido(D, d, redEnd) {
        const tf = D.trafo || {}, awgAco = (D.acometida && D.acometida.awg) || 8, xR = 642.8;

            d.text(xR, 14, 'Red Eléctrica del', { size: 4.2, align: 'center' }); d.text(xR, 18.6, `Operador de Red ${D.operador || ''}`.trim(), { size: 4.2, align: 'center' });
            d.poly([[xR - 6.6, 22], [xR + 6.7, 22], [xR + 0.1, 32]], { closed: true, w: 0.6 });
            for (let k = -6; k <= 6.1; k += 1.2) d.line(xR + k, 22.2, xR + 0.1 + k * 0.05, 31.8, { w: 0.2, color: GRIS });
            d.line(xR, 32, xR, 44.8);
            d.circle(xR + 0.2, 53, 8.2); d.circle(xR + 0.2, 62.6, 8.2);
            const t1 = [`Transformador ${tf.fases == 3 ? 'Trifásico' : 'Bifásico'}`, `Relación: ${tf.tensionPrim || ''}/${tf.tensionSec || ''}`, `Potencia: ${tf.kva || ''}kVA`, `Código: ${tf.codigo || ''}`, tf.matricula ? `Matrícula: ${tf.matricula}` : '', D.nic ? `Cuenta: ${D.nic}` : ''].filter(Boolean);
            t1.forEach((t, k) => d.text(xR - 12, 50 + k * 4.7, t, { size: 4.2, align: 'right' }));
            d.line(xR + 8.4, 57.8, xR + 30.6, 57.8, { color: VERDE, layer: 'TIERRA' }); d.line(xR + 30.6, 57.8, xR + 30.6, 64, { color: VERDE, layer: 'TIERRA' });
            S.tierra(d, xR + 30.6, 64, { w: 0.6 }); d.text(xR + 38, 63, 'Puesta a tierra poste', { size: 3.7 }); d.text(xR + 38, 67.4, 'y transformador', { size: 3.7 });
            d.line(xR, 70.8, xR, 84);
            S.cond(d, xR, 73.4, true, { f: 2, n: true });
            lineas(d, xR + 8.6, 76.2, [`2XNo.${awgAco} AWG Cu. THHN/THWN-2 (F)`, `1XNo.${awgAco} AWG Cu. THHN/THWN-2 (N)`], { size: 3.3, gap: 3.8 });
            d.rect(xR - 11.4, 84, 22.7, 20, { w: 0.75 }); d.rect(xR - 6.4, 86.5, 12.8, 4, { w: 0.4 }); d.text(xR, 99, 'kW/h', { size: 4.6, align: 'center' });
            d.rect(xR - 105.5, 80, 82.4, 42.7, { w: 0.6, color: NARANJA });
            lineas(d, xR - 104.2, 87.4, ['EQUIPO DE MEDIDA DIRECTA', 'SE REEMPLAZA POR MEDIDOR', 'BIDIRECCIONAL CALIBRADO Y', 'HOMOLOGADO POR OPERADOR DE', 'RED Y COMERCIALIZADOR DE', 'ENERGIA'], { size: 4.2, gap: 6.2 });
            d.line(xR, 104, xR, redEnd);
            S.cond(d, xR, 111.2, true, { f: 2, n: true });
            lineas(d, xR + 8.6, 114, [`2XNo.${awgAco} AWG Cu. THHN/THWN-2 (F)`, `1XNo.${awgAco} AWG Cu. THHN/THWN-2 (N)`], { size: 3.3, gap: 3.8 });
    }

    // ============================================================
    // SISTEMAS HÍBRIDOS (inversor con batería)
    // Igual que el on-grid del lado de los strings, pero el inversor trae los puertos
    // BATTERY / COM (arriba) y LOAD / GRID (a la derecha); hay un bloque de batería y el
    // tablero AC lleva barraje, breakers "red SSFV" y "load SSFV" y un selector de
    // transferencia de 3 posiciones hacia el tablero de distribución de cargas.
    // D.bateria = { marca, modelo, kwh, ah, cantidad, cableMm2, distancia, imax }
    // ============================================================
    function construirHibrido(D) {
        const d = new Dib(), r = new Dib();
        const P = D.panel, I = D.inversor, C = D.calc;
        if (D.inversores.length !== 1) throw new Error('El unifilar híbrido por ahora es de un solo inversor.');
        const inv = D.inversores[0];
        const dist = Object.assign({ cajaInversor: 1.7, invTablero: 23, tableroGeneral: 11 }, D.dist || {});
        const canal = Object.assign({ dcTipo: 'IMC', dcDim: '1"', acTipo: 'EMT', acDim: '1 1/4"' }, D.canal || {});
        const awgAc = (C.regAC[0].conductor.match(/^(\d+)/) || [0, 8])[1];
        const awgAco = (D.acometida && D.acometida.awg) || 8;
        const tf = D.trafo || {}, B = D.bateria || {};
        const vac = D.vSistema || I.vNom, nF = I.fases || 2;
        const acCanal = canal.acBandeja ? 'Bandeja portacable' : `${canal.acTipo} ${canal.acDim}`;
        const dcCanal = canal.dcBandeja ? 'Bandeja portacable' : `${canal.dcTipo} ${canal.dcDim}`;
        const brk = C.regAC[0].proteccion;
        const MOD_H = 8.4;
        const maxSer = Math.max.apply(null, D.inversores[0].strings.map(s => s.series));
        const SP = Math.max(59.8, Math.ceil(maxSer / 2) * (MOD_H + 0.6) + 8 + 7 * 4.1 + 6);

        // ---------- strings, caja de paso e inversor ----------
        const rows = [];
        inv.strings.forEach(s => { for (let k = 0; k < s.paralelos; k++) rows.push({ mppt: s.mppt, series: s.series, largo: s.longitud }); });
        rows.forEach((r, k) => { r.y = 360.8 + SP * k; });
        const yFirst = rows[0].y, yLast = rows[rows.length - 1].y, nStr = rows.length;
        const yG = yLast + 88, yG0 = yG;
        rows.forEach((r, k) => {
            const col = COLOR_STRING[k % COLOR_STRING.length], y = r.y;
            d.text(31.8, y - 9.8, `STRING ${k + 1} - ${r.series} MODULOS ${P.pmax}W`, { size: 4.2, color: col });
            const hMod = moduloFV(d, 31.9, y - 7.4, r.series);
            lineas(d, 31.8, y - 7.4 + hMod + 4.2, [`I${D._numInv || 1}M${r.mppt}S${k + 1}`, 'STC: 1000W/m2 25°C, AM1.5', `Voc: ${(r.series * P.voc).toFixed(2)}V`, `Isc: ${P.isc}A`, `Vmp: ${(r.series * P.vmpp).toFixed(2)}V`, `Imp: ${P.imp}A`, `Distancia:${r.largo}m`], { size: 3.4, gap: 4.1 });
            d.line(62.7, y, 170.9, y); S.polar(d, 78, y);
            lineas(d, 65, y + 9, ['Cable Fotovoltaico', `2x#${C.cablePV.match(/(\d+)mm/)[1]}mm²/XLPE`], { size: 3.3, gap: 3.9 });
            S.cuadrado(d, 170.9, y, 3); S.cuadrado(d, 206.5, y, 3);
            d.line(170.9, y, 179, y); d.line(198, y, 206.5, y);
            d.rect(179, y - 7.9, 19, 16.6, { w: 0.4 }); S.fusible(d, 181, y - 3.2, 15, 6.4);
            d.text(178.5, y + 12.6, '2XFUSIBLE 20A', { size: 3.3 });
            d.line(27.5, y - 7.4 + hMod / 2, 31.9, y - 7.4 + hMod / 2, { color: VERDE, layer: 'TIERRA' });   // tierra de cada string
            d.line(206.5, y, 312.5, y); S.polar(d, 238, y);
            lineas(d, 247.7, y + 4.6, [`2x#${C.cablePV.match(/(\d+)mm/)[1]}mm²/XLPE`, `Imax: ${P.isc * 1.0}A`, `Conducto: ${dcCanal}`, `Distancia: ${dist.cajaInversor}m`], { size: 3.3, gap: 3.9 });
            S.cuadrado(d, 312.5, y, 3);
        });
        [[102.4, 87.5], [221.5, 206.6]].forEach(([xr, xl]) => {
            d.rect(xr, yFirst - 4, 4.4, yLast - yFirst + 8, { w: 0.4 });
            S.flecha(d, xr + 2.2, yLast + 5);
            d.line(xr + 2.2, yLast + 9.5, xr + 2.2, yLast + 19, { color: [150, 150, 205], w: 0.2, dash: true, keepDash: true });
            d.text(xr - 1, yLast + 24, canal.dcBandeja ? 'Bandeja portacable' : txtTubo(canal.dcTipo, canal.dcDim), { size: 3.6 });
        });
        const cTop = yFirst - 22.2, cBot = yLast + 27.7;
        d.rect(170.9, cTop, 35.6, cBot - cTop, { w: 0.9 });
        d.text(157.9, cTop - 9.5, 'CAJA DE PASO FV-INVERSOR', { size: 4.2 }); d.text(161, cTop - 4.8, `${nStr * 2} FUSIBLES 20A-1000VDC`, { size: 4.2 });
        S.cuadrado(d, 170.9, cTop + 4.5, 3);
        const yCt = nStr === 2 ? (yFirst + yLast) / 2 : yLast + 18;
        d.line(175.5, cTop + 4.5, 175.5, yG0, { color: VERDE, layer: 'TIERRA' });
        d.circle(175.5, yCt, 1.2, { fill: NEGRO }); d.line(175.5, yCt, 177.6, yCt);
        d.circle(181.8, yCt, 4.2);
        d.line(181.8, yCt - 2.6, 181.8, yCt - 0.3, { w: 0.4 }); d.line(179.4, yCt - 0.3, 184.2, yCt - 0.3, { w: 0.4 }); d.line(180.2, yCt + 1, 183.4, yCt + 1, { w: 0.4 }); d.line(181, yCt + 2.2, 182.6, yCt + 2.2, { w: 0.4 });
        const bTop = yFirst - 13, bBot = yLast + 76.6;
        d.rect(312.5, bTop, 109.9, bBot - bTop, { w: 0.9 });
        d.text(312.2, bTop - 1.7, D._etiqInv || 'INVERSOR', { size: 4.2 });
        d.rect(309.8, yFirst - 3.5, 5.5, yLast - yFirst + 7, { color: AZUL, w: 0.6, layer: 'COMUNICACION' });
        rows.forEach(r => S.cuadrado(d, 312.5, r.y, 3));
        const mpptY = {}; rows.forEach(r => { if (mpptY[r.mppt] === undefined) mpptY[r.mppt] = r.y; });
        Object.keys(mpptY).forEach(m => {
            const y = mpptY[m];
            d.rect(328.8, y - 7.6, 7.5, 16, { w: 0.6 }); d.text(334, y + 6.8, `MPPT ${m}`, { size: 3.7, rot: 90 });
            d.line(312.5, y, 328.8, y); d.line(336.3, y, 344, y);
        });
        const ms = Object.keys(mpptY).map(Number), yM2 = mpptY[ms[ms.length - 1]];
        d.line(344, mpptY[ms[0]], 344, yM2 + 33.4);
        d.line(344, yM2, 336.3, yM2);
        // DPS tipo 2 (cuadro con triángulo hacia abajo), como en el cuadro de convenciones
        d.line(344, yM2 + 33.4, 353.3, yM2 + 33.4); d.line(353.3, yM2 + 33.4, 353.3, yM2 + 35.5);
        d.rect(350.7, yM2 + 35.5, 5.2, 9.5, { w: 0.4 });
        d.poly([[351.9, yM2 + 38.3], [354.7, yM2 + 38.3], [353.3, yM2 + 40.8]], { closed: true, fill: NEGRO, w: 0.2 });
        d.text(358, yM2 + 41, 'DPS Tipo 2', { size: 2.8 });
        // puertos del inversor híbrido
        [['BATTERY', 345, 30], ['COM', 375, 22], ['COM', 397, 22]].forEach(([t, x, w]) => { d.rect(x, bTop, w, 6, { w: 0.5 }); d.text(x + w / 2, bTop + 4.2, t, { size: 3.1, align: 'center' }); });
        const yLoad = bTop + 16.5, yGrid = bTop + 30;
        [['LOAD', yLoad], ['GRID', yGrid]].forEach(([t, y]) => { d.rect(413.9, y - 6.75, 8.5, 13.5, { w: 0.4 }); d.text(419.3, y + 3.4, t, { size: 3, rot: 90 }); });
        const refTxt = /srne/i.test(I.fabricante) ? I.modelo : `${I.fabricante}/${I.modelo}`;
        lineas(d, 350, bTop + 15.5, [`REF:${refTxt}`, `Potencia Max: ${I.pAC}W`, `Imax:${I.iSalida}A`, `Conexión: ${nF}L+PE`, `Vac:${vac}V`], { size: 4.2, gap: 4.7 });
        // cables AC del inversor (LOAD y GRID)
        const awgTAc = (C.regAC[0].tierraCond.match(/^(\d+)/) || [0, 10])[1];
        const etAc = (x, y, conTierra) => lineas(d, x, y, [`${nF}XNo.${awgAc} AWG 60° Cu. THHN/THWN-2 (F)`, `1XNo.${awgAc} AWG 60° Cu. THHN/THWN-2 (N)`].concat(conTierra ? [`1XNo.${awgTAc} AWG 60° Cu. THHN/THWN-2 (T)`] : [], [`Imax: ${I.iSalida}A`, `Vac: ${vac}V`, `Conducto: ${acCanal}`, `Distancia: ${dist.invTablero}m`]), { size: 3.1, gap: 3.5 });
        etAc(439, yLoad - 27, true); etAc(439, yGrid + 6, false);
        S.cond(d, 484, yLoad, false, { f: nF, n: true, t: true }); S.cond(d, 484, yGrid, false, { f: nF, n: true });
        if (!canal.acBandeja) {
            d.rect(428, yLoad - 9, 5, yGrid - yLoad + 18, { w: 0.4 }); S.flecha(d, 430.5, yGrid + 9);
            d.line(430.5, yGrid + 13.5, 430.5, yGrid + 32, { color: [150, 150, 205], w: 0.2, dash: true, keepDash: true });
            d.text(426, yGrid + 37, txtTubo(canal.acTipo, canal.acDim), { size: 3.6 });
        }
        // tierra del inversor: punto, círculo con el símbolo de tierra y línea verde continua
        const yE = yLast + 56;
        d.circle(326, yE, 1.2, { fill: NEGRO }); d.line(326, yE, 328.6, yE);
        d.circle(334.4, yE, 5.8);
        d.line(334.4, yE - 3.6, 334.4, yE - 0.4, { w: 0.4 }); d.line(331.4, yE - 0.4, 337.4, yE - 0.4, { w: 0.4 }); d.line(332.4, yE + 1.2, 336.4, yE + 1.2, { w: 0.4 }); d.line(333.4, yE + 2.8, 335.4, yE + 2.8, { w: 0.4 });
        d.line(326, yE, 326, yG, { color: VERDE, layer: 'TIERRA' });
        d.line(175.5, cTop + 4.5, 27.5, cTop + 4.5, { color: VERDE, layer: 'TIERRA' });
        d.line(27.5, cTop + 4.5, 27.5, yG, { color: VERDE, layer: 'TIERRA' });
        d.line(27.5, yG, D._xTierra || 530, yG, { color: VERDE, layer: 'TIERRA' });
        S.cond(d, 116, cTop + 4.5, false, { t: true }); d.text(121.8, cTop + 10.6, '1XNo. 10AWG (T)', { size: 3.3 }); S.cond(d, 122, yG, false, { t: true }); d.text(126.4, yG + 4, '1XNo. 10AWG (T)', { size: 3.3 }); S.cond(d, 426, yG, false, { t: true }); d.text(430, yG + 4, '1XNo. 10AWG (T)', { size: 3.3 });

        if (D._bloque) return { d, yLoad, yGrid, bTop, bBot: yLast + 76.6, yG, yFirst };

        // ---------- batería (misma figura que el bloque "bateria" del plano de referencia) ----------
        const bx0 = 322, bx1 = 420, by0 = 240, kb = (bx1 - bx0) / 157.5, by1 = by0 + 96.2 * kb, bm = (bx0 + bx1) / 2;
        const px = (v) => bx0 + v * kb, py = (v) => by1 - v * kb;
        d.rect(px(0.3), py(96.2), 157.5 * kb, 96.2 * kb, { w: 0.6 });
        d.line(px(20.8), py(77.3), px(20.8), py(58.3), { w: 0.5 }); d.line(px(12), py(67.4), px(30.3), py(67.4), { w: 0.5 });
        d.line(px(116.3), py(66.9), px(134.6), py(66.9), { w: 0.5 });
        d.line(px(14.3), py(35.5), px(73.3), py(35.5), { w: 0.5 }); d.line(px(83.1), py(35.5), px(141.5), py(35.5), { w: 0.5 });
        d.line(px(73.3), py(20.5), px(73.3), py(50.4), { w: 0.5 }); d.line(px(83.1), py(28), px(83.1), py(43), { w: 0.9 });
        const nBat = B.cantidad > 1 ? `${B.cantidad} x ` : '';
        d.text(bm, by0 - 9.5, `BATERIA ${String(B.marca || '').toUpperCase()}`.trim(), { size: 4.6, align: 'center' });
        d.text(bm, by0 - 4, `${nBat}${B.kwh ? B.kwh + 'KWH - ' : ''}${B.ah ? B.ah + 'AH - ' : ''}${String(B.modelo || '').toUpperCase()}`.replace(/ - $/, ''), { size: 4.6, align: 'center' });
        d.line(360, by1, 360, bTop, { w: 0.6 });                                        // potencia (+ y -)
        d.line(386, by1, 386, bTop, { color: AZUL, w: 0.5, layer: 'COMUNICACION' });    // comunicación
        d.line(408, by1, 408, bTop, { color: VERDE, w: 0.5, layer: 'TIERRA' });         // tierra
        const yM = by1 + 14;
        d.line(356.8, yM + 1.6, 363.2, yM - 1.6, { color: ROJO, w: 0.3 }); d.line(356.8, yM + 5.2, 363.2, yM + 2, { w: 0.3 });
        lineas(d, 354, yM - 1.5, [`Cable rojo ${B.cableMm2 || 50} mm² (+),`, `Cable negro ${B.cableMm2 || 50} mm² (-)`, `Distancia: ${B.distancia || 0.8}m`, `Imax: ${B.imax || 160}A`], { size: 3.4, gap: 4, align: 'right' });
        d.text(373, yM + 24, 'Comunicación', { size: 3.4, align: 'center' });
        S.cond(d, 408, yM + 2, true, { t: true }); d.text(414, yM + 4, '1XNo. 10AWG (T)', { size: 3.1 });

        // ---------- red (arriba a la derecha): compacta para que el diagrama llene la hoja ----------
        const xR = 642.8;
        bloqueRedHibrido(D, r, 260);

        // ---------- tablero AC SSFV ----------
        // El barraje queda debajo de los puertos: GRID baja y entra por abajo al breaker "red SSFV";
        // LOAD pasa por encima, baja por la derecha del barraje y entra al breaker "load SSFV" (Estado 2 Solar).
        const yBus = 440, xB1 = 548, xE1 = 600, xE2 = 610.4, xC = 605.2, yS = yBus + 44, xL = 690, xgd = 504;
        d.rect(511.9, yBus - 40, 195, 165, { color: ROJO, w: 0.5, layer: 'TABLERO' });
        S.breaker(d, xR, yBus - 30);
        lineas(d, xR + 4.5, yBus - 26, ['Interruptor', 'termomagnético', 'red', `${nF}X${brk}A - 10kA`], { size: 3.2, gap: 3.6 });
        d.line(xR, yBus - 19, xR, yBus);
        d.line(528, yBus, 668, yBus, { w: 2.2, color: NARANJA });
        d.text(528, yBus - 3, `BARRAJE 160A - ${vac}V`, { size: 4 }); d.text(528, yBus - 7.2, `${nF}F - 4H`, { size: 4 });
        // GRID -> breaker red SSFV (cuelga del barraje)
        d.line(422.4, yGrid, xgd, yGrid); d.line(xgd, yGrid, xgd, yBus + 32); d.line(xgd, yBus + 32, xB1, yBus + 32); d.line(xB1, yBus + 32, xB1, yBus + 15);
        d.line(xB1, yBus, xB1, yBus + 4); S.breaker(d, xB1, yBus + 4);
        lineas(d, xB1 + 4, yBus + 12, ['Interruptor', 'termomagnético', 'red SSFV', `${nF}X${brk}A - 10kA`], { size: 3.1, gap: 3.5 });
        // LOAD -> pasa sobre la línea de la red (salto), baja a la derecha del barraje y vuelve al breaker load SSFV
        d.line(422.4, yLoad, xR - 1.8, yLoad);
        const arco = []; for (let a = 0; a <= 6; a++) { const t = Math.PI * a / 6; arco.push([xR - 1.8 * Math.cos(t), yLoad - 1.8 * Math.sin(t)]); }
        d.poly(arco);
        d.line(xR + 1.8, yLoad, xL, yLoad); d.line(xL, yLoad, xL, yBus + 14); d.line(xL, yBus + 14, xE2, yBus + 14);
        d.line(xE2, yBus + 14, xE2, yBus + 17); S.breaker(d, xE2, yBus + 17); d.line(xE2, yBus + 28, xE2, yS);
        lineas(d, xE2 + 3.5, yBus + 20, ['Interruptor', 'termomagnético', 'load SSFV', `${nF}X${brk}A - 10kA`], { size: 3.1, gap: 3.5 });
        // red directa al selector (Estado 1)
        d.line(xE1, yBus, xE1, yS);
        // selector de transferencia de 3 posiciones (compacto)
        d.rect(xE1 - 2.6, yS, xE2 - xE1 + 5.2, 19, { w: 0.4 });
        S.cuadrado(d, xE1, yS, 2); S.cuadrado(d, xE2, yS, 2); S.cuadrado(d, xC, yS + 19, 2);
        d.line(xE1, yS, xE1, yS + 9); d.line(xE2, yS, xE2, yS + 6);
        d.line(xC, yS + 19, xC, yS + 13); d.line(xC, yS + 13, xE2 - 0.3, yS + 6.6);
        d.text(xE1 - 1.6, yS - 5.4, 'Estado 1', { size: 2.6, align: 'right' }); d.text(xE1 - 1.6, yS - 2.6, 'Red', { size: 2.6, align: 'right' });
        d.text(xE2 + 1.6, yS - 5.4, 'Estado 2', { size: 2.6 }); d.text(xE2 + 1.6, yS - 2.6, 'Solar', { size: 2.6 });
        d.text(xC - 1.8, yS + 22.6, 'Estado 3', { size: 2.6, align: 'right' }); d.text(xC - 1.8, yS + 25.4, 'Común', { size: 2.6, align: 'right' });
        lineas(d, xE2 + 6, yS + 7, ['Selector de', 'transferencia', 'de 3 posiciones'], { size: 3.6, gap: 4.2 });
        // salida a cargas
        const xG = 745, yOut = yS + 41;
        d.line(xC, yS + 19, xC, yOut); d.line(xC, yOut, xG, yOut);
        d.rect(xG, yOut - 15, 30, 30, { w: 1.2 }); d.poly([[xG, yOut + 15], [xG + 30, yOut - 15], [xG + 30, yOut + 15]], { closed: true, fill: NEGRO });
        d.text(xG + 15, yOut + 20, 'Tablero de distribución', { size: 3.4, align: 'center' }); d.text(xG + 15, yOut + 24, 'de cargas', { size: 3.4, align: 'center' });
        lineas(d, xC + 30, yOut + 4, [`${nF}XNo.${awgAc} AWG Cu. THHN/THWN-2 (F)`, `Conducto: ${acCanal}`, `Distancia: ${dist.tableroGeneral}m`], { size: 3.1, gap: 3.5 });
        // barraje de tierra y electrodo
        const yPE = yOut + 16;
        d.line(528, yPE, 600, yPE, { w: 1.6, color: NARANJA }); d.text(530, yPE - 2, 'Barraje de Tierra', { size: 2.8 }); d.text(580, yPE - 2, 'Icc >= 6kA', { size: 2.8 });
        d.line(530, yG, 530, yPE, { color: VERDE, layer: 'TIERRA' });
        S.tierra(d, 606, yPE + 1.2, { w: 0.6, color: [0, 110, 0] });
        d.line(565, yPE, 565, yPE + 32, { color: VERDE, layer: 'TIERRA' }); S.tierra(d, 565, yPE + 32, { w: 1.6 }); S.cond(d, 565, yPE + 14, true, { t: true });
        d.text(574, yPE + 18, '1XNo. 8 AWG (T)', { size: 3.1 }); d.text(578, yPE + 36, 'ELECTRODO DE PUESTA A TIERRA,', { size: 4 }); d.text(578, yPE + 41, 'VARILLA COPPERWELD 3/8 - 2.4m', { size: 4 });
        d.text(640, yPE + 8, 'TABLERO AC SSFV', { size: 4.2 }); d.text(640, yPE + 12.5, `BARRAJE ${nF}F`, { size: 4.2 });
        desplazar(d, -150);
        r.it.forEach(i => d.it.push(i));
        d.it.forEach(i => {
            if (!i.o.keepDash) i.o.dash = false;
            if (i.t === 't') i.o.helv = true;
            else if (i.t !== 'i') { const w = i.o.w || 0.5; i.o.w = w >= 1.5 ? w * 0.75 : Math.max(0.22, w * 0.5); }
        });
        return d;
    }

    // Cables ortogonales: donde una horizontal cruza una vertical de otro cable, salta con un arco
    function cablesConSaltos(d, cables) {
        const segs = [];
        cables.forEach((c, ci) => { for (let k = 0; k < c.pts.length - 1; k++) segs.push({ ci, a: c.pts[k], b: c.pts[k + 1], o: c.o || {}, sv: !!c.saltaV }); });
        const arcoH = (x, y, r) => { const q = []; for (let t = 0; t <= 6; t++) { const w = Math.PI * t / 6; q.push([x - r * Math.cos(w), y - r * Math.sin(w)]); } return q; };
        const arcoV = (x, y, r) => { const q = []; for (let t = 0; t <= 6; t++) { const w = Math.PI * t / 6; q.push([x - r * Math.sin(w), y - r * Math.cos(w)]); } return q; };
        segs.forEach(sg => {
            const x1 = sg.a[0], y1 = sg.a[1], x2 = sg.b[0], y2 = sg.b[1];
            if (Math.abs(y1 - y2) > 0.01) {                       // vertical
                if (!sg.sv) { d.line(x1, y1, x2, y2, sg.o); return; }
                const x = x1, ya = Math.min(y1, y2), yb = Math.max(y1, y2), cruces = [];
                segs.forEach(o2 => {
                    if (o2.ci === sg.ci || Math.abs(o2.a[1] - o2.b[1]) > 0.01) return;
                    const v = o2.a[1], xa = Math.min(o2.a[0], o2.b[0]), xb = Math.max(o2.a[0], o2.b[0]);
                    if (v > ya + 2.5 && v < yb - 2.5 && x > xa + 0.5 && x < xb - 0.5) cruces.push(v);
                });
                cruces.sort((p, q) => p - q);
                let cur = ya;
                cruces.forEach(v => { d.line(x, cur, x, v - 1.8, sg.o); d.poly(arcoV(x, v, 1.8), sg.o); cur = v + 1.8; });
                d.line(x, cur, x, yb, sg.o);
                return;
            }
            const y = y1, xa = Math.min(x1, x2), xb = Math.max(x1, x2), cruces = [];
            segs.forEach(o2 => {
                if (o2.ci === sg.ci || o2.sv || Math.abs(o2.a[0] - o2.b[0]) > 0.01) return;
                const u = o2.a[0], ya = Math.min(o2.a[1], o2.b[1]), yb = Math.max(o2.a[1], o2.b[1]);
                if (u > xa + 2.5 && u < xb - 2.5 && y > ya + 0.5 && y < yb - 0.5) cruces.push(u);
            });
            cruces.sort((p, q) => p - q);
            let cur = xa;
            cruces.forEach(u => { d.line(cur, y, u - 1.8, y, sg.o); d.poly(arcoH(u, y, 1.8), sg.o); cur = u + 1.8; });
            d.line(cur, y, xb, y, sg.o);
        });
    }

    function escalarItems(items, f) {
        items.forEach(i => {
            if (i.t === 'l') { i.x1 *= f; i.y1 *= f; i.x2 *= f; i.y2 *= f; }
            else if (i.t === 'p') i.pts = i.pts.map(p => [p[0] * f, p[1] * f]);
            else if (i.t === 'r' || i.t === 'i') { i.x *= f; i.y *= f; i.w *= f; i.h *= f; }
            else if (i.t === 'c') { i.x *= f; i.y *= f; i.r *= f; }
            else if (i.t === 't') { i.x *= f; i.y *= f; if (i.o.size) i.o.size *= f; }
            if (i.o && i.o.w) i.o.w *= f;
        });
    }

    const BREAKER_STD = [20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
    const sigBreaker = (a) => BREAKER_STD.find(v => v >= a) || Math.ceil(a / 10) * 10;

    // ============================================================
    // HÍBRIDOS CON VARIOS INVERSORES Y BATERÍAS
    // Bloques de inversor apilados (strings + caja de paso + inversor), banco de baterías arriba con su
    // barraje DC y un tronco por la izquierda que baja al puerto BATTERY de cada inversor; los inversores
    // se comunican en cadena (azul). Tablero AC con dos barrajes: arriba el de la red (un breaker "red SSFV"
    // por inversor) y abajo el de carga (un breaker "load SSFV" por inversor), un breaker general de carga y
    // un solo selector de transferencia.
    // ============================================================
    function construirHibridoMulti(D) {
        const d = new Dib(), r = new Dib();
        const N = D.inversores.length, B = D.bateria || {}, I = D.inversor, C = D.calc;
        const awgAc = (C.regAC[0].conductor.match(/^(\d+)/) || [0, 8])[1];
        const vac = D.vSistema || I.vNom, nF = I.fases || 2;
        const nB = Math.max(1, B.cantidad || N);
        const dist = Object.assign({ tableroGeneral: 11 }, D.dist || {});
        const canal = Object.assign({ acTipo: 'EMT', acDim: '1 1/4"' }, D.canal || {});
        const acCanal = canal.acBandeja ? 'Bandeja portacable' : `${canal.acTipo} ${canal.acDim}`;
        const brkK = (k) => (C.regAC[k] || C.regAC[0]).proteccion;
        const brkTot = sigBreaker(D.inversores.reduce((a, _, k) => a + brkK(k), 0));

        // ---------- bloques de inversor ----------
        const bl = D.inversores.map((inv, k) => construirHibrido(Object.assign({}, D, {
            inversores: [inv], calc: Object.assign({}, C, { regAC: [C.regAC[k] || C.regAC[0]] }),
            _bloque: true, _numInv: k + 1, _etiqInv: `INVERSOR ${k + 1}`, _xTierra: 534
        })));
        const bb = bl.map(b => b.d.bbox());
        const dy = [0];
        for (let k = 1; k < N; k++) dy[k] = dy[k - 1] + bb[k - 1].y1 + 22 - bb[k].y0;
        bl.forEach((b, k) => { desplazar(b.d, dy[k]); b.d.it.forEach(i => d.it.push(i)); });
        const P = bl.map((b, k) => ({ yL: b.yLoad + dy[k], yG: b.yGrid + dy[k], bTop: b.bTop + dy[k], bBot: b.bBot + dy[k], yTierra: b.yG + dy[k], yH: bb[k].y0 + dy[k] - 6 }));
        const cables = [];
        const NEGRO_O = {}, VERDE_O = { color: VERDE, layer: 'TIERRA' }, AZUL_O = { color: AZUL, layer: 'COMUNICACION', w: 0.5 };

        // ---------- banco de baterías + tablero de protecciones de baterías ----------
        // Copiado del plano de referencia (Lorena Ocampo): baterías en fila con su cable de potencia (+/-) y su
        // cable CAN/BMS, un barraje con un breaker BAT-INVk por inversor y la salida de cada breaker hacia su inversor.
        const fs = 0.3, xo = 34, yTop = P[0].yH - 12 - 124;
        const bx = (X) => xo + (X - 5318) * fs, by = (Y) => yTop + (16430 - Y) * fs;
        const nSl = Math.max(nB, N), dSl = nSl - 3;
        const ROJO_O = { color: ROJO, w: 0.3 }, OSC = [110, 20, 20];
        // dos rayas de polaridad (roja y oscura) sobre un cable vertical / horizontal
        const marcasV = (X, Yc) => {
            [[ROJO, 4.5], [OSC, -4.5]].forEach(([col, dyy]) => d.line(bx(X - 8), by(Yc + dyy + 4.5), bx(X + 8), by(Yc + dyy - 4.5), { color: col, w: 0.3 }));
        };
        const marcasH = (Xc, Y) => {
            [[ROJO, 4.5], [OSC, -4.5]].forEach(([col, dxx]) => d.line(bx(Xc + dxx - 4.5), by(Y - 8), bx(Xc + dxx + 4.5), by(Y + 8), { color: col, w: 0.3 }));
        };
        // baterías
        for (let j = 0; j < nB; j++) {
            const X0 = 5318 + 256.5 * j, Y0 = 16236;
            const px = (v) => bx(X0 + v), py = (v) => by(Y0 + v);
            d.rect(px(0.3), py(96.2), 157.5 * fs, 96.2 * fs, { w: 0.5 });
            d.line(px(20.8), py(77.3), px(20.8), py(58.3), { w: 0.5 }); d.line(px(12), py(67.4), px(30.3), py(67.4), { w: 0.5 });
            d.line(px(116.3), py(66.9), px(134.6), py(66.9), { w: 0.5 });
            d.line(px(14.3), py(35.5), px(73.3), py(35.5), { w: 0.5 }); d.line(px(83.1), py(35.5), px(141.5), py(35.5), { w: 0.5 });
            d.line(px(73.3), py(20.5), px(73.3), py(50.4), { w: 0.5 }); d.line(px(83.1), py(28), px(83.1), py(43), { w: 0.9 });
            const cx = px(78.9);
            d.text(cx, by(16336) - 4.2, `BATERIA ${nB > 1 ? (j + 1) + ' ' : ''}${String(B.marca || '').toUpperCase()}`.replace(/\s+$/, ''), { size: 3.4, align: 'center' });
            d.text(cx, by(16336), `${B.kwh ? B.kwh + 'KWH - ' : ''}${B.ah ? B.ah + 'AH - ' : ''}${String(B.modelo || '').toUpperCase()}`.replace(/ - $/, ''), { size: 3.4, align: 'center' });
            // cable de potencia: baja, corre en horizontal (cada batería a su altura) y sube al barraje
            const xp = 5362 + 256.5 * j, yh = 16074 + 10 * j, xIn = 6290 - 69.5 * j;
            cables.push({ pts: [[bx(xp), by(16236)], [bx(xp), by(yh)], [bx(xIn), by(yh)], [bx(xIn), by(16222)]], o: { w: 0.6 } });
            // cable CAN / BMS en cadena
            const xc = 5429 + 256 * j;
            cables.push({ pts: [[bx(xc), by(16236)], [bx(xc), by(16134)]], o: { color: AZUL, w: 0.4, layer: 'COMUNICACION' } });
            if (j === nB - 1 && nB > 1) cables.push({ pts: [[bx(5429), by(16134)], [bx(xc), by(16134)]], o: { color: AZUL, w: 0.4, layer: 'COMUNICACION' } });
            marcasV(xp, 16198.5); marcasV(xIn, 16198.5);
            lineas(d, bx(xp) - 3, by(16202) + 2.2, [`Cable rojo ${B.cableMm2 || 50} mm² (+),`, `Cable negro ${B.cableMm2 || 50} mm² (-)`, `Distancia: ${B.distancia || 0.8}m`, `Imax: ${B.imax || 160}A`, `Ducto: ${canal.acDim} EMT`], { size: 2.1, gap: 2.5, align: 'right' });
            lineas(d, bx(xIn) - 2.5, by([16217, 16172, 16218][j % 3]) + 2.2, [`Cable rojo ${B.cableMm2 || 50} mm² (+),`, `Cable negro ${B.cableMm2 || 50} mm² (-)`, `Distancia: ${B.distancia || 0.8}m`, `Imax: ${B.imax || 160}A`, `Ducto: ${canal.acDim} EMT`], { size: 2.1, gap: 2.5, align: 'right' });
            if (j < nB - 1 || nB === 1) lineas(d, bx(xc) + 2, by(16197) + 2.2, ['1X cable UTP Cat 6', '(Protocolo Can Bus / BMS)'], { size: 2.1, gap: 2.5 });
        }
        // barraje del tablero de protecciones y recuadro punteado
        const xb0 = Math.min(6105, 6290 - 69.5 * (nB - 1) - 46), xb1 = 6316 + 73 * dSl;
        d.rect(bx(xb0), by(16227), (xb1 - xb0) * fs, 5 * fs, { w: 0.4, color: NARANJA, fill: NARANJA });
        d.rect(bx(xb0 - 62), by(16403), (6370 + 73 * dSl - (xb0 - 62)) * fs, (16403 - 16017) * fs, { color: ROJO, w: 0.4, dash: true, keepDash: true, layer: 'TABLERO' });
        d.text(bx(6259 + 73 * dSl / 2 + 54), by(16381) + 2.6, 'TABLERO PROTECCIONES', { size: 2.9, align: 'center' }); d.text(bx(6259 + 73 * dSl / 2 + 54), by(16381) + 6, 'BATERÍAS', { size: 2.9, align: 'center' });
        // breakers BAT-INVk (uno por inversor) y su salida hacia el inversor
        const brkDXF = (X, Yb) => {
            d.line(bx(X), by(Yb), bx(X), by(Yb + 26.1)); d.line(bx(X), by(Yb + 26.1), bx(X - 15.1), by(Yb + 52.5));
            d.line(bx(X - 4.7), by(Yb + 47.8), bx(X + 4.7), by(Yb + 57.2)); d.line(bx(X - 4.7), by(Yb + 57.2), bx(X + 4.7), by(Yb + 47.8));
            d.line(bx(X), by(Yb + 52.5), bx(X), by(Yb + 79));
        };
        for (let j = 0; j < N; j++) {
            const Xb = 6134 + 73 * j, inv = j === N - 1 ? 1 : j + 2;
            brkDXF(Xb, 16227);
            lineas(d, bx(Xb - 44), by(16274) + 1, ['Interruptor', 'termomagnético', `BAT-INV${inv}`, `2X${sigBreaker(1.25 * (B.imax || 160) * nB / N)}A`], { size: 2.6, gap: 3.2, align: 'center' });
            const kInv = inv - 1;
            if (j === N - 1) {                       // inversor 1: sale a la derecha y baja por su lado
                cables.push({ pts: [[bx(Xb), by(16306)], [360, by(16306)], [360, P[0].bTop]], o: { w: 0.6 } });
                marcasH(Xb + 57, 16306);
                lineas(d, 357, P[0].bTop - 44 + 10, [`1XNo. 350 kcmil 75° Cu. THHN/THWN-2 (+)`, `1XNo. 350 kcmil 75° Cu. THHN/THWN-2 (-)`, 'Imax: 300A', 'Conducto: EMT 3"', 'Distancia: 1m'], { size: 2, gap: 2.4, align: 'right' });
                d.line(360 - 2.6, P[0].bTop - 52, 360 + 2.6, P[0].bTop - 56, { color: ROJO, w: 0.3 }); d.line(360 - 2.6, P[0].bTop - 55, 360 + 2.6, P[0].bTop - 59, { color: OSC, w: 0.3 });
            } else {                                 // inversores 2..N: suben, van a la izquierda y bajan hasta su puerto
                const yT = 16414 + 16 * j, xL = 5271 - 19 * j;
                cables.push({ pts: [[bx(Xb), by(16306)], [bx(Xb), by(yT)], [bx(xL), by(yT)], [bx(xL), P[kInv].yH], [360, P[kInv].yH], [360, P[kInv].bTop]], o: { w: 0.6 } });
                marcasV(Xb, 16349);
                [`1XNo. 350 kcmil 75° Cu. (+)`, `1XNo. 350 kcmil 75° Cu. (-)`, 'Imax: 300A'].forEach((t, q) => d.text(bx(Xb) - 9 + q * 2.2, by(16292), t, { size: 1.8, rot: 90 }));
            }
        }
        for (let k = 0; k < N - 1; k++) {                     // comunicación entre inversores (cadena)
            cables.push({ pts: [[386, P[k].bBot], [386, P[k + 1].bTop]], o: AZUL_O });
        }
        d.text(390, P[0].bBot + 6, 'Comunicación', { size: 3.2 });

        // ---------- tablero AC SSFV: copiado del plano de referencia (Lorena Ocampo) ----------
        // Barraje de red arriba con un breaker "red SSFV" por inversor; barraje de carga con un breaker "load SSFV"
        // por inversor y un breaker general hacia el selector de transferencia (Estado 2 Solar); Estado 1 Red baja del
        // barraje de arriba. Los cables de cada inversor llegan por pasillos a la izquierda y entran por filas propias.
        const tf_ = 0.3, xB = 540.8, yBU = P[0].yL + 73.6;
        const tx = (X) => xB + (X - 8097) * tf_, ty = (Y) => yBU + (15482 - Y) * tf_;
        const Xg = (j) => 8252 + 85.5 * j, Xl = (i) => 8507 + 90.5 * i;
        const xRectR = Math.max(8760, Xl(N - 1) + 73), xBusUR = Math.max(8475, Xg(N - 1) + 52), xBusLR = Xl(N - 1) + 10;
        const Xm = Xl(0) + 11, XE1 = 8469, XE2 = 8518, XC = 8494;
        const xLB = tx(xRectR) + 100, wLB = 142 * tf_;
        const brk2 = (X, Yb) => {
            d.line(tx(X), ty(Yb), tx(X), ty(Yb + 26.1)); d.line(tx(X), ty(Yb + 26.1), tx(X - 15.1), ty(Yb + 52.5));
            d.line(tx(X - 4.7), ty(Yb + 47.8), tx(X + 4.7), ty(Yb + 57.2)); d.line(tx(X - 4.7), ty(Yb + 57.2), tx(X + 4.7), ty(Yb + 47.8));
            d.line(tx(X), ty(Yb + 52.5), tx(X), ty(Yb + 79));
        };
        // texto en bloque: la última línea queda con su base en Ybase; alineado al centro o a la izquierda
        const bloqueT = (X, Ybase, arr, o) => { const gp = o.gap, n = arr.length; arr.forEach((t, i) => d.text(tx(X), ty(Ybase) - (n - 1 - i) * gp, t, { size: o.size, align: o.align })); };
        // rectángulo del tablero y barrajes
        d.rect(tx(8097), ty(15558), (xRectR - 8097) * tf_, (15558 - 14890) * tf_, { color: ROJO, w: 0.5, layer: 'TABLERO' });
        d.rect(tx(8243), ty(15489), (xBusUR - 8243) * tf_, 7 * tf_, { w: 0.4, color: NARANJA, fill: NARANJA });
        d.rect(tx(8496), ty(15216), (xBusLR - 8496) * tf_, 7 * tf_, { w: 0.4, color: NARANJA, fill: NARANJA });
        bloqueT(8243, 15496, ['BARRAJE 160A - 240V', '2F - 4H'].map(t => t.replace('240V', vac + 'V').replace('2F', nF + 'F')), { size: 3.1, gap: 3.4, align: 'left' });
        bloqueT(8604, 15189, ['BARRAJE 160A - 240V', '2F - 4H'].map(t => t.replace('240V', vac + 'V').replace('2F', nF + 'F')), { size: 3.1, gap: 3.4, align: 'left' });
        bloqueT(8100, 15516, ['TABLERO AC SSFV', `BARRAJE ${nF}F`], { size: 5, gap: 5.8, align: 'left' });
        // acometida: breaker "red" sobre el barraje (la línea llega por arriba)
        const xRb2 = tx(8437);
        brk2(8437, 15489);
        bloqueT(8479, 15513 + 2, ['Interruptor', 'termomagnético', 'red', `${nF}X${brkTot}A - 10kA`], { size: 2.9, gap: 3.3, align: 'center' });
        // breakers red SSFV (cuelgan del barraje de arriba) y load SSFV (sobre el de abajo)
        for (let j = 0; j < N; j++) {
            brk2(Xg(j), 15403);
            bloqueT(Xg(j) - 56, 15423 + 4, ['Interruptor', 'termomagnético', 'red SSFV', `${nF}X${brkK(j)}A - 10kA`], { size: 2.3, gap: 3.1, align: 'center' });
        }
        for (let i = 0; i < N; i++) {
            brk2(Xl(i), 15216);
            bloqueT(Xl(i) + 52, 15247 + 4, ['Interruptor', 'termomagnético', 'load SSFV', `${nF}X${brkK(N - 1 - i)}A - 10kA`], { size: 2.6, gap: 3.1, align: 'center' });
        }
        // breaker general de carga -> Estado 2 del selector
        brk2(Xm, 15131);
        bloqueT(Xm + 56, 15159 + 4, ['Interruptor', 'termomagnético', 'load SSFV', `${nF}X${brkTot}A - 10kA`], { size: 2.6, gap: 3.1, align: 'center' });
        d.line(tx(Xm), ty(15131), tx(Xm), ty(15128));
        // selector de transferencia (misma figura del bloque del plano)
        d.rect(tx(8457), ty(15128), 73 * tf_, 90 * tf_, { w: 0.4 });
        [[XE1, 15128], [XE2, 15128], [XC, 15038]].forEach(([X, Y]) => d.circle(tx(X), ty(Y), 0.9, { fill: NEGRO }));
        d.line(tx(8476), ty(15128), tx(8476), ty(15110)); d.line(tx(XE1), ty(15110), tx(XE2), ty(15110));
        d.line(tx(XE1), ty(15110), tx(XE1), ty(15081)); d.line(tx(XE2), ty(15110), tx(XE2), ty(15081));
        d.line(tx(XC), ty(15041), tx(XC), ty(15064)); d.line(tx(XC), ty(15064), tx(8470), ty(15079));
        bloqueT(8463, 15135 + 4, ['Estado 1', 'Red'], { size: 2.6, gap: 3, align: 'right' });
        bloqueT(8554, 15133 + 4, ['Estado 2', 'Solar'], { size: 2.6, gap: 3, align: 'center' });
        bloqueT(8488, 15017 + 4, ['Estado 3', 'Común'], { size: 2.6, gap: 3, align: 'right' });
        bloqueT(8540, 15057 + 6, ['Selector de', 'transferencia', 'de 3 posiciones'], { size: 4.2, gap: 4.8, align: 'left' });
        // salida a cargas
        d.rect(xLB, ty(15052), wLB, 71 * tf_, { w: 0.5 });
        d.poly([[xLB, ty(14981)], [xLB + wLB, ty(14981)], [xLB + wLB, ty(15052)]], { closed: true, fill: NEGRO });
        d.text(xLB + wLB / 2, ty(15059) + 1, 'Tablero de distribución', { size: 3.6, align: 'center' }); d.text(xLB + wLB / 2, ty(15059) + 5.2, 'de cargas', { size: 3.6, align: 'center' });
        d.line(tx(XC), ty(15035), tx(XC), ty(15016));
        d.line(tx(XC), ty(15016), xLB, ty(15016));
        lineas(d, tx(8760) + 12, ty(15016) + 4, [`${nF}XNo.${awgAc} AWG Cu. THHN/THWN-2 (F)`, `Conducto: ${acCanal}`, `Distancia: ${dist.tableroGeneral}m`], { size: 2.6, gap: 3 });
        // barraje de tierra, electrodo y tierra del tablero de cargas
        const yPE2 = ty(15029);
        d.rect(tx(8120), yPE2 - 0.3, 95 * tf_, 0.6, { w: 0.5, color: NARANJA, fill: NARANJA });
        d.text(tx(8138), yPE2 - 1.4, 'Barraje de Tierra', { size: 2.4 }); d.text(tx(8200), yPE2 + 3.4, 'Icc >= 6kA', { size: 2.4 });
        S.tierra(d, tx(8250), yPE2 + 0.4, { w: 0.5, color: [0, 110, 0] });
        const xEl = tx(8166);
        d.line(xEl, yPE2, xEl, yPE2 + 22, VERDE_O); S.tierra(d, xEl, yPE2 + 22, { w: 1.4 }); S.cond(d, xEl, yPE2 + 9, true, { t: true });
        d.text(xEl - 3, yPE2 + 13, '1XNo. 8 AWG (T)', { size: 2.2, align: 'right' }); d.text(xEl + 9, yPE2 + 26, 'ELECTRODO DE PUESTA A TIERRA,', { size: 3.4 }); d.text(xEl + 9, yPE2 + 30.6, 'VARILLA COPPERWELD 3/8 - 2.4m', { size: 3.4 });
        cables.push({ pts: [[xLB + wLB - 8, ty(14981)], [xLB + wLB - 8, ty(14901)], [tx(8195), ty(14901)], [tx(8195), yPE2]], o: VERDE_O });
        S.cond(d, tx(9090), ty(14901), false, { t: true }); d.text(tx(9053), ty(14901) + 4.6, '1XNo. 10AWG (T)', { size: 2.6 });
        cables.push({ pts: [[534, P[0].yTierra], [534, Math.max(yPE2, P[N - 1].yTierra)]], o: VERDE_O });
        cables.push({ pts: [[534, yPE2], [tx(8120), yPE2]], o: VERDE_O });
        // Estado 1 Red: baja del barraje de arriba (salta sobre los cables que cruza)
        cables.push({ pts: [[tx(XE1), ty(15482)], [tx(XE1), ty(15131)]], o: NEGRO_O, saltaV: true });
        // cables de los inversores: de su puerto al pasillo, del pasillo a su fila y de la fila a su breaker
        const filas = [];
        for (let j = 0; j < N; j++) {
            filas.push({ port: P[j].yG, lv: ty(15403 - 22 * j), pts: [[tx(Xg(j)), ty(15403)], [tx(Xg(j)), ty(15403 - 22 * j)]], x: tx(Xg(j)) });
            const i = N - 1 - j, lvL = i === N - 1 ? ty(15744) : ty(15295 + 40 * i);
            filas.push({ port: P[j].yL, lv: lvL, pts: [[tx(Xl(i)), ty(15295)], [tx(Xl(i)), lvL]], x: tx(Xl(i)) });
        }
        const sube = filas.filter(w => w.port < w.lv).sort((a, b) => b.lv - a.lv), baja = filas.filter(w => w.port >= w.lv).sort((a, b) => a.lv - b.lv);
        [...sube, ...baja].forEach((w, q) => { w.xc = 496 + 4.5 * q; });
        filas.forEach(w => {
            const dentro = w.pts[0], fin = w.pts[1];
            cables.push({ pts: [[422.4, w.port], [w.xc, w.port], [w.xc, w.lv], [fin[0], fin[1]], [dentro[0], dentro[1]]], o: NEGRO_O });
        });

        cablesConSaltos(d, cables);

        // ---------- red (arriba a la derecha) ----------
        const dAll = -150;
        bloqueRedHibrido(D, r, ty(15568) + dAll);
        desplazar(d, dAll);
        r.it.forEach(i => d.it.push(i));
        d.it.forEach(i => {
            if (!i.o.keepDash) i.o.dash = false;
            if (i.t === 't') i.o.helv = true;
            else if (i.t !== 'i') { const w = i.o.w || 0.5; i.o.w = w >= 1.5 ? w * 0.75 : Math.max(0.22, w * 0.5); }
        });
        return d;
    }

    function desplazar(d, dy) {
        d.it.forEach(i => {
            if (i.t === 'l') { i.y1 += dy; i.y2 += dy; }
            else if (i.t === 'p') i.pts = i.pts.map(p => [p[0], p[1] + dy]);
            else i.y += dy;
        });
    }

    // módulos fotovoltaicos dibujados como cuadrícula azul (2 columnas)
    function moduloFV(d, x, y, n) {
        const mw = 14.8, mh = 8.4, cols = 2, rowsN = Math.ceil(n / cols), NAVY = [0, 0, 100];
        const cc = 8, cr = 4, pad = 0.7, cw = (mw - 2 * pad) / cc, ch = (mh - 2 * pad) / cr, cf = 0.22;
        for (let k = 0; k < n; k++) {
            const mx = x + (k % cols) * (mw + 0.8), my = y + Math.floor(k / cols) * (mh + 0.6);
            d.rect(mx, my, mw, mh, { w: 0.2, color: [150, 150, 150], fill: [255, 255, 255] });
            for (let r = 0; r < cr; r++) for (let c = 0; c < cc; c++) {
                const px = mx + pad + c * cw + 0.1, py = my + pad + r * ch + 0.1, w = cw - 0.2, h = ch - 0.2;
                d.poly([[px + cf, py], [px + w - cf, py], [px + w, py + cf], [px + w, py + h - cf], [px + w - cf, py + h], [px + cf, py + h], [px, py + h - cf], [px, py + cf]], { closed: true, fill: NAVY, color: NAVY, w: 0.05 });
            }
        }
        return rowsN * (mh + 0.6);
    }

    // ------------------------------------------------------------
    // Hoja A3 de los híbridos: título, diagrama, convenciones, rótulo, logo y firmas
    // ------------------------------------------------------------
    function hojaA3(d, D) {
        const fs = D._fs || 1;
        const A3 = { w: 420 * fs, h: 297 * fs };
        const e = new Dib(); e.hoja = A3;
        const T = ajuste(d, { x: 10 * fs, y: 20 * fs, w: 400 * fs, h: 176 * fs });
        const dg = aplicar(d, T).it;
        const M = { marco: true };
        const L = (x1, y1, x2, y2, w) => e.line(x1, y1, x2, y2, { w: w || 0.4, marco: true, layer: 'MARCO' });
        const R = (x, y, w, h, ww) => e.rect(x, y, w, h, { w: ww || 0.4, marco: true, layer: 'MARCO' });
        const Tx = (x, y, s, sz, o) => e.text(x, y, s, Object.assign({ size: sz, marco: true, layer: 'TEXTO', helv: true }, o || {}));
        R(5, 5, 410, 287, 0.6);
        L(5, 17, 415, 17, 0.4);
        Tx(210, 12.4, `DIAGRAMA UNIFILAR SISTEMA SOLAR FOTOVOLTAICO - PROYECTO ${D.nombre}`, 5, { align: 'center' });

        // cuadro de convenciones (vectorial, ya extraído)
        const yB = 200;
        const CV = window.UNIFILAR_CONVENCIONES;
        if (CV) {
            const s = Math.min(256 / CV.w, 88 / CV.h), ox = 8, oy = yB;
            const px = (x) => ox + x * s, py = (y) => oy + y * s;
            CV.dib.forEach(i => {
                const o = { w: Math.max((i.w || i.lw || 0.2) * s, 0.15), color: i.s || undefined, marco: true, layer: 'SIMBOLOS' };
                if (i.t === 'r') { e.rect(px(i.x), py(i.y), i.w * s, i.h * s, Object.assign(o, { w: Math.max((i.lw || 0.2) * s, 0.15), fill: i.f || undefined })); }
                else {
                    const pts = i.pts.map(p => [px(p[0]), py(p[1])]);
                    if (i.f && i.c) e.poly(pts, Object.assign(o, { closed: true, fill: i.f }));
                    else e.poly(pts, Object.assign(o, { closed: !!i.c }));
                }
            });
            CV.txt.forEach(t => e.text(px(t.x), py(t.y), t.s, { size: Math.max(t.sz * s, 1.2), marco: true, layer: 'TEXTO', bold: t.b, helv: true }));
        }

        // rótulo (datos del proyecto, empresa promotora y firmas)
        const wrap = (arr, max) => {
            const out = [];
            (arr || []).forEach(t => { let cur = ''; String(t).split(' ').forEach(w => { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = '  ' + w; } else cur = (cur ? cur + ' ' : '') + w; }); if (cur) out.push(cur); });
            return out;
        };
        const rx = 267, ry = yB, wL = 98, cw = 50, alto = 90;
        R(rx, ry, wL, alto); R(rx + wL, ry, cw, alto);
        [8, 15.5, 25.5, 58, 74].forEach(y => L(rx, ry + y, rx + wL, ry + y));
        Tx(rx + 1.5, ry + 5.5, `PROYECTO ${D.nombre}`, 3.6);
        Tx(rx + 1.5, ry + 12.2, `Tipo de sistema fotovoltaico: ${D.tipoSistemaTxt || 'Híbrido'}`, 3.0);
        Tx(rx + 1.5, ry + 19.2, 'POTENCIA NOMINAL INSTALADA:', 3.0); Tx(rx + 1.5, ry + 23.4, `${D.potAC}kW.`, 3.0);
        Tx(rx + 1.5, ry + 29.6, 'DESCRIPCIÓN DE LA INSTALACIÓN:', 3.0);
        wrap(D.descripcion, 58).slice(0, 7).forEach((t, k) => Tx(rx + 1.5, ry + 34 + k * 3.5, t, 2.8));
        Tx(rx + 1.5, ry + 62, 'DIRECCIÓN:', 3.0);
        wrap([D.direccion || ''], 62).slice(0, 2).forEach((t, k) => Tx(rx + 1.5, ry + 66 + k * 3.6, t, 2.9));
        Tx(rx + 1.5, ry + 71.8, `CIUDAD/MUNICIPIO: ${String(D.municipio || '').toUpperCase()}`, 2.9);
        Tx(rx + 1.5, ry + 78, 'UBICACIÓN GEOGRÁFICA:', 3.0); Tx(rx + 1.5, ry + 82.4, `Latitud: ${D.lat || ''}`, 2.9); Tx(rx + 1.5, ry + 86.4, `Longitud: ${D.lng || ''}`, 2.9);
        const cx = rx + wL;
        [24, 57].forEach(y => L(cx, ry + y, cx + cw, ry + y));
        Tx(cx + cw / 2, ry + 5, 'EMPRESA PROMOTORA', 2.8, { align: 'center' });
        if (D.logo) { const lw = cw - 8, lh = lw * D.logo.h / D.logo.w; e.img(cx + 4, ry + 14 - lh / 2 + 3, lw, lh, D.logo.data, D.logo.fmt, 'LOGO'); }
        const F = D.firmas || {};
        const firma = (y0, titulo, f, nombre, mp) => {
            Tx(cx + cw / 2, ry + y0 + 4, titulo, 2.3, { align: 'center' });
            if (f) e.img(cx + 5, ry + y0 + 6, cw - 10, Math.min((cw - 10) * f.h / f.w, 16), f.data, f.fmt, 'FIRMA');
            Tx(cx + cw / 2, ry + y0 + 25, nombre, 1.9, { align: 'center' }); Tx(cx + cw / 2, ry + y0 + 28.5, mp, 1.9, { align: 'center' });
        };
        firma(24, 'FIRMA DEL INGENIERO CONSTRUCTOR', F.cons, F.consNombre || 'ING. OSCAR ANDRES GODOY RODRIGUEZ', F.consMp ? (/^M\.?P/i.test(F.consMp) ? F.consMp : `M.P. No.${F.consMp}`) : '');
        firma(57, 'FIRMA DEL INGENIERO DISEÑADOR', F.dis, F.disNombre || '', F.disMp ? (/MATR|^M\.?P/i.test(F.disMp) ? F.disMp : `MATRICULA PROF.: ${F.disMp}`) : '');
        if (fs !== 1) escalarItems(e.it, fs);
        e.it = dg.concat(e.it);
        return e;
    }

    // ------------------------------------------------------------
    // API
    // ------------------------------------------------------------
    function dibujar(D, area) {
        if (D.inversor && D.inversor.tipoSistema === 'hibrido') {
            const n = D.inversores.length;
            return hojaA3(n > 1 ? construirHibridoMulti(D) : construirHibrido(D), Object.assign({}, D, { _fs: n >= 3 ? Math.SQRT2 : 1 }));
        }
        const d = construir(D);
        const T = ajuste(d, area || { x: 28, y: 34, w: 946, h: 656 });
        const e = aplicar(d, T);
        marco(e, `DIAGRAMA UNIFILAR SISTEMA SOLAR FOTOVOLTAICO ${D.nombre} ${D.potDC} kWp - ${D.potAC} kW`);
        return e;
    }
    function generar(D) {
        const e = dibujar(D);
        const doc = toPDF(e);
        return { pdf: doc.output('blob'), dxf: toDXF(e), dibujo: e };
    }

    root.Unifilar = { construir, construirHibrido, construirHibridoMulti, dibujar, generar, toPDF, toDXF, Dib };
})(typeof window !== 'undefined' ? window : globalThis);
