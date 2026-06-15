// ============================================================
// metrics.js — Detección de fijaciones (I-DT) y métricas AOI
//
// Algoritmo: I-DT (Identification by Dispersion Threshold)
//   - Ventana deslizante de muestras de gaze
//   - Si dispersión < umbral Y duración >= mínima → fijación
//   - Caso contrario → sacada
//
// Muestreo real: ~60 Hz (≈16 ms/muestra) limitado por webcam/rAF
// ============================================================

const Metrics = (() => {

    // ── Estado ───────────────────────────────────────────────
    let muestras        = [];   // { x, y, t }  — gaze raw
    let fijaciones      = [];   // { x, y, tInicio, tFin, duracion }
    let sacadas         = [];   // { x1,y1,x2,y2, t }
    let tInicioSesion   = null;
    let grabando        = false;

    // Parámetros (configurables desde UI)
    let UMBRAL_DISP   = 50;   // píxeles — radio de dispersión máximo para fijación
    let DUR_MIN       = 100;  // ms — duración mínima para considerar fijación
    let VENTANA_IDT   = [];   // buffer de la ventana deslizante actual

    // ── API pública ──────────────────────────────────────────

    function configurar(dispersion, duracionMin) {
        UMBRAL_DISP = dispersion;
        DUR_MIN     = duracionMin;
    }

    function iniciarSesion() {
        muestras      = [];
        fijaciones    = [];
        sacadas       = [];
        VENTANA_IDT   = [];
        tInicioSesion = performance.now();
        grabando      = true;
    }

    function detenerSesion() {
        grabando = false;
        // Procesar lo que quede en la ventana
        if (VENTANA_IDT.length > 0) _intentarFijacion(VENTANA_IDT);
        VENTANA_IDT = [];
    }

    // Llamado por Tracker en cada muestra de gaze
    function procesarMuestra(x, y, t) {
        if (!grabando) return;
        const muestra = { x, y, t };
        muestras.push(muestra);
        _iDT(muestra);
    }

    function getFijaciones()   { return fijaciones; }
    function getSacadas()      { return sacadas; }
    function getMuestras()     { return muestras; }
    function getTInicioSesion(){ return tInicioSesion; }

    // ── Métricas por AOI ─────────────────────────────────────
    /**
     * Calcula las 5 métricas atencionales para un AOI dado.
     * @param {Object} aoi — { x, y, w, h } en píxeles pantalla
     * @returns {Object} métricas
     */
    function calcularMetricasAOI(aoi) {
        const fixEnAOI = fijaciones.filter(f => _enAOI(f, aoi));
        const fixFuera = fijaciones.filter(f => !_enAOI(f, aoi));

        // 1. Tiempo hasta primera fijación en AOI (desde inicio sesión)
        const primeraFix = fixEnAOI.length > 0 ? fixEnAOI[0] : null;
        const tPrimeraFijacion = primeraFix
            ? primeraFix.tInicio - tInicioSesion
            : null;

        // 2. Número de fijaciones previas a la primera fijación en AOI
        let fijacionesPrevias = null;
        if (primeraFix) {
            fijacionesPrevias = fijaciones.filter(f => f.tInicio < primeraFix.tInicio).length;
        }

        // 3. Número de fijaciones dentro del AOI
        const numFijaciones = fixEnAOI.length;

        // 4. Duración media de fijaciones en AOI
        const duracionMedia = numFijaciones > 0
            ? fixEnAOI.reduce((s, f) => s + f.duracion, 0) / numFijaciones
            : 0;

        // 5. Tiempo total de fijaciones dentro del AOI
        const tiempoTotal = fixEnAOI.reduce((s, f) => s + f.duracion, 0);

        return {
            tPrimeraFijacion,       // ms desde inicio (null si nunca se miró)
            fijacionesPrevias,      // entero (null si nunca se miró)
            numFijaciones,          // entero
            duracionMedia: Math.round(duracionMedia),  // ms
            tiempoTotal             // ms
        };
    }

    /** Resumen global de la sesión */
    function resumenGlobal() {
        const durSesion = grabando
            ? performance.now() - tInicioSesion
            : (muestras.length > 0 ? muestras[muestras.length - 1].t - tInicioSesion : 0);
        return {
            totalMuestras:   muestras.length,
            frecuenciaMuestreo: muestras.length > 1
                ? Math.round(1000 / ((muestras[muestras.length-1].t - muestras[0].t) / (muestras.length - 1)))
                : 0,
            totalFijaciones: fijaciones.length,
            totalSacadas:    sacadas.length,
            duracionSesionMs: Math.round(durSesion),
            duracionMediaFijacion: fijaciones.length > 0
                ? Math.round(fijaciones.reduce((s, f) => s + f.duracion, 0) / fijaciones.length)
                : 0
        };
    }

    // ── Algoritmo I-DT interno ───────────────────────────────

    function _iDT(muestra) {
        VENTANA_IDT.push(muestra);

        // Calcular dispersión de la ventana actual
        const disp = _dispersion(VENTANA_IDT);

        if (disp <= UMBRAL_DISP) {
            // Posible fijación — ampliar ventana
        } else {
            // Dispersión supera umbral: examinar si la ventana (sin último punto) es fijación
            const candidata = VENTANA_IDT.slice(0, -1);
            _intentarFijacion(candidata);
            // Reiniciar ventana con el punto actual
            VENTANA_IDT = [muestra];
        }
    }

    function _intentarFijacion(ventana) {
        if (ventana.length < 2) return;
        const duracion = ventana[ventana.length - 1].t - ventana[0].t;
        if (duracion < DUR_MIN) {
            // Sacada o movimiento suprathreshold
            if (fijaciones.length > 0 && ventana.length > 0) {
                const ultima = fijaciones[fijaciones.length - 1];
                sacadas.push({
                    x1: ultima.x, y1: ultima.y,
                    x2: ventana[0].x, y2: ventana[0].y,
                    t: ventana[0].t
                });
            }
            return;
        }
        const cx = ventana.reduce((s, p) => s + p.x, 0) / ventana.length;
        const cy = ventana.reduce((s, p) => s + p.y, 0) / ventana.length;

        // Registrar sacada entre fijación anterior y esta
        if (fijaciones.length > 0) {
            const ult = fijaciones[fijaciones.length - 1];
            sacadas.push({ x1: ult.x, y1: ult.y, x2: cx, y2: cy, t: ventana[0].t });
        }

        fijaciones.push({
            x: Math.round(cx),
            y: Math.round(cy),
            tInicio: ventana[0].t,
            tFin: ventana[ventana.length - 1].t,
            duracion: Math.round(duracion)
        });
    }

    function _dispersion(pts) {
        if (pts.length < 2) return 0;
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        return (Math.max(...xs) - Math.min(...xs)) + (Math.max(...ys) - Math.min(...ys));
    }

    function _enAOI(fijacion, aoi) {
        return fijacion.x >= aoi.x && fijacion.x <= aoi.x + aoi.w &&
               fijacion.y >= aoi.y && fijacion.y <= aoi.y + aoi.h;
    }

    return {
        configurar, iniciarSesion, detenerSesion, procesarMuestra,
        getFijaciones, getSacadas, getMuestras, getTInicioSesion,
        calcularMetricasAOI, resumenGlobal
    };
})();
