import { Conversion } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.46.0/+esm';
import { EMBEDDED_ALPHA_MAPS_U8 } from './maps.js';

const ORT_VERSION = '1.26.0';
const ORT_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort.webgpu.min.js`;
const ORT_WASM_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODEL_COMMIT = 'bef0303a437902286a18ab4d1586629f198b90b7';
const MODEL_BASE = `https://cdn.jsdelivr.net/gh/GargantuaX/gemini-watermark-remover@${MODEL_COMMIT}/public/models/allenk-fdncnn`;
const FDNCNN_SIGMA = 75;
const ALPHA_EDGE_BOOST = 0.045;

const MODEL_PROFILES = Object.freeze([
  Object.freeze({
    id: '104',
    side: 104,
    maxWatermarkSize: 56,
    url: `${MODEL_BASE}/model_core_fp32_104.onnx`
  }),
  Object.freeze({
    id: '200',
    side: 200,
    maxWatermarkSize: Infinity,
    url: `${MODEL_BASE}/model_core_fp32_200.onnx`
  })
]);

let lastGeometry = null;
let ortPromise = null;
const runtimePromises = new Map();
const alphaSources = new Map();
const alphaCache = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
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

function enhanceAlphaEdges(alphaMap, size, strength = ALPHA_EDGE_BOOST) {
  const gradient = new Float32Array(alphaMap.length);
  let maxGradient = 0;
  const sample = (x, y) => alphaMap[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)] || 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = y * size + x;
      const gx = -sample(x - 1, y - 1) - 2 * sample(x - 1, y) - sample(x - 1, y + 1)
        + sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1);
      const gy = -sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1)
        + sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1);
      const value = Math.sqrt(gx * gx + gy * gy);
      gradient[index] = value;
      maxGradient = Math.max(maxGradient, value);
    }
  }
  if (maxGradient <= 0) return new Float32Array(alphaMap);
  const out = new Float32Array(alphaMap.length);
  for (let i = 0; i < out.length; i++) {
    const edge = Math.sqrt(gradient[i] / maxGradient);
    out[i] = Math.min(0.99, alphaMap[i] + edge * strength);
  }
  return out;
}

function getAlphaMap(size) {
  const profile = size < 40 ? '48' : '96-20260520';
  const cacheKey = `${profile}:${size}`;
  if (alphaCache.has(cacheKey)) return alphaCache.get(cacheKey);
  const source = getAlphaSource(profile) || getAlphaSource('96') || getAlphaSource('48');
  if (!source) return null;
  const map = enhanceAlphaEdges(resizeAlphaMapArea(source.values, source.size, size), size);
  alphaCache.set(cacheKey, map);
  return map;
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

function gaussianBlurFloat(source, width, height, sigma, radius = Math.ceil(sigma * 3)) {
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

function dilateFloat(source, width, height, radius) {
  const output = new Float32Array(source.length);
  const r = Math.max(1, Math.round(radius));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxValue = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (dx * dx + dy * dy > r * r) continue;
          maxValue = Math.max(maxValue, source[yy * width + xx] || 0);
        }
      }
      output[y * width + x] = maxValue;
    }
  }
  return output;
}

function buildLocalCleanupMask(alphaMap, size) {
  const gradient = new Float32Array(size * size);
  let maxGradient = 0;
  const sample = (x, y) => alphaMap[clamp(y, 0, size - 1) * size + clamp(x, 0, size - 1)] || 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const gx = -sample(x - 1, y - 1) - 2 * sample(x - 1, y) - sample(x - 1, y + 1)
        + sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1);
      const gy = -sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1)
        + sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1);
      const value = Math.sqrt(gx * gx + gy * gy);
      gradient[i] = value;
      maxGradient = Math.max(maxGradient, value);
    }
  }

  const mask = new Float32Array(size * size);
  for (let i = 0; i < mask.length; i++) {
    const alpha = alphaMap[i] || 0;
    const edge = maxGradient > 0 ? Math.sqrt((gradient[i] || 0) / maxGradient) : 0;
    const footprint = smoothstep(0.006, 0.075, alpha);
    const body = smoothstep(0.08, 0.22, alpha);
    mask[i] = clamp(edge * 0.92 + footprint * 0.48 + body * 0.18, 0, 1);
  }
  return gaussianBlurFloat(dilateFloat(mask, size, size, 3), size, size, 1.15, 3);
}

function chooseProfile(watermarkSize) {
  return MODEL_PROFILES.find((profile) => watermarkSize <= profile.maxWatermarkSize) || MODEL_PROFILES[MODEL_PROFILES.length - 1];
}

function parseGeometry(text) {
  const match = String(text || '').match(/(\d+)px at (\d+),(\d+)/i);
  if (!match) return null;
  return {
    size: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3])
  };
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === src);
    if (existing && globalThis.ort) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the local cleanup runtime.'));
    document.head.appendChild(script);
  });
}

async function loadOrt() {
  if (globalThis.ort) return globalThis.ort;
  if (!ortPromise) {
    ortPromise = (async () => {
      await loadClassicScript(ORT_SCRIPT_URL);
      if (!globalThis.ort) throw new Error('Local cleanup runtime did not initialize.');
      globalThis.ort.env.wasm.wasmPaths = ORT_WASM_BASE;
      globalThis.ort.env.wasm.proxy = false;
      globalThis.ort.env.wasm.numThreads = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
        ? Math.max(1, Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2)))
        : 1;
      return globalThis.ort;
    })().catch((error) => {
      ortPromise = null;
      throw error;
    });
  }
  return ortPromise;
}

async function createRuntime(profile) {
  const ort = await loadOrt();
  const response = await fetch(profile.url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Cleanup model unavailable (${response.status}).`);
  const modelBytes = await response.arrayBuffer();
  let session = null;
  let provider = 'wasm';

  if (navigator.gpu) {
    try {
      session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all'
      });
      provider = 'webgpu';
    } catch (error) {
      console.warn('Video Light WebGPU cleanup unavailable; falling back to WASM.', error);
    }
  }

  if (!session) {
    session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
  }

  return {
    ort,
    session,
    provider,
    profile,
    inputName: session.inputNames?.[0] || 'fdncnn_input',
    outputName: session.outputNames?.[0] || 'fdncnn_output'
  };
}

function getRuntime(profile) {
  if (!runtimePromises.has(profile.id)) {
    const promise = createRuntime(profile).catch((error) => {
      runtimePromises.delete(profile.id);
      throw error;
    });
    runtimePromises.set(profile.id, promise);
  }
  return runtimePromises.get(profile.id);
}

function resolveRoi(canvas, geometry, side) {
  if (canvas.width < side || canvas.height < side) return null;
  const centerX = geometry.x + geometry.size / 2;
  const centerY = geometry.y + geometry.size / 2;
  const x = clamp(Math.round(centerX - side / 2), 0, canvas.width - side);
  const y = clamp(Math.round(centerY - side / 2), 0, canvas.height - side);
  return { x, y, width: side, height: side };
}

function buildFdncnnInput(imageData, sigma = FDNCNN_SIGMA) {
  const pixelCount = imageData.width * imageData.height;
  const input = new Float32Array(pixelCount * 4);
  const sigmaNorm = clamp(sigma, 0, 150) / 255;
  for (let i = 0; i < pixelCount; i++) {
    const src = i * 4;
    input[i] = imageData.data[src] / 255;
    input[pixelCount + i] = imageData.data[src + 1] / 255;
    input[pixelCount * 2 + i] = imageData.data[src + 2] / 255;
    input[pixelCount * 3 + i] = sigmaNorm;
  }
  return input;
}

function outputToRgba(output, width, height) {
  const pixelCount = width * height;
  if (!output || output.length < pixelCount * 3) return null;
  const rgba = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4] = Math.round(clamp(output[i], 0, 1) * 255);
    rgba[i * 4 + 1] = Math.round(clamp(output[pixelCount + i], 0, 1) * 255);
    rgba[i * 4 + 2] = Math.round(clamp(output[pixelCount * 2 + i], 0, 1) * 255);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function buildRoiMask(geometry, roi, alphaMap) {
  const localMask = buildLocalCleanupMask(alphaMap, geometry.size);
  const weights = new Float32Array(roi.width * roi.height);
  const offsetX = geometry.x - roi.x;
  const offsetY = geometry.y - roi.y;
  for (let y = 0; y < geometry.size; y++) {
    const ry = offsetY + y;
    if (ry < 0 || ry >= roi.height) continue;
    for (let x = 0; x < geometry.size; x++) {
      const rx = offsetX + x;
      if (rx < 0 || rx >= roi.width) continue;
      weights[ry * roi.width + rx] = localMask[y * geometry.size + x];
    }
  }
  return gaussianBlurFloat(dilateFloat(weights, roi.width, roi.height, 2), roi.width, roi.height, 1.0, 3);
}

function buildStructureGuard(data, width, height) {
  const guard = new Float32Array(width * height);
  const luma = (x, y) => {
    const xx = clamp(x, 0, width - 1);
    const yy = clamp(y, 0, height - 1);
    const idx = (yy * width + xx) * 4;
    return 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = -luma(x - 1, y - 1) - 2 * luma(x - 1, y) - luma(x - 1, y + 1)
        + luma(x + 1, y - 1) + 2 * luma(x + 1, y) + luma(x + 1, y + 1);
      const gy = -luma(x - 1, y - 1) - 2 * luma(x, y - 1) - luma(x + 1, y - 1)
        + luma(x - 1, y + 1) + 2 * luma(x, y + 1) + luma(x + 1, y + 1);
      guard[y * width + x] = smoothstep(48, 160, Math.sqrt(gx * gx + gy * gy));
    }
  }
  return gaussianBlurFloat(guard, width, height, 0.65, 2);
}

function sampledMeanAbsDiff(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 32) {
    sum += Math.abs(a[i] - b[i]);
    count += 1;
  }
  return count ? sum / count : Infinity;
}

function applyDeltaToImage(sourceData, delta, weights, structureGuard) {
  const output = new Uint8ClampedArray(sourceData);
  const pixelCount = Math.min(weights.length, Math.floor(sourceData.length / 4));
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    const rawWeight = clamp(weights[pixel] || 0, 0, 1);
    if (rawWeight <= 0.01) continue;
    const structureFactor = Math.max(0.42, 1 - (structureGuard[pixel] || 0) * 0.58);
    const weight = Math.min(0.92, rawWeight * 1.12) * structureFactor;
    const idx = pixel * 4;
    for (let c = 0; c < 3; c++) {
      output[idx + c] = Math.round(clamp(sourceData[idx + c] + delta[idx + c] * weight, 0, 255));
    }
  }
  return output;
}

async function enhanceCanvas(canvas, geometry, runtime, state) {
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const alphaMap = getAlphaMap(geometry.size);
  if (!alphaMap) return;
  const roi = resolveRoi(canvas, geometry, runtime.profile.side);
  if (!roi) return;
  const source = ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
  const weights = buildRoiMask(geometry, roi, alphaMap);
  const structureGuard = buildStructureGuard(source.data, roi.width, roi.height);

  const canReuse = runtime.provider === 'wasm'
    && state.lastDelta
    && state.lastSource
    && state.frameIndex % 2 === 1
    && sampledMeanAbsDiff(source.data, state.lastSource) <= 6.5;

  let delta = null;
  if (canReuse) {
    delta = state.lastDelta;
  } else {
    const input = buildFdncnnInput(source);
    const tensor = new runtime.ort.Tensor('float32', input, [1, 4, roi.height, roi.width]);
    const outputs = await runtime.session.run({ [runtime.inputName]: tensor });
    const outputTensor = outputs[runtime.outputName];
    const denoised = outputToRgba(outputTensor?.data, roi.width, roi.height);
    if (!denoised) return;
    delta = new Int16Array(source.data.length);
    for (let i = 0; i < delta.length; i++) delta[i] = denoised[i] - source.data[i];
    state.lastDelta = delta;
    state.lastSource = new Uint8ClampedArray(source.data);
  }

  const blended = applyDeltaToImage(source.data, delta, weights, structureGuard);
  ctx.putImageData(new ImageData(blended, roi.width, roi.height), roi.x, roi.y);
  state.frameIndex += 1;
}

function friendlySelectedMeta(text) {
  const parts = String(text || '').split(' · ').map((part) => part.trim()).filter(Boolean);
  return parts.slice(0, 3).join(' · ');
}

function friendlyResultMeta(text) {
  const raw = String(text || '');
  const selected = document.getElementById('video-file-meta')?.textContent || '';
  const selectedParts = selected.split(' · ').map((part) => part.trim()).filter(Boolean);
  const resultParts = raw.split(' · ').map((part) => part.trim()).filter(Boolean);
  const resolution = resultParts[0] || selectedParts[0] || '';
  const duration = selectedParts[1] || '';
  const outputSize = resultParts.find((part) => /\b(?:KB|MB|GB)\b/i.test(part)) || '';
  return [resolution, duration, outputSize].filter(Boolean).join(' · ');
}

function observeFriendlyUi() {
  const fileMeta = document.getElementById('video-file-meta');
  const resultMeta = document.getElementById('video-result-details');
  const progressDetail = document.getElementById('video-progress-detail');

  if (fileMeta) {
    new MutationObserver(() => {
      const current = fileMeta.textContent || '';
      if (/detection samples|audio\s/i.test(current)) fileMeta.textContent = friendlySelectedMeta(current);
    }).observe(fileMeta, { childList: true, characterData: true, subtree: true });
  }

  if (resultMeta) {
    new MutationObserver(() => {
      const current = resultMeta.textContent || '';
      if (/frames|skipped|audio|samples|edge|gain/i.test(current)) resultMeta.textContent = friendlyResultMeta(current);
    }).observe(resultMeta, { childList: true, characterData: true, subtree: true });
  }

  if (progressDetail) {
    new MutationObserver(() => {
      const raw = progressDetail.textContent || '';
      const geometry = parseGeometry(raw);
      if (geometry) lastGeometry = geometry;
      let friendly = null;
      if (/Detection frame|Scanning \d+px|Testing alpha|samples|edge \+|px at \d+/i.test(raw)) friendly = 'Analyzing the watermark…';
      else if (/Frame \d+|low-confidence skipped/i.test(raw)) friendly = 'Cleaning the video locally…';
      else if (/Opening the local MP4/i.test(raw)) friendly = 'Preparing your video…';
      if (friendly && raw !== friendly) progressDetail.textContent = friendly;
    }).observe(progressDetail, { childList: true, characterData: true, subtree: true });
  }
}

const originalConversionInit = Conversion.init.bind(Conversion);
Conversion.init = async function patchedConversionInit(options) {
  const videoOptions = options?.video;
  const cleanupMode = document.querySelector('input[name="video-cleanup"]:checked')?.value;
  const geometry = lastGeometry || parseGeometry(document.getElementById('video-progress-detail')?.textContent);

  if (!geometry || cleanupMode !== 'enhanced' || !videoOptions || Array.isArray(videoOptions) || typeof videoOptions.process !== 'function') {
    return originalConversionInit(options);
  }

  let runtime = null;
  try {
    const profile = chooseProfile(geometry.size);
    const detail = document.getElementById('video-progress-detail');
    if (detail) detail.textContent = 'Preparing high-quality cleanup…';
    runtime = await getRuntime(profile);
  } catch (error) {
    console.warn('Video Light high-quality cleanup unavailable; continuing with deterministic cleanup.', error);
  }

  if (!runtime) return originalConversionInit(options);

  const originalProcess = videoOptions.process;
  const state = { frameIndex: 0, lastDelta: null, lastSource: null };
  let activeRuntime = runtime;
  const patchedVideoOptions = {
    ...videoOptions,
    process: async (sample) => {
      const result = await originalProcess(sample);
      if (!activeRuntime || !result || Array.isArray(result) || typeof result.getContext !== 'function') return result;
      try {
        await enhanceCanvas(result, geometry, activeRuntime, state);
      } catch (error) {
        console.warn('Video Light high-quality cleanup stopped for this clip; deterministic cleanup will continue.', error);
        activeRuntime = null;
      }
      return result;
    }
  };

  return originalConversionInit({ ...options, video: patchedVideoOptions });
};

observeFriendlyUi();
await import('./video.js');
