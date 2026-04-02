// Frontend Logic for Paisa AI Salesperson Chatbot
// Based on Google Gemini Live API Python SDK documentation

let audioContext;
let ws;
let mediaStream;
let processor;
let audioQueue = [];
let isPlaying = false;
let isStopping = false;
let isModelSpeaking = false;
const OUTPUT_SAMPLE_RATE = 24000;
const BACKEND_BASE_URL = 'https://gemini-live-backend-1003987130329.us-central1.run.app';
const INPUT_SAMPLE_RATE = 16000;

const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status-text');
const statusIndicator = document.getElementById('status-indicator');
const logArea = document.getElementById('log');

function log(msg) {
    console.log(`[ui] ${msg}`);
    const p = document.createElement('p');
    p.textContent = `> ${msg}`;
    logArea.appendChild(p);
    logArea.scrollTop = logArea.scrollHeight;
}

async function startConversation() {
    isStopping = false;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = "¡Conectando mijo!";
    statusIndicator.classList.add('on');
    
    // 1. WebSocket connection to FastAPI backend
    ws = new WebSocket(`${BACKEND_BASE_URL.replace(/^http/, 'ws')}/ws/live`);
    ws.binaryType = 'arraybuffer';
    console.log('[ws] creating socket to', ws.url);

    ws.onopen = async () => {
        console.log('[ws] open');
        log("¡Conectao pues! Empezamos la venta...");
        statusText.textContent = "🎙️ Paisa conectado";

        ws.send(JSON.stringify({
            type: 'session_start',
            inputSampleRate: INPUT_SAMPLE_RATE,
            outputSampleRate: OUTPUT_SAMPLE_RATE,
            inputFormat: 'pcm16',
            outputFormat: 'pcm16',
            language: 'es-CO'
        }));
        
        // 2. Client-side audio logic
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Input: Get Mic Stream
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('[audio] mic stream acquired', mediaStream.getAudioTracks().length, 'tracks');
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        // Use ScriptProcessor for low latency-ish buffer capture
        processor = audioContext.createScriptProcessor(4096, 1, 1);
        console.log('[audio] ScriptProcessorNode created');
        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
            if (isModelSpeaking) return;  // don't echo back model audio
            const inputData = e.inputBuffer.getChannelData(0);
            const pcmData = convertFloat32ToInt16(inputData);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(pcmData);
            }
        };

        // Output: Handle incoming audio data from model
        ws.onmessage = async (e) => {
            if (e.data instanceof ArrayBuffer) {
                console.log('[ws] audio chunk received', e.data.byteLength);
                isModelSpeaking = true;  // mute mic while model produces audio
                audioQueue.push(e.data);
                if (!isPlaying) {
                    playNextInQueue();
                }
            } else if (typeof e.data === 'string') {
                // turn_complete just logged – mic unmutes only when audio drain completes
                const msg = JSON.parse(e.data);
                if (msg.type === 'turn_complete') {
                    console.log('[ws] turn_complete from server (audio may still be playing)');
                }
            }
        };
    };

    ws.onerror = (err) => {
        log("¡Ave María! Se dañó la señal...");
        console.error('[ws] error event', err);
        console.error(err);
    };

    ws.onclose = (event) => {
        console.log('[ws] close', {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
        });
        if (!isStopping) {
            log(`¡Se fue la señal del paisa! (${event.code}${event.reason ? `: ${event.reason}` : ""})`);
        }
        cleanupConversation();
    };
}

function stopConversation() {
    isStopping = true;
    cleanupConversation();
}

function cleanupConversation() {
    console.log('[ui] cleanupConversation');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = "Desconectado";
    statusIndicator.classList.remove('on');

    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    if (ws) ws = null;
    if (processor) processor.disconnect();
    processor = null;
    if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
    if (audioContext) audioContext.close();
    audioContext = null;
    
    audioQueue = [];
    isPlaying = false;
    isModelSpeaking = false;
}

function convertFloat32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // Simple clipping and scaling
        const val = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = val < 0 ? val * 0x8000 : val * 0x7FFF;
    }
    return int16Array.buffer;
}

async function playNextInQueue() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        // All audio drained → safe to unmute mic now
        if (isModelSpeaking) {
            console.log('[audio] queue empty, unmuting mic');
            isModelSpeaking = false;
        }
        return;
    }

    isPlaying = true;
    const buffer = audioQueue.shift();
    const float32Array = convertInt16ToFloat32(new Int16Array(buffer));
    
    const audioBuffer = audioContext.createBuffer(1, float32Array.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.getChannelData(0).set(float32Array);
    
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    
    source.onended = () => {
        playNextInQueue();
    };
    source.start();
}

function convertInt16ToFloat32(int16Array) {
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }
    return float32Array;
}

startBtn.addEventListener('click', startConversation);
stopBtn.addEventListener('click', stopConversation);
