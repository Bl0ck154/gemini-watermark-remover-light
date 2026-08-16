import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeVideo
} from 'https://cdn.jsdelivr.net/npm/mediabunny@1.46.0/+esm';
import { EMBEDDED_ALPHA_MAPS_U8 } from './maps.js';

const DETECTION_SAMPLES_PER_SECOND = 3;
const MIN_DETECTION_SAMPLES = 18;
const MAX_DETECTION_SAMPLES = 60;
const SMART_SEARCH_FRAME_LIMIT = 9;
const CALIBRATION_FRAME_LIMIT = 12;
const LOW_FRAME_CONFIDENCE = 0.055;
const MIN_DETECTION_SCORE = 0.12;
const MIN_DETECTION_GAP = 0.012;
const STRONG_KNOWN_SCORE = 0.20;
const MAX_FILE_SIZE = 350 * 1024 * 1024;
const SUPPORTED_MIME = new Set(['video/mp4']);
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_VIDEO_BITRATE = 12_000_000;
const LARGE_VIDEO_ALPHA_PROFILE = '96-20260520';
const SMALL_VIDEO_ALPHA_PROFILE = '48';
const DEFAULT_ALPHA_EDGE_BOOST = 0.045;
const INSET_ALPHA_EDGE_BOOST = 0.035;

const KNOWN_CANDIDATES = Object.freeze({
  '1920x1080': [
    { id: '1080-standard', size: 72, marginRight: 108, marginBottom: 108 },
    { id: '1080-relocated', size: 72, marginRight: 144, marginBottom: 144 }
  ],
  '1080x1920': [
    { id: '1080p-standard', size: 72, marginRight: 108, marginBottom: 108 },
    { id: '1080p-relocated', size: 72, marginRight: 144, marginBottom: 144 }
  ],
  '1280x720': [
    { id: '720-standard', size: 48, marginRight: 72, marginBottom: 72 },
    { id: '720-inset', size: 48, marginRight: 96, marginBottom: 96 },
    { id: '720-compact', size: 44, marginRight: 29, marginBottom: 40 }
  ],
  '720x1280': [
    { id: '720p-standard', size: 48, marginRight: 72, marginBottom: 72 },
    { id: '720p-relocated', size: 48, marginRight: 96, marginBottom: 96 },
    { id: '720p-animated-compact', size: 24, marginRight: 48, marginBottom: 48 },
    { id: '720p-vertical-inset', size: 35, marginRight: 102, marginBottom: 96 },
    { id: '720p-compact', size: 44, marginRight: 29, marginBottom: 40 }
  ]
});

const $ = (id) => document.getElementById(id);
const els = {
  dropzone: $('video-dropzone'),
  input: $('video-file-input'),
  choose: $('video-choose'),
  selectedState: $('video-selected-state'),
  selectedPreview: $('video-selected-preview'),
  remove: $('video-remove'),
  fileName: $('video-file-name'),
  fileMeta: $('video-file-meta'),
  replace: $('video-replace'),
  options: $('video-options'),
  actions: $('video-actions'),
  process: $('video-process'),
  progress: $('video-progress'),
  progressLabel: $('video-progress-label'),
  progressPercent: $('video-progress-percent'),
  progressBar: $('video-progress-bar'),
  progressDetail: $('video-progress-detail'),
  error: $('video-error'),
  errorTitle: $('video-error-title'),
  errorMessage: $('video-error-message'),
  errorRetry: $('video-error-retry'),
  result: $('video-result'),
  resultPreview: $('video-result-preview'),
  showOriginal: $('video-show-original'),
  showCleaned: $('video-show-cleaned'),
  resultDetails: $('video-result-details'),
  newFile: $('video-new'),
  download: $('video-download')
};

let currentFile = null;
let currentMetadata = null;
let currentInputUrl = null;
let currentOutputUrl = null;
let currentBlob = null;
let currentResultMode = 'cleaned';
let dragDepth = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function selectedRadio(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
}

function selectedBitrate() {
  return Number(selectedRadio('video-bitrate', String(DEFAULT_VIDEO_BITRATE))) || DEFAULT_VIDEO_BITRATE;
}

function selectedCleanup() {
  return selectedRadio('video-cleanup', 'enhanced');
}

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

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function detectionSampleCount(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 24;
  return clamp(Math.round(duration * DETECTION_SAMPLES_PER_SECOND), MIN_DETECTION_SAMPLES, MAX_DETECTION_SAMPLES);
}

function representativeFrames(frames, limit) {
  if (frames.length <= limit) return frames;
  if (limit <= 1) return [frames[Math.floor(frames.length / 2)]];
  return Array.from({ length: limit }, (_, index) => {
    const frameIndex = Math.round(index * (frames.length - 1) / (limit - 1));
    return frames[frameIndex];
  });
}

function setProgress(progress, label, detail = '') {
  const safe = clamp(Number(progress) || 0, 0, 1);
  const pct = Math.round(safe * 100);
  els.progressBar.style.width = `${pct}%`;
  els.progressPercent.textContent = `${pct}%`;
  els.progressLabel.textContent = label;
  els.progressDetail.textContent = detail;
}

function pauseAndClear(video) {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function clearOutput() {
  pauseAndClear(els.resultPreview);
  if (currentOutputUrl) URL.revokeObjectURL(currentOutputUrl);
  currentOutputUrl = null;
  currentBlob = null;
}

function clearInputPreview() {
  pauseAndClear(els.selectedPreview);
  if (currentInputUrl) URL.revokeObjectURL(currentInputUrl);
  currentInputUrl = null;
}

function clearUrls() {
  clearOutput();
  clearInputPreview();
}

function showDropState(state) {
  els.choose.hidden = state !== 'idle';
  els.selectedState.hidden = state !== 'selected';
  els.progress.hidden = state !== 'processing';
  els.result.hidden = state !== 'result';
  els.error.hidden = state !== 'error';
}

function pickFile() {
  els.input.value = '';
  els.input.click();
}

function removeSelection() {
  currentFile = null;
  currentMetadata = null;
  clearUrls();
  els.options.hidden = true;
  els.actions.hidden = true;
  els.process.disabled = false;
  els.input.value = '';
  showDropState('idle');
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

function createInput(file) {
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

async function openInput(file) {
  const input = createInput(file);
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
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    const [width, height, firstTimestamp, durationFromMetadata, packetStats, audioCodec] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getFirstTimestamp().catch(() => 0),
      input.getDurationFromMetadata([track], { skipLiveWait: true }).catch(() => null),
      track.computePacketStats(90, { skipLiveWait: true }).catch(() => null),
      audioTrack ? audioTrack.getCodec().catch(() => null) : null
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
      frameCountEstimate: Number.isFinite(duration) && sampledFrameRate ? Math.max(1, Math.round(duration * sampledFrameRate)) : null,
      hasAudio: Boolean(audioTrack),
      audioCodec
    };
  } finally {
    input.dispose();
  }
}

function decodePackedMap(key) {
  const packed = EMBEDDED_ALPHA_MAPS_U8[key];
  if (!packed) return null;
  const binary = atob(packed);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  const size = Math.round(Math.sqrt(bytes.length));
  if (!size || size * size !== bytes.length) return null;
  return { size, values: Float32Array.from(bytes, (value) => value / 255) };
}

const alphaSources = new Map();
const resizedMaps = new Map();

function getAlphaSource(profile) {
  if (!alphaSources.has(profile)) alphaSources.set(profile, decodePackedMap(profile));
  return alphaSources.get(profile);
}

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

function enhanceVideoAlphaEdges(alphaMap, size, strength) {
  if (!Number.isFinite(strength) || strength <= 0 || size <= 2) return new Float32Array(alphaMap);
  const gradient = new Float32Array(alphaMap.length);
  let maxGradient = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const gx =
        -alphaMap[i - size - 1] - 2 * alphaMap[i - 1] - alphaMap[i + size - 1] +
        alphaMap[i - size + 1] + 2 * alphaMap[i + 1] + alphaMap[i + size + 1];
      const gy =
        -alphaMap[i - size - 1] - 2 * alphaMap[i - size] - alphaMap[i - size + 1] +
        alphaMap[i + size - 1] + 2 * alphaMap[i + size] + alphaMap[i + size + 1];
      const value = Math.sqrt(gx * gx + gy * gy);
      gradient[i] = value;
      if (value > maxGradient) maxGradient = value;
    }
  }
  if (maxGradient <= 0) return new Float32Array(alphaMap);
  const out = new Float32Array(alphaMap.length);
  for (let i = 0; i < alphaMap.length; i++) {
    const edge = Math.sqrt(gradient[i] / maxGradient);
    out[i] = Math.min(0.99, alphaMap[i] + edge * strength);
  }
  return out;
}

function getAlphaMap(size, edgeBoost = DEFAULT_ALPHA_EDGE_BOOST) {
  const profile = size < 40 ? SMALL_VIDEO_ALPHA_PROFILE : LARGE_VIDEO_ALPHA_PROFILE;
  const cacheKey = `${profile}:${size}:${edgeBoost.toFixed(3)}`;
  if (resizedMaps.has(cacheKey)) return resizedMaps.get(cacheKey);
  const source = getAlphaSource(profile) || getAlphaSource('96') || getAlphaSource('48');
  if (!source) throw new Error('Video alpha calibration maps are missing.');
  const resized = resizeAlphaMapArea(source.values, source.size, size);
  const enhanced = enhanceVideoAlphaEdges(resized, size, edgeBoost);
  resizedMaps.set(cacheKey, enhanced);
  return enhanced;
}

function edgeBoostForGeometry(size, marginRight, marginBottom) {
  const inset = Number.isFinite(size) && size > 0 && (
    marginRight / size >= 1.85 || marginBottom / size >= 1.85
  );
  return inset ? INSET_ALPHA_EDGE_BOOST : DEFAULT_ALPHA_EDGE_BOOST;
}

function buildCandidate({ id, size, marginRight, marginBottom, source = 'known', edgeBoost = null }, width, height) {
  const x = width - marginRight - size;
  const y = height - marginBottom - size;
  if (x < 0 || y < 0 || x + size > width || y + size > height) return null;
  const resolvedBoost = Number.isFinite(edgeBoost) ? edgeBoost : edgeBoostForGeometry(size, marginRight, marginBottom);
  return {
    id,
    x,
    y,
    size,
    marginRight,
    marginBottom,
    source,
    edgeBoost: resolvedBoost,
    alphaMap: getAlphaMap(size, resolvedBoost)
  };
}

function knownCandidatesFor(width, height) {
  const exact = KNOWN_CANDIDATES[`${width}x${height}`] || [];
  const candidates = exact.map((item) => buildCandidate(item, width, height)).filter(Boolean);
  const scale = Math.min(width / 1920, height / 1080);
  if (scale > 0.35) {
    const size = Math.max(22, Math.round(72 * scale));
    for (const [name, marginBase] of [['projected-standard', 108], ['projected-inset', 144]]) {
      const margin = Math.max(8, Math.round(marginBase * scale));
      const projected = buildCandidate({ id: name, size, marginRight: margin, marginBottom: margin, source: 'projected' }, width, height);
      if (projected && !candidates.some((item) => item.x === projected.x && item.y === projected.y && item.size === projected.size)) {
        candidates.push(projected);
      }
    }
  }
  return candidates;
}

function lumaAt(data, index) {
  return (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
}

function scoreCandidate(frame, candidate, pixelStep = 1) {
  const { x, y, size, alphaMap } = candidate;
  if (x < 0 || y < 0 || x + size > frame.width || y + size > frame.height) return Number.NEGATIVE_INFINITY;
  const step = Math.max(1, Math.round(pixelStep));
  let alphaMean = 0;
  let lumaMean = 0;
  let count = 0;
  let activeLuma = 0;
  let activeWeight = 0;
  let quietLuma = 0;
  let quietWeight = 0;

  for (let py = 0; py < size; py += step) {
    for (let px = 0; px < size; px += step) {
      const alpha = alphaMap[py * size + px];
      const index = ((y + py) * frame.width + x + px) * 4;
      const luma = lumaAt(frame.data, index);
      alphaMean += alpha;
      lumaMean += luma;
      count += 1;
      if (alpha > 0.035) {
        activeLuma += luma * alpha;
        activeWeight += alpha;
      } else if (alpha < 0.012) {
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
  for (let py = 0; py < size; py += step) {
    for (let px = 0; px < size; px += step) {
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
  return Math.max(0, correlation) * 0.80 + Math.max(0, contrast) * 0.20;
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
  return clamp(0.88 + contrast * 2.4, 0.68, 1.34);
}

function summarizeCandidate(frames, candidate, pixelStep = 1) {
  const scores = frames.map((frame) => scoreCandidate(frame, candidate, pixelStep)).filter(Number.isFinite);
  if (!scores.length) return { ...candidate, score: Number.NEGATIVE_INFINITY, votes: 0, sampledFrames: 0, seedGain: 1 };
  const sortedScores = [...scores].sort((a, b) => b - a);
  const usefulScores = sortedScores.slice(0, Math.max(3, Math.ceil(sortedScores.length * 0.70)));
  const score = average(usefulScores) * 0.72 + (median(scores) || 0) * 0.28;
  const votes = scores.filter((value) => value >= LOW_FRAME_CONFIDENCE).length;
  const gains = frames.map((frame) => estimateGain(frame, candidate)).filter(Number.isFinite);
  return { ...candidate, score, votes, sampledFrames: scores.length, seedGain: median(gains) || 1 };
}

async function sampleDetectionFrames(file, metadata) {
  const { input, track } = await openInput(file);
  const duration = Number(metadata.duration) || 0;
  const firstTimestamp = Number(metadata.firstTimestamp) || 0;
  const sampleCount = detectionSampleCount(duration);
  const targets = Array.from({ length: sampleCount }, (_, index) => {
    if (duration > 0) return firstTimestamp + duration * ((index + 0.5) / sampleCount);
    return firstTimestamp + index / DETECTION_SAMPLES_PER_SECOND;
  });
  const frames = [];
  try {
    const sink = new CanvasSink(track);
    let index = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(targets)) {
      index += 1;
      if (!wrapped?.canvas) continue;
      const canvas = wrapped.canvas;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      setProgress(0.02 + 0.10 * index / sampleCount, 'Sampling video', `Detection frame ${index}/${sampleCount}`);
      if (index % 3 === 0) await yieldToBrowser();
    }
  } finally {
    input.dispose();
  }
  if (frames.length < Math.min(6, sampleCount)) throw new Error('Could not decode enough frames to detect the watermark safely.');
  return { frames, sampleCount };
}

function searchSizes(width, height) {
  const scale = Math.min(width / 1920, height / 1080);
  const projected = Math.max(22, Math.round(72 * scale));
  const common = [22, 24, 35, 36, 44, 48, 72, projected, Math.round(projected * 0.5), Math.round(projected * 0.67)];
  const limit = Math.max(24, Math.floor(Math.min(width, height) * 0.16));
  return [...new Set(common.map((value) => Math.max(18, Math.round(value))).filter((value) => value <= limit))].sort((a, b) => a - b);
}

function insertTop(list, item, limit = 8) {
  list.push(item);
  list.sort((a, b) => b.score - a.score);
  if (list.length > limit) list.length = limit;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.x}:${candidate.y}:${candidate.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function smartSearchCandidates(frames, metadata) {
  const selectedFrames = representativeFrames(frames, SMART_SEARCH_FRAME_LIMIT);
  const sizes = searchSizes(metadata.width, metadata.height);
  const maxRight = Math.min(360, Math.max(80, Math.round(metadata.width * 0.28)));
  const maxBottom = Math.min(360, Math.max(80, Math.round(metadata.height * 0.28)));
  const coarseTop = [];

  for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex++) {
    const size = sizes[sizeIndex];
    const alphaMap = getAlphaMap(size, DEFAULT_ALPHA_EDGE_BOOST);
    const coarseStep = size <= 24 ? 4 : size <= 48 ? 6 : 8;
    const pixelStep = size <= 24 ? 1 : size <= 48 ? 2 : 3;
    for (let marginBottom = 8; marginBottom <= maxBottom; marginBottom += coarseStep) {
      const y = metadata.height - marginBottom - size;
      if (y < 0) continue;
      for (let marginRight = 8; marginRight <= maxRight; marginRight += coarseStep) {
        const x = metadata.width - marginRight - size;
        if (x < 0) continue;
        const candidate = {
          id: `smart-${size}`,
          x,
          y,
          size,
          marginRight,
          marginBottom,
          source: 'smart',
          edgeBoost: DEFAULT_ALPHA_EDGE_BOOST,
          alphaMap
        };
        const score = average(selectedFrames.map((frame) => scoreCandidate(frame, candidate, pixelStep)));
        if (Number.isFinite(score)) insertTop(coarseTop, { ...candidate, score, coarseStep }, 12);
      }
    }
    setProgress(0.13 + 0.09 * (sizeIndex + 1) / sizes.length, 'Searching watermark area', `Scanning ${size}px candidates across ${selectedFrames.length} representative frames`);
    await yieldToBrowser();
  }

  const refinedTop = [];
  for (const coarse of coarseTop) {
    const radius = coarse.coarseStep;
    for (let y = Math.max(0, coarse.y - radius); y <= Math.min(metadata.height - coarse.size, coarse.y + radius); y++) {
      for (let x = Math.max(0, coarse.x - radius); x <= Math.min(metadata.width - coarse.size, coarse.x + radius); x++) {
        const marginRight = metadata.width - x - coarse.size;
        const marginBottom = metadata.height - y - coarse.size;
        const edgeBoost = edgeBoostForGeometry(coarse.size, marginRight, marginBottom);
        const candidate = {
          id: `smart-${coarse.size}-${x}-${y}`,
          x,
          y,
          size: coarse.size,
          marginRight,
          marginBottom,
          source: 'smart',
          edgeBoost,
          alphaMap: getAlphaMap(coarse.size, edgeBoost)
        };
        const score = average(selectedFrames.map((frame) => scoreCandidate(frame, candidate, coarse.size <= 24 ? 1 : 2)));
        if (Number.isFinite(score)) insertTop(refinedTop, { ...candidate, score }, 10);
      }
    }
    await yieldToBrowser();
  }
  return dedupeCandidates(refinedTop);
}

function restoredLumaAndClip(data, index, alpha) {
  const remainder = Math.max(0.01, 1 - alpha);
  let clipped = 0;
  const channels = [0, 1, 2].map((channel) => {
    const raw = (data[index + channel] - 255 * alpha) / remainder;
    if (raw < 0 || raw > 255) clipped += 1;
    return clamp(raw, 0, 255);
  });
  return {
    luma: (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / 255,
    clipped
  };
}

function residualScoreForGain(frame, candidate, gain, alphaMap = candidate.alphaMap) {
  const { x, y, size } = candidate;
  let alphaMean = 0;
  let lumaMean = 0;
  let count = 0;
  let clipped = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const rawAlpha = alphaMap[py * size + px];
      const alpha = rawAlpha > 0.015 ? Math.min(0.99, rawAlpha * gain) : 0;
      const index = ((y + py) * frame.width + x + px) * 4;
      const restored = alpha > 0 ? restoredLumaAndClip(frame.data, index, alpha) : { luma: lumaAt(frame.data, index), clipped: 0 };
      alphaMean += rawAlpha;
      lumaMean += restored.luma;
      clipped += restored.clipped;
      count += 1;
    }
  }
  if (!count) return Number.POSITIVE_INFINITY;
  alphaMean /= count;
  lumaMean /= count;
  let covariance = 0;
  let alphaVariance = 0;
  let lumaVariance = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const rawAlpha = alphaMap[py * size + px];
      const alpha = rawAlpha > 0.015 ? Math.min(0.99, rawAlpha * gain) : 0;
      const index = ((y + py) * frame.width + x + px) * 4;
      const luma = alpha > 0 ? restoredLumaAndClip(frame.data, index, alpha).luma : lumaAt(frame.data, index);
      const da = rawAlpha - alphaMean;
      const dl = luma - lumaMean;
      covariance += da * dl;
      alphaVariance += da * da;
      lumaVariance += dl * dl;
    }
  }
  const correlation = alphaVariance > 0 && lumaVariance > 0 ? covariance / Math.sqrt(alphaVariance * lumaVariance) : 0;
  const clipRatio = clipped / (count * 3);
  return Math.abs(correlation) + clipRatio * 0.65;
}

function calibrateRemoval(frames, candidate) {
  const calibrationFrames = representativeFrames(frames, CALIBRATION_FRAME_LIMIT);
  const boostOptions = [...new Set([
    candidate.edgeBoost,
    INSET_ALPHA_EDGE_BOOST,
    DEFAULT_ALPHA_EDGE_BOOST,
    0.07,
    0.09,
    0.12
  ].map((value) => Number(value.toFixed(3))))];
  let best = null;

  for (const edgeBoost of boostOptions) {
    const alphaMap = getAlphaMap(candidate.size, edgeBoost);
    const tempCandidate = { ...candidate, edgeBoost, alphaMap };
    const baseGain = median(calibrationFrames.map((frame) => estimateGain(frame, tempCandidate)).filter(Number.isFinite)) || 1;
    const gains = [...new Set([
      baseGain - 0.12,
      baseGain - 0.08,
      baseGain - 0.04,
      baseGain,
      baseGain + 0.04,
      baseGain + 0.08,
      baseGain + 0.12,
      0.90,
      1.00,
      1.10,
      1.20
    ].map((value) => clamp(Number(value.toFixed(3)), 0.65, 1.40)))];

    for (const gain of gains) {
      const scores = calibrationFrames.map((frame) => residualScoreForGain(frame, tempCandidate, gain, alphaMap));
      const score = (median(scores) || Number.POSITIVE_INFINITY) + Math.max(0, edgeBoost - 0.09) * 0.02;
      if (!best || score < best.score) best = { score, edgeBoost, alphaMap, gain };
    }
  }

  if (!best) return candidate;
  return { ...candidate, edgeBoost: best.edgeBoost, alphaMap: best.alphaMap, seedGain: best.gain, calibrationResidual: best.score };
}

function refineFrameGain(frame, candidate, currentGain) {
  const estimated = estimateGain(frame, candidate);
  const candidates = [...new Set([
    currentGain - 0.05,
    currentGain - 0.025,
    currentGain,
    currentGain + 0.025,
    currentGain + 0.05,
    estimated
  ].map((value) => clamp(Number(value.toFixed(3)), 0.65, 1.40)))];
  let bestGain = currentGain;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const gain of candidates) {
    const score = residualScoreForGain(frame, candidate, gain);
    if (score < bestScore) {
      bestScore = score;
      bestGain = gain;
    }
  }
  return clamp(bestGain, currentGain - 0.04, currentGain + 0.04);
}

async function detectWatermark(file, metadata) {
  const sampled = await sampleDetectionFrames(file, metadata);
  const frames = sampled.frames;
  const known = knownCandidatesFor(metadata.width, metadata.height)
    .map((candidate) => summarizeCandidate(frames, candidate))
    .sort((a, b) => b.score - a.score);

  const knownBest = known[0];
  const knownSecond = known[1];
  const knownIsStrong = Boolean(
    knownBest &&
    knownBest.score >= STRONG_KNOWN_SCORE &&
    knownBest.votes >= Math.max(5, Math.ceil(frames.length * 0.45)) &&
    (!knownSecond || knownBest.score - knownSecond.score >= 0.025)
  );

  let smart = [];
  if (!knownIsStrong) {
    smart = (await smartSearchCandidates(frames, metadata)).map((candidate) => summarizeCandidate(frames, candidate));
  }

  const ranked = dedupeCandidates([...known, ...smart]).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const minVotes = Math.max(5, Math.ceil(frames.length * 0.35));

  if (!best || best.score < MIN_DETECTION_SCORE || best.votes < minVotes) {
    throw new Error('No supported Gemini/Veo diamond watermark was detected with enough confidence. Nothing was changed.');
  }
  if (second && best.score - second.score < MIN_DETECTION_GAP && (best.x !== second.x || best.y !== second.y || best.size !== second.size)) {
    throw new Error('The watermark position is ambiguous in this clip. Video Light stopped instead of modifying the wrong region.');
  }

  setProgress(0.24, 'Calibrating removal', `Testing alpha edge shape and removal strength on ${Math.min(frames.length, CALIBRATION_FRAME_LIMIT)} frames`);
  await yieldToBrowser();
  return { ...calibrateRemoval(frames, best), detectionSamples: sampled.sampleCount };
}

function removeFrameWatermark(imageData, candidate, gain) {
  const { x, y, size, alphaMap } = candidate;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const mapAlpha = alphaMap[py * size + px];
      const alpha = mapAlpha > 0.015 ? Math.min(0.99, mapAlpha * gain) : 0;
      if (!alpha) continue;
      const index = ((y + py) * imageData.width + x + px) * 4;
      const remainder = 1 - alpha;
      for (let channel = 0; channel < 3; channel++) {
        imageData.data[index + channel] = clamp(Math.round((imageData.data[index + channel] - 255 * alpha) / remainder), 0, 255);
      }
    }
  }
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function createGaussianKernel(sigma, radius = Math.ceil(sigma * 3)) {
  const safeSigma = Math.max(0.01, sigma);
  const safeRadius = Math.max(1, Math.round(radius));
  const kernel = new Float32Array(safeRadius * 2 + 1);
  let sum = 0;
  for (let i = -safeRadius; i <= safeRadius; i++) {
    const value = Math.exp(-(i * i) / (2 * safeSigma * safeSigma));
    kernel[i + safeRadius] = value;
    sum += value;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return { kernel, radius: safeRadius };
}

function gaussianBlurFloatMap(source, width, height, sigma, radius = Math.ceil(sigma * 3)) {
  const { kernel, radius: r } = createGaussianKernel(sigma, radius);
  const temp = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dx = -r; dx <= r; dx++) {
        const xx = clamp(x + dx, 0, width - 1);
        sum += source[y * width + xx] * kernel[dx + r];
      }
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = clamp(y + dy, 0, height - 1);
        sum += temp[yy * width + x] * kernel[dy + r];
      }
      output[y * width + x] = sum;
    }
  }
  return output;
}

function buildGradientWeightMap(alphaMap, width, height, strength = 1) {
  const gradient = new Float32Array(width * height);
  let maxGradient = 0;
  const sample = (x, y) => alphaMap[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)] || 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const gx = -sample(x - 1, y - 1) - 2 * sample(x - 1, y) - sample(x - 1, y + 1) + sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1);
      const gy = -sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1) + sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1);
      const value = Math.sqrt(gx * gx + gy * gy);
      gradient[i] = value;
      if (value > maxGradient) maxGradient = value;
    }
  }
  if (maxGradient <= 0) return gradient;
  const dilated = new Float32Array(gradient.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let localMax = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = clamp(x + dx, 0, width - 1);
          const yy = clamp(y + dy, 0, height - 1);
          localMax = Math.max(localMax, gradient[yy * width + xx]);
        }
      }
      dilated[y * width + x] = Math.sqrt(localMax / maxGradient);
    }
  }
  const smoothed = gaussianBlurFloatMap(dilated, width, height, 1.0, 3);
  for (let i = 0; i < smoothed.length; i++) smoothed[i] = Math.min(1, smoothed[i] * strength);
  return smoothed;
}

function buildFootprintPolishWeightMap(alphaMap, width, height, strength = 1) {
  const edgeWeights = buildGradientWeightMap(alphaMap, width, height, 1);
  const weights = new Float32Array(width * height);
  const safeStrength = clamp(strength, 0, 1);
  for (let i = 0; i < weights.length; i++) {
    const alpha = alphaMap[i] || 0;
    const edge = edgeWeights[i] || 0;
    const footprint = smoothstep(0.012, 0.12, alpha);
    const body = smoothstep(0.08, 0.22, alpha);
    const edgeGuard = 1 - smoothstep(0.42, 0.78, edge) * 0.24;
    weights[i] = Math.min(1, (footprint * 0.42 + body * 0.24 + edge * 0.22) * edgeGuard * safeStrength);
  }
  return gaussianBlurFloatMap(weights, width, height, 0.85, 2);
}

function mapRoiWeightsToPaddedWeights(roiWeights, candidate, padded, padX, padY) {
  const weights = new Float32Array(padded.width * padded.height);
  for (let y = 0; y < candidate.size; y++) {
    const py = candidate.y - padY + y;
    if (py < 0 || py >= padded.height) continue;
    for (let x = 0; x < candidate.size; x++) {
      const px = candidate.x - padX + x;
      if (px < 0 || px >= padded.width) continue;
      weights[py * padded.width + px] = roiWeights[y * candidate.size + x];
    }
  }
  return weights;
}

function gaussianBlurImageData(imageData, sigma, radius) {
  const { width, height, data } = imageData;
  const { kernel, radius: r } = createGaussianKernel(sigma, radius);
  const temp = new Float32Array(data.length);
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dx = -r; dx <= r; dx++) {
          const xx = clamp(x + dx, 0, width - 1);
          sum += data[(y * width + xx) * 4 + c] * kernel[dx + r];
        }
        temp[dst + c] = sum;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = clamp(y + dy, 0, height - 1);
          sum += temp[(yy * width + x) * 4 + c] * kernel[dy + r];
        }
        output[dst + c] = clamp(Math.round(sum), 0, 255);
      }
    }
  }
  return output;
}

function inpaintImageData(imageData, weights, iterations) {
  const { width, height, data } = imageData;
  const active = new Uint8Array(width * height);
  const current = new Float32Array(data.length);
  const next = new Float32Array(data.length);
  current.set(data);
  next.set(data);
  for (let i = 0; i < weights.length; i++) active[i] = weights[i] > 0.07 ? 1 : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (!active[pixel]) continue;
      let count = 0;
      const sum = [0, 0, 0];
      for (let radius = 1; radius <= 7 && count === 0; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width || Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const neighbor = yy * width + xx;
            if (active[neighbor]) continue;
            const idx = neighbor * 4;
            sum[0] += data[idx];
            sum[1] += data[idx + 1];
            sum[2] += data[idx + 2];
            count += 1;
          }
        }
      }
      if (count > 0) {
        const idx = pixel * 4;
        for (let c = 0; c < 3; c++) current[idx + c] = next[idx + c] = sum[c] / count;
      }
    }
  }

  for (let round = 0; round < iterations; round++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixel = y * width + x;
        const idx = pixel * 4;
        if (!active[pixel]) continue;
        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]];
        let count = 0;
        const sum = [0, 0, 0];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = (ny * width + nx) * 4;
          sum[0] += current[nIdx];
          sum[1] += current[nIdx + 1];
          sum[2] += current[nIdx + 2];
          count += 1;
        }
        if (count > 0) {
          for (let c = 0; c < 3; c++) next[idx + c] = sum[c] / count;
          next[idx + 3] = current[idx + 3];
        }
      }
    }
    current.set(next);
  }

  const output = new Uint8ClampedArray(data.length);
  for (let i = 0; i < output.length; i++) output[i] = clamp(Math.round(current[i]), 0, 255);
  return output;
}

function applyFootprintPolish(ctx, candidate) {
  const padding = Math.max(22, Math.round(candidate.size * 0.55));
  const padX = Math.max(0, candidate.x - padding);
  const padY = Math.max(0, candidate.y - padding);
  const padRight = Math.min(ctx.canvas.width, candidate.x + candidate.size + padding);
  const padBottom = Math.min(ctx.canvas.height, candidate.y + candidate.size + padding);
  const padded = ctx.getImageData(padX, padY, padRight - padX, padBottom - padY);
  const roiWeights = buildFootprintPolishWeightMap(candidate.alphaMap, candidate.size, candidate.size, 1);
  const paddedWeights = mapRoiWeightsToPaddedWeights(roiWeights, candidate, padded, padX, padY);
  const weights = gaussianBlurFloatMap(paddedWeights, padded.width, padded.height, 0.8, 2);
  const base = gaussianBlurImageData(padded, 1.8, 4);
  const inpainted = inpaintImageData(padded, weights, Math.max(12, Math.round(candidate.size / 4)));
  const repairedSource = gaussianBlurImageData({ width: padded.width, height: padded.height, data: inpainted }, 1.2, 3);

  for (let pixel = 0; pixel < weights.length; pixel++) {
    const weight = clamp(weights[pixel] || 0, 0, 1);
    const blendWeight = Math.min(0.42, weight * 0.82);
    if (blendWeight <= 0.012) continue;
    const idx = pixel * 4;
    const textureGain = Math.max(0.24, 0.70 - blendWeight * 1.05);
    for (let c = 0; c < 3; c++) {
      const texture = padded.data[idx + c] - base[idx + c];
      const repaired = clamp(repairedSource[idx + c] + texture * textureGain, 0, 255);
      padded.data[idx + c] = Math.round(padded.data[idx + c] * (1 - blendWeight) + repaired * blendWeight);
    }
  }
  ctx.putImageData(padded, padX, padY);
}

async function processVideo(file, metadata, detection) {
  const bitrate = selectedBitrate();
  const cleanup = selectedCleanup();
  const canEncode = await canEncodeVideo('avc', {
    width: metadata.width,
    height: metadata.height,
    bitrate,
    hardwareAcceleration: 'no-preference'
  });
  if (!canEncode) throw new Error('This browser cannot encode H.264 with WebCodecs. Try current Chrome or Edge.');

  const input = createInput(file);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
  let canvas = null;
  let ctx = null;
  let processed = 0;
  let skipped = 0;
  let gain = Number.isFinite(detection.seedGain) ? detection.seedGain : 1;

  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        codec: 'avc',
        bitrate,
        keyFrameInterval: 2,
        hardwareAcceleration: 'no-preference',
        forceTranscode: true,
        processedWidth: metadata.width,
        processedHeight: metadata.height,
        process: (sample) => {
          if (!canvas) {
            canvas = createRuntimeCanvas(metadata.width, metadata.height);
            ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) throw new Error('Canvas video processing is unavailable in this browser.');
          }

          ctx.clearRect(0, 0, metadata.width, metadata.height);
          sample.draw(ctx, 0, 0, metadata.width, metadata.height);
          const frame = ctx.getImageData(0, 0, metadata.width, metadata.height);
          const confidence = scoreCandidate(frame, detection);
          if (confidence >= LOW_FRAME_CONFIDENCE) {
            gain = refineFrameGain(frame, detection, gain);
            removeFrameWatermark(frame, detection, gain);
            ctx.putImageData(frame, 0, 0);
            if (cleanup === 'enhanced') applyFootprintPolish(ctx, detection);
          } else {
            skipped += 1;
          }
          processed += 1;
          return canvas;
        }
      }
    });

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((item) => item.reason).filter(Boolean);
      throw new Error(`This MP4 cannot be converted safely in this browser${reasons.length ? `: ${[...new Set(reasons)].join(', ')}` : '.'}`);
    }

    const audioDiscarded = Boolean(audioTrack && conversion.discardedTracks.some((item) => item.track === audioTrack));
    conversion.onProgress = (progress) => {
      const safe = Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
      setProgress(0.28 + safe * 0.70, 'Processing video', `Frame ${processed}${metadata.frameCountEstimate ? ` / ~${metadata.frameCountEstimate}` : ''} · ${skipped} low-confidence skipped`);
    };

    await conversion.execute();
    if (!target.buffer) throw new Error('The browser produced an empty MP4.');
    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      processed,
      skipped,
      gain,
      bitrate,
      cleanup,
      audioKept: Boolean(audioTrack && !audioDiscarded),
      hadAudio: Boolean(audioTrack)
    };
  } finally {
    input.dispose();
  }
}

function showError(title, message) {
  els.errorTitle.textContent = title;
  els.errorMessage.textContent = message;
  els.options.hidden = true;
  els.actions.hidden = true;
  els.process.disabled = false;
  showDropState('error');
}

async function loadFile(file) {
  if (!file) return;
  clearUrls();
  currentFile = null;
  currentMetadata = null;
  els.options.hidden = true;
  els.actions.hidden = true;

  if (!SUPPORTED_MIME.has(file.type) && !file.name.toLowerCase().endsWith('.mp4')) {
    showError('Choose an MP4 video', 'Video Light currently accepts MP4 files only.');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('Video is too large', 'Video Light currently limits in-memory browser processing to 350 MB.');
    return;
  }

  try {
    const metadata = await getMetadata(file);
    if (!Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) throw new Error('Could not read video dimensions.');
    currentFile = file;
    currentMetadata = metadata;
    currentInputUrl = URL.createObjectURL(file);
    els.selectedPreview.src = currentInputUrl;
    els.selectedPreview.load();
    const samples = detectionSampleCount(metadata.duration);
    els.fileName.textContent = file.name;
    els.fileMeta.textContent = `${metadata.width} × ${metadata.height} · ${secondsLabel(metadata.duration)} · ${bytesLabel(file.size)} · ${samples} detection samples${metadata.hasAudio ? ` · audio ${metadata.audioCodec || 'present'}` : ''}`;
    els.options.hidden = false;
    els.actions.hidden = false;
    showDropState('selected');
  } catch (error) {
    showError('Could not read this MP4', error.message || 'The file could not be decoded.');
  }
}

function setResultMode(mode) {
  if (!currentInputUrl || !currentOutputUrl) return;
  const nextUrl = mode === 'original' ? currentInputUrl : currentOutputUrl;
  if (currentResultMode === mode && els.resultPreview.src === nextUrl) return;
  const currentTime = Number.isFinite(els.resultPreview.currentTime) ? els.resultPreview.currentTime : 0;
  const shouldResume = !els.resultPreview.paused;
  currentResultMode = mode;
  els.showOriginal.classList.toggle('is-active', mode === 'original');
  els.showCleaned.classList.toggle('is-active', mode === 'cleaned');
  els.resultPreview.src = nextUrl;
  els.resultPreview.load();
  els.resultPreview.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(els.resultPreview.duration)) els.resultPreview.currentTime = Math.min(currentTime, Math.max(0, els.resultPreview.duration - 0.05));
    if (shouldResume) els.resultPreview.play().catch(() => {});
  }, { once: true });
}

async function run() {
  if (!currentFile || !currentMetadata) return;
  clearOutput();
  els.process.disabled = true;
  els.options.hidden = true;
  els.actions.hidden = true;
  showDropState('processing');
  try {
    setProgress(0.01, 'Preparing', 'Opening the local MP4.');
    const detection = await detectWatermark(currentFile, currentMetadata);
    setProgress(0.27, 'Watermark locked', `${detection.source} · ${detection.size}px at ${detection.x},${detection.y} · ${detection.detectionSamples} samples · edge +${detection.edgeBoost.toFixed(3)}`);
    const result = await processVideo(currentFile, currentMetadata, detection);
    setProgress(1, 'Done', `${result.processed} frames processed.`);

    currentBlob = result.blob;
    currentOutputUrl = URL.createObjectURL(result.blob);
    currentResultMode = 'cleaned';
    els.showOriginal.classList.remove('is-active');
    els.showCleaned.classList.add('is-active');
    els.resultPreview.src = currentOutputUrl;
    els.resultPreview.load();
    const audioLabel = result.hadAudio ? (result.audioKept ? 'audio kept' : 'audio could not be kept') : 'no audio track';
    els.resultDetails.textContent = `${currentMetadata.width} × ${currentMetadata.height} · ${result.processed} frames · ${result.skipped} skipped · ${Math.round(result.bitrate / 1_000_000)} Mbps · ${bytesLabel(result.blob.size)} · ${audioLabel} · ${detection.detectionSamples} detection samples · edge +${detection.edgeBoost.toFixed(3)} · gain ${result.gain.toFixed(2)}`;
    showDropState('result');
  } catch (error) {
    showError('Could not process this video', error.message || 'Video processing failed.');
  } finally {
    els.process.disabled = false;
  }
}

els.choose.addEventListener('click', pickFile);
els.replace.addEventListener('click', pickFile);
els.newFile.addEventListener('click', pickFile);
els.errorRetry.addEventListener('click', pickFile);
els.remove.addEventListener('click', removeSelection);
els.input.addEventListener('change', () => loadFile(els.input.files[0]));
els.process.addEventListener('click', run);
els.showOriginal.addEventListener('click', () => setResultMode('original'));
els.showCleaned.addEventListener('click', () => setResultMode('cleaned'));
els.download.addEventListener('click', () => {
  if (!currentBlob || !currentOutputUrl || !currentFile) return;
  const link = document.createElement('a');
  link.href = currentOutputUrl;
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
