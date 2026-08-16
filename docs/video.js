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

const SAMPLE_COUNT = 12;
const LOW_FRAME_CONFIDENCE = 0.06;
const MIN_DETECTION_SCORE = 0.12;
const MIN_DETECTION_GAP = 0.012;
const STRONG_KNOWN_SCORE = 0.20;
const MAX_FILE_SIZE = 350 * 1024 * 1024;
const SUPPORTED_MIME = new Set(['video/mp4']);
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_VIDEO_BITRATE = 12_000_000;
const LARGE_VIDEO_ALPHA_PROFILE = '96-20260520';
const SMALL_VIDEO_ALPHA_PROFILE = '48';

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
  dropzone: $('video-dropzone'), input: $('video-file-input'), choose: $('video-choose'), fileCard: $('video-file-card'),
  fileName: $('video-file-name'), fileMeta: $('video-file-meta'), replace: $('video-replace'), options: $('video-options'),
  actions: $('video-actions'), process: $('video-process'), progress: $('video-progress'), progressLabel: $('video-progress-label'),
  progressPercent: $('video-progress-percent'), progressBar: $('video-progress-bar'), progressDetail: $('video-progress-detail'),
  error: $('video-error'), errorTitle: $('video-error-title'), errorMessage: $('video-error-message'), result: $('video-result'),
  before: $('video-before'), after: $('video-after'), resultDetails: $('video-result-details'), newFile: $('video-new'),
  download: $('video-download')
};

let currentFile = null;
let currentMetadata = null;
let currentBeforeUrl = null;
let currentAfterUrl = null;
let currentBlob = null;
let dragDepth = 0;

function selectedRadio(name, fallback) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
}

function selectedBitrate() {
  return Number(selectedRadio('video-bitrate', String(DEFAULT_VIDEO_BITRATE))) || DEFAULT_VIDEO_BITRATE;
}

function selectedCleanup() {
  return selectedRadio('video-cleanup', 'soft');
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
  for (const video of [els.before, els.after]) {
    if (!video) continue;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
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
      audioTrack?.getCodec().catch(() => null) ?? null
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

function getAlphaMap(size) {
  const profile = size < 40 ? SMALL_VIDEO_ALPHA_PROFILE : LARGE_VIDEO_ALPHA_PROFILE;
  const cacheKey = `${profile}:${size}`;
  if (resizedMaps.has(cacheKey)) return resizedMaps.get(cacheKey);
  const source = getAlphaSource(profile) || getAlphaSource('96') || getAlphaSource('48');
  if (!source) throw new Error('Video alpha calibration maps are missing.');
  const resized = resizeAlphaMapArea(source.values, source.size, size);
  resizedMaps.set(cacheKey, resized);
  return resized;
}

function buildCandidate({ id, size, marginRight, marginBottom, source = 'known' }, width, height) {
  const x = width - marginRight - size;
  const y = height - marginBottom - size;
  if (x < 0 || y < 0 || x + size > width || y + size > height) return null;
  return { id, x, y, size, marginRight, marginBottom, source, alphaMap: getAlphaMap(size) };
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
  return Math.max(0.72, Math.min(1.22, 0.88 + contrast * 2.4));
}

function summarizeCandidate(frames, candidate, pixelStep = 1) {
  const scores = frames.map((frame) => scoreCandidate(frame, candidate, pixelStep)).filter(Number.isFinite);
  if (!scores.length) return { ...candidate, score: Number.NEGATIVE_INFINITY, votes: 0, sampledFrames: 0, seedGain: 1 };
  const sortedScores = [...scores].sort((a, b) => b - a);
  const usefulScores = sortedScores.slice(0, Math.max(3, Math.ceil(sortedScores.length * 0.70)));
  const score = average(usefulScores) * 0.72 + (median(scores) || 0) * 0.28;
  const votes = scores.filter((value) => value >= LOW_FRAME_CONFIDENCE).length;
  const gains = frames
    .map((frame, index) => scores[index] >= LOW_FRAME_CONFIDENCE ? estimateGain(frame, candidate) : null)
    .filter(Number.isFinite);
  return { ...candidate, score, votes, sampledFrames: scores.length, seedGain: median(gains) || 1 };
}

async function sampleDetectionFrames(file, metadata) {
  const { input, track } = await openInput(file);
  const duration = Number(metadata.duration) || 0;
  const firstTimestamp = Number(metadata.firstTimestamp) || 0;
  const interval = duration > 0 ? duration / (SAMPLE_COUNT + 1) : 0;
  const targets = Array.from({ length: SAMPLE_COUNT }, (_, index) => firstTimestamp + interval * (index + 1));
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
      setProgress(0.03 + 0.09 * index / SAMPLE_COUNT, 'Sampling video', `Detection frame ${index}/${SAMPLE_COUNT}`);
      await yieldToBrowser();
    }
  } finally {
    input.dispose();
  }
  if (frames.length < 3) throw new Error('Could not decode enough frames to detect the watermark safely.');
  return frames;
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
  const selectedFrames = frames.length <= 3
    ? frames
    : [frames[1], frames[Math.floor(frames.length / 2)], frames[frames.length - 2]];
  const sizes = searchSizes(metadata.width, metadata.height);
  const maxRight = Math.min(360, Math.max(80, Math.round(metadata.width * 0.28)));
  const maxBottom = Math.min(360, Math.max(80, Math.round(metadata.height * 0.28)));
  const coarseTop = [];

  for (let sizeIndex = 0; sizeIndex < sizes.length; sizeIndex++) {
    const size = sizes[sizeIndex];
    const alphaMap = getAlphaMap(size);
    const coarseStep = size <= 24 ? 4 : size <= 48 ? 6 : 8;
    const pixelStep = size <= 24 ? 1 : size <= 48 ? 2 : 3;
    for (let marginBottom = 8; marginBottom <= maxBottom; marginBottom += coarseStep) {
      const y = metadata.height - marginBottom - size;
      if (y < 0) continue;
      for (let marginRight = 8; marginRight <= maxRight; marginRight += coarseStep) {
        const x = metadata.width - marginRight - size;
        if (x < 0) continue;
        const candidate = { id: `smart-${size}`, x, y, size, marginRight, marginBottom, source: 'smart', alphaMap };
        const score = average(selectedFrames.map((frame) => scoreCandidate(frame, candidate, pixelStep)));
        if (Number.isFinite(score)) insertTop(coarseTop, { ...candidate, score, coarseStep }, 10);
      }
    }
    setProgress(0.13 + 0.10 * (sizeIndex + 1) / sizes.length, 'Searching watermark area', `Scanning ${size}px candidates near the bottom-right corner`);
    await yieldToBrowser();
  }

  const refinedTop = [];
  for (const coarse of coarseTop) {
    const radius = coarse.coarseStep;
    for (let y = Math.max(0, coarse.y - radius); y <= Math.min(metadata.height - coarse.size, coarse.y + radius); y++) {
      for (let x = Math.max(0, coarse.x - radius); x <= Math.min(metadata.width - coarse.size, coarse.x + radius); x++) {
        const candidate = {
          id: `smart-${coarse.size}-${x}-${y}`,
          x,
          y,
          size: coarse.size,
          marginRight: metadata.width - x - coarse.size,
          marginBottom: metadata.height - y - coarse.size,
          source: 'smart',
          alphaMap: coarse.alphaMap
        };
        const score = average(selectedFrames.map((frame) => scoreCandidate(frame, candidate, coarse.size <= 24 ? 1 : 2)));
        if (Number.isFinite(score)) insertTop(refinedTop, { ...candidate, score }, 8);
      }
    }
    await yieldToBrowser();
  }
  return dedupeCandidates(refinedTop);
}

async function detectWatermark(file, metadata) {
  const frames = await sampleDetectionFrames(file, metadata);
  const known = knownCandidatesFor(metadata.width, metadata.height)
    .map((candidate) => summarizeCandidate(frames, candidate))
    .sort((a, b) => b.score - a.score);

  const knownBest = known[0];
  const knownSecond = known[1];
  const knownIsStrong = Boolean(
    knownBest &&
    knownBest.score >= STRONG_KNOWN_SCORE &&
    knownBest.votes >= Math.max(3, Math.ceil(frames.length * 0.45)) &&
    (!knownSecond || knownBest.score - knownSecond.score >= 0.025)
  );

  let smart = [];
  if (!knownIsStrong) {
    smart = (await smartSearchCandidates(frames, metadata)).map((candidate) => summarizeCandidate(frames, candidate));
  }

  const ranked = dedupeCandidates([...known, ...smart]).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const minVotes = Math.max(3, Math.ceil(frames.length * 0.35));

  if (!best || best.score < MIN_DETECTION_SCORE || best.votes < minVotes) {
    throw new Error('No supported Gemini/Veo diamond watermark was detected with enough confidence. Nothing was changed.');
  }
  if (second && best.score - second.score < MIN_DETECTION_GAP && (best.x !== second.x || best.y !== second.y || best.size !== second.size)) {
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
            const estimatedGain = estimateGain(frame, detection);
            gain = Math.max(gain - 0.05, Math.min(gain + 0.05, estimatedGain));
            removeFrameWatermark(frame, detection, gain);
            ctx.putImageData(frame, 0, 0);
            if (cleanup === 'soft') softCleanup(ctx, detection);
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
      const safe = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
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

async function loadFile(file) {
  if (!file) return;
  resetForFile();
  currentFile = null;
  currentMetadata = null;
  els.fileCard.hidden = true;
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
    els.fileName.textContent = file.name;
    els.fileMeta.textContent = `${metadata.width} × ${metadata.height} · ${secondsLabel(metadata.duration)} · ${bytesLabel(file.size)}${metadata.hasAudio ? ` · audio ${metadata.audioCodec || 'present'}` : ''}`;
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
    setProgress(0.26, 'Watermark locked', `${detection.source} · ${detection.size}px at ${detection.x},${detection.y} · confidence ${detection.score.toFixed(3)}`);
    const result = await processVideo(currentFile, currentMetadata, detection);
    setProgress(1, 'Done', `${result.processed} frames processed.`);

    currentBlob = result.blob;
    currentBeforeUrl = URL.createObjectURL(currentFile);
    currentAfterUrl = URL.createObjectURL(result.blob);
    els.before.src = currentBeforeUrl;
    els.after.src = currentAfterUrl;
    els.before.load();
    els.after.load();
    const audioLabel = result.hadAudio ? (result.audioKept ? 'audio kept' : 'audio could not be kept') : 'no audio track';
    els.resultDetails.textContent = `${currentMetadata.width} × ${currentMetadata.height} · ${result.processed} frames · ${result.skipped} skipped · ${Math.round(result.bitrate / 1_000_000)} Mbps · ${bytesLabel(result.blob.size)} · ${audioLabel} · detected ${detection.size}px at ${detection.x},${detection.y}`;
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
