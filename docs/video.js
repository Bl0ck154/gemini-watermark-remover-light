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
const MIN_DETECTION_SCORE = 0.055;
const MAX_FILE_SIZE = 350 * 1024 * 1024;
const SUPPORTED_MIME = new Set(['video/mp4']);
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_VIDEO_BITRATE = 12_000_000;
const VIDEO_ALPHA_PROFILE = '96-20260520';

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
let currentMetadata = null;
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

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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

function createRuntimeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function yieldToBrowser() {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
    const [width, height, firstTimestamp, durationFromMetadata, packetStats] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getFirstTimestamp().catch(() => 0),
      input.getDurationFromMetadata([track], { skipLiveWait: true }).catch(() => null),
      track.computePacketStats(90, { skipLiveWait: true }).catch(() => null)
    ]);
    const duration = Number.isFinite(durationFromMetadata) && durationFromMetadata > 0
      ? durationFromMetadata
      : await track.computeDuration({ skipLiveWait: true }).catch(() => null);
    const sampledFrameRate = Number.isFinite(packetStats?.averagePacketRate) && packetStats.averagePacketRate > 0
      ? packetStats.averagePacketRate
      : null;
    return {
      width,
      height,
      firstTimestamp: Number.isFinite(firstTimestamp) ? firstTimestamp : 0,
      duration: Number.isFinite(duration) ? duration : null,
      frameRate: sampledFrameRate || DEFAULT_FRAME_RATE,
      frameCountEstimate: Number.isFinite(duration) && sampledFrameRate ? Math.max(1, Math.round(duration * sampledFrameRate)) : null
    };
  } finally {
    input.dispose();
  }
}

function decodePackedMap(key = VIDEO_ALPHA_PROFILE) {
  const packed = EMBEDDED_ALPHA_MAPS_U8[key] || EMBEDDED_ALPHA_MAPS_U8['96'];
  if (!packed) throw new Error('Video alpha calibration map is missing.');
  const binary = atob(packed);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const size = Math.round(Math.sqrt(bytes.length));
  if (!size || size * size !== bytes.length) throw new Error('Video alpha calibration map is invalid.');
  return { size, values: Float32Array.from(bytes, (value) => value / 255) };
}

const baseMap = decodePackedMap();
const resizedMaps = new Map();

function resizeAlphaMapArea(source, sourceSize, targetSize) {
  if (sourceSize === targetSize) return new Float32Array(source);
  const out = new Float32Array(targetSize * targetSize);
  const scale = sourceSize / targetSize;
  for (let y = 0; y < targetSize; y++) {
    const yStart = y * scale;
    const yEnd = (y + 1) * scale;
    const y0 = Math.floor(yStart);
    const y1 = Math.ceil(yEnd);
    for (let x = 0; x < targetSize; x++) {
      const xStart = x * scale;
      const xEnd = (x + 1) * scale;
      const x0 = Math.floor(xStart);
      const x1 = Math.ceil(xEnd);
      let sum = 0;
      let areaSum = 0;
      for (let sy = y0; sy < y1; sy++) {
        if (sy < 0 || sy >= sourceSize) continue;
        const wy = Math.max(0, Math.min(yEnd, sy + 1) - Math.max(yStart, sy));
        for (let sx = x0; sx < x1; sx++) {
          if (sx < 0 || sx >= sourceSize) continue;
          const wx = Math.max(0, Math.min(xEnd, sx + 1) - Math.max(xStart, sx));
          const area = wx * wy;
          sum += source[sy * sourceSize + sx] * area;
          areaSum += area;
        }
      }
      out[y * targetSize + x] = areaSum > 0 ? sum / areaSum : 0;
    }
  }
  return out;
}

function getAlphaMap(size) {
  if (!resizedMaps.has(size)) resizedMaps.set(size, resizeAlphaMapArea(baseMap.values, baseMap.size, size));
  return resizedMaps.get(size);
}

function candidatesFor(width, height) {
  const exact = CANDIDATES[`${width}x${height}`];
  if (exact) return exact.map((candidate) => ({ ...candidate, alphaMap: getAlphaMap(candidate.size) }));
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (longSide < 900 || shortSide < 500) return [];
  const scale = shortSide / 1080;
  const size = Math.max(36, Math.round(72 * scale));
  const margin = Math.max(Math.round(size * 1.5), 48);
  const x = width - margin - size;
  const y = height - margin - size;
  if (x < 0 || y < 0) return [];
  return [{ id: 'scaled-standard-experimental', x, y, size, alphaMap: getAlphaMap(size), experimental: true }];
}

function lumaAt(data, index) {
  return (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
}

function scoreCandidate(frame, candidate) {
  const { x, y, size, alphaMap } = candidate;
  if (x < 0 || y < 0 || x + size > frame.width || y + size > frame.height) return Number.NEGATIVE_INFINITY;

  let alphaMean = 0;
  let lumaMean = 0;
  let count = 0;
  let activeLuma = 0;
  let activeWeight = 0;
  let quietLuma = 0;
  let quietWeight = 0;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const alpha = alphaMap[py * size + px];
      const index = ((y + py) * frame.width + x + px) * 4;
      const luma = lumaAt(frame.data, index);
      alphaMean += alpha;
      lumaMean += luma;
      count += 1;
      if (alpha > 0.035) {
        activeLuma += luma * alpha;
        activeWeight += alpha;
      } else {
        quietLuma += luma;
        quietWeight += 1;
      }
    }
  }

  if (!count || !activeWeight || !quietWeight) return Number.NEGATIVE_INFINITY;
  alphaMean /= count;
  lumaMean /= count;

  let covariance = 0;
  let alphaVariance = 0;
  let lumaVariance = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const alpha = alphaMap[py * size + px];
      const index = ((y + py) * frame.width + x + px) * 4;
      const luma = lumaAt(frame.data, index);
      const da = alpha - alphaMean;
      const dl = luma - lumaMean;
      covariance += da * dl;
      alphaVariance += da * da;
      lumaVariance += dl * dl;
    }
  }

  const correlation = alphaVariance > 0 && lumaVariance > 0
    ? covariance / Math.sqrt(alphaVariance * lumaVariance)
    : 0;
  const contrast = activeLuma / activeWeight - quietLuma / quietWeight;
  return Math.max(0, correlation) * 0.72 + Math.max(0, contrast) * 0.28;
}

function estimateGain(frame, candidate) {
  const { x, y, size, alphaMap } = candidate;
  let activeLuma = 0;
  let activeWeight = 0;
  let quietLuma = 0;
  let quietWeight = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const alpha = alphaMap[py * size + px];
      const index = ((y + py) * frame.width + x + px) * 4;
      const luma = lumaAt(frame.data, index);
      if (alpha > 0.05) {
        activeLuma += luma * alpha;
        activeWeight += alpha;
      } else if (alpha < 0.012) {
        quietLuma += luma;
        quietWeight += 1;
      }
    }
  }
  if (!activeWeight || !quietWeight) return 1;
  const contrast = activeLuma / activeWeight - quietLuma / quietWeight;
  return Math.max(0.72, Math.min(1.22, 0.88 + contrast * 2.4));
}

async function detectWatermark(file, metadata) {
  const candidates = candidatesFor(metadata.width, metadata.height);
  if (!candidates.length) throw new Error(`Video size ${metadata.width}×${metadata.height} is not supported by Video Light yet.`);

  const { input, track } = await openInput(file);
  const canvas = createRuntimeCanvas(metadata.width, metadata.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    input.dispose();
    throw new Error('Canvas video processing is unavailable in this browser.');
  }

  const duration = Number(metadata.duration) || 0;
  const firstTimestamp = Number(metadata.firstTimestamp) || 0;
  const interval = duration > 0 ? duration / (SAMPLE_COUNT + 1) : 0;
  const targets = Array.from({ length: SAMPLE_COUNT }, (_, i) => firstTimestamp + interval * (i + 1));
  const evidence = new Map(candidates.map((candidate) => [candidate.id, { candidate, scores: [], gains: [] }]));
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
          const item = evidence.get(candidate.id);
          item.scores.push(scoreCandidate(frame, candidate));
          item.gains.push(estimateGain(frame, candidate));
        }
        targetIndex += 1;
        setProgress(0.03 + 0.22 * targetIndex / SAMPLE_COUNT, 'Detecting watermark', `Sample ${targetIndex}/${SAMPLE_COUNT}`);
        await yieldToBrowser();
      } finally {
        sample.close();
      }
    }
  } finally {
    input.dispose();
  }

  const ranked = [...evidence.values()].filter((item) => item.scores.length).map((item) => {
    const sortedScores = [...item.scores].sort((a, b) => b - a);
    const usefulScores = sortedScores.slice(0, Math.max(3, Math.ceil(sortedScores.length * 0.65)));
    return {
      ...item.candidate,
      score: usefulScores.reduce((sum, value) => sum + value, 0) / usefulScores.length,
      seedGain: median(item.gains.filter(Number.isFinite)) || 1,
      sampledFrames: item.scores.length
    };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < MIN_DETECTION_SCORE) {
    throw new Error('No supported Gemini/Veo diamond watermark was detected with enough confidence.');
  }
  if (second && best.score - second.score < 0.008 && best.id !== second.id) {
    throw new Error('The watermark position is ambiguous in this clip. Video Light stopped instead of modifying the wrong region.');
  }
  return best;
}

function removeFrameWatermark(imageData, candidate, gain) {
  const { x, y, size, alphaMap } = candidate;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const mapAlpha = alphaMap[py * size + px];
      const alpha = mapAlpha > 0.025 ? Math.min(0.99, mapAlpha * gain) : 0;
      if (!alpha) continue;
      const index = ((y + py) * imageData.width + x + px) * 4;
      const remainder = 1 - alpha;
      for (let channel = 0; channel < 3; channel++) {
        imageData.data[index + channel] = Math.max(0, Math.min(255, Math.round((imageData.data[index + channel] - 255 * alpha) / remainder)));
      }
    }
  }
}

function softCleanup(ctx, candidate) {
  const { x, y, size, alphaMap } = candidate;
  const roi = ctx.getImageData(x, y, size, size);
  const source = new Uint8ClampedArray(roi.data);
  for (let py = 1; py < size - 1; py++) {
    for (let px = 1; px < size - 1; px++) {
      const alpha = alphaMap[py * size + px];
      if (alpha < 0.025 || alpha > 0.22) continue;
      const index = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const neighborAverage = (
          source[((py - 1) * size + px) * 4 + channel] +
          source[((py + 1) * size + px) * 4 + channel] +
          source[(py * size + px - 1) * 4 + channel] +
          source[(py * size + px + 1) * 4 + channel]
        ) / 4;
        roi.data[index + channel] = Math.round(source[index + channel] * 0.78 + neighborAverage * 0.22);
      }
    }
  }
  ctx.putImageData(roi, x, y);
}

async function prepareAudioCopy(input, output, format, startTimestamp) {
  const track = await input.getPrimaryAudioTrack().catch(() => null);
  if (!track) return { source: null, track: null, meta: null, startTimestamp, result: { copied: false, codec: null, reason: 'no-audio-track' } };
  const codec = await track.getCodec().catch(() => null);
  if (!codec || !format.getSupportedAudioCodecs().includes(codec)) {
    return { source: null, track, meta: null, startTimestamp, result: { copied: false, codec, reason: 'unsupported-audio-codec' } };
  }
  const source = new EncodedAudioPacketSource(codec);
  output.addAudioTrack(source);
  const decoderConfig = await track.getDecoderConfig().catch(() => null);
  return {
    source,
    track,
    meta: { decoderConfig: decoderConfig ?? undefined },
    startTimestamp,
    result: { copied: false, codec, reason: null }
  };
}

async function copyAudioPackets(audioCopy) {
  if (!audioCopy.source || !audioCopy.track) return audioCopy.result;
  const sink = new EncodedPacketSink(audioCopy.track);
  let packetCount = 0;
  try {
    for await (const packet of sink.packets()) {
      const shiftedTimestamp = packet.timestamp - audioCopy.startTimestamp;
      if (packet.timestamp + packet.duration <= audioCopy.startTimestamp) continue;
      const normalized = shiftedTimestamp >= 0
        ? packet.clone({ timestamp: shiftedTimestamp })
        : packet.clone({ timestamp: 0, duration: Math.max(0, packet.duration + shiftedTimestamp) });
      await audioCopy.source.add(normalized, audioCopy.meta);
      packetCount += 1;
    }
    audioCopy.source.close();
    return { copied: packetCount > 0, codec: audioCopy.result.codec, reason: packetCount > 0 ? null : 'no-audio-packets' };
  } catch (error) {
    audioCopy.source.close();
    throw error;
  }
}

async function processVideo(file, metadata, detection) {
  const bitrate = Number(els.bitrate.value) || DEFAULT_VIDEO_BITRATE;
  const frameRate = Number(metadata.frameRate) || DEFAULT_FRAME_RATE;
  const canEncode = await canEncodeVideo('avc', {
    width: metadata.width,
    height: metadata.height,
    bitrate,
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
    contentHint: 'detail'
  });
  if (!canEncode) throw new Error('This browser cannot encode H.264 with WebCodecs. Try current Chrome or Edge.');

  const { input, track } = await openInput(file);
  const canvas = createRuntimeCanvas(metadata.width, metadata.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    input.dispose();
    throw new Error('Canvas video processing is unavailable in this browser.');
  }

  const target = new BufferTarget();
  const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate,
    alpha: 'discard',
    keyFrameInterval: 2,
    latencyMode: 'quality',
    bitrateMode: 'constant',
    hardwareAcceleration: 'no-preference',
    contentHint: 'detail'
  });
  output.addVideoTrack(source, { frameRate });

  const startTimestamp = Number(metadata.firstTimestamp) || 0;
  const audioCopy = await prepareAudioCopy(input, output, format, startTimestamp);
  let processed = 0;
  let skipped = 0;
  let gain = Number.isFinite(detection.seedGain) ? detection.seedGain : 1;
  let lastTimestamp = -Infinity;
  const fallbackDuration = 1 / frameRate;
  const frameEstimate = metadata.frameCountEstimate || (metadata.duration ? Math.max(1, Math.round(metadata.duration * frameRate)) : null);

  try {
    await output.start();
    const audioCopyPromise = copyAudioPackets(audioCopy);
    const sink = new VideoSampleSink(track);

    for await (const sample of sink.samples()) {
      try {
        sample.draw(ctx, 0, 0, metadata.width, metadata.height);
        const frame = ctx.getImageData(0, 0, metadata.width, metadata.height);
        const confidence = scoreCandidate(frame, detection);
        if (confidence >= LOW_FRAME_CONFIDENCE) {
          const estimatedGain = estimateGain(frame, detection);
          gain = Math.max(gain - 0.05, Math.min(gain + 0.05, estimatedGain));
          removeFrameWatermark(frame, detection, gain);
          ctx.putImageData(frame, 0, 0);
          if (els.cleanup.value === 'soft') softCleanup(ctx, detection);
        } else {
          skipped += 1;
        }

        let timestamp = Math.max(0, sample.timestamp - startTimestamp);
        if (timestamp < lastTimestamp) timestamp = lastTimestamp + fallbackDuration;
        const duration = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : fallbackDuration;
        await source.add(timestamp, duration);
        lastTimestamp = timestamp;
        processed += 1;

        const timeProgress = Number.isFinite(metadata.duration) && metadata.duration > 0
          ? Math.max(0, Math.min(1, (timestamp + duration) / metadata.duration))
          : null;
        const progress = timeProgress ?? (frameEstimate ? Math.min(1, processed / frameEstimate) : 0);
        setProgress(0.28 + progress * 0.68, 'Processing video', `Frame ${processed}${frameEstimate ? ` / ~${frameEstimate}` : ''} · ${skipped} low-confidence skipped`);
        if (processed % 4 === 0) await yieldToBrowser();
      } finally {
        sample.close();
      }
    }

    source.close();
    const audio = await audioCopyPromise;
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
  currentMetadata = null;
  els.fileCard.hidden = true;
  els.options.hidden = true;
  els.actions.hidden = true;

  if (!SUPPORTED_MIME.has(file.type) && !file.name.toLowerCase().endsWith('.mp4')) {
    showError('Choose an MP4 video', 'Video Light v1 currently accepts MP4 files only.');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('Video is too large', 'Video Light v1 currently limits in-memory browser processing to 350 MB.');
    return;
  }

  try {
    const metadata = await getMetadata(file);
    if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) throw new Error('Could not read video dimensions.');
    currentFile = file;
    currentMetadata = metadata;
    els.fileName.textContent = file.name;
    els.fileMeta.textContent = `${metadata.width} × ${metadata.height} · ${secondsLabel(metadata.duration)} · ${bytesLabel(file.size)}`;
    els.fileCard.hidden = false;
    els.options.hidden = false;
    els.actions.hidden = false;
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
  if (!currentFile || !currentMetadata) return;
  resetForFile();
  els.process.disabled = true;
  try {
    setProgress(0.01, 'Preparing', 'Opening the local MP4.');
    const detection = await detectWatermark(currentFile, currentMetadata);
    setProgress(0.27, 'Watermark locked', `${detection.id} · ${detection.size}px · confidence ${detection.score.toFixed(3)}`);
    const result = await processVideo(currentFile, currentMetadata, detection);
    setProgress(1, 'Done', `${result.processed} frames processed.`);

    currentBlob = result.blob;
    currentBeforeUrl = URL.createObjectURL(currentFile);
    currentAfterUrl = URL.createObjectURL(result.blob);
    els.before.src = currentBeforeUrl;
    els.after.src = currentAfterUrl;
    els.resultDetails.textContent = `${currentMetadata.width} × ${currentMetadata.height} · ${result.processed} frames · ${result.skipped} skipped · ${bytesLabel(result.blob.size)}${result.audio.copied ? ' · audio preserved' : ' · audio not copied'}`;
    els.result.hidden = false;
  } catch (error) {
    els.progress.hidden = true;
    showError('Could not process this video', error.message || 'Video processing failed.');
  } finally {
    els.process.disabled = false;
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
