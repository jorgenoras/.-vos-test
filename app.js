'use strict';
const $ = (id) => document.getElementById(id);
const tabText = $('tabText');
const tabVoice = $('tabVoice');
const textPanel = $('textPanel');
const voicePanel = $('voicePanel');
const sourceText = $('sourceText');
const statusNode = $('status');
const resultPanel = $('resultPanel');
const recordBtn = $('recordBtn');
const recordHint = $('recordHint');
let currentTranslation = '';
let targetLanguage = 'pt';
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let timer = null;
let discardOnStop = false;
let audioContext = null;
let silenceTimer = null;
let microphoneSource = null;
let recordingGeneration = 0;
let processingVoice = false;
let recorderStarting = false;
let voiceAbortController = null;
let continuousMode = false;
let continuousCycle = 0;
let restartTimeout = null;

function stopContinuousMode(message = 'Conversa contínua terminada.') {
  continuousMode = false;
  continuousCycle++;
  clearTimeout(restartTimeout);
  restartTimeout = null;
  $('continuousBtn').textContent = 'Iniciar conversa contínua';
  $('continuousBtn').classList.remove('recording');
  cancelRecording();
  recordBtn.disabled = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  showStatus(message);
}
function scheduleNextTurn(cycle) {
  if (!continuousMode || cycle !== continuousCycle || document.hidden) return;
  clearTimeout(restartTimeout);
  restartTimeout = setTimeout(() => {
    restartTimeout = null;
    if (continuousMode && cycle === continuousCycle && !processingVoice && !document.hidden) recordVoice();
  }, 350);
}
function runNextAfterSpeech(cycle) {
  if (!continuousMode || cycle !== continuousCycle) return;
  if (!$('autoSpeak').checked || !currentTranslation) return scheduleNextTurn(cycle);
  speakTranslation(() => scheduleNextTurn(cycle));
}
$('continuousBtn').addEventListener('click', () => {
  if (continuousMode) return stopContinuousMode();
  if (processingVoice || recorderStarting || (mediaRecorder && mediaRecorder.state !== 'inactive')) return showStatus('Termina primeiro a gravação em curso.', true);
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !getMime()) return showStatus('Gravação contínua indisponível neste navegador.', true);
  continuousMode = true;
  continuousCycle++;
  $('continuousBtn').textContent = 'Terminar conversa contínua';
  $('continuousBtn').classList.add('recording');
  $('autoSpeak').checked = true;
  recordVoice();
});

function clearSilenceMonitor() {
  clearInterval(silenceTimer);
  silenceTimer = null;
  if (microphoneSource) microphoneSource.disconnect();
  microphoneSource = null;
  if (audioContext) audioContext.close().catch(() => {});
  audioContext = null;
}
function monitorSilence(context) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  microphoneSource = context.createMediaStreamSource(mediaStream);
  microphoneSource.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let heardSpeech = false;
  let lastSound = performance.now();
  const started = lastSound;
  silenceTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
    const now = performance.now();
    if (rms > 0.018) { heardSpeech = true; lastSound = now; }
    if (heardSpeech && now - lastSound >= 1500) stopRecording();
    else if (!heardSpeech && now - started >= 10000) {
      cancelRecording();
      if (continuousMode) scheduleNextTurn(continuousCycle);
      else showStatus('Não foi detetada voz. Toca em Gravar voz para tentar novamente.', true);
    }
  }, 100);
}

function showStatus(message, isError = false) {
  statusNode.textContent = message || '';
  statusNode.classList.toggle('has-error', Boolean(isError));
}
function switchTab(which) {
  const voice = which === 'voice';
  if (!voice && continuousMode) stopContinuousMode();
  else if (!voice && mediaRecorder?.state !== 'inactive') cancelRecording();
  tabText.setAttribute('aria-selected', String(!voice));
  tabVoice.setAttribute('aria-selected', String(voice));
  tabText.classList.toggle('active', !voice);
  tabVoice.classList.toggle('active', voice);
  textPanel.hidden = voice;
  voicePanel.hidden = !voice;
  showStatus('');
}
tabText.addEventListener('click', () => switchTab('text'));
tabVoice.addEventListener('click', () => switchTab('voice'));
sourceText.addEventListener('input', () => { $('charCount').textContent = `${sourceText.value.length} / 3000`; });

async function fetchJson(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
  let body;
  try { body = await response.json(); } catch (_) { throw new Error('O servidor devolveu uma resposta inválida.'); }
  if (!response.ok) {
    if (response.status === 401) setTimeout(() => { window.location.href = '/login'; }, 1500);
    throw new Error(body.error || 'Não foi possível concluir a operação.');
  }
  return body;
}
function present(data) {
  $('originalOutput').textContent = data.original || '';
  $('translatedOutput').textContent = data.translation || '';
  targetLanguage = data.target_language || 'pt';
  $('translatedOutput').setAttribute('lang', targetLanguage === 'uk' ? 'uk-UA' : 'pt-PT');
  $('direction').textContent = data.detected_language === 'pt' ? 'PT → UA' : data.detected_language === 'uk' ? 'UA → PT' : 'Língua não detetada';
  currentTranslation = data.translation || '';
  resultPanel.hidden = false;
  showStatus(currentTranslation ? 'Tradução concluída.' : 'Não foi possível detetar português ou ucraniano.');
}
async function translate() {
  const text = sourceText.value.trim();
  if (!text) return showStatus('Escreve uma mensagem para traduzir.', true);
  $('translateBtn').disabled = true;
  showStatus('A traduzir...');
  try {
    present(await fetchJson('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }));
  } catch (err) { showStatus(err.message, true); }
  finally { $('translateBtn').disabled = false; }
}
$('translateBtn').addEventListener('click', translate);

function getMime() {
  if (!window.MediaRecorder) return '';
  for (const mime of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}
function stopTracks() {
  clearSilenceMonitor();
  if (mediaStream) for (const track of mediaStream.getTracks()) track.stop();
  mediaStream = null;
  if (timer) { clearTimeout(timer); timer = null; }
  recordBtn.textContent = 'Gravar voz';
  recordBtn.classList.remove('recording');
  recordHint.textContent = 'O microfone está desligado.';
}
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  stopTracks();
}
function cancelRecording() {
  recordingGeneration++;
  if (voiceAbortController) { voiceAbortController.abort(); voiceAbortController = null; }
  processingVoice = false;
  recordBtn.disabled = false;
  discardOnStop = true;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  stopTracks();
}
async function recordVoice() {
  if (processingVoice || recorderStarting) return;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') return stopRecording();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    return showStatus('O Safari deste dispositivo não suporta esta gravação. Podes usar o modo Texto.', true);
  }
  const mime = getMime();
  if (!mime) return showStatus('Formato áudio não suportado neste navegador.', true);
  recordBtn.disabled = true;
  recorderStarting = true;
  const generation = ++recordingGeneration;
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      // Prime synthesis inside the user's tap; iOS behaviour still needs device testing.
      if ($('autoSpeak').checked) {
        const prime = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(prime);
      }
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('silence-unavailable');
    audioContext = new AudioContextClass();
    await audioContext.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (generation !== recordingGeneration || document.hidden) {
      stream.getTracks().forEach(track => track.stop());
      if (generation === recordingGeneration) stopTracks();
      return;
    }
    mediaStream = stream;
    chunks = [];
    discardOnStop = false;
    const recorder = new MediaRecorder(mediaStream, { mimeType: mime });
    mediaRecorder = recorder;
    const recordingChunks = [];
    recorder.addEventListener('dataavailable', (e) => { if (e.data.size) recordingChunks.push(e.data); });
    recorder.addEventListener('error', () => { if (generation !== recordingGeneration) return; stopTracks(); if (continuousMode) stopContinuousMode('Erro ao gravar áudio.'); else showStatus('Erro ao gravar áudio.', true); });
    recorder.addEventListener('stop', async () => {
      const blob = new Blob(recordingChunks, { type: mime });
      if (mediaRecorder === recorder) { mediaRecorder = null; stopTracks(); }
      if (generation !== recordingGeneration) return;
      if (!blob.size) { if (continuousMode) scheduleNextTurn(continuousCycle); else showStatus('Não foi captado áudio.', true); return; }
      const form = new FormData();
      form.append('audio', blob, mime.includes('mp4') ? 'voz.m4a' : mime.includes('ogg') ? 'voz.ogg' : 'voz.webm');
      showStatus('A reconhecer e traduzir a voz...');
      processingVoice = true;
      const cycle = continuousCycle;
      recordBtn.disabled = true;
      const controller = new AbortController();
      voiceAbortController = controller;
      try {
        const data = await fetchJson('/api/voice', { method: 'POST', body: form, signal: controller.signal });
        if (generation !== recordingGeneration || document.hidden) return;
        present(data);
        if (continuousMode) runNextAfterSpeech(cycle);
        else if ($('autoSpeak').checked && currentTranslation) speakTranslation();
      } catch (err) {
        if (generation === recordingGeneration && !document.hidden) {
          if (continuousMode) stopContinuousMode('Conversa interrompida: ' + err.message);
          else showStatus(err.message, true);
        }
      } finally {
        if (voiceAbortController === controller) voiceAbortController = null;
        if (generation === recordingGeneration) { processingVoice = false; recordBtn.disabled = false; }
      }
    }, { once: true });
    recorder.start();
    recorderStarting = false;
    monitorSilence(audioContext);
    recordBtn.textContent = 'Parar gravação';
    recordBtn.classList.add('recording');
    recordHint.textContent = continuousMode ? 'A escutar… A tradução será reproduzida antes de voltar a escutar.' : 'A gravar… Uma pausa de 1,5 segundos termina a gravação e desliga o microfone.';
    showStatus('Podes falar agora em português ou ucraniano.');
    timer = setTimeout(stopRecording, 30000);
  } catch (err) {
    stopTracks();
    if (continuousMode) stopContinuousMode('Não foi possível iniciar a gravação contínua. Verifica a permissão do microfone.');
    else showStatus('Não foi possível iniciar a gravação automática. Confirma a permissão do microfone e usa o Safari atualizado.', true);
  } finally { recorderStarting = false; recordBtn.disabled = false; }
}
recordBtn.addEventListener('click', () => { if (continuousMode) stopContinuousMode(); else recordVoice(); });
window.addEventListener('pagehide', () => { if (continuousMode) stopContinuousMode(); else cancelRecording(); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); });

$('copyBtn').addEventListener('click', async () => {
  if (!currentTranslation) return showStatus('Não existe texto para copiar.', true);
  try {
    await navigator.clipboard.writeText(currentTranslation);
    showStatus('Texto copiado. Abre o WhatsApp e cola-o na mensagem.');
  } catch (_) {
    const node = $('translatedOutput');
    const range = document.createRange(); range.selectNodeContents(node);
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    showStatus('Texto selecionado. Escolhe «Copiar» no menu do iPhone.', true);
  }
});
function speakTranslation(onFinished = null) {
  if (!currentTranslation) return showStatus('Não existe texto para ler.', true);
  if (!('speechSynthesis' in window)) return showStatus('Leitura de voz indisponível neste dispositivo.', true);
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentTranslation);
  utterance.lang = targetLanguage === 'uk' ? 'uk-UA' : 'pt-PT';
  utterance.rate = 0.94;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang.toLowerCase() === utterance.lang.toLowerCase());
  if (preferred) utterance.voice = preferred;
  let completed = false;
  const finish = () => { if (completed) return; completed = true; if (onFinished) onFinished(); };
  utterance.onend = finish;
  utterance.onerror = () => {
    if (continuousMode) stopContinuousMode('A leitura de voz falhou. Verifica as vozes do iPhone.');
    else showStatus('A leitura automática não começou. Toca em Ouvir tradução; se necessário, verifica as vozes do iPhone.', true);
  };
  window.speechSynthesis.speak(utterance);
  showStatus('A ler a tradução com a voz disponível no dispositivo.');
}
$('speakBtn').addEventListener('click', () => speakTranslation());
$('clearBtn').addEventListener('click', () => {
  if (continuousMode) stopContinuousMode(); else cancelRecording();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  sourceText.value = '';
  $('charCount').textContent = '0 / 3000';
  $('originalOutput').textContent = '';
  $('translatedOutput').textContent = '';
  currentTranslation = '';
  resultPanel.hidden = true;
  showStatus('Texto apagado do ecrã.');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (continuousMode) stopContinuousMode('Conversa interrompida porque a aplicação ficou em segundo plano.'); else cancelRecording();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
});
$('whatsappBtn').addEventListener('click', () => {
  if (!currentTranslation) return showStatus('Não existe tradução para enviar.', true);
  window.open('https://wa.me/?text=' + encodeURIComponent(currentTranslation), '_blank', 'noopener,noreferrer');
  showStatus('Escolhe o contacto no WhatsApp e confirma o envio.');
});
