// ============================================================
// export.js — Exportación de datos a CSV y JSON
// ============================================================

const Exportar = (() => {

    function CSV() {
        const resumen  = Metrics.resumenGlobal();
        const fix      = Metrics.getFijaciones();
        const aois     = AOI.getLista();

        let csv = 'sep=,\n';

        // Resumen global
        csv += '# RESUMEN GLOBAL\n';
        csv += 'Parámetro,Valor\n';
        csv += `Duración sesión (ms),${resumen.duracionSesionMs}\n`;
        csv += `Total muestras,${resumen.totalMuestras}\n`;
        csv += `Frecuencia muestreo (Hz),${resumen.frecuenciaMuestreo}\n`;
        csv += `Total fijaciones,${resumen.totalFijaciones}\n`;
        csv += `Total sacadas,${resumen.totalSacadas}\n`;
        csv += `Duración media fijación (ms),${resumen.duracionMediaFijacion}\n\n`;

        // Fijaciones brutas
        csv += '# FIJACIONES\n';
        csv += 'Nº,X (px),Y (px),T inicio (ms),T fin (ms),Duración (ms)\n';
        fix.forEach((f, i) => {
            csv += `${i+1},${f.x},${f.y},${Math.round(f.tInicio - Metrics.getTInicioSesion())},${Math.round(f.tFin - Metrics.getTInicioSesion())},${f.duracion}\n`;
        });
        csv += '\n';

        // Métricas por AOI
        if (aois.length > 0) {
            csv += '# MÉTRICAS POR AOI\n';
            csv += 'AOI,T primera fijación (ms),Fijaciones previas,Nº fijaciones en AOI,Duración media (ms),Tiempo total (ms)\n';

            const estimuloEl = _getEstimuloElement();
            const rect = estimuloEl ? estimuloEl.getBoundingClientRect() : { left:0, top:0, width: window.innerWidth, height: window.innerHeight };
            const aoisEscalados = AOI.getListaEscalada(rect);

            aoisEscalados.forEach(a => {
                const m = Metrics.calcularMetricasAOI(a);
                csv += `${a.nombre},${m.tPrimeraFijacion ?? 'N/A'},${m.fijacionesPrevias ?? 'N/A'},${m.numFijaciones},${m.duracionMedia},${m.tiempoTotal}\n`;
            });
        }

        _descargar(csv, 'eyetrack_resultados.csv', 'text/csv;charset=utf-8;');
    }

    function JSON_export() {
        const resumen = Metrics.resumenGlobal();
        const fix     = Metrics.getFijaciones();
        const sac     = Metrics.getSacadas();
        const raw     = Metrics.getMuestras();
        const aois    = AOI.getLista();

        const estimuloEl = _getEstimuloElement();
        const rect = estimuloEl ? estimuloEl.getBoundingClientRect() : { left:0, top:0, width: window.innerWidth, height: window.innerHeight };
        const aoisEscalados = AOI.getListaEscalada(rect);

        const metricasAOI = aoisEscalados.map(a => ({
            aoi: a.nombre,
            coords: { x: a.x, y: a.y, w: a.w, h: a.h },
            metricas: Metrics.calcularMetricasAOI(a)
        }));

        const t0 = Metrics.getTInicioSesion();
        const data = {
            exportado: new Date().toISOString(),
            motor: document.getElementById('info-motor')?.textContent || '',
            resumenGlobal: resumen,
            metricasAOI,
            fijaciones: fix.map(f => ({
                x: f.x, y: f.y,
                tInicio: Math.round(f.tInicio - t0),
                tFin: Math.round(f.tFin - t0),
                duracion: f.duracion
            })),
            sacadas: sac.map(s => ({
                x1: Math.round(s.x1), y1: Math.round(s.y1),
                x2: Math.round(s.x2), y2: Math.round(s.y2),
                t: Math.round(s.t - t0)
            })),
            muestrasRaw: raw.map(m => ({
                x: Math.round(m.x), y: Math.round(m.y),
                t: Math.round(m.t - t0)
            }))
        };

        _descargar(
            JSON.stringify(data, null, 2),
            'eyetrack_resultados.json',
            'application/json'
        );
    }

    // Alias
    const JSON = JSON_export;

    function _descargar(contenido, nombre, tipo) {
        const blob = new Blob([contenido], { type: tipo });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function _getEstimuloElement() {
        const iframe = document.getElementById('estimulo-iframe');
        const img    = document.getElementById('estimulo-imagen');
        const video  = document.getElementById('estimulo-video');
        if (!iframe?.classList.contains('oculto')) return iframe;
        if (!img?.classList.contains('oculto'))    return img;
        if (!video?.classList.contains('oculto'))  return video;
        return null;
    }

    return { CSV, JSON };
})();
