// ============================================================
// app.js — Controlador principal de la aplicación
// Orquesta pantallas, calibración, grabación y resultados
// ============================================================

const App = (() => {
    let motorSeleccionado = null;
    let timerGrabacion    = null;
    let segundosGrabacion = 0;
    let pausado           = false;
    let aoisEnGrabacion   = [];

    // ── Arranque ─────────────────────────────────────────────

    window.addEventListener('DOMContentLoaded', () => {
        AOI.init();
    });

    // ── Flujo de pantallas ───────────────────────────────────

    async function iniciar(motor) {
        motorSeleccionado = motor;

        // El tracker SIEMPRE arranca antes de la calibración:
        // WebGazer necesita estar activo para registrar los clics de calibración.
        // MediaPipe necesita la cámara para la cuenta atrás automática.
        await Tracker.iniciar(motor, _onGaze, 4);

        _mostrarPantalla('pantalla-calibracion');

        Calibracion.iniciar(motor, () => {
            _mostrarPantalla('pantalla-config');
            // Forzar redimensionado del canvas AOI ahora que la pantalla es visible
            setTimeout(() => AOI.redimensionar(), 100);
        });
    }

    function iniciarGrabacion() {
        // Leer parámetros
        const disp    = parseInt(document.getElementById('param-dispersion').value)   || 50;
        const durMin  = parseInt(document.getElementById('param-duracion-min').value) || 100;
        const ventana = parseInt(document.getElementById('param-suavizado').value)    || 6;

        Metrics.configurar(disp, durMin);
        Tracker.setVentanaFiltro(ventana);

        // Guardar AOIs escalados al inicio de la grabación
        _mostrarPantalla('pantalla-grabacion');

        document.getElementById('info-motor').textContent = motorSeleccionado.toUpperCase();

        Estimulo.activarEnGrabacion();
        Metrics.iniciarSesion();

        // Calcular AOIs escalados al frame del estímulo
        setTimeout(() => {
            const el = _getEstimuloElement();
            const rect = el ? el.getBoundingClientRect()
                            : { left:0, top:0, width: window.innerWidth, height: window.innerHeight };
            aoisEnGrabacion = AOI.getListaEscalada(rect);
            // Compartir los AOIs escalados con el módulo de exportación
            Exportar.setAOIs(aoisEnGrabacion);
            _renderOverlayAOIs();
        }, 300);

        Tracker.reanudar();
        pausado = false;

        // Timer
        segundosGrabacion = 0;
        timerGrabacion = setInterval(() => {
            if (!pausado) {
                segundosGrabacion++;
                _actualizarTimer();
            }
        }, 1000);

        document.getElementById('indicador-rec').className = 'rec-activo';
    }

    function volverInicio() {
        Tracker.detener();
        Estimulo.detener();
        window.location.reload();
    }

    function volverConfig() {
        _pararTimer();
        _mostrarPantalla('pantalla-config');
    }

    // ── Grabación ────────────────────────────────────────────

    const Grabacion = {
        toggle() {
            pausado = !pausado;
            const btn    = document.getElementById('btn-rec-toggle');
            const cursor = document.getElementById('cursor-mirada');
            if (pausado) {
                Tracker.detener();
                btn.textContent = '▶ Reanudar';
                document.getElementById('indicador-rec').className = 'rec-pausado';
                if (cursor) cursor.style.display = 'none';
            } else {
                Tracker.reanudar();
                btn.textContent = '⏸ Pausar';
                document.getElementById('indicador-rec').className = 'rec-activo';
                if (cursor) cursor.style.display = 'block';
            }
        },

        detener() {
            _pararTimer();
            Tracker.detener();
            Estimulo.detener();
            Metrics.detenerSesion();
            _mostrarResultados();
        }
    };

    // ── Callback de gaze ─────────────────────────────────────

    function _onGaze(x, y, t) {
        // Cursor de validación en pantalla de calibración (fase 2)
        const cursorVal = document.getElementById('cal-cursor-validacion');
        if (cursorVal) {
            cursorVal.style.left = x + 'px';
            cursorVal.style.top  = y + 'px';
        }

        if (pausado) return;

        // Cursor de mirada durante grabación
        const cursor = document.getElementById('cursor-mirada');
        if (cursor) {
            cursor.style.left = x + 'px';
            cursor.style.top  = y + 'px';
        }

        Metrics.procesarMuestra(x, y, t);

        // Actualizar contadores en barra
        const fix = Metrics.getFijaciones();
        const raw = Metrics.getMuestras();
        document.getElementById('info-fijaciones').textContent = `Fijaciones: ${fix.length}`;
        document.getElementById('info-muestras').textContent   = `Muestras: ${raw.length}`;

    }

    // ── Resultados ───────────────────────────────────────────

    function _mostrarResultados() {
        _mostrarPantalla('pantalla-resultados');

        const res = Metrics.resumenGlobal();

        // Cards de resumen
        document.getElementById('resumen-global').innerHTML = [
            { label: 'Duración sesión',       val: _ms(res.duracionSesionMs) },
            { label: 'Total muestras',        val: res.totalMuestras },
            { label: 'Frecuencia muestreo',   val: res.frecuenciaMuestreo + ' Hz' },
            { label: 'Total fijaciones',      val: res.totalFijaciones },
            { label: 'Total sacadas',         val: res.totalSacadas },
            { label: 'Duración media fix.',   val: res.duracionMediaFijacion + ' ms' }
        ].map(c => `<div class="card-resumen"><div class="card-valor">${c.val}</div><div class="card-label">${c.label}</div></div>`).join('');

        // Tabla AOI
        const tbody = document.getElementById('tabla-aoi-body');
        if (aoisEnGrabacion.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;opacity:.6">No se definieron AOIs</td></tr>';
        } else {
            tbody.innerHTML = aoisEnGrabacion.map(a => {
                const m = Metrics.calcularMetricasAOI(a);
                return `<tr>
                    <td><span class="aoi-badge" style="background:${a.color}">${a.nombre}</span></td>
                    <td>${m.tPrimeraFijacion != null ? _ms(m.tPrimeraFijacion) : '—'}</td>
                    <td>${m.fijacionesPrevias ?? '—'}</td>
                    <td>${m.numFijaciones}</td>
                    <td>${m.duracionMedia} ms</td>
                    <td>${_ms(m.tiempoTotal)}</td>
                </tr>`;
            }).join('');
        }

        // Heatmap y scanpath
        _renderHeatmap();
        _renderScanpath();
    }

    // ── Heatmap ──────────────────────────────────────────────

    function _renderHeatmap() {
        const canvas = document.getElementById('heatmap-canvas');
        const wrap   = document.getElementById('heatmap-wrap');
        canvas.width  = wrap.offsetWidth;
        canvas.height = wrap.offsetHeight || 400;
        const ctx = canvas.getContext('2d');

        const raw = Metrics.getMuestras();
        if (raw.length === 0) return;

        // Escalar coordenadas al canvas
        const scaleX = canvas.width  / window.innerWidth;
        const scaleY = canvas.height / window.innerHeight;
        const R = 40;

        raw.forEach(m => {
            const grd = ctx.createRadialGradient(
                m.x * scaleX, m.y * scaleY, 0,
                m.x * scaleX, m.y * scaleY, R);
            grd.addColorStop(0, 'rgba(255,0,0,0.06)');
            grd.addColorStop(1, 'rgba(255,0,0,0)');
            ctx.fillStyle = grd;
            ctx.fillRect(m.x * scaleX - R, m.y * scaleY - R, R*2, R*2);
        });
    }

    // ── Scanpath ─────────────────────────────────────────────

    function _renderScanpath() {
        const canvas = document.getElementById('scanpath-canvas');
        const wrap   = document.getElementById('scanpath-wrap');
        canvas.width  = wrap.offsetWidth;
        canvas.height = wrap.offsetHeight || 400;
        const ctx = canvas.getContext('2d');

        const fix = Metrics.getFijaciones();
        if (fix.length === 0) return;

        const scaleX = canvas.width  / window.innerWidth;
        const scaleY = canvas.height / window.innerHeight;

        // Líneas de sacada
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;
        for (let i = 1; i < fix.length; i++) {
            ctx.beginPath();
            ctx.moveTo(fix[i-1].x * scaleX, fix[i-1].y * scaleY);
            ctx.lineTo(fix[i].x   * scaleX, fix[i].y   * scaleY);
            ctx.stroke();
        }

        // Círculos de fijación (radio proporcional a duración)
        const maxDur = Math.max(...fix.map(f => f.duracion));
        fix.forEach((f, i) => {
            const r = 8 + (f.duracion / maxDur) * 22;
            const alpha = 0.4 + (i / fix.length) * 0.6;
            ctx.beginPath();
            ctx.arc(f.x * scaleX, f.y * scaleY, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(52,152,219,${alpha})`;
            ctx.fill();
            ctx.strokeStyle = 'white';
            ctx.lineWidth = 1;
            ctx.stroke();
            // Número de orden
            ctx.fillStyle = 'white';
            ctx.font = `bold ${Math.max(9, r * 0.7)}px Segoe UI`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(i + 1, f.x * scaleX, f.y * scaleY);
        });
    }


    // ── Canvas overlay AOIs durante grabación ────────────────

    function _renderOverlayAOIs() {
        const canvas = document.getElementById('canvas-overlay');
        const zona   = document.getElementById('zona-estimulo');
        canvas.width  = zona.offsetWidth;
        canvas.height = zona.offsetHeight;
        const ctx = canvas.getContext('2d');
        const rect = zona.getBoundingClientRect();
        AOI.dibujarEnOverlay(ctx, aoisEnGrabacion, rect);
    }

    // ── Helpers ──────────────────────────────────────────────

    function _mostrarPantalla(id) {
        document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
        document.getElementById(id)?.classList.add('activa');
    }

    function _actualizarTimer() {
        const m = String(Math.floor(segundosGrabacion / 60)).padStart(2, '0');
        const s = String(segundosGrabacion % 60).padStart(2, '0');
        document.getElementById('grabacion-tiempo').textContent = `${m}:${s}`;
    }

    function _pararTimer() {
        clearInterval(timerGrabacion);
        timerGrabacion = null;
    }

    function _getEstimuloElement() {
        const iframe = document.getElementById('estimulo-iframe');
        const img    = document.getElementById('estimulo-imagen');
        const video  = document.getElementById('estimulo-video');
        if (!iframe?.classList.contains('oculto')) return iframe;
        if (!img?.classList.contains('oculto'))    return img;
        if (!video?.classList.contains('oculto'))  return video;
        return document.getElementById('zona-estimulo');
    }

    function _ms(ms) {
        if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
        return Math.round(ms) + ' ms';
    }

    // Exponer Grabacion al HTML
    window.Grabacion = Grabacion;

    return { iniciar, iniciarGrabacion, volverInicio, volverConfig };
})();
