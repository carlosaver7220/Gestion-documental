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
        const t = [[[0, 0, 0], 7], [[255, 0, 0], 1], [[0, 0, 255], 5], [[0, 170, 0], 3], [[217, 140, 50], 30], [[90, 90, 90], 8], [[140, 60, 190], 6], [[0, 150, 160], 4]];
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
            d.poly([[x - 2.2, y + 3.6], [x + 2.2, y + 3.6], [x, y]], { closed: true, w: 0.5 });
        }
    };

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
            else if (i.t === 'r') doc.rect(i.x, i.y, i.w, i.h, o.fill ? 'F' : 'S');
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
                if (i.o.fill) solido(i, [[i.x, i.y], [i.x + i.w, i.y], [i.x, i.y + i.h], [i.x + i.w, i.y + i.h]]);
                else poli([[i.x, i.y], [i.x + i.w, i.y], [i.x + i.w, i.y + i.h], [i.x, i.y + i.h]], true, i);
            }
            else if (i.t === 'c') {
                if (i.o.fill) solido(i, [[i.x - i.r, i.y], [i.x, i.y - i.r], [i.x, i.y + i.r], [i.x + i.r, i.y]]);
                else { ent('CIRCLE', i, 'SIMBOLOS', 'AcDbCircle'); g(10, X(i.x)); g(20, Y(i.y)); g(30, 0); g(40, i.r.toFixed(3)); }
            }
            else if (i.t === 'p') {
                if (i.o.fill && i.pts.length === 3) solido(i, [i.pts[0], i.pts[1], i.pts[2], i.pts[2]]);
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
        const SP = 59.8;

        // ---------- strings, caja de paso e inversor ----------
        const rows = [];
        inv.strings.forEach(s => { for (let k = 0; k < s.paralelos; k++) rows.push({ mppt: s.mppt, series: s.series, largo: s.longitud }); });
        rows.forEach((r, k) => { r.y = 360.8 + SP * k; });
        const yFirst = rows[0].y, yLast = rows[rows.length - 1].y, nStr = rows.length;
        rows.forEach((r, k) => {
            const col = COLOR_STRING[k % COLOR_STRING.length], y = r.y;
            d.text(31.8, y - 8, `STRING ${k + 1} - ${r.series} MODULOS ${P.pmax}W`, { size: 4.2, color: col });
            const hMod = moduloFV(d, 31.9, y - 7.4, r.series);
            lineas(d, 31.8, y - 7.4 + hMod + 4.2, [`I1M${r.mppt}S${k + 1}`, 'STC: 1000W/m2 25°C, AM1.5', `Voc: ${(r.series * P.voc).toFixed(2)}V`, `Isc: ${P.isc}A`, `Vmp: ${(r.series * P.vmpp).toFixed(2)}V`, `Imp: ${P.imp}A`, `Distancia:${r.largo}m`], { size: 3.4, gap: 4.1 });
            d.line(62.7, y, 170.9, y);
            lineas(d, 65, y + 4.6, ['Cable Fotovoltaico', `2x#${C.cablePV.match(/(\d+)mm/)[1]}mm²/XLPE`], { size: 3.3, gap: 3.9 });
            S.cuadrado(d, 170.9, y, 3); S.cuadrado(d, 206.5, y, 3);
            d.rect(176.6, y - 7.9, 21.4, 16.6, { w: 0.4 }); S.fusible(d, 180, y - 3.2, 14.6, 6.4);
            d.text(175.9, y + 12.6, '2XFUSIBLE 20A', { size: 3.3 });
            d.line(206.5, y, 312.5, y);
            lineas(d, 247.7, y + 4.6, [`2x#${C.cablePV.match(/(\d+)mm/)[1]}mm²/XLPE`, `Imax: ${P.isc * 1.0}A`, `Conducto: ${dcCanal}`, `Distancia: ${dist.cajaInversor}m`], { size: 3.3, gap: 3.9 });
            S.cuadrado(d, 312.5, y, 3);
        });
        [[102.4, 87.5], [221.5, 206.6]].forEach(([xr, xl]) => {
            d.rect(xr, yFirst - 3.5, 4.4, yLast - yFirst + 33.9, { w: 0.6 });
            S.flecha(d, xr + 2.2, yLast + 31.2);
            d.text(xl, yLast + 39.2, `Tubería metálica ${dcCanal}`, { size: 3.3 });
        });
        const cTop = yFirst - 22.2, cBot = yLast + 27.7;
        d.rect(170.9, cTop, 35.6, cBot - cTop, { w: 0.9 });
        d.text(157.9, cTop - 9.5, 'CAJA DE PASO FV-INVERSOR', { size: 4.2 }); d.text(161, cTop - 4.8, `${nStr * 2} FUSIBLES 20A-1000VDC`, { size: 4.2 });
        S.cuadrado(d, 170.9, cTop + 4.5, 3);
        d.circle(174.5, yLast + 21, 1.2, { fill: NEGRO }); S.tierraCirculo(d, 177.4, yLast + 21);
        const bTop = yFirst - 13, bBot = yLast + 76.6;
        d.rect(312.5, bTop, 109.9, bBot - bTop, { w: 0.9 });
        d.text(312.2, bTop - 1.7, 'INVERSOR', { size: 4.2 });
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
        const yGrid = bTop + 16.5, yLoad = bTop + 30;
        [['GRID', yGrid], ['LOAD', yLoad]].forEach(([t, y]) => { d.rect(418.5, y - 6, 7.5, 12, { w: 0.4 }); d.text(423.4, y + 3.2, t, { size: 3, rot: 90 }); });
        const refTxt = /srne/i.test(I.fabricante) ? I.modelo : `${I.fabricante}/${I.modelo}`;
        lineas(d, 350, bTop + 15.5, [`REF:${refTxt}`, `Potencia Max: ${I.pAC}W`, `Imax:${I.iSalida}A`, `Conexión: ${nF}L+PE`, `Vac:${vac}V`], { size: 4.2, gap: 4.7 });
        // cables AC del inversor (LOAD y GRID)
        const etAc = (x, y) => lineas(d, x, y, [`${nF}XNo.${awgAc} AWG 60° Cu. THHN/THWN-2 (F)`, `1XNo.${awgAc} AWG 60° Cu. THHN/THWN-2 (N)`, `Imax: ${I.iSalida}A`, `Vac: ${vac}V`, `Conducto: ${acCanal}`, `Distancia: ${dist.invTablero}m`], { size: 3.1, gap: 3.5 });
        etAc(431, yGrid - 24); etAc(431, yLoad + 6);
        S.marcas(d, 470, yGrid - 3.1, 2, false); S.marcas(d, 470, yLoad - 3.1, 2, false);
        // tierra del inversor
        d.circle(326, yLast + 56, 1.2, { fill: NEGRO }); S.tierraCirculo(d, 326, yLast + 59.6);
        const yG = yLast + 61.2;
        d.line(326, yLast + 59.6 + 1.9, 326, yG, { color: VERDE, layer: 'TIERRA' });
        d.line(170.9, cTop + 4.5, 27.5, cTop + 4.5, { color: VERDE, layer: 'TIERRA', dash: true });
        d.line(27.5, cTop + 4.5, 27.5, yG, { color: VERDE, layer: 'TIERRA', dash: true });
        d.line(27.5, yG, 530, yG, { color: VERDE, layer: 'TIERRA', dash: true });
        d.text(121.8, cTop + 10.6, '1XNo. 10AWG (T)', { size: 3.3 }); d.text(126.4, yG + 4, '1XNo. 10AWG (T)', { size: 3.3 }); d.text(430, yG + 4, '1XNo. 10AWG (T)', { size: 3.3 });

        // ---------- batería ----------
        const bx0 = 322, bx1 = 420, by0 = 262, by1 = 322;
        d.rect(bx0, by0, bx1 - bx0, by1 - by0, { w: 0.8 });
        const nBat = B.cantidad > 1 ? `${B.cantidad} x ` : '';
        d.text((bx0 + bx1) / 2, by0 + 6.5, `BATERIA ${String(B.marca || '').toUpperCase()}`.trim(), { size: 4.2, align: 'center' });
        d.text((bx0 + bx1) / 2, by0 + 11.7, `${nBat}${B.kwh ? B.kwh + 'KWH - ' : ''}${B.ah ? B.ah + 'AH - ' : ''}${String(B.modelo || '').toUpperCase()}`.replace(/ - $/, ''), { size: 4.2, align: 'center' });
        const yb = (by0 + by1) / 2 + 6;   // símbolo de batería
        d.line(bx0 + 14, yb, 366, yb, { w: 0.8 }); d.line(366, yb - 9, 366, yb + 9, { w: 0.9 }); d.line(371, yb - 5.5, 371, yb + 5.5, { w: 1.5 }); d.line(371, yb, bx1 - 14, yb, { w: 0.8 });
        d.text(bx0 + 8, yb - 2, '+', { size: 5.5 }); d.text(bx1 - 11, yb - 2, '-', { size: 5.5 });
        d.line(360, by1, 360, bTop, { w: 1.2 });
        d.line(386, by1, 386, bTop, { color: AZUL, w: 0.75, layer: 'COMUNICACION' });
        lineas(d, 270, by1 + 9, [`Cable rojo ${B.cableMm2 || 50} mm² (+),`, `Cable negro ${B.cableMm2 || 50} mm² (-)`, `Distancia: ${B.distancia || 0.8}m`, `Imax: ${B.imax || 160}A`], { size: 3.5, gap: 4.1 });
        d.text(392, by1 + 12, 'Comunicación', { size: 3.4 }); d.line(391, by1 + 13.4, 421, by1 + 13.4, { color: [56, 80, 158], w: 0.5 });
        d.text(396, by1 + 24, '1XNo. 10AWG (T)', { size: 3.1 });

        // ---------- red (arriba a la derecha): compacta para que el diagrama llene la hoja ----------
        const xR = 642.8;
        (function (d) {
            d.text(xR, 14, 'Red Eléctrica del', { size: 4.2, align: 'center' }); d.text(xR, 18.6, `Operador de Red ${D.operador || ''}`.trim(), { size: 4.2, align: 'center' });
            d.poly([[xR - 6.6, 22], [xR + 6.7, 22], [xR + 0.1, 32]], { closed: true, w: 0.6 });
            for (let k = -5; k <= 5; k += 2.4) d.line(xR + k * 0.9, 22.2, xR + k * 0.45, 29, { w: 0.25 });
            d.line(xR, 32, xR, 44.8);
            d.circle(xR + 0.2, 53, 8.2); d.circle(xR + 0.2, 62.6, 8.2);
            const t1 = [`Transformador ${tf.fases == 3 ? 'Trifásico' : 'Monofásico'}`, `Relación: ${tf.tensionPrim || ''}/${tf.tensionSec || ''}`, `Potencia: ${tf.kva || ''}kVA`, `Código: ${tf.codigo || ''}`, tf.matricula ? `Matrícula: ${tf.matricula}` : '', D.nic ? `Cuenta: ${D.nic}` : ''].filter(Boolean);
            t1.forEach((t, k) => d.text(xR - 12, 50 + k * 4.7, t, { size: 4.2, align: 'right' }));
            d.line(xR + 8.6, 57, xR + 30.6, 57, { color: VERDE, layer: 'TIERRA', dash: true });
            S.tierra(d, xR + 30.6, 57, { w: 0.6 }); d.text(xR + 36, 60.5, 'Puesta a tierra poste', { size: 3.7 }); d.text(xR + 36, 64.9, 'y transformador', { size: 3.7 });
            d.line(xR, 70.8, xR, 84);
            S.marcas(d, xR - 2.8, 74.6, 2, false);
            lineas(d, xR + 8.6, 76.2, [`2XNo.${awgAco} AWG Cu. THHN/THWN-2 (F)`, `1XNo.${awgAco} AWG Cu. THHN/THWN-2 (N)`], { size: 3.3, gap: 3.8 });
            d.rect(xR - 11.4, 84, 22.7, 20, { w: 0.75 }); d.rect(xR - 6.4, 86.5, 12.8, 4, { w: 0.4 }); d.text(xR, 99, 'kW/h', { size: 4.6, align: 'center' });
            d.rect(xR - 105.5, 80, 82.4, 42.7, { w: 0.6, color: NARANJA });
            lineas(d, xR - 104.2, 87.4, ['EQUIPO DE MEDIDA DIRECTA', 'SE REEMPLAZA POR MEDIDOR', 'BIDIRECCIONAL CALIBRADO Y', 'HOMOLOGADO POR OPERADOR DE', 'RED Y COMERCIALIZADOR DE', 'ENERGIA'], { size: 4.9, gap: 6.7 });
            d.line(xR, 104, xR, 142);
            S.marcas(d, xR - 2.8, 112.4, 2, false);
            lineas(d, xR + 8.6, 114, [`2XNo.${awgAco} AWG Cu. THHN/THWN-2 (F)`, `1XNo.${awgAco} AWG Cu. THHN/THWN-2 (N)`], { size: 3.3, gap: 3.8 });
        })(r);

        // ---------- tablero AC SSFV ----------
        const yBus = 322, xB1 = 540, xB3 = 555, xB2 = 575;
        d.rect(511.9, 285, 195, 188, { color: ROJO, w: 0.5, dash: true, layer: 'TABLERO' });
        S.breaker(d, xR, 292);
        lineas(d, xR + 4.5, 296, ['Interruptor', 'termomagnético', 'red', `${nF}X${brk}A - 10kA`], { size: 3.2, gap: 3.6 });
        d.line(xR, 303, xR, yBus);
        d.line(528, yBus, 668, yBus, { w: 2.2, color: NARANJA });
        d.text(528, yBus - 3, `BARRAJE 160A - ${vac}V`, { size: 4 }); d.text(528, yBus - 7.2, `${nF}F - 4H`, { size: 4 });
        // red SSFV (GRID del inversor)
        d.line(xB1, yBus, xB1, yBus + 4); S.breaker(d, xB1, yBus + 4); d.line(xB1, yBus + 15, xB1, yGrid);
        d.line(xB1, yGrid, 425.5, yGrid);
        lineas(d, xB1 - 28, yBus + 12, ['Interruptor', 'termomagnético', 'red SSFV', `${nF}X${brk}A - 10kA`], { size: 3.1, gap: 3.5 });
        // load SSFV (LOAD del inversor)
        d.line(425.5, yLoad, xB3, yLoad); d.line(xB3, yLoad, xB3, yLoad + 3); S.breaker(d, xB3, yLoad + 3); d.line(xB3, yLoad + 14, xB3, 395);
        lineas(d, xB3 + 3.5, yLoad + 6, ['Interruptor', 'termomagnético', 'load SSFV', `${nF}X${brk}A - 10kA`], { size: 3.1, gap: 3.5 });
        // red directa al selector
        d.line(xB2, yBus, xB2, 395);
        // selector de transferencia de 3 posiciones
        d.rect(540, 395, 58, 30, { w: 0.4 });
        S.cuadrado(d, xB3, 395, 2.4); S.cuadrado(d, xB2, 395, 2.4); S.cuadrado(d, 566, 425, 2.4);
        d.text(xB3 - 2.8, 402, 'Estado 2', { size: 3, align: 'right' }); d.text(xB3 - 2.8, 405.5, 'Solar', { size: 3, align: 'right' });
        d.text(xB2 + 2.8, 402, 'Estado 1', { size: 3 }); d.text(xB2 + 2.8, 405.5, 'Red', { size: 3 });
        d.text(563, 431, 'Estado 3', { size: 3, align: 'right' }); d.text(563, 434.4, 'Común', { size: 3, align: 'right' });
        d.line(xB3, 395, xB3, 407); d.line(xB2, 395, xB2, 410);
        d.line(566, 425, 566, 416); d.line(566, 416, xB3 + 0.6, 408.4);
        lineas(d, 602, 410, ['Selector de', 'transferencia', 'de 3 posiciones'], { size: 4, gap: 4.6 });
        // salida a cargas
        const xG = 745;
        d.line(566, 425, 566, 446); d.line(566, 446, xG, 446);
        d.rect(xG, 431, 30, 30, { w: 1.2 }); d.poly([[xG, 461], [xG + 30, 431], [xG + 30, 461]], { closed: true, fill: NEGRO });
        d.text(xG + 15, 466, 'Tablero de distribución', { size: 3.4, align: 'center' }); d.text(xG + 15, 470, 'de cargas', { size: 3.4, align: 'center' });
        lineas(d, 640, 450, [`${nF}XNo.${awgAc} AWG Cu. THHN/THWN-2 (F)`, `Conducto: ${acCanal}`, `Distancia: ${dist.tableroGeneral}m`], { size: 3.1, gap: 3.5 });
        // barraje de tierra y electrodo
        const yPE = 458;
        d.line(528, yPE, 600, yPE, { w: 1.6, color: NARANJA }); d.text(530, yPE - 2, 'Barraje de Tierra', { size: 2.8 }); d.text(580, yPE - 2, 'Icc >= 6kA', { size: 2.8 });
        d.line(530, yG, 530, yPE, { color: VERDE, layer: 'TIERRA', dash: true });
        d.line(565, yPE, 565, 490, { color: VERDE, layer: 'TIERRA', dash: true }); S.tierra(d, 565, 490, { w: 1.6 });
        d.text(574, 476, '1XNo. 8 AWG (T)', { size: 3.1 }); d.text(578, 494, 'ELECTRODO DE PUESTA A TIERRA,', { size: 4 }); d.text(578, 499, 'VARILLA COPPERWELD 3/8 - 2.4m', { size: 4 });
        d.text(640, 466, 'TABLERO AC SSFV', { size: 4.2 }); d.text(640, 470.5, `BARRAJE ${nF}F`, { size: 4.2 });
        desplazar(d, -150);
        r.it.forEach(i => d.it.push(i));
        d.it.forEach(i => {
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
        const cw = 9.6, ch = 5.2, cols = 3, rowsN = Math.ceil(n / cols);
        for (let k = 0; k < n; k++) {
            const cx = x + (k % cols) * (cw + 0.6), cy = y + Math.floor(k / cols) * (ch + 0.6);
            d.rect(cx, cy, cw, ch, { fill: [20, 30, 120], w: 0.2 });
            d.line(cx + cw / 2, cy, cx + cw / 2, cy + ch, { color: [150, 160, 220], w: 0.2 });
            d.line(cx, cy + ch / 2, cx + cw, cy + ch / 2, { color: [150, 160, 220], w: 0.2 });
        }
        return rowsN * (ch + 0.6);
    }

    // ------------------------------------------------------------
    // Hoja A3 de los híbridos: título, diagrama, convenciones, rótulo, logo y firmas
    // ------------------------------------------------------------
    function hojaA3(d, D) {
        const A3 = { w: 420, h: 297 };
        const e = new Dib(); e.hoja = A3;
        const T = ajuste(d, { x: 10, y: 20, w: 400, h: 176 });
        aplicar(d, T).it.forEach(i => e.it.push(i));
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
        return e;
    }

    // ------------------------------------------------------------
    // API
    // ------------------------------------------------------------
    function dibujar(D, area) {
        if (D.inversor && D.inversor.tipoSistema === 'hibrido') return hojaA3(construirHibrido(D), D);
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

    root.Unifilar = { construir, construirHibrido, dibujar, generar, toPDF, toDXF, Dib };
})(typeof window !== 'undefined' ? window : globalThis);
