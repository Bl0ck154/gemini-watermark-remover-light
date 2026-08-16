import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  canEncodeVideo
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.46.0/+esm';
import { EMBEDDED_ALPHA_MAPS_U8 } from './maps.js';

const SAMPLE_COUNT = 12;
const LOW_FRAME_CONFIDENCE = 0.025;
const MIN_DETECTION_SCORE = 0.035;
const MAX_FILE_SIZE = 600 * 1024 * 1024;
const SUPPORTED_MIME = new Set(['video/mp4']);
const CANDIDATES = Object.freeze({
  '1920x1080': [
    { id: '1080-standard', x: 1740, y: 900, size: 72 },
    { id: '1080-relocated', x: 1704, y: 864, size: 72 }
  ],
  '1080x1920': [
    { id: '1080p-standard', x: 900, y: 1740, size: 72 },
    { id: '1080p-relocated', x: 864, y: 1704, size: 72 }
  ],
  '1280x720': [
    { id: '720-standard', x: 1160, y: 600, size: 48 },
    { id: '720-compact', x: 1207, y: 636, size: 44 }
  ],
  '720x1280': [
    { id: '720p-standard', x: 600, y: 1160, size: 48 },
    { id: '720p-compact', x: 647, y: 1196, size: 44 }
  ]
});

const $ = (id) => document.getElementById(id);
const els = {
  dropzone: $('video-dropzone'), input: $('video-file-input'), choose: $('video-choose'), fileCard: $('video-file-card'),
  fileName: $('video-file-name'), fileMeta: $('video-file-meta'), replace: $('video-replace'), options: $('video-options'),
  cleanup: $('video-cleanup'), bitrate: $('video-bitrate'), actions: $('video-actions'), process: $('video-process'),
  progress: $('video-progress'), progressLabel: $('video-progress-label'), progressPercent: $('video-progress-percent'),
  progressBar: $('video-progress-bar'), progressDetail: $('video-progress-detail'), error: $('video-error'),
  errorTitle: $('video-error-title'), errorMessage: $('video-error-message'), result: $('video-result'), before: $('video-before'),
  after: $('video-after'), resultDetails: $('video-result-details'), newFile: $('video-new'), download: $('video-download')
};

let currentFile = null;
let currentBeforeUrl = null;
let currentAfterUrl = null;
let currentBlob = null;
let dragDepth = 0;

function bytesLabel(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function secondsLabel(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown duration';
  const total = Math.max(0, Math.round(seconds));
  const min = Math.floor(total / 60);
  const sec = String(total % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function setProgress(progress, label, detail = '') {
  const safe = Math.max(0, Math.min(1, Number(progress) || 0));
  const pct = Math.round(safe * 100);
  els.progress.hidden = false;
  els.progressBar.style.width = `${pct}%`;
  els.progressPercent.textContent = `${pct}%`;
  els.progressLabel.textContent = label;
  els.progressDetail.textContent = detail;
}

function clearUrls() {
  if (currentBeforeUrl) URL.revokeObjectURL(currentBeforeUrl);
  if (currentAfterUrl) URL.revokeObjectURL(currentAfterUrl);
  currentBeforeUrl = null;
  currentAfterUrl = null;
  currentBlob = null;
}

function resetForFile() {
  clearUrls();
  els.result.hidden = true;
  els.error.hidden = true;
  els.progress.hidden = true;
  els.process.disabled = false;
}

function pickFile() {
  els.input.value = '';
  els.input.click();
}

async function openInput(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    throw new Error('No video track was found in this file.');
  }
  return { input, track };
}

async function getMetadata(file) {
  const { input, track } = await openInput(file);
  try {
    const width = track.displayWidth || track.codedWidth || track.width;
    const height = track.displayHeight || track.codedHeight || track.height;
    const duration = await input.computeDuration().catch(() => null);
    const frameRate = await track.computePacketStats?.().then((stats) => stats?.averagePacketRate).catch(() => null);
    return { width, height, duration, frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30 };
  } finally {
    input.dispose();
  }
}

function decodePackedMap(key = '96-20260520') {
  const packed = EMBEDDED_ALPHA_MAPS_U8[key] || EMBEDDED_ALPHA_MAPS_U8['96'];
  if (!packed) throw new Error('Video alpha calibration map is missing.');
  const binary = atob(packed);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const size = Number.parseInt(key, 10) || 96;
  return { size, values: Float32Array.from(bytes, (value) => value / 255) };
}

const baseMap = decodePackedMap();
const resizedMaps = new Map();

function getAlphaMap(size) {
  if (resizedMaps.has(size)) return resizedMaps.get(size);
  const out = new Float32Array(size * size);
  const srcSize = baseMap.size;
  for (let y = 0; y < size; y++) {
    const sy = size === 1 ? 0 : y * (srcSize - 1) / (size - 1);
    const y0 = Math.floor(sy), y1 = Math.min(srcSize - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < size; x++) {
      const sx = size === 1 ? 0 : x * (srcSize - 1) / (size - 1);
      const x0 = Math.floor(sx), x1 = Math.min(srcSize - 1, x0 + 1), fx = sx - x0;
      const a = baseMap.values[y0 * srcSize + x0];
      const b = baseMap.values[y0 * srcSize + x1];
      const c = baseMap.values[y1 * srcSize + x0];
      const d = baseMap.values[y1 * srcSize + x1];
      out[y * size + x] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  resizedMaps.set(size, out);
  return out;
}

function candidatesFor(width, height) {
  const exact = CANDIDATES[`${width}x${height}`];
  if (exact) return exact.map((candidate) => ({ ...candidate, alphaMap: getAlphaMap(candidate.size) }));
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long < 900 || short < 500) return [];
  const scale = short / 1080;
  const size = Math.max(36, Math.round(72 * scale));
  const margin = Math.max(54, Math.round(108 * scale));
  const x = width - margin - size;
  const y = height - margin - size;
  if (x < 0 || y < 0) return [];
  return [{ id: 'scaled-standard', x, y, size, alphaMap: getAlphaMap(size) }];
}

function roiLuma(imageData, x, y) {
  const idx = (y * imageData.width + x) * 4;
  return 0.2126 * imageData.data[idx] + 0.7152 * imageData.data[idx + 1] + 0.0722 * imageData.data[idx + 2];
}

function scoreCandidate(frame, candidate) {
  const { x, y, size, alphaMap } = candidate;
  if (x < 0 || y < 0 || x + size > frame.width || y + size > frame.height) return -Infinity;
  let weighted = 0, weight = 0, background = 0, backgroundWeight = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const alpha = alphaMap[py * size + px];
      const luma = roiLuma(frame, x + px, y + py) / 255;
      if (alpha > 0.03) {
        weighted += luma * alpha;
        weight += alpha;
      } else {
        background += luma;
        backgroundWeight += 1;
      }
    }
  }
  if (!weight || !backgroundWeight) return -Infinity;
  return weighted / weight - background / backgroundWeight;
}

async function detectWatermark(file, metadata) {
  const candidates = candidatesFor(metadata.width, metadata.height);
  if (!candidates.length) throw new Error(`Video size ${metadata.width}×${metadata.height} is not supported by Video Light yet.`);
  const { input, track } = await openInput(file);
  const canvas = new OffscreenCanvas(metadata.width, metadata.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const duration = Number(metadata.duration) || 0;
  const targets = Array.from({ length: SAMPLE_COUNT }, (_, i) => duration > 0 ? duration * (i + 1) / (SAMPLE_COUNT + 1) : i / SAMPLE_COUNT);
  const sums = new Map(candidates.map((candidate) => [candidate.id, { total: 0, count: 0, candidate }]));
  let targetIndex = 0;
  try {
    const sink = new VideoSampleSink(track);
    for await (const sample of sink.samples()) {
      try {
        if (targetIndex >= targets.length) break;
        if (duration > 0 && sample.timestamp < targets[targetIndex]) continue;
        sample.draw(ctx, 0, 0, metadata.width, metadata.height);
        const frame = ctx.getImageData(0, 0, metadata.width, metadata.height);
        for (const candidate of candidates) {
          const bucket = sums.get(candidate.id);
          bucket.total += scoreCandidate(frame, candidate);
          bucket.count += 1;
        }
        targetIndex += 1;
        setProgress(0.03 + 0.22 * targetIndex / SAMPLE_COUNT, 'Detecting watermark', `Sample ${targetIndex}/${SAMPLE_COUNT}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        sample.close();
      }
    }
  } finally {
    input.dispose();
  }
  const ranked = [...sums.values()].filter((item) => item.count).map((item) => ({
    ...item.candidate,
    score: item.total / item.count
  })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < MIN_DETECTION_SCORE) throw new Error('No supported Gemini/Veo diamond watermark was detected with enough confidence.');
  return best;
}

function estimateGain(frame, candidate) {
  const { x, y, size, alphaMap } = candidate;
  let alphaWeight = 0, excess = 0, bg = 0, bgCount = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const alpha = alphaMap[py * size + px];
      const lum = roiLuma(frame, x + px, y + py) / 255;
      if (alpha > 0.05) {
        excess += lum * alpha;
        alphaWeight += alpha;
      } else {
        bg += lum;
        bgCount += 1;
      }
    }
  }
  if (!alphaWeight || !bgCount) return 1;
  const contrast = excess / alphaWeight - bg / bgCount;
  return Math.max(0.72, Math.min(1.22, 0.88 + contrast * 2.5));
}

function removeFrameWatermark(imageData, candidate, gain) {
  const { x, y, size, alphaMap } = candidate;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const mapAlpha = alphaMap[py * size + px];
      const alpha = Math.min(0.92, mapAlpha * gain);
      if (alpha < 0.012) continue;
      const idx = ((y + py) * imageData.width + x + px) * 4;
      const remainder = 1 - alpha;
      for (let c = 0; c < 3; c++) {
        imageData.data[idx + c] = Math.max(0, Math.min(255, Math.round((imageData.data[idx + c] - 255 * alpha) / remainder)));
      }
    }
  }
}

function softCleanup(ctx, candidate) {
  const { x, y, size, alphaMap } = candidate;
  const roi = ctx.getImageData(x, y, size, size);
  const src = new Uint8ClampedArray(roi.data);
  for (let py = 1; py < size - 1; py++) {
    for (let px = 1; px < size - 1; px++) {
      const alpha = alphaMap[py * size + px];
      if (alpha < 0.025 || alpha > 0.22) continue;
      const idx = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const avg = (
          src[((py - 1) * size + px) * 4 + c] + src[((py + 1) * size + px) * 4 + c] +
          src[(py * size + px - 1) * 4 + c] + src[(py * size + px + 1) * 4 + c]
        ) / 4;
        roi.data[idx + c] = Math.round(center * 0.76 + avg * 0.24);
      }
    }
  }
  ctx.putImageData(roi, x, y);
}

function frameConfidence(frame, candidate) {
  return Math.max(0, scoreCandidate(frame, candidate));
}

async function copyAudio(input, output, format, startTimestamp) {
  const track = await input.getPrimaryAudioTrack().catch(() => null);
  if (!track) return { copied: false, codec: null };
  const codec = await track.getCodec().catch(() => null);
  if (!codec || !format.getSupportedAudioCodecs().includes(codec)) return { copied: false, codec };
  const source = new EncodedAudioPacketSource(codec);
  output.addAudioTrack(source);
  const config = await track.getDecoderConfig().catch(() => null);
  const sink = new EncodedPacketSink(track);
  let count = 0;
  for await (const packet of sink.packets()) {
    if (packet.timestamp + packet.duration < startTimestamp) continue;
    const shifted = packet.timestamp < startTimestamp
      ? packet.clone({ timestamp: 0, duration: Math.max(0, packet.duration - (startTimestamp - packet.timestamp)) })
      : packet.clone({ timestamp: packet.timestamp - startTimestamp });
    await source.add(shifted, { decoderConfig: config ?? undefined });
    count += 1;
  }
  source.close();
  return { copied: count > 0, codec };
}

async function processVideo(file, metadata, detection) {
  const bitrate = Number(els.bitrate.value) || 12_000_000;
  const canEncode = await canEncodeVideo('avc', { width: metadata.width, height: metadata.height, bitrate });
  if (!canEncode) throw new Error('This browser cannot encode H.264 with WebCodecs. Try current Chrome or Edge.');
  const { input, track } = await openInput(file);
  const canvas = new OffscreenCanvas(metadata.width, metadata.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const target = new BufferTarget();
  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate, alpha: 'discard', latencyMode: 'quality', hardwareAcceleration: 'no-preference' });
  output.addVideoTrack(source, { frameRate: metadata.frameRate || 30 });
  let processed = 0, skipped = 0, gain = 1, firstTimestamp = null, lastTimestamp = -Infinity;
  const estimatedFrames = Math.max(1, Math.round((metadata.duration || 0) * (metadata.frameRate || 30)));
  try {
    await output.start();
    const sink = new VideoSampleSink(track);
    let audioPromise = null;
    for await (const sample of sink.samples()) {
      try {
        if (firstTimestamp === null) {
          firstTimestamp = sample.timestamp;
          audioPromise = copyAudio(input, output, format, firstTimestamp);
        }
        sample.draw(ctx, 0, 0, metadata.width, metadata.height);
        const frame = ctx.getImageData(0, 0, metadata.width, metadata.height);
        const confidence = frameConfidence(frame, detection);
        if (confidence >= LOW_FRAME_CONFIDENCE) {
          const nextGain = estimateGain(frame, detection);
          gain = Math.max(gain - 0.05, Math.min(gain + 0.05, nextGain));
          removeFrameWatermark(frame, detection, gain);
          ctx.putImageData(frame, 0, 0);
          if (els.cleanup.value === 'soft') softCleanup(ctx, detection);
        } else {
          skipped += 1;
        }
        let timestamp = Math.max(0, sample.timestamp - firstTimestamp);
        if (timestamp < lastTimestamp) timestamp = lastTimestamp + 1 / (metadata.frameRate || 30);
        const duration = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : 1 / (metadata.frameRate || 30);
        await source.add(timestamp, duration);
        lastTimestamp = timestamp;
        processed += 1;
        const progress = metadata.duration > 0 ? Math.min(1, (timestamp + duration) / metadata.duration) : Math.min(1, processed / estimatedFrames);
        setProgress(0.28 + progress * 0.68, 'Processing video', `Frame ${processed}${estimatedFrames ? ` / ~${estimatedFrames}` : ''} · ${skipped} low-confidence skipped`);
        if (processed % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        sample.close();
      }
    }
    source.close();
    const audio = audioPromise ? await audioPromise : { copied: false, codec: null };
    await output.finalize();
    if (!target.buffer) throw new Error('The browser produced an empty MP4.');
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), processed, skipped, gain, audio };
  } catch (error) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw error;
  } finally {
    input.dispose();
  }
}

async function loadFile(file) {
  if (!file) return;
  resetForFile();
  currentFile = null;
  if (!SUPPORTED_MIME.has(file.type) && !file.name.toLowerCase().endsWith('.mp4')) {
    showError('Choose an MP4 video', 'Video Light v1 currently accepts MP4 files only.');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('Video is too large', 'Video Light v1 currently limits browser processing to 600 MB.');
    return;
  }
  try {
    const metadata = await getMetadata(file);
    if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) throw new Error('Could not read video dimensions.');
    currentFile = file;
    els.fileName.textContent = file.name;
    els.fileMeta.textContent = `${metadata.width} × ${metadata.height} · ${secondsLabel(metadata.duration)} · ${bytesLabel(file.size)}`;
    els.fileCard.hidden = false;
    els.options.hidden = false;
    els.actions.hidden = false;
    els.process.dataset.metadata = JSON.stringify(metadata);
  } catch (error) {
    showError('Could not read this MP4', error.message || 'The file could not be decoded.');
  }
}

function showError(title, message) {
  els.error.hidden = false;
  els.errorTitle.textContent = title;
  els.errorMessage.textContent = message;
  els.process.disabled = false;
}

async function run() {
  if (!currentFile) return;
  resetForFile();
  els.process.disabled = true;
  try {
    const metadata = JSON.parse(els.process.dataset.metadata || '{}');
    setProgress(0.01, 'Preparing', 'Opening the local MP4.');
    const detection = await detectWatermark(currentFile, metadata);
    setProgress(0.27, 'Watermark locked', `${detection.id} · ${detection.size}px · confidence ${detection.score.toFixed(3)}`);
    const result = await processVideo(currentFile, metadata, detection);
    setProgress(1, 'Done', `${result.processed} frames processed.`);
    currentBlob = result.blob;
    currentBeforeUrl = URL.createObjectURL(currentFile);
    currentAfterUrl = URL.createObjectURL(result.blob);
    els.before.src = currentBeforeUrl;
    els.after.src = currentAfterUrl;
    els.resultDetails.textContent = `${metadata.width} × ${metadata.height} · ${result.processed} frames · ${result.skipped} skipped · ${bytesLabel(result.blob.size)}${result.audio.copied ? ' · audio preserved' : ' · audio not copied'}`;
    els.result.hidden = false;
    els.process.disabled = false;
  } catch (error) {
    els.progress.hidden = true;
    showError('Could not process this video', error.message || 'Video processing failed.');
  }
}

els.choose.addEventListener('click', pickFile);
els.replace.addEventListener('click', pickFile);
els.newFile.addEventListener('click', pickFile);
els.input.addEventListener('change', () => loadFile(els.input.files[0]));
els.process.addEventListener('click', run);
els.download.addEventListener('click', () => {
  if (!currentBlob || !currentAfterUrl || !currentFile) return;
  const link = document.createElement('a');
  link.href = currentAfterUrl;
  link.download = `${currentFile.name.replace(/\.[^.]+$/, '') || 'video'}-clean.mp4`;
  link.click();
});
for (const eventName of ['dragenter', 'dragover']) {
  els.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === 'dragenter') dragDepth += 1;
    els.dropzone.classList.add('is-dragging');
  });
}
els.dropzone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.dropzone.classList.remove('is-dragging');
});
els.dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  els.dropzone.classList.remove('is-dragging');
  loadFile(event.dataTransfer.files[0]);
});
window.addEventListener('beforeunload', clearUrls);
