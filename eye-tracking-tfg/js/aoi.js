// ============================================================
// aoi.js — Editor visual de Áreas de Interés (AOIs)
// Canvas drag-to-draw con alta visibilidad sobre cualquier fondo
// ============================================================

const AOI = (() => {
    let lista     = [];
    let dibujando = false;
    let drag      = null;
    let canvas    = null;
    let ctx       = null;
    let colorIdx  = 0;

    const COLORES = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];

    // ── Init ─────────────────────────────────────────────────

    function init() {
        canvas = document.getElementById('aoi-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        redimensionar();
        canvas.addEventListener('mousedown', _onMouseDown);
        canvas.addEventListener('mousemove', _onMouseMove);
        canvas.addEventListener('mouseup',   _onMouseUp);
        window.addEventListener('resize', redimensionar);
    }

    // Público — llamar después de cargar imagen/vídeo o mostrar pantalla config
    function redimensionar() {
        if (!canvas) return;
        const parent = canvas.parentElement;
        if (!parent || parent.offsetWidth === 0) return;
        canvas.width  = parent.offsetWidth;
        canvas.height = parent.offsetHeight;
        _render();
    }

    // ── Modos ────────────────────────────────────────────────

    function activarDibujo() {
        if (!canvas) return;
        dibujando = true;
        canvas.style.cursor = 'crosshair';
        const btn = document.getElementById('btn-dibujar-aoi');
        if (btn) {
            btn.textContent = '✕ Cancelar dibujo';
            btn.onclick = cancelarDibujo;
        }
    }

    function cancelarDibujo() {
        dibujando = false;
        drag = null;
        if (canvas) canvas.style.cursor = 'default';
        const btn = document.getElementById('btn-dibujar-aoi');
        if (btn) {
            btn.textContent = '✏ Dibujar AOI';
            btn.onclick = () => AOI.activarDibujo();
        }
        _render();
    }

    function limpiarTodas() {
        lista = [];
        colorIdx = 0;
        _render();
        _actualizarLista();
    }

    function eliminar(id) {
        lista = lista.filter(a => a.id !== id);
        _render();
        _actualizarLista();
    }

    function getLista() { return lista; }

    // ── Escalado al espacio de pantalla ──────────────────────

    function getListaEscalada(rectEstimulo) {
        if (!lista.length) return [];
        return lista.map(a => {
            // Usar dimensiones guardadas en el dibujo, NO getBoundingClientRect().
            // El panel de configuración está oculto cuando empieza la grabación,
            // por lo que getBoundingClientRect() devolvería 0×0 y el escalado sería Infinity.
            const pW = a._cw || (canvas ? canvas.width  : 860);
            const pH = a._ch || (canvas ? canvas.height : 380);
            if (!pW || !pH) return { ...a };   // fallback seguro
            const scaleX = rectEstimulo.width  / pW;
            const scaleY = rectEstimulo.height / pH;
            return {
                ...a,
                x: rectEstimulo.left + a.x * scaleX,
                y: rectEstimulo.top  + a.y * scaleY,
                w: a.w * scaleX,
                h: a.h * scaleY
            };
        });
    }

    // ── Render en canvas de grabación ────────────────────────

    function dibujarEnOverlay(ctxO, aoisEscalados, rectEstimulo) {
        aoisEscalados.forEach(a => {
            const x = a.x - rectEstimulo.left;
            const y = a.y - rectEstimulo.top;
            _dibujarRect(ctxO, x, y, a.w, a.h, a.color, a.nombre, 14);
        });
    }

    // ── Eventos canvas ───────────────────────────────────────

    function _onMouseDown(e) {
        if (!dibujando) return;
        const r = canvas.getBoundingClientRect();
        drag = { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function _onMouseMove(e) {
        if (!drag) return;
        const r  = canvas.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        _render();
        // Previsualización discontinua
        ctx.save();
        ctx.setLineDash([8, 4]);
        ctx.strokeStyle = COLORES[colorIdx % COLORES.length];
        ctx.lineWidth = 2;
        ctx.strokeRect(drag.x, drag.y, cx - drag.x, cy - drag.y);
        ctx.restore();
    }

    function _onMouseUp(e) {
        if (!drag) return;
        const r  = canvas.getBoundingClientRect();
        const ex = e.clientX - r.left;
        const ey = e.clientY - r.top;

        const x = Math.min(drag.x, ex);
        const y = Math.min(drag.y, ey);
        const w = Math.abs(ex - drag.x);
        const h = Math.abs(ey - drag.y);
        drag = null;

        if (w < 15 || h < 15) { _render(); return; }

        const nombre = document.getElementById('aoi-nombre')?.value.trim()
            || `AOI ${lista.length + 1}`;

        lista.push({
            id: 'aoi_' + Date.now(),
            nombre,
            x: Math.round(x), y: Math.round(y),
            w: Math.round(w), h: Math.round(h),
            color: COLORES[colorIdx % COLORES.length],
            // Guardar dimensiones del canvas en el momento del dibujo.
            // getListaEscalada las usa para el escalado aunque el panel esté oculto.
            _cw: canvas.width,
            _ch: canvas.height
        });
        colorIdx++;

        const inp = document.getElementById('aoi-nombre');
        if (inp) inp.value = '';

        cancelarDibujo();
        _actualizarLista();
    }

    // ── Renderizado ──────────────────────────────────────────

    function _render() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        lista.forEach(a => _dibujarRect(ctx, a.x, a.y, a.w, a.h, a.color, a.nombre, 13));
    }

    /**
     * Dibuja un rectángulo AOI con borde doble (blanco + color) para que
     * sea visible sobre cualquier fondo (oscuro o claro).
     */
    function _dibujarRect(c, x, y, w, h, color, nombre, fontSize) {
        // Borde exterior blanco (contraste universal)
        c.strokeStyle = 'white';
        c.lineWidth = 4;
        c.strokeRect(x, y, w, h);

        // Borde interior del color del AOI
        c.strokeStyle = color;
        c.lineWidth = 2;
        c.strokeRect(x, y, w, h);

        // Relleno semitransparente
        c.fillStyle = color + '40';
        c.fillRect(x, y, w, h);

        // Etiqueta con fondo oscuro para legibilidad
        c.font = `bold ${fontSize}px Segoe UI`;
        const textW = c.measureText(nombre).width;
        const padX = 6, padY = 3, th = fontSize + padY * 2;
        // Fondo de etiqueta
        c.fillStyle = 'rgba(0,0,0,0.75)';
        c.fillRect(x + 4, y + 4, textW + padX * 2, th);
        // Texto
        c.fillStyle = color;
        c.fillText(nombre, x + 4 + padX, y + 4 + padY + fontSize - 2);
    }

    function _actualizarLista() {
        const cont = document.getElementById('aoi-lista');
        if (!cont) return;
        cont.innerHTML = lista.length === 0
            ? '<p class="aoi-vacia">No hay AOIs definidas. Haz clic en "Dibujar AOI" y arrastra sobre la imagen.</p>'
            : lista.map(a => `
                <div class="aoi-chip" style="border-left: 4px solid ${a.color}">
                    <span class="aoi-chip-nombre">${a.nombre}</span>
                    <small>${Math.round(a.w)}×${Math.round(a.h)} px</small>
                    <button onclick="AOI.eliminar('${a.id}')" title="Eliminar">✕</button>
                </div>`).join('');
    }

    return {
        init, redimensionar, activarDibujo, cancelarDibujo,
        limpiarTodas, eliminar, getLista, getListaEscalada, dibujarEnOverlay
    };
})();
