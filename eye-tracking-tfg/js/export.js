// ============================================================
// export.js — Exportación de datos a CSV
// ============================================================

const Exportar = (() => {

    // app.js llama a setAOIs() al inicio de la grabación con los AOIs
    // ya escalados al espacio de pantalla. Así el export no necesita
    // recalcularlos desde una pantalla que ya está oculta.
    let _aoisEscalados = [];

    function setAOIs(aois) {
        _aoisEscalados = Array.isArray(aois) ? aois : [];
    }

    function CSV() {
        const resumen = Metrics.resumenGlobal();
        const fix     = Metrics.getFijaciones();
        const sac     = Metrics.getSacadas();
        const raw     = Metrics.getMuestras();
        const t0      = Metrics.getTInicioSesion();
        const motor   = document.getElementById('info-motor')?.textContent || '';

        // BOM (﻿) para que Excel abra correctamente UTF-8
        let csv = '﻿';
        csv += 'sep=,\n';

        // ── Resumen global ────────────────────────────────────
        csv += '# RESUMEN GLOBAL\n';
        csv += `Motor,${motor}\n`;
        csv += `Exportado,${new Date().toLocaleString('es-ES')}\n`;
        csv += 'Parámetro,Valor\n';
        csv += `Duración sesión (ms),${resumen.duracionSesionMs}\n`;
        csv += `Total muestras,${resumen.totalMuestras}\n`;
        csv += `Frecuencia muestreo (Hz),${resumen.frecuenciaMuestreo}\n`;
        csv += `Total fijaciones,${resumen.totalFijaciones}\n`;
        csv += `Total sacadas,${resumen.totalSacadas}\n`;
        csv += `Duración media fijación (ms),${resumen.duracionMediaFijacion}\n`;
        csv += '\n';

        // ── Métricas por AOI ──────────────────────────────────
        if (_aoisEscalados.length > 0) {
            csv += '# MÉTRICAS POR AOI\n';
            csv += 'AOI,T primera fijación (ms),Fijaciones previas,Nº fijaciones,Duración media (ms),Tiempo total (ms)\n';
            _aoisEscalados.forEach(a => {
                const m = Metrics.calcularMetricasAOI(a);
                csv += [
                    a.nombre,
                    m.tPrimeraFijacion != null ? Math.round(m.tPrimeraFijacion) : 'N/A',
                    m.fijacionesPrevias != null ? m.fijacionesPrevias : 'N/A',
                    m.numFijaciones,
                    m.duracionMedia,
                    m.tiempoTotal
                ].join(',') + '\n';
            });
            csv += '\n';
        }

        // ── Fijaciones ────────────────────────────────────────
        csv += '# FIJACIONES\n';
        csv += 'Nº,X (px),Y (px),T inicio (ms),T fin (ms),Duración (ms),AOI\n';
        fix.forEach((f, i) => {
            // Determinar en qué AOI cae esta fijación (primera coincidencia)
            const aoiNombre = _aoisEscalados.find(a =>
                f.x >= a.x && f.x <= a.x + a.w &&
                f.y >= a.y && f.y <= a.y + a.h
            )?.nombre ?? '';
            csv += [
                i + 1, f.x, f.y,
                Math.round(f.tInicio - t0),
                Math.round(f.tFin   - t0),
                f.duracion,
                aoiNombre
            ].join(',') + '\n';
        });
        csv += '\n';

        // ── Sacadas ───────────────────────────────────────────
        if (sac.length > 0) {
            csv += '# SACADAS\n';
            csv += 'Nº,X1 (px),Y1 (px),X2 (px),Y2 (px),T (ms)\n';
            sac.forEach((s, i) => {
                csv += [
                    i + 1,
                    Math.round(s.x1), Math.round(s.y1),
                    Math.round(s.x2), Math.round(s.y2),
                    Math.round(s.t - t0)
                ].join(',') + '\n';
            });
            csv += '\n';
        }

        // ── Muestras raw ──────────────────────────────────────
        csv += '# MUESTRAS RAW (gaze)\n';
        csv += 'T (ms),X (px),Y (px)\n';
        raw.forEach(m => {
            csv += `${Math.round(m.t - t0)},${Math.round(m.x)},${Math.round(m.y)}\n`;
        });

        const ts = _timestamp();
        _descargar(csv, `eyetrack_${ts}.csv`, 'text/csv;charset=utf-8;');
    }

    // ── Helpers ───────────────────────────────────────────────

    function _timestamp() {
        const d = new Date();
        return [
            d.getFullYear(),
            String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0'),
            '_',
            String(d.getHours()).padStart(2, '0'),
            String(d.getMinutes()).padStart(2, '0')
        ].join('');
    }

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

    return { CSV, setAOIs };
})();
