import { Conversion } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.46.0/+esm';
import { EMBEDDED_ALPHA_MAPS_U8 } from './maps.js';

const POSITION_REFINE_RADIUS = 4;
const POSITION_SAMPLE_LIMIT = 8;
const SHOT_SEED_FRAME_LIMIT = 12;
const ALPHA_SHAPE_SAMPLE_LIMIT = 8;
const ALPHA_REFINEMENT_ROUNDS = 5;
const FRAME_HIGH_CONFIDENCE = 0.14;
const FRAME_LOW_CONFIDENCE = 0.035;
const FRAME_GAIN_STEP_CAP = 0.05;
const DEFAULT_GAIN = 1;
const DEFAULT_EDGE_BOOST = 0.045;
const NORMALIZED_CONTRAST_GATE = 0.5;
const LOGO_VALUE = 255;

let detectedGeometry = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseGeometry(text) {
  const raw = String(text || '');
  const match = raw.match(/(\d+)px at (\d+),(\d+)/i);
  if (!match) return null;
  const edgeMatch = raw.match(/edge \+([0-9.]+)/i);
  return {
    size: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
    edgeBoost: edgeMatch ? Number(edgeMatch[1]) : DEFAULT_EDGE_BOOST
  };
}

function observeDetectionGeometry() {
  const detail = document.getElementById('video-progress-detail');
  if (!detail) return;
  const capture = () => {
    const geometry = parseGeometry(detail.textContent);
    if (geometry) detectedGeometry = geometry;
  };
  capture();
  new MutationObserver(capture).observe(detail, { childList: true, characterData: true, subtree: true });
}

observeDetectionGeometry();

const alphaSources = new Map();
const alphaCache = new Map();

function decodePackedMap(key) {
  const packed = EMBEDDED_ALPHA_MAPS_U8[key];
  if (!packed) return null;
  const binary = atob(packed);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const size = Math.round(Math.sqrt(bytes.length));
  if (!size || size * size !== bytes.length) return null;
  return { size, values: Float32Array.from(bytes, (value) => value / 255) };
}

function getAlphaSource(profile) {
  if (!alphaSources.has(profile)) alphaSources.set(profile, decodePackedMap(profile));
  return alphaSources.get(profile);
}

function resizeAlphaMapArea(source, sourceSize, targetSize) {
  if (sourceSize === targetSize) return new Float32Array(source);
  const output = new Float32Array(targetSize * targetSize);
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
      let area = 0;
      for (let sy = y0; sy < y1; sy++) {
        if (sy < 0 || sy >= sourceSize) continue;
        const wy = Math.max(0, Math.min(yEnd, sy + 1) - Math.max(yStart, sy));
        for (let sx = x0; sx < x1; sx++) {
          if (sx < 0 || sx >= sourceSize) continue;
          const wx = Math.max(0, Math.min(xEnd, sx + 1) - Math.max(xStart, sx));
          const weight = wx * wy;
          sum += source[sy * sourceSize + sx] * weight;
          area += weight;
        }
      }
      output[y * targetSize + x] = area > 0 ? sum / area : 0;
    }
  }
  return output;
}

function enhanceAlphaEdges(alphaMap, size, strength) {
  if (!Number.isFinite(strength) || strength <= 0) return new Float32Array(alphaMap);
  const gradient = new Float32Array(alphaMap.length);
  let maxGradient = 0;
  const at = (x, y) => alphaMap[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)] || 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
        + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
        + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const value = Math.sqrt(gx * gx + gy * gy);
      gradient[index] = value;
      maxGradient = Math.max(maxGradient, value);
    }
  }
  if (maxGradient <= 0) return new Float32Array(alphaMap);
  const output = new Float32Array(alphaMap.length);
  for (let i = 0; i < output.length; i++) {
    output[i] = Math.min(0.99, alphaMap[i] + Math.sqrt(gradient[i] / maxGradient) * strength);
  }
  return output;
}

function getAlphaMap(size, profile, edgeBoost) {
  const key = `${profile}:${size}:${Number(edgeBoost).toFixed(3)}`;
  if (alphaCache.has(key)) return alphaCache.get(key);
  const source = getAlphaSource(profile) || getAlphaSource(size < 40 ? '48' : '96-20260520') || getAlphaSource('96');
  if (!source) return null;
  const map = enhanceAlphaEdges(resizeAlphaMapArea(source.values, source.size, size), size, edgeBoost);
  alphaCache.set(key, map);
  return map;
}

function buildAlphaOptions(geometry) {
  const edge = Number.isFinite(geometry.edgeBoost) ? geometry.edgeBoost : DEFAULT_EDGE_BOOST;
  if (geometry.size < 40) {
    return [...new Set([edge, DEFAULT_EDGE_BOOST, 0.08, 0.10].map((value) => Number(value.toFixed(3))))]
      .map((edgeBoost, index) => ({
        id: `48:${edgeBoost}`,
        profile: '48',
        edgeBoost,
        baseline: index === 0,
        alphaMap: getAlphaMap(geometry.size, '48', edgeBoost)
      }))
      .filter((option) => option.alphaMap);
  }

  const options = [{
    id: `96-20260520:${edge}`,
    profile: '96-20260520',
    edgeBoost: edge,
    baseline: true,
    alphaMap: getAlphaMap(geometry.size, '96-20260520', edge)
  }];
  for (const edgeBoost of [...new Set([edge, 0.08, 0.10, 0.12].map((value) => Number(value.toFixed(3))))]) {
    options.push({
      id: `96:${edgeBoost}`,
      profile: '96',
      edgeBoost,
      baseline: false,
      alphaMap: getAlphaMap(geometry.size, '96', edgeBoost)
    });
  }
  return options.filter((option) => option.alphaMap);
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function lumaAt(data, index) {
  return (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
}

function correlation(valuesA, valuesB) {
  const count = Math.min(valuesA.length, valuesB.length);
  if (count < 8) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < count; i++) {
    meanA += valuesA[i];
    meanB += valuesB[i];
  }
  meanA /= count;
  meanB /= count;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < count; i++) {
    const da = valuesA[i] - meanA;
    const db = valuesB[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  return varianceA > 0 && varianceB > 0 ? covariance / Math.sqrt(varianceA * varianceB) : 0;
}

function scoreGeometry(frame, geometry, alphaMap) {
  const { size, x, y } = geometry;
  if (!alphaMap || x < 0 || y < 0 || x + size > frame.width || y + size > frame.height) return 0;
  const step = size > 56 ? 2 : 1;
  const alphaValues = [];
  const lumaValues = [];
  const alphaGradients = [];
  const lumaGradients = [];
  const alphaAt = (px, py) => alphaMap[clamp(py, 0, size - 1) * size + clamp(px, 0, size - 1)] || 0;
  const imageLuma = (px, py) => {
    const ix = clamp(x + px, 0, frame.width - 1);
    const iy = clamp(y + py, 0, frame.height - 1);
    return lumaAt(frame.data, (iy * frame.width + ix) * 4);
  };

  for (let py = 1; py < size - 1; py += step) {
    for (let px = 1; px < size - 1; px += step) {
      const alpha = alphaAt(px, py);
      const luma = imageLuma(px, py);
      alphaValues.push(alpha);
      lumaValues.push(luma);
      const agx = alphaAt(px + 1, py) - alphaAt(px - 1, py);
      const agy = alphaAt(px, py + 1) - alphaAt(px, py - 1);
      const lgx = imageLuma(px + 1, py) - imageLuma(px - 1, py);
      const lgy = imageLuma(px, py + 1) - imageLuma(px, py - 1);
      alphaGradients.push(Math.sqrt(agx * agx + agy * agy));
      lumaGradients.push(Math.sqrt(lgx * lgx + lgy * lgy));
    }
  }

  const spatial = correlation(alphaValues, lumaValues);
  const gradient = correlation(alphaGradients, lumaGradients);
  return Math.max(0, spatial) * 0.35 + Math.max(0, gradient) * 0.65;
}

function createState(baseGeometry) {
  const alphaOptions = buildAlphaOptions(baseGeometry);
  const baseline = alphaOptions.find((option) => option.baseline) || alphaOptions[0];
  return {
    baseGeometry: { ...baseGeometry },
    geometry: { ...baseGeometry },
    positionFrames: 0,
    positionScores: new Map(),
    positionLocked: false,
    alphaOptions,
    alphaScores: new Map(alphaOptions.map((option) => [option.id, []])),
    alphaFrames: 0,
    alphaLocked: alphaOptions.length <= 1,
    alphaOption: baseline,
    shotGains: [],
    shotGain: DEFAULT_GAIN,
    shotLocked: false,
    processedFrames: 0
  };
}

function refinePosition(frame, state) {
  if (state.positionLocked || !state.alphaOption?.alphaMap) return state.geometry;
  const base = state.baseGeometry;
  for (let dy = -POSITION_REFINE_RADIUS; dy <= POSITION_REFINE_RADIUS; dy++) {
    for (let dx = -POSITION_REFINE_RADIUS; dx <= POSITION_REFINE_RADIUS; dx++) {
      const geometry = { ...base, x: base.x + dx, y: base.y + dy };
      if (geometry.x < 0 || geometry.y < 0 || geometry.x + geometry.size > frame.width || geometry.y + geometry.size > frame.height) continue;
      const key = `${dx},${dy}`;
      const entry = state.positionScores.get(key) || { sum: 0, count: 0, dx, dy };
      entry.sum += scoreGeometry(frame, geometry, state.alphaOption.alphaMap);
      entry.count += 1;
      state.positionScores.set(key, entry);
    }
  }
  state.positionFrames += 1;
  if (state.positionFrames >= 3) {
    const ranked = [...state.positionScores.values()]
      .filter((entry) => entry.count > 0)
      .sort((a, b) => (b.sum / b.count) - (a.sum / a.count));
    const best = ranked[0];
    if (best) state.geometry = { ...base, x: base.x + best.dx, y: base.y + best.dy };
  }
  if (state.positionFrames >= POSITION_SAMPLE_LIMIT) state.positionLocked = true;
  return state.geometry;
}

function computeBackgroundMean(frame, geometry, alphaMap, padding = 18) {
  const padX = Math.max(0, geometry.x - padding);
  const padY = Math.max(0, geometry.y - padding);
  const padRight = Math.min(frame.width, geometry.x + geometry.size + padding);
  const padBottom = Math.min(frame.height, geometry.y + geometry.size + padding);
  let sum = 0;
  let weightSum = 0;
  for (let y = padY; y < padBottom; y++) {
    for (let x = padX; x < padRight; x++) {
      const inRoi = x >= geometry.x && x < geometry.x + geometry.size && y >= geometry.y && y < geometry.y + geometry.size;
      let weight = inRoi ? 0 : 1;
      if (inRoi) {
        const rx = x - geometry.x;
        const ry = y - geometry.y;
        if ((alphaMap[ry * geometry.size + rx] || 0) <= 0.015) weight = 0.35;
      }
      if (weight <= 0) continue;
      sum += lumaAt(frame.data, (y * frame.width + x) * 4) * 255 * weight;
      weightSum += weight;
    }
  }
  return weightSum > 0 ? sum / weightSum : null;
}

function scoreGainAgainstBackground(frame, geometry, alphaMap, gain, backgroundMean) {
  if (!Number.isFinite(backgroundMean)) return null;
  let sum = 0;
  let weightSum = 0;
  for (let y = 0; y < geometry.size; y++) {
    for (let x = 0; x < geometry.size; x++) {
      const rawAlpha = alphaMap[y * geometry.size + x] || 0;
      if (rawAlpha <= 0.025) continue;
      const alpha = Math.min(rawAlpha * gain, 0.99);
      const oneMinusAlpha = 1 - alpha;
      const index = ((geometry.y + y) * frame.width + geometry.x + x) * 4;
      const weight = Math.min(1, Math.max(0, rawAlpha * 8));
      const r = (frame.data[index] - alpha * LOGO_VALUE) / oneMinusAlpha;
      const g = (frame.data[index + 1] - alpha * LOGO_VALUE) / oneMinusAlpha;
      const b = (frame.data[index + 2] - alpha * LOGO_VALUE) / oneMinusAlpha;
      sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * weight;
      weightSum += weight;
    }
  }
  return weightSum > 0 ? sum / weightSum - backgroundMean : null;
}

function estimateFrameGain(frame, geometry, alphaMap, seedGain) {
  const backgroundMean = computeBackgroundMean(frame, geometry, alphaMap);
  if (!Number.isFinite(backgroundMean)) return null;
  let lo = Math.max(0.35, seedGain - 0.45);
  let hi = Math.min(1.35, seedGain + 0.45);
  let bestGain = clamp(seedGain, lo, hi);
  let bestResidual = Number.POSITIVE_INFINITY;
  for (let round = 0; round < ALPHA_REFINEMENT_ROUNDS; round++) {
    const gain = (lo + hi) / 2;
    const delta = scoreGainAgainstBackground(frame, geometry, alphaMap, gain, backgroundMean);
    if (!Number.isFinite(delta)) return null;
    const residual = Math.abs(delta);
    if (residual < bestResidual) {
      bestResidual = residual;
      bestGain = gain;
    }
    if (delta > 0) lo = gain;
    else hi = gain;
  }
  return { gain: bestGain, residual: bestResidual };
}

function updateAlphaShape(frame, state) {
  if (state.alphaLocked || state.alphaOptions.length <= 1) return state.alphaOption;
  for (const option of state.alphaOptions) {
    const estimate = estimateFrameGain(frame, state.geometry, option.alphaMap, state.shotGain);
    if (!estimate) continue;
    state.alphaScores.get(option.id)?.push(estimate.residual);
  }
  state.alphaFrames += 1;
  if (state.alphaFrames < 4) return state.alphaOption;

  const ranked = state.alphaOptions
    .map((option) => {
      const values = state.alphaScores.get(option.id) || [];
      return { option, score: median(values) ?? Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.score - b.score);
  const baseline = ranked.find((entry) => entry.option.baseline) || ranked[0];
  const best = ranked[0];
  if (best && baseline && Number.isFinite(best.score) && Number.isFinite(baseline.score)) {
    const absoluteImprovement = baseline.score - best.score;
    const relativeImprovement = baseline.score > 0 ? absoluteImprovement / baseline.score : 0;
    state.alphaOption = best !== baseline && absoluteImprovement >= 0.75 && relativeImprovement >= 0.08
      ? best.option
      : baseline.option;
  }
  if (state.alphaFrames >= ALPHA_SHAPE_SAMPLE_LIMIT) state.alphaLocked = true;
  return state.alphaOption;
}

function normalizedAlphaContrast(frame, geometry, alphaMap) {
  let foregroundSum = 0;
  let foregroundWeight = 0;
  let backgroundSum = 0;
  let backgroundSq = 0;
  let backgroundWeight = 0;
  for (let y = 0; y < geometry.size; y++) {
    for (let x = 0; x < geometry.size; x++) {
      const alpha = alphaMap[y * geometry.size + x] || 0;
      const luma = lumaAt(frame.data, ((geometry.y + y) * frame.width + geometry.x + x) * 4);
      if (alpha >= 0.18) {
        foregroundSum += luma * alpha;
        foregroundWeight += alpha;
      } else if (alpha <= 0.035) {
        backgroundSum += luma;
        backgroundSq += luma * luma;
        backgroundWeight += 1;
      }
    }
  }
  if (!foregroundWeight || !backgroundWeight) return 0;
  const foregroundMean = foregroundSum / foregroundWeight;
  const backgroundMean = backgroundSum / backgroundWeight;
  const variance = Math.max(0, backgroundSq / backgroundWeight - backgroundMean * backgroundMean);
  return (foregroundMean - backgroundMean) / Math.max(0.015, Math.sqrt(variance));
}

function updateShotSeed(frame, state, confidence) {
  if (state.shotLocked || confidence < FRAME_LOW_CONFIDENCE || !state.alphaOption?.alphaMap) return state.shotGain;
  const estimate = estimateFrameGain(frame, state.geometry, state.alphaOption.alphaMap, state.shotGain);
  if (estimate && estimate.gain >= 0.35 && estimate.gain <= 1.35) {
    state.shotGains.push(estimate.gain);
    state.shotGain = median(state.shotGains) ?? DEFAULT_GAIN;
  }
  if (state.shotGains.length >= SHOT_SEED_FRAME_LIMIT) state.shotLocked = true;
  return state.shotGain;
}

function selectFrameGain(frame, state, confidence) {
  const alphaMap = state.alphaOption?.alphaMap;
  if (!alphaMap) return { process: false, gain: state.shotGain, reason: 'no-alpha-map' };
  const shotGain = state.shotGain;
  if (confidence >= FRAME_HIGH_CONFIDENCE) {
    const estimate = estimateFrameGain(frame, state.geometry, alphaMap, shotGain);
    const refined = estimate ? estimate.gain : shotGain;
    return {
      process: true,
      gain: clamp(refined, shotGain - FRAME_GAIN_STEP_CAP, shotGain + FRAME_GAIN_STEP_CAP),
      reason: 'high-confidence-feedback'
    };
  }
  if (confidence >= FRAME_LOW_CONFIDENCE) {
    return { process: true, gain: shotGain, reason: 'low-confidence-shot-consensus' };
  }
  const contrast = normalizedAlphaContrast(frame, state.geometry, alphaMap);
  if (Math.abs(contrast) >= NORMALIZED_CONTRAST_GATE) {
    return { process: true, gain: shotGain, reason: 'background-normalized-evidence' };
  }
  return { process: false, gain: shotGain, reason: 'likely-watermark-free' };
}

function restoreRawPatch(ctx, frame, geometry, padding) {
  const x = Math.max(0, geometry.x - padding);
  const y = Math.max(0, geometry.y - padding);
  const right = Math.min(frame.width, geometry.x + geometry.size + padding);
  const bottom = Math.min(frame.height, geometry.y + geometry.size + padding);
  if (right <= x || bottom <= y) return;
  ctx.putImageData(frame, 0, 0, x, y, right - x, bottom - y);
}

function applyReverseAlpha(ctx, frame, geometry, alphaMap, gain) {
  const output = new Uint8ClampedArray(geometry.size * geometry.size * 4);
  for (let y = 0; y < geometry.size; y++) {
    for (let x = 0; x < geometry.size; x++) {
      const src = ((geometry.y + y) * frame.width + geometry.x + x) * 4;
      const dst = (y * geometry.size + x) * 4;
      const rawAlpha = alphaMap[y * geometry.size + x] || 0;
      const alpha = rawAlpha > 0.025 ? Math.min(rawAlpha * gain, 0.99) : 0;
      if (alpha > 0) {
        const remainder = 1 - alpha;
        output[dst] = Math.round(clamp((frame.data[src] - LOGO_VALUE * alpha) / remainder, 0, 255));
        output[dst + 1] = Math.round(clamp((frame.data[src + 1] - LOGO_VALUE * alpha) / remainder, 0, 255));
        output[dst + 2] = Math.round(clamp((frame.data[src + 2] - LOGO_VALUE * alpha) / remainder, 0, 255));
      } else {
        output[dst] = frame.data[src];
        output[dst + 1] = frame.data[src + 1];
        output[dst + 2] = frame.data[src + 2];
      }
      output[dst + 3] = frame.data[src + 3] ?? 255;
    }
  }
  ctx.putImageData(new ImageData(output, geometry.size, geometry.size), geometry.x, geometry.y);
}

function refineResultCanvas(result, rawFrame, state) {
  if (!result || typeof result.getContext !== 'function') return;
  const ctx = result.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  refinePosition(rawFrame, state);
  updateAlphaShape(rawFrame, state);
  const alphaMap = state.alphaOption?.alphaMap;
  if (!alphaMap) return;
  const confidence = scoreGeometry(rawFrame, state.geometry, alphaMap);
  updateShotSeed(rawFrame, state, confidence);
  const selected = selectFrameGain(rawFrame, state, confidence);
  if (!selected.process) return;

  const restorePadding = Math.max(8, Math.round(state.geometry.size * 0.22));
  restoreRawPatch(ctx, rawFrame, state.baseGeometry, restorePadding);
  if (state.geometry.x !== state.baseGeometry.x || state.geometry.y !== state.baseGeometry.y) {
    restoreRawPatch(ctx, rawFrame, state.geometry, restorePadding);
  }
  applyReverseAlpha(ctx, rawFrame, state.geometry, alphaMap, selected.gain);
  state.processedFrames += 1;
}

await import('./video-bootstrap.js');

const previousConversionInit = Conversion.init.bind(Conversion);
Conversion.init = async function allenkRefinedConversionInit(options) {
  const video = options?.video;
  const geometry = detectedGeometry;
  if (!geometry || !video || Array.isArray(video) || typeof video.process !== 'function') {
    return previousConversionInit(options);
  }

  const width = Number(video.processedWidth);
  const height = Number(video.processedHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return previousConversionInit(options);
  }

  const state = createState(geometry);
  const rawCanvas = createCanvas(width, height);
  const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) return previousConversionInit(options);
  const originalProcess = video.process;

  const refinedVideo = {
    ...video,
    process: async (sample) => {
      rawCtx.clearRect(0, 0, width, height);
      sample.draw(rawCtx, 0, 0, width, height);
      const rawFrame = rawCtx.getImageData(0, 0, width, height);
      const result = await originalProcess(sample);
      if (result && !Array.isArray(result)) refineResultCanvas(result, rawFrame, state);
      return result;
    }
  };

  return previousConversionInit({ ...options, video: refinedVideo });
};
