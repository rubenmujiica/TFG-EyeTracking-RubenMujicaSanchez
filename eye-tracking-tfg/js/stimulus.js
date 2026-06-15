// ============================================================
// stimulus.js — Cargador de estímulos (URL, imagen, vídeo)
// Gestiona la vista previa en configuración y la visualización
// en la pantalla de grabación.
// ============================================================

const Estimulo = (() => {
    let tipo    = 'url';    // 'url' | 'imagen' | 'video'
    let recurso = null;     // URL string o ObjectURL

    // ── Selección de tipo ────────────────────────────────────

    function seleccionarTipo(nuevoTipo, btnEl) {
        tipo = nuevoTipo;
        document.querySelectorAll('.config-panel-estimulo').forEach(p => p.classList.add('oculto'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
        document.getElementById(`config-${nuevoTipo}`).classList.remove('oculto');
        btnEl.classList.add('activo');
        recurso = null;
        _limpiarPreviewEstimulo();
    }

    // ── Carga de cada tipo ───────────────────────────────────

    function cargarURL() {
        const val = document.getElementById('input-url').value.trim();
        if (!val) return;
        recurso = val.startsWith('http') ? val : 'https://' + val;
        _mostrarPreviewURL(recurso);
    }

    function cargarImagen(input) {
        if (!input.files?.[0]) return;
        recurso = URL.createObjectURL(input.files[0]);
        const div = document.getElementById('preview-imagen');
        div.innerHTML = `<img src="${recurso}" alt="preview" />`;
        _sincronizarPreviewAOI('img', recurso);
        // Redimensionar canvas AOI después de que la imagen cargue
        const img = new Image();
        img.onload = () => setTimeout(() => AOI.redimensionar(), 50);
        img.src = recurso;
    }

    function cargarVideo(input) {
        if (!input.files?.[0]) return;
        recurso = URL.createObjectURL(input.files[0]);
        const div = document.getElementById('preview-video');
        div.innerHTML = `<video src="${recurso}" controls muted style="max-width:100%;max-height:200px"></video>`;
        _sincronizarPreviewAOI('video', recurso);
        setTimeout(() => AOI.redimensionar(), 100);
    }

    // ── Activar estímulo en grabación ────────────────────────

    function activarEnGrabacion() {
        const iframe = document.getElementById('estimulo-iframe');
        const img    = document.getElementById('estimulo-imagen');
        const video  = document.getElementById('estimulo-video');

        [iframe, img, video].forEach(el => el.classList.add('oculto'));

        if (!recurso) return;

        if (tipo === 'url') {
            iframe.src = recurso;
            iframe.classList.remove('oculto');
        } else if (tipo === 'imagen') {
            img.src = recurso;
            img.classList.remove('oculto');
        } else if (tipo === 'video') {
            video.src = recurso;
            video.classList.remove('oculto');
            video.play().catch(() => {});
        }
    }

    function detener() {
        const video = document.getElementById('estimulo-video');
        if (video) video.pause();
    }

    function getTipo()    { return tipo; }
    function getRecurso() { return recurso; }

    // ── Privado ──────────────────────────────────────────────

    function _mostrarPreviewURL(url) {
        const area = document.getElementById('aoi-estimulo-preview');
        area.innerHTML = `
            <iframe src="${url}" class="preview-iframe-aoi"
                sandbox="allow-scripts allow-same-origin"
                title="Preview estímulo"></iframe>`;
    }

    function _limpiarPreviewEstimulo() {
        const area = document.getElementById('aoi-estimulo-preview');
        if (area) area.innerHTML = '';
    }

    function _sincronizarPreviewAOI(etiqueta, src) {
        const area = document.getElementById('aoi-estimulo-preview');
        if (!area) return;
        if (etiqueta === 'img') {
            area.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain" />`;
        } else {
            area.innerHTML = `<video src="${src}" muted style="max-width:100%;max-height:100%"></video>`;
        }
    }

    return { seleccionarTipo, cargarURL, cargarImagen, cargarVideo, activarEnGrabacion, detener, getTipo, getRecurso };
})();
