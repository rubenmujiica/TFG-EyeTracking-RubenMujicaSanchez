// ============================================================
// tracker.js — Motores de eye tracking
//
// WebGazer: regresión ridge + Kalman filter
// MediaPipe: calibración de 5 puntos + regresión lineal
//            (iris_x → screen_x, iris_y → screen_y)
//
// BUG ANTERIOR corregido: el loop de MediaPipe usaba
// "if (!activo) return" dentro del rAF → al pausar el loop
// moría y no se reiniciaba al reanudar.
// FIX: el loop siempre corre; 'activo' solo controla la emisión.
// ============================================================

const Tracker = (() => {

    let motorActivo  = null;
    let gazeCallback = null;
    let activo       = false;
    let loopVivo     = false;   // controla si el loop de MediaPipe vive

    let bufX = [], bufY = [];
    let ventanaFiltro = 4;

    // Última posición cruda del iris (se actualiza SIEMPRE, activo o no)
    let ultimaIris = null;

    // ── Calibración MediaPipe (9 puntos, regresión cuadrática 2D) ──
    let calibMP = {
        puntos: [],   // [{irisX, irisY, screenX, screenY}]
        coefX: null,  // 6 coeficientes → screen_x = coefX·features(iris)
        coefY: null,
        listo: false
    };

    // Calibración nariz (referencia puntual, misma que antes)
    let calibNariz = null;

    // ── API pública ──────────────────────────────────────────

    async function iniciar(motor, callback, ventana = 4) {
        motorActivo   = motor;
        gazeCallback  = callback;
        ventanaFiltro = ventana;
        activo        = true;
        bufX = []; bufY = [];

        if (motor === 'webgazer') {
            await _iniciarWebGazer();
        } else {
            await _iniciarWebGazerSilencioso();
            await _iniciarMediaPipe();
        }
    }

    function detener() {
        activo = false;
        // NO tocamos loopVivo → el loop de MediaPipe sigue corriendo
        // 'activo=false' basta para que _onFaceResults no emita nada
        try { webgazer.pause(); } catch (_) {}
    }

    function reanudar() {
        activo = true;
        bufX = []; bufY = [];
        try { if (motorActivo === 'webgazer') webgazer.resume(); } catch (_) {}
    }

    function destruir() {
        loopVivo = false;
        activo   = false;
    }

    function setVentanaFiltro(v) { ventanaFiltro = Math.max(1, v); }

    function getVideoFeed() {
        return document.getElementById('webgazerVideoFeed') || null;
    }

    // ── Calibración MediaPipe ────────────────────────────────

    /** Recoge muestras del iris durante `ms` ms y devuelve el promedio */
    function muestrearIris(ms) {
        return new Promise(resolve => {
            const muestras = [];
            const iv = setInterval(() => {
                if (ultimaIris) muestras.push({ x: ultimaIris.x, y: ultimaIris.y });
            }, 33);
            setTimeout(() => {
                clearInterval(iv);
                if (!muestras.length) { resolve(null); return; }
                resolve({
                    x: muestras.reduce((s, m) => s + m.x, 0) / muestras.length,
                    y: muestras.reduce((s, m) => s + m.y, 0) / muestras.length
                });
            }, ms);
        });
    }

    /** Añade un punto de calibración; cuando hay ≥6 calcula la regresión cuadrática */
    function agregarPuntoCalibMP(screenX, screenY, irisX, irisY) {
        calibMP.puntos.push({ irisX, irisY, screenX, screenY });
        if (calibMP.puntos.length >= 6) _computarRegresionMP();
    }

    function resetCalibMP() {
        calibMP    = { puntos: [], coefX: null, coefY: null, listo: false };
        ultimaIris = null;
    }

    function calibrarNariz() {
        calibNariz = null; // se asignará en el próximo frame
        // _onFaceResults lo detecta cuando calibNariz===null y motorActivo==='nose'
    }

    // ── WebGazer ─────────────────────────────────────────────

    async function _iniciarWebGazer() {
        webgazer.params.saveDataAcrossSessions = false;
        webgazer.params.showVideo              = false;
        webgazer.params.showFaceOverlay        = false;
        webgazer.params.showFaceFeedbackBox    = false;
        webgazer.clearData();
        webgazer.setRegression('ridge');

        await webgazer.begin();

        webgazer.setGazeListener((data) => {
            if (!activo || motorActivo !== 'webgazer' || !data) return;
            _emitir(data.x, data.y);
        });
        webgazer.showPredictionPoints(false);
        webgazer.applyKalmanFilter(true);
    }

    async function _iniciarWebGazerSilencioso() {
        webgazer.params.saveDataAcrossSessions = false;
        webgazer.params.showVideo              = false;
        webgazer.params.showFaceOverlay        = false;
        webgazer.params.showFaceFeedbackBox    = false;
        webgazer.clearData();
        await webgazer.begin();
        webgazer.showPredictionPoints(false);
        webgazer.pause();
    }

    // ── MediaPipe ────────────────────────────────────────────

    async function _iniciarMediaPipe() {
        const faceMesh = new FaceMesh({ locateFile: f =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${f}` });

        faceMesh.setOptions({
            maxNumFaces: 1, refineLandmarks: true,
            minDetectionConfidence: 0.5, minTrackingConfidence: 0.5
        });
        faceMesh.onResults(_onFaceResults);

        loopVivo = true;

        const iv = setInterval(() => {
            const v = document.getElementById('webgazerVideoFeed');
            if (!v) return;
            clearInterval(iv);

            const loop = async () => {
                // CLAVE: no salimos del loop aunque activo=false
                // Solo paramos si destruir() pone loopVivo=false
                if (!loopVivo) return;
                if (v.readyState >= 2) await faceMesh.send({ image: v });
                requestAnimationFrame(loop);
            };
            loop();
        }, 200);
    }

    function _onFaceResults(r) {
        if (!r.multiFaceLandmarks?.length) return;
        const f = r.multiFaceLandmarks[0];
        let xT, yT;

        try {
            if (motorActivo === 'nose') {
                const n = f[1];
                if (!calibNariz) { calibNariz = { x: n.x, y: n.y }; return; }
                if (!activo) return;
                xT = window.innerWidth  / 2 - (n.x - calibNariz.x) * window.innerWidth  * 7;
                yT = window.innerHeight / 2 + (n.y - calibNariz.y) * window.innerHeight * 5;

            } else if (motorActivo === 'mediapipe') {
                const iL = f[468], iR = f[473];
                const wL = Math.abs(f[133].x - f[33].x)  || 0.01;
                const wR = Math.abs(f[263].x - f[362].x) || 0.01;
                const relX = ((iL.x - f[33].x) / wL + (iR.x - f[362].x) / wR) / 2;
                const relY = (iL.y + iR.y) / 2;

                // Guardar posición cruda SIEMPRE (útil para calibración incluso si !activo)
                ultimaIris = { x: relX, y: relY };

                if (!activo) return;
                if (!calibMP.listo) return; // no emitir hasta que la calibración esté lista

                // Predicción: regresión cuadrática 2D
                const feat = _features(relX, relY);
                xT = feat.reduce((s, v, i) => s + v * calibMP.coefX[i], 0);
                yT = feat.reduce((s, v, i) => s + v * calibMP.coefY[i], 0);
            }

            if (xT !== undefined && yT !== undefined) {
                _emitir(
                    Math.max(0, Math.min(window.innerWidth,  xT)),
                    Math.max(0, Math.min(window.innerHeight, yT))
                );
            }
        } catch (e) { console.warn('[Tracker]', e); }
    }

    // ── Regresión cuadrática 2D ──────────────────────────────
    // Features: [ix, iy, ix·iy, ix², iy², 1]  (6 por eje)
    // Razón: la regresión 1D anterior ignoraba la posición Y al predecir X
    // y viceversa. La cuadrática 2D captura interacciones cruzadas y
    // no-linealidades propias del movimiento ocular en perspectiva.

    function _features(ix, iy) {
        return [ix, iy, ix * iy, ix * ix, iy * iy, 1];
    }

    function _computarRegresionMP() {
        const pts   = calibMP.puntos;
        const feats = pts.map(p => _features(p.irisX, p.irisY));
        calibMP.coefX = _minCuadrados(feats, pts.map(p => p.screenX));
        calibMP.coefY = _minCuadrados(feats, pts.map(p => p.screenY));
        calibMP.listo = true;
    }

    // Mínimos cuadrados: resuelve A^T·A·x = A^T·b
    function _minCuadrados(A, b) {
        const N = A.length, M = A[0].length;
        const ATA = Array.from({ length: M }, () => new Array(M).fill(0));
        for (let i = 0; i < M; i++)
            for (let j = 0; j < M; j++)
                for (let k = 0; k < N; k++)
                    ATA[i][j] += A[k][i] * A[k][j];
        const ATb = new Array(M).fill(0);
        for (let i = 0; i < M; i++)
            for (let k = 0; k < N; k++)
                ATb[i] += A[k][i] * b[k];
        return _gauss(ATA, ATb);
    }

    // Eliminación gaussiana con pivoteo parcial
    function _gauss(A, b) {
        const n = A.length;
        const M = A.map((row, i) => [...row, b[i]]);
        for (let col = 0; col < n; col++) {
            let maxRow = col;
            for (let row = col + 1; row < n; row++)
                if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
            [M[col], M[maxRow]] = [M[maxRow], M[col]];
            if (Math.abs(M[col][col]) < 1e-12) continue;
            for (let row = col + 1; row < n; row++) {
                const f = M[row][col] / M[col][col];
                for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
            }
        }
        const x = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            if (Math.abs(M[i][i]) < 1e-12) continue;
            x[i] = M[i][n] / M[i][i];
            for (let k = i - 1; k >= 0; k--) M[k][n] -= M[k][i] * x[i];
        }
        return x;
    }

    // ── Filtro y emisión ─────────────────────────────────────

    function _emitir(x, y) {
        if (isNaN(x) || isNaN(y)) return;
        bufX.push(x); bufY.push(y);
        if (bufX.length > ventanaFiltro) { bufX.shift(); bufY.shift(); }
        const xS = bufX.reduce((a, b) => a + b) / bufX.length;
        const yS = bufY.reduce((a, b) => a + b) / bufY.length;
        if (gazeCallback) gazeCallback(xS, yS, performance.now());
    }

    return {
        iniciar, detener, reanudar, destruir,
        setVentanaFiltro, getVideoFeed,
        muestrearIris, agregarPuntoCalibMP, resetCalibMP, calibrarNariz
    };
})();
