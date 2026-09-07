/* ============================================================
 * informe-pdf.js — Motor del Informe General de Proyecto (PDF)
 *
 * Contiene TODA la lógica del informe: estructura de secciones, textos
 * adaptables, maquetación con jsPDF y compresión de imágenes.
 *
 * Lo usan dos páginas:
 *   - plantilla-de-proyecto.html : formulario suelto de pruebas.
 *   - index.html                 : la app de gestión documental, que rellena
 *                                  los datos desde Supabase.
 *
 * Requiere jsPDF cargado antes (window.jspdf).
 * Expone todo en window.InformePDF.
 * ============================================================ */
(function () {
    'use strict';

    // ============================================================
    // ASSETS DE MARCA (logo / encabezado / pie de página)
    // ============================================================
    const LOGO_URL = 'https://raw.githubusercontent.com/carlosaver7220/Gestion-documental/main/img/logo.png';
    const HEADER_URL = 'https://raw.githubusercontent.com/carlosaver7220/Gestion-documental/main/img/header.jpg';
    const FOOTER_URL = 'https://raw.githubusercontent.com/carlosaver7220/Gestion-documental/main/img/footer.jpg';

    // ============================================================
    // ESTRUCTURA DEL INFORME (única fuente de verdad)
    // Cada grupo es un tema principal (empieza en página nueva).
    // Cada "hijo" es una subsección dentro del grupo.
    // Cambiar/añadir/quitar aquí actualiza automáticamente:
    //  - el desplegable de fotos del formulario
    //  - la tabla de contenido (con número de página real)
    //  - el cuerpo del informe
    // ============================================================
    // Notas:
    //  - La numeración (1, 1.1, 1.2 …) se calcula automáticamente en flattenSecciones.
    //  - Estos informes son para proyectos RESIDENCIALES y COMERCIALES: no se
    //    incluyen "Inspección termográfica" ni "Lavado de paneles".
    //  - ÍNDICE INTELIGENTE: una subsección solo aparece (en la tabla de contenido
    //    y en el cuerpo) si tiene al menos una foto asignada, salvo que esté marcada
    //    con `siempre: true` (secciones narrativas / de datos técnicos) o que cumpla
    //    su propia `condicion`. Un grupo desaparece si se queda sin subsecciones visibles.
    //  - `titulo` puede ser texto o una función (datos) => texto (títulos adaptables).
    // ORDEN: el informe se organiza POR EQUIPO, y dentro de cada equipo va
    // primero LO PROPUESTO (plano / diseño), luego LO EJECUTADO (fotos de obra)
    // y al final su FICHA TÉCNICA.
    const REPORTE = [
        { titulo: 'Descripción general del proyecto', id: 'descripcion_general', siempre: true },

        // Lo propuesto vs. lo ejecutado en el sitio de los equipos.
        { titulo: 'Espacios de trabajo y operación', hijos: [
            { id: 'bastidor_propuesto', titulo: 'Bastidor propuesto' },
            { id: 'espacio_trabajo', titulo: 'Espacio y distancias de trabajo' },
            { id: 'punto_conexion', titulo: d => `Punto de conexión existente en ${predio(d)}` },
            { id: 'distancias_seguridad', titulo: 'Distancias de seguridad' },
        ]},

        { titulo: 'Disponibilidad del transformador', id: 'disponibilidad_trafo' },

        { titulo: 'Módulos fotovoltaicos', hijos: [
            { id: 'plano_modulos', titulo: 'Disposición de paneles en cubierta' },
            { id: 'estructura_soporte', titulo: 'Estructura de soporte' },
            { id: 'instalacion_modulos', titulo: 'Instalación de módulos solares' },
            { id: 'modulos_fv_detalle', titulo: 'Especificaciones de los módulos', siempre: true },
            { id: 'ficha_panel', titulo: 'Ficha técnica del panel solar' },
            // Sección opcional: solo aparece si se activa la casilla o si se le asignan fotos.
            { id: 'impermeabilizacion', titulo: 'Pruebas de impermeabilización',
              condicion: (d, f) => d.incluyeImpermeabilizacion || f.some(x => x.seccion === 'impermeabilizacion') },
        ]},

        { titulo: 'Inversores', hijos: [
            { id: 'inversores_instalacion', titulo: 'Instalación de inversores' },
            { id: 'inversores_detalle', titulo: 'Especificaciones del inversor', siempre: true },
            { id: 'ficha_inversor', titulo: 'Ficha técnica del inversor' },
        ]},

        { titulo: 'Sistema de almacenamiento (baterías)',
          condicion: (d, f) => d.tieneBateria || f.some(x => ['baterias', 'instalacion_bateria', 'ficha_bateria'].includes(x.seccion)),
          hijos: [
            { id: 'instalacion_bateria', titulo: 'Instalación del banco de baterías' },
            { id: 'baterias', titulo: 'Especificaciones del banco de baterías', siempre: true },
            { id: 'ficha_bateria', titulo: 'Ficha técnica de la batería' },
        ]},

        { titulo: 'Instalaciones eléctricas y protecciones', hijos: [
            { id: 'canalizacion_ac', titulo: d => d.canalizacion === 'tuberia'
                ? 'Canalización y cableado AC (tubería)' : 'Canalización y cableado AC' },
            { id: 'canalizacion_dc', titulo: d => (d.canalizacionDC || d.canalizacion) === 'tuberia'
                ? 'Canalización y cableado DC (tubería)' : 'Canalización y cableado DC' },
            { id: 'protecciones_dc', titulo: 'Protecciones DC (fusibles)', siempre: true,
              condicion: (d, f) => (d.proteccionesDC && d.proteccionesDC !== 'ninguna') || f.some(x => x.seccion === 'protecciones_dc') },
            { id: 'medios_proteccion', titulo: 'Gabinete de protecciones AC' },
            { id: 'puesta_tierra', titulo: 'Puesta a tierra' },
            { id: 'diagrama_unifilar', titulo: 'Diagrama unifilar' },
        ]},

        { titulo: 'Pruebas eléctricas y puesta en servicio', hijos: [
            { id: 'medicion_tension', titulo: 'Medición de tensión en cadenas fotovoltaicas' },
            { id: 'pruebas_aislamiento', titulo: 'Pruebas de aislamiento en cableado DC' },
            { id: 'resistencia_tierra', titulo: 'Medición de resistencia del sistema de puesta a tierra' },
            { id: 'puesta_en_marcha', titulo: 'Puesta en marcha del sistema' },
        ]},

        { titulo: 'Operación de la planta', siempre: true, hijos: [
            { id: 'operacion_planta', titulo: null, sinEncabezado: true, siempre: true },
            { id: 'observaciones', titulo: 'Observaciones', siempre: true,
              condicion: d => !!(d.observaciones && String(d.observaciones).trim()) },
        ]},
    ];

    // Resuelve un título que puede ser texto o función (datos) => texto.
    function resolverTitulo(t, datos) {
        return typeof t === 'function' ? t(datos || {}) : t;
    }

    // Aplana la estructura, aplica el "índice inteligente" y calcula la numeración
    // jerárquica (1, 1.1, 1.2 …). ignorarCondiciones=true -> para el desplegable
    // del formulario (se muestran todas las opciones siempre).
    function flattenSecciones(datos, fotos, ignorarCondiciones) {
        datos = datos || {}; fotos = fotos || [];
        const tieneFotos = id => fotos.some(f => f.seccion === id);
        const hijoVisible = h => {
            if (ignorarCondiciones) return true;
            if (h.condicion && !h.condicion(datos, fotos)) return false;
            if (h.sinEncabezado || h.siempre) return true;
            return tieneFotos(h.id);
        };
        const out = [];
        let grupoNum = 0;
        REPORTE.forEach(grupo => {
            if (!ignorarCondiciones && grupo.condicion && !grupo.condicion(datos, fotos)) return;
            const hijosVis = (grupo.hijos || []).filter(hijoVisible);
            const grupoConContenidoPropio = grupo.id && (ignorarCondiciones || grupo.siempre || tieneFotos(grupo.id));
            // Un grupo sin contenido propio ni subsecciones visibles no aparece.
            if (!ignorarCondiciones && !grupoConContenidoPropio && hijosVis.length === 0) return;
            grupoNum++;
            const numGrupo = String(grupoNum);
            out.push({ id: grupo.id || null, titulo: resolverTitulo(grupo.titulo, datos), num: numGrupo,
                       nivel: 1, esGrupo: !grupo.id, sinEncabezado: false });
            let hijoNum = 0;
            hijosVis.forEach(h => {
                let num = '';
                if (!h.sinEncabezado) { hijoNum++; num = numGrupo + '.' + hijoNum; }
                out.push({ id: h.id, titulo: resolverTitulo(h.titulo, datos), num, nivel: 2,
                           sinEncabezado: !!h.sinEncabezado });
            });
        });
        return out;
    }

    // Desplegable de secciones para asignar fotos: todas las secciones con id
    const SECCIONES_FOTOS = flattenSecciones({}, [], true)
        .filter(s => s.id)
        .map(s => ({ id: s.id, label: s.titulo == null ? 'Generalidades de operación' : s.titulo }));

    // ============================================================
    // TEXTOS ESTÁNDAR INTELIGENTES (se adaptan a los datos)
    // ============================================================
    function listaInversores(datos, incluirPotencia) {
        if (incluirPotencia === undefined) incluirPotencia = true;
        const arr = datos.inversores.map(inv => {
            const modelo = inv.modelo || 'modelo no especificado';
            return incluirPotencia && inv.potencia ? `${modelo} (${inv.potencia})` : modelo;
        });
        if (arr.length === 1) return arr[0];
        if (arr.length === 2) return arr.join(' y ');
        return arr.slice(0, -1).join(', ') + ' y ' + arr[arr.length - 1];
    }

    function marcasInversores(datos) {
        const marcas = [...new Set(datos.inversores.map(i => i.marca).filter(Boolean))];
        return marcas.length ? marcas.join(' / ') : 'no especificada';
    }

    function fraseSistema(datos) {
        if (datos.tipoSistema === 'hibrido') {
            return 'sistema fotovoltaico híbrido, con capacidad de operación interconectada a la red eléctrica y de respaldo autónomo mediante banco de baterías';
        }
        if (datos.tipoSistema === 'offgrid') {
            return 'sistema fotovoltaico aislado de la red eléctrica (Off-Grid), con soporte energético mediante banco de baterías';
        }
        return 'sistema de autogeneración fotovoltaica interconectado a la red eléctrica (On-Grid)';
    }

    // ---- Medio de canalización (bandeja / tubería / mixto) ----
    // datos.canalizacion: 'bandeja' | 'tuberia' | 'mixto'
    function medioCanalizacionAC(datos) {
        if (datos.canalizacion === 'tuberia') {
            return 'tubería metálica EMT en los tramos interiores y tubería metálica IMC en los tramos exteriores expuestos a la intemperie, complementada con coraza flexible impermeable (tipo Sealtite) en las conexiones directas a los equipos';
        }
        if (datos.canalizacion === 'mixto') {
            return 'bandeja portacables tipo escalera en las rutas principales, tubería metálica (EMT en interiores e IMC en exteriores) en los tramos restantes y coraza flexible impermeable en las conexiones a los equipos';
        }
        return 'bandeja portacables tipo escalera en las rutas principales y tubería metálica en los tramos expuestos, complementada con coraza flexible impermeable en las conexiones a los equipos';
    }
    // "la vivienda" / "el establecimiento" según el tipo de proyecto.
    function predio(datos) {
        return (datos && datos.tipoPredio === 'comercial') ? 'el establecimiento' : 'la vivienda';
    }
    function predioDe(datos) {
        return (datos && datos.tipoPredio === 'comercial') ? 'del establecimiento' : 'de la vivienda';
    }

    // Medio de canalización DC: usa su propio selector; si no hay, cae al de AC.
    function canalDC(datos) { return datos.canalizacionDC || datos.canalizacion || 'bandeja'; }
    function medioCanalizacionDC(datos) {
        const v = canalDC(datos);
        if (v === 'tuberia') return 'tubería metálica (EMT en los tramos interiores e IMC en los exteriores) complementada con coraza flexible en las transiciones a los equipos';
        if (v === 'mixto') return 'bandeja portacables y tubería metálica';
        return 'bandeja portacables sobre la cubierta';
    }
    function palabraCanalDC(datos) {
        const v = canalDC(datos);
        if (v === 'tuberia') return 'la tubería de canalización DC';
        if (v === 'mixto') return 'la bandeja portacables y la tubería';
        return 'la bandeja portacables';
    }

    function getTextos(id, datos) {
        const n = datos.inversores.length;
        const plural = n > 1 ? 'es' : '';
        // "Se instaló 1 inversor" / "Se instalaron 2 inversores"
        const seInstalo = `Se instal${n > 1 ? 'aron' : 'ó'} ${n} inversor${plural}`;

        const textos = {
            descripcion_general: [
                `El presente informe documenta el proceso de instalación y puesta en marcha del ${fraseSistema(datos)}, desarrollado para ${datos.cliente}, en ${datos.ubicacion}.`,
                `El sistema cuenta con una potencia instalada de ${datos.potenciaDC} kWp en corriente continua (DC) y ${datos.potenciaAC} kW en corriente alterna (AC), conformada por ${datos.numPaneles} módulos solares fotovoltaicos de ${datos.potenciaPanel} Wp cada uno.`,
                `La generación se distribuye a través de ${n} inversor${plural} de la marca ${marcasInversores(datos)}, con referencia${plural} ${listaInversores(datos)}.` +
                    (datos.tipoSistema !== 'offgrid' ? ' Los equipos cuentan con protección anti-isla integrada, evitando que el sistema permanezca energizado cuando la red del operador se encuentre des-energizada.' : ''),
                datos.tieneBateria ? `El proyecto incorpora un banco de baterías ${datos.bateria.marca} ${datos.bateria.modelo}, con una capacidad de almacenamiento de ${datos.bateria.capacidad || 'N/A'} kWh, que permite disponer de energía de respaldo ante interrupciones del suministro eléctrico.` : null,
                `Desde ${n > 1 ? 'los inversores' : 'el inversor'}, la energía generada se conduce hacia el gabinete de protecciones del sistema fotovoltaico y posteriormente se integra al tablero de distribución existente ${predioDe(datos)}.`,
            ].filter(Boolean),

            inversores_instalacion: [
                `${seInstalo} de la marca ${marcasInversores(datos)}, con referencia${plural} ${listaInversores(datos)}. ${n > 1 ? 'Los equipos se ubican' : 'El equipo se ubica'} en una zona técnica de fácil acceso, cercana al punto de conexión ${predioDe(datos)}.`,
                `La instalación ${n > 1 ? 'de cada inversor' : 'del inversor'} se realizó siguiendo las especificaciones del fabricante, garantizando una correcta ventilación, fijación mecánica y distancias mínimas de servicio para labores de mantenimiento.`,
            ],

            // Canalización y cableado AC (secciones fusionadas).
            canalizacion_ac: [
                `La canalización de corriente alterna (CA) se ejecutó empleando ${medioCanalizacionAC(datos)}, asegurando un índice de protección adecuado en las conexiones exteriores.`,
                `El cableado de fuerza entre el gabinete de protecciones AC y ${n > 1 ? 'cada inversor' : 'el inversor'} se dimensiona de acuerdo con la corriente nominal de cada circuito, garantizando las caídas de tensión admisibles según la normativa eléctrica vigente.`,
                ...datos.inversores.map(inv => ({ type: 'bullet', text: `${inv.modelo || 'Inversor'}${inv.potencia ? ` (${inv.potencia})` : ''}: ${datos.canalizacion === 'tuberia' ? 'canalización en tubería metálica y coraza flexible' : 'canalización en coraza metálica y bandeja portacables tipo escalera'}; ${datos.calibreAC ? `conductor calibre ${datos.calibreAC}` : 'calibre de conductor según diseño eléctrico del proyecto'}.` })),
                datos.calibreAcometida
                    ? `La acometida desde el gabinete de protecciones AC hasta el punto de conexión ${predioDe(datos)} se ejecutó con conductor calibre ${datos.calibreAcometida}.`
                    : null,
            ].filter(Boolean),

            estructura_soporte: [
                'Se instaló la estructura de soporte de los paneles, conformada por perfiles de aluminio. El montaje se planifica mediante la medición y ubicación de los soportes, sobre los cuales se instalan los rieles y sus respectivos clips de fijación, asegurando el montaje correcto de los módulos fotovoltaicos sobre la cubierta.',
                'Los clips y rieles de fijación evitan realizar perforaciones adicionales en la cubierta, preservando su impermeabilidad. La tornillería empleada es en acero inoxidable.',
            ],

            instalacion_modulos: [
                'Los módulos fotovoltaicos se trasladaron por la cubierta hasta su ubicación final y se fijaron sobre la estructura de soporte previamente instalada.',
                'Posteriormente se realizó el torque de la tornillería de fijación, verificando cada punto de anclaje y aplicando el par de apriete indicado por el fabricante.',
            ],

            // Canalización y cableado DC (secciones fusionadas).
            canalizacion_dc: [
                `Se instaló la canalización de corriente continua (DC) en ${medioCanalizacionDC(datos)}, empleada para enrutar el cableado de cada una de las series de paneles solares hasta ${n > 1 ? 'el respectivo inversor' : 'el inversor'}.`,
                `El cableado DC se tendió sobre ${palabraCanalDC(datos)} y se aseguró mediante amarres plásticos, marcando cada conductor para facilitar su identificación y trazabilidad. Se emplea cable solar de 4 mm² con conectores tipo MC4 en los extremos de cada cadena.`,
            ],

            instalacion_bateria: [
                `Se instaló el banco de baterías ${[datos.bateria.marca, datos.bateria.modelo].filter(Boolean).join(' ') || 'del sistema'} en la misma zona técnica del inversor, respetando las distancias de ventilación y de servicio indicadas por el fabricante.`,
                'La conexión al inversor se realiza mediante conductores dimensionados para la corriente máxima de carga y descarga del banco, con su respectiva protección y con la polaridad verificada antes de energizar el sistema.',
            ],

            protecciones_dc: [
                `La protección del lado de corriente continua (DC) se realiza mediante portafusibles con fusibles tipo gPV, dimensionados según la corriente de cortocircuito de cada cadena fotovoltaica${n > 1 ? ' y alojados en la caja de string de cada inversor' : ''}. A diferencia del lado de corriente alterna —protegido con interruptores termomagnéticos—, en DC se emplean fusibles por su capacidad de interrupción en corriente continua.`,
                'El sistema incorpora además dispositivos de protección contra sobretensiones transitorias (DPS) tipo 2 en el lado DC, que derivan a tierra las sobretensiones de origen atmosférico y protegen la entrada de los inversores.',
            ],

            impermeabilizacion: datos.impermeabilizacionTexto
                ? datos.impermeabilizacionTexto.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
                : [
                    'El método utilizado para la prueba hidráulica fue aplicar agua sobre la superficie de la cubierta de manera uniforme durante un periodo de 2 horas. Durante y posterior a este período, se realizó una inspección visual al interior del local para identificar posibles filtraciones.',
                    'Durante la prueba no se detectaron filtraciones en los puntos críticos ni en el área interna del local. El estado de impermeabilización es óptimo debido a que no se evidenciaron filtraciones. La cubierta evaluada cumple con los criterios de impermeabilización.',
                ],

            modulos_fv_detalle: [
                `Se instaló un total de ${datos.numPaneles} módulos fotovoltaicos marca ${datos.marcaPaneles || 'no especificada'}, modelo ${datos.modeloPaneles || 'no especificado'}, con una potencia de ${datos.potenciaPanel || 'N/A'} Wp cada uno.`,
                'Los paneles se instalaron sobre una estructura de aluminio fija, siguiendo las especificaciones técnicas del fabricante para garantizar su correcto desempeño y vida útil.',
            ],

            ficha_panel: [
                `A continuación se presenta la ficha técnica del módulo fotovoltaico ${[datos.marcaPaneles, datos.modeloPaneles].filter(Boolean).join(' ') || 'instalado'}, con sus características eléctricas, mecánicas y condiciones de operación indicadas por el fabricante.`,
            ],

            inversores_detalle: [
                `${seInstalo} de la marca ${marcasInversores(datos)}, con las siguientes referencias y potencias nominales:`,
                ...datos.inversores.map(inv => ({ type: 'bullet', text: `${inv.modelo || 'Modelo no especificado'} — Potencia nominal: ${inv.potencia || 'no especificada'}${inv.marca ? ` (marca ${inv.marca})` : ''}.` })),
            ],

            ficha_inversor: [
                `A continuación se presenta la ficha técnica ${n > 1 ? 'de los inversores instalados' : `del inversor ${listaInversores(datos, false)}`}, con sus parámetros de entrada DC, salida AC, rendimiento y protecciones integradas según el fabricante.`,
            ],

            baterias: [
                `El sistema cuenta con un banco de baterías ${datos.bateria.marca || 'no especificada'} ${datos.bateria.modelo || ''}, con una capacidad total de almacenamiento de ${datos.bateria.capacidad || 'N/A'} kWh${datos.bateria.cantidad ? `, distribuida en ${datos.bateria.cantidad} unidad${String(datos.bateria.cantidad).trim() === '1' ? '' : 'es'}` : ''}.`,
                'El banco de baterías permite almacenar la energía excedente generada por el sistema fotovoltaico y disponer de respaldo energético ante interrupciones del suministro de la red eléctrica.',
            ],

            ficha_bateria: [
                `A continuación se presenta la ficha técnica del banco de baterías ${[datos.bateria.marca, datos.bateria.modelo].filter(Boolean).join(' ') || 'instalado'}, con sus características eléctricas y condiciones de operación indicadas por el fabricante.`,
            ],

            // Gabinete de protecciones AC (fusión de "Medios de protección" y
            // "Tablero de protecciones AC": es el mismo gabinete).
            medios_proteccion: [
                `El gabinete de protecciones AC centraliza las protecciones del sistema y constituye el medio de desconexión del sistema fotovoltaico. Se encuentra ubicado en una zona de fácil acceso, cercana ${n > 1 ? 'a los inversores' : 'al inversor'}.`,
                `En su interior se disponen ${n > 1 ? 'los interruptores termomagnéticos totalizadores de los inversores' : 'el interruptor termomagnético totalizador del inversor'}, el interruptor de red y el de carga, junto con los dispositivos de protección contra sobretensiones transitorias (DPS) en corriente alterna.` +
                    (datos.tipoSistema !== 'ongrid' ? ' El gabinete incorpora además el conmutador de transferencia entre red y sistema solar, que permite seleccionar la fuente de alimentación de las cargas respaldadas.' : ''),
                `El gabinete cuenta con la señalización de seguridad y las advertencias de riesgo eléctrico exigidas por el RETIE, indicando la presencia de una fuente de alimentación fotovoltaica.`,
            ],

            puesta_tierra: [
                'La puesta a tierra de la estructura de los paneles se realiza mediante accesorios de conexión y continuidad mecánica, interconectados hacia el sistema general de puesta a tierra del proyecto.',
                `${n > 1 ? 'Cada inversor se conecta' : 'El inversor se conecta'} al barraje de tierra mediante conductor de cobre${datos.calibreTierra ? ` calibre ${datos.calibreTierra}` : ', con calibre dimensionado según su corriente nominal'}, garantizando un camino de baja impedancia para la disipación de corrientes de falla.`,
            ],

            medicion_tension: [
                'Previo a la interconexión y puesta en marcha de los inversores, se realizó la verificación de la tensión en circuito abierto (Voc) de las cadenas de módulos fotovoltaicos, con el fin de confirmar la correcta conexión en serie de los módulos y descartar fallas de polaridad invertida.',
            ],

            pruebas_aislamiento: [
                'Con el objetivo de garantizar la integridad del revestimiento de los conductores de corriente continua, se ejecutaron pruebas de resistencia de aislamiento (megado) en los polos positivo y negativo de las series fotovoltaicas, confirmando un nivel de aislamiento dieléctrico adecuado y la ausencia de fallas a tierra o fugas de corriente.',
            ],

            resistencia_tierra: [
                'Se verificó la resistividad del sistema de puesta a tierra del proyecto mediante el método de caída de potencial, con el fin de asegurar la correcta disipación de posibles corrientes de falla y proteger la integridad de los equipos y del personal.',
            ],

            puesta_en_marcha: [
                `Finalizadas las pruebas eléctricas se realizó la puesta en marcha del sistema, energizando ${n > 1 ? 'los inversores' : 'el inversor'} y verificando en pantalla los parámetros de operación: tensión y potencia de entrada en corriente continua, tensión y potencia de salida en corriente alterna${datos.tieneBateria ? ', estado de carga del banco de baterías' : ''}${datos.tipoSistema !== 'offgrid' ? ' y tensión de la red del operador' : ''}.`,
                `El sistema quedó operando de forma estable, cubriendo la demanda ${predioDe(datos)} con la generación fotovoltaica${datos.tieneBateria ? ' y respaldando el consumo con el banco de baterías cuando las condiciones de operación lo requieren' : ''}.`,
            ],

            // Secciones de planos: solo imágenes con su pie. Sin texto de relleno.
            diagrama_unifilar: [],
            plano_modulos: [],

            distancias_seguridad: [
                'Se verificaron las distancias de seguridad entre el sistema fotovoltaico y las redes eléctricas cercanas al predio, confirmando el cumplimiento de las distancias mínimas de aproximación establecidas en el RETIE para redes de media y baja tensión.',
            ],

            espacio_trabajo: [
                `Se garantizan los espacios y las distancias de trabajo alrededor de los equipos eléctricos${datos.tieneBateria ? ' (inversor, banco de baterías y gabinete de protecciones AC)' : ' (inversor y gabinete de protecciones AC)'}, permitiendo su operación y mantenimiento de forma segura conforme a los requisitos del RETIE.`,
            ],

            disponibilidad_trafo: (() => {
                const t = datos.trafo || {};
                const op = datos.operadorRed || 'el operador de red';
                const ident = [
                    t.codigo ? `código ${t.codigo}` : null,
                    t.matricula ? `matrícula ${t.matricula}` : null,
                ].filter(Boolean).join(' y ');
                const carac = [
                    t.kva ? `una potencia nominal de ${t.kva} kVA` : null,
                    t.tensionPrim ? `tensión primaria de ${t.tensionPrim}` : null,
                    t.tensionSec ? `tensión secundaria de ${t.tensionSec}` : null,
                ].filter(Boolean);
                return [
                    `Previo a la ejecución del proyecto se consultó la disponibilidad de capacidad en el transformador de distribución del que se deriva el suministro ${predioDe(datos)}, a través del portal de ${op}.`,
                    `El transformador ${ident ? `identificado con ${ident}` : 'asociado al punto de conexión'} presenta ${carac.length ? carac.join(', ') : 'las características indicadas por el operador de red'}.` +
                        (t.ocupacion ? ` Al momento de la consulta registraba un porcentaje de ocupación del ${t.ocupacion}%.` : ''),
                    `Con base en esta información se confirma que existe capacidad disponible en el transformador para la conexión del sistema fotovoltaico de ${datos.potenciaAC} kW, sin afectar la operación de la red ni la calidad del servicio de los demás usuarios.`,
                ];
            })(),

            punto_conexion: [
                `El punto de conexión del sistema fotovoltaico corresponde al tablero de distribución ya existente en ${predio(datos)}, ubicado junto al equipo de medida ${datos.operadorRed ? `de ${datos.operadorRed}` : 'del operador de red'}. Desde este tablero se alimenta la totalidad de las cargas del predio, y es allí donde se realiza la interconexión del sistema solar.`,
                datos.smartMeter === 'Si'
                    ? `El equipo de medida existente se reemplaza por un medidor bidireccional (smart meter) calibrado y homologado por ${datos.operadorRed || 'el operador de red'}, requisito para la liquidación de los excedentes entregados.`
                    : (datos.smartMeter === 'No'
                        ? 'El proyecto conserva el equipo de medida existente; no se contempla la instalación de un medidor bidireccional (smart meter).'
                        : null),
                'Sobre el tablero existente se instaló la señalización de seguridad exigida por el RETIE, advirtiendo la presencia de una fuente de alimentación fotovoltaica, de manera que cualquier intervención posterior se realice con conocimiento de la doble fuente de energía.',
            ].filter(Boolean),

            bastidor_propuesto: [
                `Se presenta el esquema del bastidor propuesto para el equipo de medida, en el que se indica la disposición del medidor bidireccional, el totalizador y la señalización correspondiente, conforme a los requisitos de ${datos.operadorRed || 'el operador de red'} para sistemas de autogeneración a pequeña escala (AGPE).`,
            ],

            operacion_planta: [
                'La planta solar debe ser operada únicamente por personal calificado y autorizado por el propietario, empleando las medidas de protección adecuadas. Para cualquier intervención se deben seguir estrictamente los lineamientos estipulados por el fabricante de cada equipo.' +
                    (datos.tieneBateria ? ' El banco de baterías debe operarse dentro de los rangos de carga y descarga recomendados por su fabricante, con el fin de preservar su vida útil.' : ''),
                `El medio de desconexión del sistema se encuentra en el gabinete de protecciones AC. Ante cualquier maniobra debe tenerse en cuenta que ${predio(datos)} cuenta con doble fuente de alimentación —red y sistema fotovoltaico—, según la señalización instalada.`,
            ],

            // Texto libre que escribe quien elabora el informe.
            observaciones: String(datos.observaciones || '')
                .split(/\n\s*\n/).map(s => s.trim()).filter(Boolean),
        };

        return textos[id] || ['Información no disponible para esta sección.'];
    }

    // ============================================================
    // GENERACIÓN DEL PDF CON jsPDF
    // ============================================================
    async function generarInformePDF(datos, fotos, portadaData) {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pageWidth - margin * 2;
        const contentTopY = 50; // espacio libre bajo el encabezado (incluye el nombre corto del proyecto)
        const BOTTOM_LIMIT = pageHeight - 48; // deja espacio de sobra para el pie de página
        let y = margin;

        // ==========================================================
        // PORTADA — logo arriba, foto recortada al centro, texto abajo a la izquierda
        // ==========================================================
        const coverMargin = 20;

        let logoImg = null;
        try {
            logoImg = await loadImageFromUrl(LOGO_URL);
        } catch (e) {
            console.warn('No se pudo cargar el logo desde LOGO_URL, se usa texto de respaldo:', e);
        }

        const logoBlockTop = 55;
        let logoBottom;

        if (logoImg) {
            const logoH = 18;
            const logoW = logoH * (logoImg.width / logoImg.height);
            const logoX = (pageWidth - logoW) / 2;
            doc.addImage(logoImg.data, 'JPEG', logoX, logoBlockTop, logoW, logoH);
            logoBottom = logoBlockTop + logoH + 14;
        } else {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor('#1a202c');
            doc.text('SmartEnergy Ing', pageWidth / 2, logoBlockTop + 12, { align: 'center' });
            logoBottom = logoBlockTop + 12 + 14;
        }

        const imgTop = logoBottom;
        const imgAreaHeight = 105;
        const imgBottom = imgTop + imgAreaHeight;

        if (portadaData) {
            try {
                const croppedDataUrl = await recortarImagenCover(portadaData, pageWidth, imgAreaHeight);
                doc.addImage(croppedDataUrl, 'JPEG', 0, imgTop, pageWidth, imgAreaHeight);
            } catch (e) {
                console.warn('Error al recortar/cargar imagen de portada:', e);
                doc.setFillColor('#1a365d');
                doc.rect(0, imgTop, pageWidth, imgAreaHeight, 'F');
            }
        } else {
            doc.setFillColor('#1a365d');
            doc.rect(0, imgTop, pageWidth, imgAreaHeight, 'F');
        }

        let textY = imgBottom + 18;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor('#1a202c');
        doc.text('ENERGÍA SOLAR FOTOVOLTAICA', coverMargin, textY);
        textY += 6;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor('#1a202c');
        doc.text('Proyecto:', coverMargin, textY);
        textY += 5.5;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10.5);
        doc.setTextColor('#1a202c');
        const nombreLines = doc.splitTextToSize(datos.nombre, pageWidth - coverMargin * 2);
        doc.text(nombreLines, coverMargin, textY);
        textY += nombreLines.length * 5.5;

        textY += 10;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor('#4a5568');
        doc.text(`${datos.ubicacion}, ${datos.fecha}`, coverMargin, textY);

        // ==========================================================
        // PÁGINA 2 - ÍNDICE (con número de página real, agregado al final)
        // ==========================================================
        doc.addPage();
        y = contentTopY;

        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor('#1a365d');
        doc.text('Tabla de contenido', margin, y);
        y += 2;

        doc.setDrawColor('#cbd5e0');
        doc.line(margin, y, pageWidth - margin, y);
        y += 12;

        const flat = flattenSecciones(datos, fotos, false);
        const tocEntradas = [];

        flat.forEach(item => {
            // Los ítems "sin encabezado" (texto introductorio de un grupo) no
            // se listan en la tabla de contenido, pero se conserva la posición
            // para mantener alineados los índices con el cuerpo del informe.
            if (item.sinEncabezado) {
                tocEntradas.push({ y: null, pageNum: null });
                return;
            }
            const esGrupo = item.nivel === 1;
            doc.setFontSize(esGrupo ? 12 : 11);
            doc.setFont('helvetica', esGrupo ? 'bold' : 'normal');
            doc.setTextColor(esGrupo ? '#1a365d' : '#2d3748');
            const indent = esGrupo ? 0 : 8;
            const titulo = item.titulo || 'Generalidades de operación';
            const etiqueta = (item.num ? item.num + '  ' : '') + titulo;
            doc.text(etiqueta, margin + indent, y);
            tocEntradas.push({ y, pageNum: null, nivel: item.nivel, etiqueta, indent });
            y += esGrupo ? 7 : 6.5;
        });

        // ==========================================================
        // FUNCIONES AUXILIARES PARA EL CUERPO DEL INFORME
        // ==========================================================
        function checkPage() {
            if (y > BOTTOM_LIMIT) {
                doc.addPage();
                y = contentTopY;
                return true;
            }
            return false;
        }

        function addText(text, size, style, color, align) {
            if (!text) return;
            size = size || 11; style = style || 'normal'; color = color || '#1a365d'; align = align || 'left';
            checkPage();
            doc.setFontSize(size);
            doc.setFont('helvetica', style);
            doc.setTextColor(color);
            const lines = doc.splitTextToSize(text, contentWidth);
            const opts = { align };
            if (align === 'justify') opts.maxWidth = contentWidth;
            const x = align === 'center' ? pageWidth / 2 : margin;
            doc.text(lines, x, y, opts);
            y += lines.length * (size * 0.42) + 3;
        }

        function addBullet(text) {
            if (!text) return;
            checkPage();
            const bulletIndent = 5;
            doc.setFontSize(10.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor('#2d3748');
            const lines = doc.splitTextToSize(text, contentWidth - bulletIndent);
            doc.text('•', margin, y);
            doc.text(lines, margin + bulletIndent, y);
            y += lines.length * 4.6 + 2;
        }

        function addParrafos(items) {
            if (!items) return;
            items.forEach(item => {
                if (typeof item === 'string') {
                    addText(item, 10.5, 'normal', '#2d3748', 'justify');
                    addSpace(2);
                } else if (item && item.type === 'bullet') {
                    addBullet(item.text);
                }
            });
        }

        function addSpace(mm) { y += mm; }

        // Título de grupo: centrado, en negrita, sin línea debajo (como el PDF de referencia).
        function addGroupHeading(num, titulo) {
            const texto = (num ? num + '. ' : '') + titulo;
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor('#1a202c');
            const lines = doc.splitTextToSize(texto, contentWidth);
            doc.text(lines, pageWidth / 2, y, { align: 'center' });
            y += lines.length * 7 + 11;
        }

        // Subtítulo: alineado a la izquierda, negrita, subrayado de ancho completo.
        // Nunca queda un subtítulo "huérfano" al pie de la página: si no hay al
        // menos ~46 mm libres debajo, salta a la siguiente página.
        function addSubHeading(num, titulo, espacioMin) {
            if (BOTTOM_LIMIT - y < (espacioMin || 34)) { doc.addPage(); y = contentTopY; }
            const texto = (num ? num + '. ' : '') + titulo;
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor('#1a365d');
            const lines = doc.splitTextToSize(texto, contentWidth);
            doc.text(lines, margin, y);
            y += (lines.length - 1) * 6;
            doc.setDrawColor('#9fb3c8');
            doc.setLineWidth(0.4);
            doc.line(margin, y + 2, pageWidth - margin, y + 2);
            doc.setLineWidth(0.2);
            y += 8;
        }

        // ==========================================================
        // GRID DE IMÁGENES: si no hay fotos, no se imprime nada (sin
        // textos de relleno). Centrado, recortado sin deformar.
        // ==========================================================
        // Pie de imagen: cursiva, centrado, tono gris azulado, con numeración
        // "Imagen N." continua en todo el documento.
        const CAP_COLOR = '#5b6b7f';
        function pieImagen(texto, x, anchoMax) {
            const num = ++imagenCounter;
            const full = `Imagen ${num}. ${texto || ''}`.trim();
            doc.setFontSize(9);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(CAP_COLOR);
            const lines = doc.splitTextToSize(full, anchoMax);
            doc.text(lines, x, y, { align: 'center' });
            return lines.length;
        }

        async function agregarGridImagenes(fotosArr) {
            if (!fotosArr || fotosArr.length === 0) return;

            const cargadas = [];
            for (const foto of fotosArr) {
                try {
                    const imgData = await loadImageFromFile(foto.archivo);
                    cargadas.push({ imgData, descripcion: (foto.descripcion || '').trim() });
                } catch (e) {
                    console.warn('Error al cargar imagen:', e);
                }
            }
            if (cargadas.length === 0) return;

            const n = cargadas.length;
            // Si todas las fotos comparten la misma descripción (o están vacías),
            // se agrupan bajo un único pie centrado. Si difieren, cada imagen
            // lleva su propio pie (como el PDF de referencia).
            const descs = cargadas.map(c => c.descripcion);
            const mismaDescripcion = descs.every(d => d === descs[0]);
            const modoIndividual = n > 1 && !mismaDescripcion;

            // Espacio libre útil desde la posición actual hasta el pie de página.
            const libre = () => BOTTOM_LIMIT - y;
            // Si al pasar a página nueva la imagen cabría, se encoge para caber en
            // la página actual siempre que quede al menos este alto (evita huecos).
            const MIN_FILA = 36;

            if (n === 1) {
                const { imgData, descripcion } = cargadas[0];
                const ar = imgData.width / imgData.height;
                const capH = 9;
                // Tamaño moderado a media página, para que el texto de la siguiente
                // sección pueda subir y no queden huecos. Si la imagen queda sola al
                // inicio de una página (no empuja nada), se permite más alta para
                // llenar la hoja en vez de dejar la mitad en blanco.
                const alTope = y <= contentTopY + 3;
                const hMax = ar < 1 ? (alTope ? 190 : 150) : (ar < 1.5 ? 120 : 105);
                let h = Math.min(contentWidth / ar, hMax);
                if (y + h + capH > BOTTOM_LIMIT) {
                    const disp = libre() - capH;
                    if (disp >= MIN_FILA) {
                        h = Math.min(h, disp);            // encoge para caber
                    } else {
                        // No cabe: página nueva. Al quedar sola arriba, puede ir más grande.
                        doc.addPage(); y = contentTopY;
                        h = Math.min(contentWidth / ar, ar < 1 ? 190 : (ar < 1.5 ? 120 : 105));
                    }
                }
                let w = h * ar;
                if (w > contentWidth) { w = contentWidth; h = w / ar; }
                const x = margin + (contentWidth - w) / 2;
                doc.addImage(imgData.data, 'JPEG', x, y, w, h);
                y += h + 4;
                const nl = pieImagen(descripcion, pageWidth / 2, contentWidth * 0.85);
                y += nl * 4.4 + 5;
                return;
            }

            const cols = n === 2 ? 2 : (n % 3 === 0 || n > 4) ? 3 : 2;
            const gap = 3;
            const cellW = (contentWidth - gap * (cols - 1)) / cols;
            // Alto máximo de celda. Las imágenes NO se recortan: se reducen hasta
            // caber completas dentro de la celda, así que el alto de cada fila es
            // el que necesite la imagen más alta (sin pasarse del máximo).
            const cellHMax = cellW * (cols === 2 ? 0.95 : 0.9);

            for (let i = 0; i < n; i += cols) {
                const fila = cargadas.slice(i, i + cols);
                const filaN = fila.length;
                const filaWidth = filaN * cellW + (filaN - 1) * gap;
                const startX = margin + (contentWidth - filaWidth) / 2;
                const altoPie = modoIndividual ? 12 : 0;

                let cellH = 0;
                for (const it of fila) {
                    const arCelda = it.imgData.width / it.imgData.height;
                    cellH = Math.max(cellH, Math.min(cellHMax, cellW / arCelda));
                }
                if (y + cellH + altoPie > BOTTOM_LIMIT) {
                    const disponible = libre() - altoPie;
                    if (disponible >= MIN_FILA) {
                        cellH = Math.min(cellH, disponible); // encoge la fila
                    } else {
                        doc.addPage(); y = contentTopY;
                    }
                }

                for (let j = 0; j < filaN; j++) {
                    // "Contain": la imagen se ve completa, centrada en su celda.
                    const ajustada = await ajustarImagenContain(fila[j].imgData, cellW, cellH);
                    const x = startX + j * (cellW + gap) + (cellW - ajustada.w) / 2;
                    doc.addImage(ajustada.data, 'JPEG', x, y + (cellH - ajustada.h) / 2, ajustada.w, ajustada.h);
                }
                y += cellH + 3;

                if (modoIndividual) {
                    let maxLineas = 1;
                    for (let j = 0; j < filaN; j++) {
                        const x = startX + j * (cellW + gap) + cellW / 2;
                        const nl = pieImagen(fila[j].descripcion, x, cellW - 2);
                        if (nl > maxLineas) maxLineas = nl;
                    }
                    y += maxLineas * 4 + 5;
                } else {
                    y += 2;
                }
            }

            if (!modoIndividual) {
                if (y + 8 > BOTTOM_LIMIT) { doc.addPage(); y = contentTopY; }
                const nl = pieImagen(descs[0], pageWidth / 2, contentWidth * 0.85);
                y += nl * 4.4 + 5;
            }
            addSpace(2);
        }

        function fotosDe(id) {
            return fotos.filter(f => f.seccion === id);
        }

        // ==========================================================
        // CUERPO DEL INFORME (recorre exactamente la misma lista "flat" que
        // la tabla de contenido -> índices y numeración siempre coinciden).
        // ==========================================================
        let imagenCounter = 0;

        for (let flatIndex = 0; flatIndex < flat.length; flatIndex++) {
            const item = flat[flatIndex];

            if (item.nivel === 1) {
                // Los temas principales fluyen: solo saltan de página si queda
                // poco espacio útil (evita páginas medio vacías). El primero
                // siempre empieza en página nueva (después de la tabla de contenido).
                // El título de grupo no debe quedar solo al pie: necesita espacio
                // para él, para el primer subtítulo y para unas líneas de texto.
                if (flatIndex === 0 || BOTTOM_LIMIT - y < 72) {
                    doc.addPage();
                    y = contentTopY;
                } else {
                    y += 13;
                }
                tocEntradas[flatIndex].pageNum = doc.internal.getNumberOfPages();
                addGroupHeading(item.num, item.titulo);
                if (item.id) {
                    addParrafos(getTextos(item.id, datos));
                    await agregarGridImagenes(fotosDe(item.id));
                }
            } else {
                if (item.sinEncabezado) checkPage();
                tocEntradas[flatIndex].pageNum = doc.internal.getNumberOfPages();
                const fotosSeccion = fotosDe(item.id);
                const parrafos = getTextos(item.id, datos);
                if (!item.sinEncabezado) {
                    // Si la sección tiene texto, este fluye y llena la página (la
                    // imagen puede pasar a la siguiente sin dejar hueco). Si es una
                    // sección solo de imagen —los planos—, el título debe viajar
                    // junto con su plano: se exige espacio para ambos.
                    const soloImagen = parrafos.filter(p => typeof p === 'string').length === 0;
                    const minEspacio = (fotosSeccion.length && soloImagen) ? 78 : 30;
                    addSubHeading(item.num, item.titulo, minEspacio);
                    // addSubHeading pudo saltar de página: reflejarlo en la TOC.
                    tocEntradas[flatIndex].pageNum = doc.internal.getNumberOfPages();
                }
                addParrafos(parrafos);
                await agregarGridImagenes(fotosSeccion);
                addSpace(3);
            }
        }

        // ==========================================================
        // SECCIONES PERSONALIZADAS
        // ==========================================================
        const fotosPersonalizadas = fotos.filter(f => f.seccion === 'personalizada');
        if (fotosPersonalizadas.length > 0) {
            const grupos = {};
            fotosPersonalizadas.forEach(f => {
                const titulo = f.tituloPersonalizado || 'Sección adicional';
                if (!grupos[titulo]) grupos[titulo] = [];
                grupos[titulo].push(f);
            });

            doc.addPage();
            y = contentTopY;
            addGroupHeading('', 'Anexos');

            for (const [titulo, fotosGrupo] of Object.entries(grupos)) {
                checkPage();
                addSubHeading('', titulo);
                await agregarGridImagenes(fotosGrupo);
                addSpace(8);
            }
        }

        // ==========================================================
        // FIRMA DEL TÉCNICO QUE EJECUTÓ LA INSTALACIÓN
        // Bloque de cierre con la línea de firma, el nombre, el rol/cargo y
        // la cédula de quien ejecutó el proyecto.
        // ==========================================================
        if (datos.tecnico && datos.tecnico.nombre) {
            const t = datos.tecnico;
            // Necesita ~50 mm: encabezado, hueco para firmar, línea y tres renglones.
            if (BOTTOM_LIMIT - y < 50) { doc.addPage(); y = contentTopY; } else { y += 14; }

            doc.setFontSize(10.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor('#1a365d');
            doc.text('Ejecutado por:', margin, y);
            y += 22; // espacio en blanco para firmar

            const anchoFirma = 78;
            doc.setDrawColor('#1a202c');
            doc.setLineWidth(0.4);
            doc.line(margin, y, margin + anchoFirma, y);
            doc.setLineWidth(0.2);
            y += 5;

            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor('#1a202c');
            doc.text(t.nombre, margin, y);
            y += 5;

            doc.setFontSize(9.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor('#4a5568');
            if (t.cargo) { doc.text(t.cargo, margin, y); y += 4.5; }
            if (t.cedula) { doc.text(`C.C. ${t.cedula}`, margin, y); y += 4.5; }
            doc.text(t.empresa || 'Smart Energy Ing S.A.S', margin, y);
            y += 6;
        }

        // ==========================================================
        // TABLA DE CONTENIDO INTELIGENTE:
        //  - número de página real
        //  - cada línea es un enlace que salta a su sección
        //  - marcadores (bookmarks) de navegación del PDF
        // ==========================================================
        doc.setPage(2);
        let bmGrupo = null;
        tocEntradas.forEach(entrada => {
            if (!entrada.pageNum || entrada.y == null) return;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor('#4a5568');
            doc.text(String(entrada.pageNum), pageWidth - margin, entrada.y, { align: 'right' });
            // Enlace interno (toda la fila).
            try {
                doc.link(margin, entrada.y - 4, pageWidth - margin * 2, 6, { pageNumber: entrada.pageNum });
            } catch (e) { /* algunas versiones no soportan pageNumber en link */ }
            // Marcadores del PDF.
            try {
                if (doc.outline && doc.outline.add) {
                    if (entrada.nivel === 1) {
                        bmGrupo = doc.outline.add(null, entrada.etiqueta, { pageNumber: entrada.pageNum });
                    } else {
                        doc.outline.add(bmGrupo || null, entrada.etiqueta, { pageNumber: entrada.pageNum });
                    }
                }
            } catch (e) { /* sin marcadores si la versión no lo permite */ }
        });

        // ==========================================================
        // ENCABEZADO Y PIE DE PÁGINA EN TODAS LAS HOJAS, EXCEPTO LA PORTADA
        // ==========================================================
        let headerImg = null, footerImg = null;
        try { headerImg = await loadImageFromUrl(HEADER_URL); } catch (e) { console.warn('No se pudo cargar el encabezado:', e); }
        try { footerImg = await loadImageFromUrl(FOOTER_URL); } catch (e) { console.warn('No se pudo cargar el pie de página:', e); }

        const totalPages = doc.internal.getNumberOfPages();
        for (let p = 2; p <= totalPages; p++) {
            doc.setPage(p);
            let hH = 22;
            if (headerImg) {
                hH = pageWidth / (headerImg.width / headerImg.height);
                doc.addImage(headerImg.data, 'JPEG', 0, 0, pageWidth, hH);
            }
            // Nombre corto del proyecto, alineado a la derecha bajo el encabezado
            // (como el PDF de referencia).
            if (datos.nombreCorto) {
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor('#4a5568');
                doc.text(datos.nombreCorto, pageWidth - margin, hH + 4.5, { align: 'right' });
            }
            if (footerImg) {
                const fH = pageWidth / (footerImg.width / footerImg.height);
                doc.addImage(footerImg.data, 'JPEG', 0, pageHeight - fH, pageWidth, fH);
            }
        }

        return doc.output('blob');
    }

    // ============================================================
    // FUNCIONES AUXILIARES PARA IMÁGENES
    // ============================================================
    // Assets de marca (logo / encabezado / pie). Se reducen y se convierten a
    // JPEG sobre fondo blanco: los tres se dibujan sobre páginas blancas y, en
    // PNG, jsPDF los guardaría sin comprimir (el logo solo pesaba 1,4 MB).
    function loadImageFromUrl(url, maxPx) {
        maxPx = maxPx || 1600;
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const escala = Math.min(1, maxPx / Math.max(img.width, img.height));
                    const w = Math.max(1, Math.round(img.width * escala));
                    const h = Math.max(1, Math.round(img.height * escala));
                    const { canvas, ctx } = lienzoBlanco(w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve({ data: canvas.toDataURL('image/jpeg', 0.92), width: w, height: h });
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    // ============================================================
    // COMPRESIÓN DE IMÁGENES
    // Las fotos de celular llegan a 4000 px y pesan varios MB cada una; sin
    // reducirlas el informe puede superar los 50 MB. Se redimensionan al
    // tamaño que realmente necesita una hoja A4 (~200-250 ppp) y se
    // recomprimen a JPEG antes de incrustarlas en el PDF.
    // ============================================================
    // Lado mayor en píxeles: una imagen a ancho completo (180 mm) con 1800 px
    // equivale a ~254 ppp, de sobra para impresión.
    const MAX_PX_FOTO = 1800;   // fotografías
    const MAX_PX_DOC = 2100;    // planos, fichas técnicas y capturas (texto fino)
    const CALIDAD_FOTO = 0.85;
    // Calidad alta para planos, fichas y capturas: llevan texto pequeño y son
    // pocas, así que el costo en peso es bajo.
    const CALIDAD_DOC = 0.95;

    // IMPORTANTE: todo se incrusta como JPEG. jsPDF guarda los PNG SIN COMPRIMIR
    // dentro del PDF (un PNG de 150 KB puede ocupar 8 MB, más otro tanto de máscara
    // de transparencia), así que un informe con planos en PNG se dispara a decenas
    // de MB. Convertirlos a JPEG reduce el archivo más de un 90 %.

    // ¿La imagen es un documento (plano/ficha/captura) en vez de una foto?
    // Esos llevan texto pequeño y se tratan con más resolución y calidad.
    function esDocumentoImagen(file) {
        const tipo = (file && file.type) || '';
        const nombre = (file && file.name) || '';
        return /png|webp|gif/i.test(tipo) || /\.(png|webp|gif)$/i.test(nombre);
    }

    // Dibuja sobre fondo blanco: evita que los PNG con transparencia
    // queden con fondo negro al convertirlos a JPEG.
    function lienzoBlanco(w, h) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        return { canvas, ctx };
    }

    // Ajusta la imagen DENTRO de una celda sin recortarla ("contain"): se reduce
    // hasta caber completa. Devuelve el tamaño real en mm que ocupa, para poder
    // centrarla en la celda. Se usa en las rejillas de fotos: así se ve todo el
    // contenido de la foto, aunque quede más pequeña.
    function ajustarImagenContain(imgData, boxW, boxH) {
        return new Promise((resolve, reject) => {
            const ar = imgData.width / imgData.height;
            let w = boxW, h = boxW / ar;
            if (h > boxH) { h = boxH; w = h * ar; }
            // Se rasteriza al tamaño que realmente ocupará en la hoja (~9 px/mm).
            const outW = Math.max(300, Math.min(1700, Math.round(w * 9)));
            const outH = Math.max(1, Math.round(outW / ar));
            const { canvas, ctx } = lienzoBlanco(outW, outH);
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, outW, outH);
                resolve({ data: canvas.toDataURL('image/jpeg', CALIDAD_FOTO), w, h });
            };
            img.onerror = reject;
            img.src = imgData.data;
        });
    }

    // Recorte "cover" (llena el marco, recortando lo que sobra). Solo se usa en
    // la franja de la portada, donde sí interesa que ocupe de extremo a extremo.
    function recortarImagenCover(imgData, targetW, targetH) {
        return new Promise((resolve, reject) => {
            const targetRatio = targetW / targetH;
            const srcRatio = imgData.width / imgData.height;

            let sx, sy, sw, sh;
            if (srcRatio > targetRatio) {
                sh = imgData.height;
                sw = sh * targetRatio;
                sx = (imgData.width - sw) / 2;
                sy = 0;
            } else {
                sw = imgData.width;
                sh = sw / targetRatio;
                sx = 0;
                sy = (imgData.height - sh) / 2;
            }

            // Resolución proporcional al tamaño real en la hoja (~9 px/mm ≈ 230 ppp),
            // en vez de un ancho fijo: una celda de 88 mm no necesita 1400 px.
            const outW = Math.max(600, Math.min(1700, Math.round(targetW * 9)));
            const outH = Math.round(outW / targetRatio);
            const { canvas, ctx } = lienzoBlanco(outW, outH);

            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
                resolve(canvas.toDataURL('image/jpeg', CALIDAD_FOTO));
            };
            img.onerror = reject;
            img.src = imgData.data;
        });
    }

    function loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const esDoc = esDocumentoImagen(file);
            const maxPx = esDoc ? MAX_PX_DOC : MAX_PX_FOTO;
            const calidad = esDoc ? CALIDAD_DOC : CALIDAD_FOTO;
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const escala = Math.min(1, maxPx / Math.max(img.width, img.height));
                    // Un JPEG que ya viene con buen tamaño se incrusta tal cual:
                    // evita una segunda compresión y el PDF lo guarda comprimido.
                    if (escala === 1 && /jpe?g/i.test(file.type || '')) {
                        resolve({ data: e.target.result, width: img.width, height: img.height });
                        return;
                    }
                    const w = Math.max(1, Math.round(img.width * escala));
                    const h = Math.max(1, Math.round(img.height * escala));
                    const { canvas, ctx } = lienzoBlanco(w, h);
                    ctx.drawImage(img, 0, 0, w, h);
                    resolve({ data: canvas.toDataURL('image/jpeg', calidad), width: w, height: h });
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
    // ============================================================
    // API PÚBLICA
    // ============================================================
    window.InformePDF = {
        // Estructura y secciones
        REPORTE,
        SECCIONES_FOTOS,
        flattenSecciones,
        resolverTitulo,
        getTextos,
        // Generación
        generarInformePDF,
        // Utilidades de imagen (las páginas las necesitan para la portada)
        loadImageFromFile,
        loadImageFromUrl,
        // Marca
        LOGO_URL, HEADER_URL, FOOTER_URL,
    };
})();
