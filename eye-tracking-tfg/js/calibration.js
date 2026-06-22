// ============================================================
// calibration.js — Calibración para WebGazer y MediaPipe
//
// Flujo compartido (WebGazer y MediaPipe):
//   [Tips + preview cámara]
//   → Fase 1: calibración (secuencial, 9 pts WG / 9 pts MP)
//   → Fase 2: validación (5 dianas, usuario ve su cursor)
//   → Resultado: Continuar | Recalibrar
// ============================================================

const Calibracion = (() => {

    // ── Puntos de calibración ─────────────────────────────────
    const PUNTOS_WG = [    // 9 puntos WebGazer (clic × 12)
        { top: '15%', left: '15%' }, { top: '15%', left: '50%' }, { top: '15%', left: '85%' },
        { top: '50%', left: '15%' }, { top: '50%', left: '50%' }, { top: '50%', left: '85%' },
        { top: '85%', left: '15%' }, { top: '85%', left: '50%' }, { top: '85%', left: '85%' }
    ];
    const PUNTOS_MP = [    // 9 puntos MediaPipe en rejilla 3×3 (mirar × 1.3 s)
        { top: '10%', left: '10%' }, { top: '10%', left: '50%' }, { top: '10%', left: '90%' },
        { top: '50%', left: '10%' }, { top: '50%', left: '50%' }, { top: '50%', left: '90%' },
        { top: '90%', left: '10%' }, { top: '90%', left: '50%' }, { top: '90%', left: '90%' }
    ];
    const PUNTOS_VAL = [   // 5 dianas de validación para mejorra la experiencia UX
        { top: '28%', left: '28%' }, { top: '28%', left: '72%' },
        { top: '72%', left: '28%' }, { top: '72%', left: '72%' },
        { top: '50%', left: '50%' }
    ];
    const CLICS_WG = 12;   // clics por punto en WebGazer

    // ── Estado ───────────────────────────────────────────────
    let motor        = null;
    let onCompletado = null;
    let previewRAF   = null;
    let dotIdxWG     = 0;
    let clicsWG      = 0;

    // ── API pública ──────────────────────────────────────────

    function iniciar(motorElegido, callback) {
        motor        = motorElegido;
        onCompletado = callback;
        dotIdxWG     = 0;
        clicsWG      = 0;
        _mostrarTips();   // SIEMPRE se muestran tips, sin importar el motor
    }

    function omitir() {
        _limpiar();
        _detenerPreview();
        if (onCompletado) onCompletado();
    }

    // ── PASO 0: Tips + preview de cámara (TODOS los motores) ─

    function _mostrarTips() {
        const extra = motor === 'webgazer'
            ? `<li>🎯 Mira el punto y haz clic <strong>${CLICS_WG} veces</strong> sin apartar los ojos</li>`
            : `<li>👁 Mira fijamente el punto durante toda la cuenta atrás</li>`;

        document.getElementById('cal-instrucciones').innerHTML = `
            <h2>Antes de calibrar</h2>
            <ul class="cal-tips-lista">
                <li>📏 Siéntate a <strong>50–70 cm</strong> de la pantalla</li>
                <li>💡 Ilumina tu cara de <strong>frente</strong> (sin luz detrás)</li>
                <li>🧍 Mantén la cabeza <strong>quieta y derecha</strong> durante toda la calibración</li>
                <li>👓 Sin gafas si puedes (los reflejos afectan a la precisión)</li>
                ${extra}
            </ul>
            <p class="cal-subtexto">Centra tu cara en el óvalo y pulsa cuando estés listo.</p>
            <button class="btn-grande" id="btn-empezar-cal">▶ Empezar calibración</button><br>
            <button id="btn-omitir-cal" onclick="Calibracion.omitir()">Omitir (no recomendado)</button>`;

        document.getElementById('btn-empezar-cal').addEventListener('click', () => {
            _detenerPreview();
            if (motor === 'webgazer') _fase1WebGazer(0);
            else if (motor === 'nose') _calibrarNariz();
            else _fase1MediaPipe(0);
        });

        _iniciarPreview();
    }

    // ── Preview de cámara (dibuja desde WebGazer videoFeed) ──

    function _iniciarPreview() {
        let intentos = 0;
        const buscar = setInterval(() => {
            intentos++;
            const feed = Tracker.getVideoFeed();
            if (feed || intentos > 30) {
                clearInterval(buscar);
                if (feed) _arrancarCanvas(feed);
                else {
                    // Fallback: mensaje si la cámara tarda
                    const w = document.createElement('div');
                    w.id = 'cal-cam-wrap';
                    w.innerHTML = '<div id="cal-cam-estado">📷 Cargando cámara...</div>';
                    document.getElementById('pantalla-calibracion').appendChild(w);
                }
            }
        }, 200);
    }

    function _arrancarCanvas(feed) {
        document.getElementById('cal-cam-wrap')?.remove();

        const wrap   = document.createElement('div');
        wrap.id      = 'cal-cam-wrap';
        const canvas = document.createElement('canvas');
        canvas.width = 220; canvas.height = 165;
        const estado = document.createElement('div');
        estado.id = 'cal-cam-estado';
        estado.textContent = 'Iniciando cámara...';
        wrap.appendChild(canvas);
        wrap.appendChild(estado);
        document.getElementById('pantalla-calibracion').appendChild(wrap);

        const ctx = canvas.getContext('2d');
        let frames = 0;

        function draw() {
            previewRAF = requestAnimationFrame(draw);
            frames++;
            if (feed.readyState >= 2) {
                // Imagen espejada (intuitivo para el usuario)
                ctx.save();
                ctx.translate(220, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(feed, 0, 0, 220, 165);
                ctx.restore();
            } else {
                ctx.fillStyle = '#0d1117';
                ctx.fillRect(0, 0, 220, 165);
                ctx.fillStyle = '#8b949e';
                ctx.font = '12px Segoe UI';
                ctx.textAlign = 'center';
                ctx.fillText('Iniciando cámara...', 110, 82);
            }
            // Óvalo guía
            ctx.strokeStyle = 'rgba(88,166,255,.85)';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([8, 5]);
            ctx.beginPath();
            ctx.ellipse(110, 82, 56, 70, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            // Etiqueta
            ctx.fillStyle = 'rgba(0,0,0,.55)';
            ctx.fillRect(0, 0, 220, 22);
            ctx.fillStyle = '#58a6ff';
            ctx.font = 'bold 11px Segoe UI';
            ctx.textAlign = 'center';
            ctx.fillText('📷 Centra tu cara aquí', 110, 14);
            // Estado
            if (frames % 30 === 0) {
                const el = document.getElementById('cal-cam-estado');
                if (el) el.textContent = feed.readyState >= 2
                    ? '✅ Cámara activa' : '⏳ Cargando cámara...';
            }
        }
        draw();
    }

    function _detenerPreview() {
        cancelAnimationFrame(previewRAF);
        previewRAF = null;
        document.getElementById('cal-cam-wrap')?.remove();
    }

    // ── FASE 1 — WebGazer (9 puntos, clic × 12) ─────────────

    function _fase1WebGazer(idx) {
        _limpiarPuntos();
        if (idx >= PUNTOS_WG.length) { _faseValidacion(); return; }

        _panelFase1WG(idx);

        const pos = PUNTOS_WG[idx];
        const btn = document.createElement('button');
        btn.className = 'punto-cal activo';
        btn.style.top  = pos.top;
        btn.style.left = pos.left;
        clicsWG = 0;

        btn.addEventListener('click', () => {
            clicsWG++;
            const pct = clicsWG / CLICS_WG;
            btn.style.background = `conic-gradient(#3fb950 ${pct*360}deg, #f85149 ${pct*360}deg)`;
            const c = document.getElementById('cal-clic-n');
            if (c) c.textContent = clicsWG;

            if (clicsWG >= CLICS_WG) {
                btn.disabled = true;
                btn.classList.replace('activo', 'completo');
                _actualizarBarraFase1(idx + 1, PUNTOS_WG.length);
                setTimeout(() => _fase1WebGazer(idx + 1), 600);
            }
        });

        document.getElementById('pantalla-calibracion').appendChild(btn);
    }

    function _panelFase1WG(idx) {
        document.getElementById('cal-instrucciones').innerHTML = `
            <h2>Calibración WebGazer — <strong>${idx + 1}</strong> / ${PUNTOS_WG.length}</h2>
            <p>Mira el punto rojo fijamente y haz clic
               <span id="cal-clic-n">0</span> / ${CLICS_WG} veces.<br>
               <em>Mira primero el punto, luego haz clic. No al revés.</em></p>
            <div id="cal-barra-wrap"><div id="cal-barra"
                style="width:${(idx/PUNTOS_WG.length)*100}%"></div></div>
            <p class="cal-tip">💡 No muevas la cabeza entre clics</p>
            <button id="btn-omitir-cal" onclick="Calibracion.omitir()">Omitir</button>`;
    }

    // ── FASE 1 — MediaPipe Iris (5 puntos, mirar 2 s c/u) ───

    async function _fase1MediaPipe(idx) {
        _limpiarPuntos();
        if (idx === 0) Tracker.resetCalibMP();   // solo al inicio, no en cada punto

        if (idx >= PUNTOS_MP.length) { _faseValidacion(); return; }

        const pos    = PUNTOS_MP[idx];
        const screenX = window.innerWidth  * parseFloat(pos.left) / 100;
        const screenY = window.innerHeight * parseFloat(pos.top)  / 100;

        // Mostrar punto y panel
        const dot = document.createElement('div');
        dot.className  = 'punto-mp activo';
        dot.style.top  = pos.top;
        dot.style.left = pos.left;
        document.getElementById('pantalla-calibracion').appendChild(dot);

        _panelFase1MP(idx, 2);

        // Cuenta atrás visual mientras dura muestreo (2 → 1 → ✓)
        let c = 2;
        const iv = setInterval(() => { c--; _panelFase1MP(idx, c); }, 1000);

        // 0.5 s de estabilización (la mirada se asienta), luego 1.5 s de muestras
        await _esperar(500);
        const iris = await Tracker.muestrearIris(1500);
        clearInterval(iv);

        if (iris) {
            Tracker.agregarPuntoCalibMP(screenX, screenY, iris.x, iris.y);
        }

        dot.classList.replace('activo', 'completo');
        _actualizarBarraFase1(idx + 1, PUNTOS_MP.length);

        await _esperar(400);
        _fase1MediaPipe(idx + 1);
    }

    function _panelFase1MP(idx, segsRestantes) {
        document.getElementById('cal-instrucciones').innerHTML = `
            <h2>Calibración Iris — <strong>${idx + 1}</strong> / ${PUNTOS_MP.length}</h2>
            <p>Mira fijamente el <strong style="color:#3fb950">punto verde</strong> en la pantalla
               sin mover los ojos ni la cabeza.</p>
            <div class="cal-countdown-sm">${segsRestantes > 0 ? segsRestantes : '✓'}</div>
            <div id="cal-barra-wrap"><div id="cal-barra"
                style="width:${(idx/PUNTOS_MP.length)*100}%"></div></div>
            <p class="cal-tip">💡 Cuanto más quieto estés, más preciso será el seguimiento</p>`;
    }

    // ── Calibración Nariz ─────────────────────────────────────

    async function _calibrarNariz() {
        document.getElementById('cal-instrucciones').innerHTML = `
            <h2>Calibración cabeza</h2>
            <p>Mira al <strong>centro de la pantalla</strong> fijamente.<br>
               El sistema tomará tu posición actual como referencia.</p>
            <div class="cal-countdown" id="cal-countdown">3</div>
            <p class="cal-tip">💡 Esta posición será tu punto central. Siéntate derecho.</p>`;

        let c = 3;
        const iv = setInterval(() => {
            c--;
            const el = document.getElementById('cal-countdown');
            if (el) el.textContent = c > 0 ? c : '✓';
            if (c <= 0) {
                clearInterval(iv);
                Tracker.calibrarNariz();
                setTimeout(_faseValidacion, 700);
            }
        }, 1000);
    }

    // ── FASE 2 — Validación (compartida por todos los motores) ─

    function _faseValidacion() {
        _limpiarPuntos();

        // Cursor visible durante validación
        const cur = document.createElement('div');
        cur.id = 'cal-cursor-validacion';
        document.getElementById('pantalla-calibracion').appendChild(cur);

        document.getElementById('cal-instrucciones').innerHTML = `
            <h2>Comprobando precisión</h2>
            <p>Mira el <strong style="color:#58a6ff">punto azul</strong>.<br>
               El cursor <strong style="color:orange">naranja</strong> es donde el sistema cree que miras.<br>
               Observa si los dos puntos coinciden.</p>
            <div id="cal-barra-wrap"><div id="cal-barra" style="width:0%"></div></div>
            <p class="cal-tip" id="val-estado">Punto 1 de ${PUNTOS_VAL.length}…</p>`;

        let idx = 0;

        function siguiente() {
            idx++;
            const b = document.getElementById('cal-barra');
            if (b) b.style.width = `${(idx / PUNTOS_VAL.length) * 100}%`;
            document.querySelector('.punto-val-seq')?.remove();

            if (idx >= PUNTOS_VAL.length) {
                _mostrarResultado();
            } else {
                const e = document.getElementById('val-estado');
                if (e) e.textContent = `Punto ${idx + 1} de ${PUNTOS_VAL.length}…`;
                mostrarPuntoVal(idx);
            }
        }

        function mostrarPuntoVal(i) {
            const d = document.createElement('div');
            d.className  = 'punto-val-seq';
            d.style.top  = PUNTOS_VAL[i].top;
            d.style.left = PUNTOS_VAL[i].left;
            document.getElementById('pantalla-calibracion').appendChild(d);
            setTimeout(siguiente, 2500);
        }

        mostrarPuntoVal(0);
    }

    // ── Resultado: Continuar | Recalibrar ────────────────────

    function _mostrarResultado() {
        document.getElementById('cal-cursor-validacion')?.remove();
        document.getElementById('cal-instrucciones').innerHTML = `
            <h2>¿Coincidió el cursor con tu mirada?</h2>
            <p>Si el cursor naranja seguía bien tu mirada, pulsa Continuar.<br>
               Si había mucha diferencia, vuelve a calibrar.</p>
            <div class="cal-resultado-btns">
                <button class="btn-grande"
                    onclick="Calibracion._continuar()">✅ Precisión correcta — Continuar</button>
                <button class="btn-secundario"
                    onclick="Calibracion._recalibrar()">🔄 Recalibrar</button>
            </div>`;
    }

    function _continuar() {
        _limpiar();
        if (onCompletado) onCompletado();
    }

    function _recalibrar() {
        try { webgazer.clearData(); } catch (_) {}
        Tracker.resetCalibMP();
        _limpiar();
        _mostrarTips();
    }

    // ── Helpers ──────────────────────────────────────────────

    function _actualizarBarraFase1(hecho, total) {
        const b = document.getElementById('cal-barra');
        if (b) b.style.width = `${(hecho / total) * 100}%`;
    }

    function _limpiarPuntos() {
        document.querySelectorAll('.punto-cal, .punto-mp, .punto-val-seq').forEach(e => e.remove());
    }

    function _limpiar() {
        _limpiarPuntos();
        document.getElementById('cal-cursor-validacion')?.remove();
    }

    function _esperar(ms) { return new Promise(r => setTimeout(r, ms)); }

    return { iniciar, omitir, _continuar, _recalibrar };
})();
