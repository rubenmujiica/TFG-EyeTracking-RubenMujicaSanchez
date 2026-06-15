// ==========================================
// 0. CONFIGURACIÓN GLOBAL Y VARIABLES
// ==========================================
let motorActual = null;
let miCursor;
let faceMesh;

// Variables de Filtrado (Smoothing)
let xHistorico = [];
let yHistorico = [];
const FILTRO_VENTANA = 12;

// Variables de MediaPipe (Nose Tracking)
let centroNoseX = null;
let centroNoseY = null;
let calibrandoNose = false;

// Variables de MediaPipe (Iris Tracking Binocular)
let centroIrisX = null;
let centroIrisY = null;
let calibrandoMediaPipe = false;

// Variables de Dwell Time (Clic por mirada)
let temporizadorDwell = null;
let posicionFijaX = 0;
let posicionFijaY = 0;
const MARGEN_ERROR = 30; // Tolerancia de movimiento en píxeles
const TIEMPO_DWELL = 1200; // 1.2 segundos para hacer clic

// Variables de Métricas UX (Para el Profesor)
let metricasAOI = {};

// ==========================================
// 1. CONTROL DE INTERFAZ Y NAVEGACIÓN
// ==========================================
function iniciarSistema(motorElegido) {
    // Cambiar pantallas
    document.getElementById('pantalla-inicio').classList.replace('pantalla-activa', 'pantalla-oculta');
    document.getElementById('pantalla-trabajo').classList.replace('pantalla-oculta', 'pantalla-activa');
    
    // Crear el cursor si no existe
    if (!miCursor) {
        miCursor = document.createElement('div');
        miCursor.id = 'cursor-suave';
        document.body.appendChild(miCursor);
    }
    miCursor.style.display = 'block';

    cambiarMotor(motorElegido);
}

function reiniciarSistema() {
    // Un reseteo limpio liberando la cámara
    window.location.reload(); 
}

// ==========================================
// 2. GESTIÓN DE MOTORES
// ==========================================
async function cambiarMotor(nuevoMotor) {
    motorActual = nuevoMotor;
    const status = document.getElementById('status');
    
    if (nuevoMotor === 'webgazer') {
        status.innerText = "Iniciando WebGazer. Por favor, calibra los puntos.";
        await iniciarWebGazer();
        crearPuntosCalibracion(); 
        
    } else if (nuevoMotor === 'nose') {
        status.innerText = "MediaPipe (Nariz): MIRA AL CENTRO DE LA PANTALLA FIJAMENTE...";
        calibrandoNose = true; 
        await iniciarWebGazer(true); // WebGazer en background pasa los frames a MediaPipe
        if (!faceMesh) await iniciarMediaPipe();
        
    } else if (nuevoMotor === 'mediapipe') {
        status.innerText = "MediaPipe (Iris): MIRA AL CENTRO DE LA PANTALLA FIJAMENTE...";
        calibrandoMediaPipe = true; 
        await iniciarWebGazer(true); 
        if (!faceMesh) await iniciarMediaPipe();
    }
}

// ==========================================
// 3. INICIO DE WEBGAZER
// ==========================================
async function iniciarWebGazer(modoSilencioso = false) {
    webgazer.params.showVideo = false;
    webgazer.params.showFaceOverlay = false;
    webgazer.params.showFaceFeedbackBox = false;

    await webgazer.setGazeListener((data) => {
        if (data && motorActual === 'webgazer') {
            actualizarPosicion(data.x, data.y);
            gestionarDwellTime(data.x, data.y);
        }
    }).begin();

    webgazer.showPredictionPoints(false);
    if(modoSilencioso) webgazer.pause(); // Pausamos sus cálculos si usamos MediaPipe
}

// ==========================================
// 4. INICIO DE MEDIAPIPE (Dual: Nariz e Iris)
// ==========================================
async function iniciarMediaPipe() {
    faceMesh = new FaceMesh({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
    }});

    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true, // Vital para detectar el iris con precisión
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    faceMesh.onResults((results) => {
        if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;
        
        const face = results.multiFaceLandmarks[0];
        let xTarget, yTarget;
        
        try {
            // ----------------------------------------------------
            // LÓGICA A: RASTREO POR NARIZ (Macro-movimientos)
            // ----------------------------------------------------
            if (motorActual === 'nose') {
                const nose = face[1]; // Punto central de la nariz
                
                if (calibrandoNose) {
                    centroNoseX = nose.x;
                    centroNoseY = nose.y;
                    calibrandoNose = false;
                    setTimeout(() => {
                        document.getElementById('status').innerText = "Nariz Calibrada. Mueve la cabeza para apuntar.";
                    }, 1000);
                }

                if (centroNoseX === null) return;

                let desvioX = nose.x - centroNoseX;
                let desvioY = nose.y - centroNoseY;

                const SENS_NOSE_X = 7; 
                const SENS_NOSE_Y = 5; 

                xTarget = (window.innerWidth / 2) - (desvioX * window.innerWidth * SENS_NOSE_X);
                yTarget = (window.innerHeight / 2) + (desvioY * window.innerHeight * SENS_NOSE_Y);
            } 
            // ----------------------------------------------------
            // LÓGICA B: RASTREO POR IRIS (Micro-movimientos)
            // ----------------------------------------------------
            else if (motorActual === 'mediapipe') {
                // OJO IZQUIERDO
                const irisIzq = face[468]; 
                const esqIntIzq = face[133]; 
                const esqExtIzq = face[33]; 
                const anchoIzq = Math.abs(esqIntIzq.x - esqExtIzq.x); 
                const relIzqX = (irisIzq.x - esqExtIzq.x) / (anchoIzq || 1);

                // OJO DERECHO
                const irisDer = face[473]; 
                const esqIntDer = face[362]; 
                const esqExtDer = face[263]; 
                const anchoDer = Math.abs(esqExtDer.x - esqIntDer.x); 
                const relDerX = (irisDer.x - esqIntDer.x) / (anchoDer || 1);

                // PROMEDIO BINOCULAR
                const relX = (relIzqX + relDerX) / 2;
                const relY = (irisIzq.y + irisDer.y) / 2;

                if (calibrandoMediaPipe) {
                    centroIrisX = relX;
                    centroIrisY = relY;
                    calibrandoMediaPipe = false;
                    setTimeout(() => {
                        document.getElementById('status').innerText = "Iris Calibrado. Ya puedes mover los ojos.";
                    }, 1000);
                }

                if (centroIrisX === null) return;

                let desvioX = relX - centroIrisX;
                let desvioY = relY - centroIrisY;

                const SENS_IRIS_X = 25; 
                const SENS_IRIS_Y = 15; 

                xTarget = (window.innerWidth / 2) - (desvioX * window.innerWidth * SENS_IRIS_X);
                yTarget = (window.innerHeight / 2) + (desvioY * window.innerHeight * SENS_IRIS_Y);
            }

            // ----------------------------------------------------
            // APLICACIÓN COMÚN (Límites, suavizado y clics)
            // ----------------------------------------------------
            if (xTarget !== undefined && yTarget !== undefined) {
                xTarget = Math.max(30, Math.min(window.innerWidth - 30, xTarget));
                yTarget = Math.max(30, Math.min(window.innerHeight - 30, yTarget));

                actualizarPosicion(xTarget, yTarget);
                gestionarDwellTime(xTarget, yTarget);
            }
            
        } catch (err) {
            console.error("Error en MediaPipe:", err);
        }
    });

    // Puente de vídeo: Pasamos la imagen capturada por WebGazer a MediaPipe
    const videoOriginal = document.getElementById('webgazerVideoFeed');
    if (videoOriginal) {
        const enviarFrames = async () => {
            if ((motorActual === 'mediapipe' || motorActual === 'nose') && videoOriginal.readyState >= 2) {
                await faceMesh.send({image: videoOriginal});
            }
            requestAnimationFrame(enviarFrames);
        };
        enviarFrames();
    }
}

// ==========================================
// 5. FILTRO DE MEDIA MÓVIL (Suavizado)
// ==========================================
function actualizarPosicion(x, y) {
    if (isNaN(x) || isNaN(y)) return;

    xHistorico.push(x);
    yHistorico.push(y);

    if (xHistorico.length > FILTRO_VENTANA) {
        xHistorico.shift();
        yHistorico.shift();
    }

    const xSuave = xHistorico.reduce((a, b) => a + b) / xHistorico.length;
    const ySuave = yHistorico.reduce((a, b) => a + b) / yHistorico.length;
    
    miCursor.style.left = xSuave + 'px';
    miCursor.style.top = ySuave + 'px';
}

// ==========================================
// 6. DWELL TIME Y MÉTRICAS DE UX
// ==========================================
function gestionarDwellTime(x, y) {
    const movimiento = Math.sqrt(Math.pow(x - posicionFijaX, 2) + Math.pow(y - posicionFijaY, 2));

    if (movimiento < MARGEN_ERROR) {
        if (!temporizadorDwell) {
            miCursor.style.backgroundColor = "#e74c3c"; // Feedback visual (rojo)
            
            temporizadorDwell = setTimeout(() => {
                const elemento = document.elementFromPoint(x, y);
                
                if (elemento && (elemento.tagName === "BUTTON" || elemento.classList.contains("aoi"))) {
                    elemento.click(); 
                    registrarMetrica(elemento.id || "Elemento_Sin_ID", TIEMPO_DWELL);
                }
                resetDwell();
            }, TIEMPO_DWELL); 
        }
    } else {
        resetDwell();
    }
    posicionFijaX = x;
    posicionFijaY = y;
}

function resetDwell() {
    clearTimeout(temporizadorDwell);
    temporizadorDwell = null;
    miCursor.style.backgroundColor = "#4cd137"; // Vuelve a verde
}

function registrarMetrica(idAOI, duracionMs) {
    if (!metricasAOI[idAOI]) {
        metricasAOI[idAOI] = { fijaciones: 0, tiempoTotalSegundos: 0 };
    }
    metricasAOI[idAOI].fijaciones += 1;
    metricasAOI[idAOI].tiempoTotalSegundos += (duracionMs / 1000);
    console.log(`[UX Data] Fijación en: ${idAOI} | Fijaciones totales: ${metricasAOI[idAOI].fijaciones}`);
}

// ==========================================
// 7. CALIBRACIÓN DE WEBGAZER (Puntos)
// ==========================================
function crearPuntosCalibracion() {
    const puntos = [
        {top: '15%', left: '15%'}, {top: '15%', left: '50%'}, {top: '15%', left: '85%'},
        {top: '50%', left: '15%'}, {top: '50%', left: '50%'}, {top: '50%', left: '85%'},
        {top: '85%', left: '15%'}, {top: '85%', left: '50%'}, {top: '85%', left: '85%'}
    ];

    puntos.forEach((p, index) => {
        const boton = document.createElement('button');
        boton.className = 'punto-calibracion aoi'; // Etiqueta AOI para capturar la métrica
        boton.id = `punto_calibracion_${index}`;
        boton.style.position = 'absolute';
        boton.style.top = p.top;
        boton.style.left = p.left;
        boton.style.width = '30px';
        boton.style.height = '30px';
        boton.style.backgroundColor = 'red';
        boton.style.borderRadius = '50%';
        boton.style.border = 'none';
        boton.style.cursor = 'pointer';
        
        let clicks = 0;
        boton.onclick = () => {
            clicks++;
            boton.style.opacity = 1 - (clicks * 0.1);
            if (clicks >= 10) {
                boton.remove();
                verificarProgreso();
            }
        };
        document.getElementById('pantalla-trabajo').appendChild(boton);
    });
}

function verificarProgreso() {
    const restantes = document.querySelectorAll('.punto-calibracion').length;
    const status = document.getElementById('status');
    if (restantes === 0) {
        status.innerText = "Calibración Completada. Sistema Listo.";
        status.style.color = "#4cd137";
        console.log("Métricas de calibración recopiladas:", metricasAOI);
    }
}