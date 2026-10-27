/* ============================================================
 * memoria-calc.js — Cálculos de la Memoria de Cálculo (sistemas on-grid)
 *
 * Reproduce las tablas que antes se pegaban como captura de un Excel:
 * distribución de strings, pérdidas, ocupación de canalizaciones y
 * regulación DC/AC. Son funciones puras (sin DOM) para poder probarlas.
 *
 * Expone window.MemoriaCalc (y module.exports en Node).
 * ============================================================ */
(function (root) {
    'use strict';

    // Conductores de cobre (THHW/THHN). r = resistencia Ω/km, amp = ampacidad a 75 °C
    // (NEC 310.15(B)(16)), area = sección total con aislamiento en mm² (NEC cap. 9 tabla 5).
    const AWG = [
        { n: '14 AWG', r: 8.286, amp: 20, area: 8.97 },
        { n: '12 AWG', r: 5.211, amp: 25, area: 11.68 },
        { n: '10 AWG', r: 3.277, amp: 35, area: 15.90 },
        { n: '8 AWG', r: 2.55, amp: 50, area: 28.27 },
        { n: '6 AWG', r: 1.608, amp: 65, area: 46.84 },
        { n: '4 AWG', r: 1.01, amp: 85, area: 62.77 },
        { n: '3 AWG', r: 0.802, amp: 100, area: 73.16 },
        { n: '2 AWG', r: 0.634, amp: 115, area: 86.0 },
        { n: '1 AWG', r: 0.505, amp: 130, area: 122.6 },
        { n: '1/0 AWG', r: 0.399, amp: 150, area: 143.4 },
        { n: '2/0 AWG', r: 0.317, amp: 175, area: 168.1 },
        { n: '3/0 AWG', r: 0.2512, amp: 200, area: 197.4 },
        { n: '4/0 AWG', r: 0.1997, amp: 230, area: 232.9 }
    ];

    // Cable fotovoltaico flexible (sección en mm²): resistencia Ω/km y área por conductor.
    const CABLE_PV = {
        4: { r: 5.3, area: 24.63, nombre: 'CABLE PV 4mm2 Cu(FLEX) XLPE SR 600 VAC-1.8 kVDC 90°C PVC' },
        6: { r: 3.4, area: 31.17, nombre: 'CABLE PV 6mm2 Cu(FLEX) XLPE SR 600 VAC-1.8 kVDC 90°C PVC' }
    };

    // Área interior (mm², 100 %) de tubería EMT / IMC por diámetro comercial.
    const TUBERIA = {
        EMT: [['1/2"', 196], ['3/4"', 343], ['1"', 557], ['1 1/4"', 968], ['1 1/2"', 1314], ['2"', 2165], ['2 1/2"', 3783], ['3"', 5800]],
        IMC: [['1/2"', 205], ['3/4"', 351], ['1"', 555], ['1 1/4"', 960], ['1 1/2"', 1300], ['2"', 2150], ['2 1/2"', 3020], ['3"', 4800]]
    };
    const OCUPACION_MAX = 40; // % máximo con 3 o más conductores (NEC cap. 9 tabla 1)

    const BREAKERS = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
    const FUSIBLES = [10, 12, 15, 20, 25, 30];

    const HORAS_SOL = 5;       // horas pico por día usadas para la energía perdida
    const DIAS_MES = 30;
    const COP_KWH_DC = 990;    // valor del kWh para pérdidas DC (COP)
    const COP_KWH_AC = 827;    // valor del kWh para pérdidas AC (COP)

    const r2 = (n) => Math.round(n * 100) / 100;
    const r1 = (n) => Math.round(n * 10) / 10;

    function awgPorCorriente(i, minimo) {
        const min = minimo ? AWG.findIndex(a => a.n === minimo) : 0;
        for (let k = Math.max(0, min); k < AWG.length; k++) if (AWG[k].amp >= i) return AWG[k];
        return AWG[AWG.length - 1];
    }
    // Conductor de puesta a tierra de equipos según el interruptor (NEC 250.122).
    function tierraPorBreaker(a) {
        const t = [[15, '14 AWG'], [20, '12 AWG'], [60, '10 AWG'], [100, '8 AWG'], [200, '6 AWG']];
        const f = t.find(x => a <= x[0]);
        return AWG.find(x => x.n === (f ? f[1] : '4 AWG'));
    }
    function breakerComercial(i) { return BREAKERS.find(b => b >= i) || Math.ceil(i / 25) * 25; }

    // Tubería más pequeña (mínimo 1") en la que el cableado ocupa <= 40 %.
    function elegirTuberia(tipo, areaCables) {
        const lista = TUBERIA[tipo];
        const minIdx = lista.findIndex(t => t[0] === '1"');
        for (let k = minIdx; k < lista.length; k++) {
            if (areaCables / lista[k][1] * 100 <= OCUPACION_MAX) return { dim: lista[k][0], area: lista[k][1] };
        }
        const u = lista[lista.length - 1];
        return { dim: u[0], area: u[1] };
    }

    /**
     * datos = {
     *   panel:  { pmax, vmpp, imp, voc, isc, coefVoc(negativo, %/°C), dim:[mm,mm,mm] },
     *   inversor: { modelo, pAC(W), iEntMppt, iscMppt, vdcMax, vmpptMin, vmpptMax, iSalida, vNom, fases, interruptor },
     *   inversores: [ { strings:[{ mppt, paralelos, series, longitud }], longitudAC } ],
     *   tmin (°C, default 15), cablePV (4 o 6), cos (factor de potencia, default 0.9)
     * }
     */
    function calcular(datos) {
        const P = datos.panel, I = datos.inversor;
        const tmin = datos.tmin != null ? datos.tmin : 15;
        const cablePV = CABLE_PV[datos.cablePV || 4];
        const fp = datos.fp || 0.9;
        const factorT = 1 + Math.abs(P.coefVoc) / 100 * (25 - tmin);   // Voc a Tmin = Voc·(1 + |coef|·(25 − Tmin))
        const imaxCFV = 1.25 * P.isc;               // 690.8(A)(1)
        const iConductor = 1.25 * imaxCFV;          // 690.8(B)(1)
        const fusible = FUSIBLES.find(f => f >= iConductor) || Math.ceil(iConductor);
        const areaPanel = (P.dim[0] * P.dim[1]) / 1e6;

        let totalMod = 0, totalWp = 0;
        const distribucion = [], perdDC = [], regDC = [], perdAC = [], regAC = [], ocupacion = [];
        const todosStrings = [];

        datos.inversores.forEach((inv, ii) => {
            const nInv = ii + 1;
            const filas = [];
            let modInv = 0, wpInv = 0;
            inv.strings.forEach((s) => {
                const paneles = s.paralelos * s.series;
                const wp = paneles * P.pmax;
                modInv += paneles; wpInv += wp;
                filas.push({
                    mppt: 'MPPT ' + s.mppt, paralelos: s.paralelos, series: s.series, paneles, wp,
                    pctTotal: 0, ratio: wp / I.pAC,
                    vocT: s.series * P.voc * factorT,
                    okVoc: s.series * P.voc * factorT <= I.vdcMax,
                    okVmp: s.series * P.vmpp >= I.vmpptMin && s.series * P.vmpp <= I.vmpptMax,
                    okIsc: P.isc * s.paralelos <= I.iscMppt && P.imp * s.paralelos <= I.iEntMppt,
                    vmpp: P.vmpp
                });
            });
            filas.forEach(f => { f.pctTotal = f.wp / wpInv; });
            distribucion.push({ inversor: nInv, filas, totalPaneles: modInv, totalWp: wpInv, ratioTotal: wpInv / I.pAC });
            totalMod += modInv; totalWp += wpInv;

            // --- Pérdidas y regulación DC (por string)
            inv.strings.forEach((s, k) => {
                for (let p = 1; p <= s.paralelos; p++) {
                    const id = `${nInv}.${s.mppt}.${p}`;
                    const L = s.longitud;
                    const perd = Math.pow(P.imp, 2) * cablePV.r / 1000 * L * 2;
                    const kwh = perd * HORAS_SOL * DIAS_MES / 1000;
                    perdDC.push({ inversor: nInv, string: id, longitud: L, corriente: P.imp, modulos: s.series, vmpp: P.vmpp,
                        vString: r1(s.series * P.vmpp), calibre: cablePV.nombre, r: cablePV.r, perdidas: r2(perd), kwh: r2(kwh), cop: Math.round(kwh * COP_KWH_DC) });
                    const dv = 2 * L * imaxCFV * cablePV.r / 1000;
                    const vocS = s.series * P.voc;
                    regDC.push({ inversor: nInv, string: id, entrada: 'PV' + s.mppt, longitud: L, modulos: s.series,
                        iscx: r1(imaxCFV), voc: r1(vocS), dv: r2(dv), reg: r2(dv / vocS * 100), calibre: cablePV.nombre.replace(' XLPE SR 600 VAC-1.8 kVDC 90°C PVC', ' XLPE SR 600 VAC-1.8 kVDC 90°C PVC') });
                    todosStrings.push(id);
                }
            });

            // --- AC por inversor
            const iAC = I.iSalida;
            const cond = awgPorCorriente(1.25 * iAC, '10 AWG');
            const brk = Math.max(breakerComercial(1.25 * iAC), I.interruptor || 0);
            const tierra = tierraPorBreaker(brk);
            const nF = I.fases || 2;
            const LAC = inv.longitudAC;
            const perdAc = Math.pow(iAC, 2) * cond.r / 1000 * LAC * nF;
            const kwhAc = perdAc * HORAS_SOL * DIAS_MES / 1000;
            perdAC.push({ inversor: nInv, modelo: I.modelo, longitud: LAC, corriente: iAC, voltaje: I.vNom, calibre: cond.n + ' THHW CT Cu',
                z: cond.r, perdidas: r2(perdAc), kwh: r2(kwhAc), cop: Math.round(kwhAc * COP_KWH_AC) });
            const dvAC = nF * iAC * LAC * cond.r / 1000;
            regAC.push({ inversor: nInv, modelo: I.modelo, potencia: I.pAC / 1000, conexion: nF === 2 ? 'Bifásica' : nF === 1 ? 'Monofásica' : 'Trifásica',
                corriente: iAC, corriente125: r2(1.25 * iAC), proteccion: brk, fases: nF, neutro: 1, tierra: 1,
                conductor: cond.n + ' THHW CT Cu', tierraCond: tierra.n + ' THHW CT Cu', amp: cond.amp, fp, longitud: LAC,
                caida: r2(dvAC), reg: r2(dvAC / I.vNom * 100) });

            // --- Ocupación de canalizaciones (una por inversor; DC con sus strings)
            const nStrDC = inv.strings.reduce((a, s) => a + s.paralelos, 0);
            const acArea = (nF + 1) * cond.area;       // fases + neutro
            const acGnd = tierra.area;
            const acT = elegirTuberia('EMT', acArea + acGnd);
            const dcCant = nStrDC * 2;
            const dcArea = dcCant * cablePV.area;
            const dcGnd = AWG.find(a => a.n === '10 AWG').area;
            const dcT = elegirTuberia('IMC', dcArea + dcGnd);
            ocupacion.push({
                inversor: nInv,
                ac: { tipo: 'EMT', dim: acT.dim, cable: cond.n + ' THHW CT Cu', cant: nF + 1, area: r2(acArea), gnd: tierra.n + ' THHW CT Cu', gndCant: 1, gndArea: r2(acGnd), pct: Math.round((acArea + acGnd) / acT.area * 100) },
                dc: { tipo: 'IMC', dim: dcT.dim, cable: cablePV.nombre, cant: dcCant, area: r2(dcArea), gnd: '10 AWG THHW CT Cu', gndCant: 1, gndArea: r2(dcGnd), pct: Math.round((dcArea + dcGnd) / dcT.area * 100) },
                cumple: (acArea + acGnd) / acT.area * 100 <= OCUPACION_MAX && (dcArea + dcGnd) / dcT.area * 100 <= OCUPACION_MAX
            });
        });

        const maxSeries = Math.max(...datos.inversores.flatMap(i => i.strings.map(s => s.series)));
        return {
            tmin, factorT, imaxCFV: r2(imaxCFV), iConductor: r2(iConductor), fusible, areaCubierta: r1(areaPanel * totalMod),
            totalModulos: totalMod, totalWp, maxSeries, vocCorregido: r1(maxSeries * P.voc * factorT),
            vocSerie: P.voc * factorT, distribucion, perdDC, regDC, perdAC, regAC, ocupacion, cablePV: cablePV.nombre
        };
    }

    // Reparto automático de los módulos: N módulos entre los inversores y sus MPPT.
    // Cada MPPT recibe un string (paralelo 1) con los módulos que le tocan; si superan el
    // máximo de módulos en serie permitido por la tensión se parte en strings en paralelo.
    function distribuirAuto(nModulos, nInv, mppt, panel, inversor, tmin) {
        const factorT = 1 + Math.abs(panel.coefVoc) / 100 * (25 - (tmin != null ? tmin : 15));
        const maxSerie = Math.floor(inversor.vdcMax / (panel.voc * factorT));
        const canales = nInv * mppt;
        const base = Math.floor(nModulos / canales);
        let resto = nModulos - base * canales;
        const res = [];
        for (let i = 0; i < nInv; i++) {
            const strings = [];
            for (let m = 1; m <= mppt; m++) {
                let n = base + (resto > 0 ? 1 : 0); if (resto > 0) resto--;
                if (n === 0) continue;
                let par = 1, ser = n;
                while (ser > maxSerie) { par++; ser = Math.ceil(n / par); }
                strings.push({ mppt: m, paralelos: par, series: ser, longitud: 10 });
            }
            res.push({ strings, longitudAC: 11 });
        }
        return res;
    }

    const api = { AWG, CABLE_PV, calcular, distribuirAuto, COP_KWH_DC, COP_KWH_AC, HORAS_SOL };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.MemoriaCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
