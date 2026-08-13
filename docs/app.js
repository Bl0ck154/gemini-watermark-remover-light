import { EMBEDDED_ALPHA_MAPS_U8 } from './maps.js';

const ALPHA_NOISE_FLOOR = 3 / 255;
const ALPHA_THRESHOLD = 2e-3;
const MAX_ALPHA = 0.99;
const MIN_MULTI_CANDIDATE_SCORE = 0.002;
const MIN_SCAN_EDGE = 1536;
const SCAN_MARGIN_MIN = 32;
const SCAN_MARGIN_MAX = 384;
const SCAN_MARGIN_STEP = 16;
const MIN_SCAN_CANDIDATE_SCORE = 0.004;
const MIN_SCAN_SCORE_GAP = 0.001;
const MAX_FILE_SIZE = 80 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const MAX_DIMENSION = 16_384;
const HALF_K_SIZE_KEYS = new Set(['512x512', '768x512', '512x768']);
const mapPromises = new Map();

const elements = {
  dropZone: document.querySelector('#drop-zone'),
  dropIdle: document.querySelector('#drop-idle'),
  fileInput: document.querySelector('#file-input'),
  chooseFile: document.querySelector('#choose-file'),
  processing: document.querySelector('#processing-state'),
  result: document.querySelector('#result-state'),
  error: document.querySelector('#error-state'),
  errorTitle: document.querySelector('#error-title'),
  errorMessage: document.querySelector('#error-message'),
  beforeImage: document.querySelector('#before-image'),
  afterImage: document.querySelector('#after-image'),
  afterClip: document.querySelector('#after-clip'),
  comparison: document.querySelector('#comparison'),
  comparisonLine: document.querySelector('#comparison-line'),
  comparisonRange: document.querySelector('#comparison-range'),
  resultTitle: document.querySelector('#result-title'),
  resultDetails: document.querySelector('#result-details'),
  outputFormat: document.querySelector('#output-format'),
  replaceFile: document.querySelector('#replace-file'),
  retryFile: document.querySelector('#retry-file'),
  downloadFile: document.querySelector('#download-file')
};

let currentResult = null;
let currentInputFile = null;
let dragDepth = 0;
let processingGeneration = 0;

function showState(name) {
  elements.dropIdle.hidden = name !== 'idle';
  elements.processing.hidden = name !== 'processing';
  elements.result.hidden = name !== 'result';
  elements.error.hidden = name !== 'error';
}

function resetInput() {
  elements.fileInput.value = '';
  elements.fileInput.click();
}

function releaseCurrentResult() {
  if (!currentResult) return;
  URL.revokeObjectURL(currentResult.beforeUrl);
  URL.revokeObjectURL(currentResult.afterUrl);
  currentResult = null;
}

function getAlphaMap(key) {
  if (!mapPromises.has(key)) {
    mapPromises.set(key, Promise.resolve().then(() => {
      const packed = EMBEDDED_ALPHA_MAPS_U8[key];
      if (!packed) throw new Error(`Missing embedded alpha map: ${key}`);
      const binary = atob(packed);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const expectedLength = Number.parseInt(key, 10) ** 2;
      if (bytes.length !== expectedLength) throw new Error(`Invalid embedded alpha map: ${key}`);
      return Float32Array.from(bytes, (value) => value / 255);
    }));
  }
  return mapPromises.get(key);
}

function getCandidateConfigs(width, height) {
  if (HALF_K_SIZE_KEYS.has(`${width}x${height}`)) {
    return [{ size: 48, marginRight: 32, marginBottom: 32, mapKey: '48' }];
  }
  if (Math.max(width, height) >= 1024) {
    const candidates = [
      { size: 96, marginRight: 64, marginBottom: 64, mapKey: '96' },
      { size: 48, marginRight: 96, marginBottom: 96, mapKey: '48', alphaGain: 0.55 }
    ];
    if (Math.max(width, height) <= 1800) {
      candidates.push(
        { size: 48, marginRight: 32, marginBottom: 32, mapKey: '48' },
        { size: 24, marginRight: 48, marginBottom: 48, mapKey: '24-preview', alphaGain: 0.55 }
      );
    }
    if (width >= 288 && height >= 288) {
      candidates.push({ size: 96, marginRight: 192, marginBottom: 192, mapKey: '96-20260520' });
    }
    return candidates;
  }
  return [{ size: 48, marginRight: 32, marginBottom: 32, mapKey: '48' }];
}

function scoreConfig(imageData, alphaMap, config) {
  const { width, height, data } = imageData;
  const x = width - config.marginRight - config.size;
  const y = height - config.marginBottom - config.size;
  if (x < 0 || y < 0) return Number.NEGATIVE_INFINITY;
  let alphaSum = 0;
  let weightedLum = 0;
  let lumSum = 0;
  let count = 0;
  for (let row = 0; row < config.size; row += 1) {
    for (let col = 0; col < config.size; col += 1) {
      const alpha = Math.max(0, alphaMap[row * config.size + col] - ALPHA_NOISE_FLOOR);
      const index = ((y + row) * width + x + col) * 4;
      const lum = (0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255;
      lumSum += lum;
      count += 1;
      if (alpha >= ALPHA_THRESHOLD) {
        alphaSum += alpha;
        weightedLum += alpha * lum;
      }
    }
  }
  if (!alphaSum || !count) return Number.NEGATIVE_INFINITY;
  return weightedLum / alphaSum - lumSum / count;
}

async function scanBottomRightConfig(imageData) {
  if (Math.min(imageData.width, imageData.height) < MIN_SCAN_EDGE) return null;
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let secondBestScore = Number.NEGATIVE_INFINITY;
  const profiles = [
    { mapKey: '24-preview', size: 24, alphaGain: 0.55 },
    { mapKey: '48', size: 48, alphaGain: 0.55 },
    { mapKey: '96', size: 96 },
    { mapKey: '96-20260520', size: 96 }
  ];
  for (const profile of profiles) {
    const alphaMap = await getAlphaMap(profile.mapKey);
    for (let marginRight = SCAN_MARGIN_MIN; marginRight <= SCAN_MARGIN_MAX; marginRight += SCAN_MARGIN_STEP) {
      for (let marginBottom = SCAN_MARGIN_MIN; marginBottom <= SCAN_MARGIN_MAX; marginBottom += SCAN_MARGIN_STEP) {
        const candidate = { ...profile, marginRight, marginBottom };
        const score = scoreConfig(imageData, alphaMap, candidate);
        if (score > bestScore) {
          secondBestScore = bestScore;
          bestScore = score;
          best = candidate;
        } else if (score > secondBestScore) {
          secondBestScore = score;
        }
      }
    }
  }
  if (bestScore < MIN_SCAN_CANDIDATE_SCORE || bestScore - secondBestScore < MIN_SCAN_SCORE_GAP) return null;
  return best;
}

async function selectConfig(imageData) {
  const candidates = getCandidateConfigs(imageData.width, imageData.height);
  let best = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = scoreConfig(imageData, await getAlphaMap(candidate.mapKey), candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore < MIN_MULTI_CANDIDATE_SCORE ? scanBottomRightConfig(imageData) : best;
}

function removeWatermark(imageData, alphaMap, config) {
  const { width, height, data } = imageData;
  const x = width - config.marginRight - config.size;
  const y = height - config.marginBottom - config.size;
  if (x < 0 || y < 0) return;
  for (let row = 0; row < config.size; row += 1) {
    for (let col = 0; col < config.size; col += 1) {
      const imageIndex = ((y + row) * width + x + col) * 4;
      const rawAlpha = alphaMap[row * config.size + col];
      const alphaGain = config.alphaGain || 1;
      if (Math.max(0, rawAlpha - ALPHA_NOISE_FLOOR) * alphaGain < ALPHA_THRESHOLD) continue;
      const alpha = Math.min(rawAlpha * alphaGain, MAX_ALPHA);
      const remainder = 1 - alpha;
      for (let channel = 0; channel < 3; channel += 1) {
        data[imageIndex + channel] = Math.max(0, Math.min(255, Math.round((data[imageIndex + channel] - alpha * 255) / remainder)));
      }
    }
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode the result.')),
    type,
    quality
  ));
}

function outputTypeFor(file) {
  if (elements.outputFormat.value === 'original') {
    return ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? file.type : 'image/png';
  }
  return elements.outputFormat.value;
}

function outputNameFor(file, type) {
  const base = file.name.replace(/\.[^.]+$/, '') || 'gemini-image';
  const extension = type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  return `${base}-clean.${extension}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' });
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function processFile(file) {
  if (!file) return;
  currentInputFile = file;
  const generation = ++processingGeneration;
  releaseCurrentResult();
  showState('processing');
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      throw new TypeError('Choose a JPG, PNG, or WebP image.');
    }
    if (file.size > MAX_FILE_SIZE) throw new RangeError('Choose an image smaller than 80 MB.');
    const image = await decodeImage(file);
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
      if ('close' in image) image.close();
      throw new RangeError('Choose an image no larger than 40 megapixels or 16,384 pixels on either side.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0);
    if ('close' in image) image.close();
    const imageData = context.getImageData(0, 0, width, height);
    const config = await selectConfig(imageData);
    if (!config) throw new Error('No supported Gemini mark was found with enough confidence. Try the original downloaded image.');
    removeWatermark(imageData, await getAlphaMap(config.mapKey), config);
    context.putImageData(imageData, 0, 0);
    const type = outputTypeFor(file);
    const output = await canvasToBlob(canvas, type, type === 'image/jpeg' ? 0.92 : undefined);
    if (generation !== processingGeneration) return;
    const beforeUrl = URL.createObjectURL(file);
    const afterUrl = URL.createObjectURL(output);
    currentResult = { blob: output, beforeUrl, afterUrl, filename: outputNameFor(file, type) };
    elements.beforeImage.src = beforeUrl;
    elements.afterImage.src = afterUrl;
    elements.resultTitle.textContent = 'Mark removed';
    elements.resultDetails.textContent = `${width} × ${height} · ${config.size}px profile · ${formatBytes(output.size)}`;
    elements.comparisonRange.value = '50';
    updateComparison();
    showState('result');
    elements.resultTitle.focus({ preventScroll: true });
  } catch (error) {
    if (generation !== processingGeneration) return;
    const expected = error instanceof TypeError || error instanceof RangeError || /No supported|Canvas/.test(error.message);
    elements.errorTitle.textContent = expected ? 'This image needs attention' : 'Could not read this image';
    elements.errorMessage.textContent = expected ? error.message : 'The file could not be decoded. Try a fresh JPG, PNG, or WebP download.';
    showState('error');
    elements.errorTitle.focus({ preventScroll: true });
  }
}

function updateComparison() {
  const value = Number(elements.comparisonRange.value);
  elements.afterClip.style.left = `${value}%`;
  elements.comparisonLine.style.left = `${value}%`;
  elements.afterClip.style.setProperty('--comparison-width', `${elements.comparison.clientWidth}px`);
}

elements.chooseFile.addEventListener('click', resetInput);
elements.replaceFile.addEventListener('click', resetInput);
elements.retryFile.addEventListener('click', resetInput);
elements.fileInput.addEventListener('change', () => processFile(elements.fileInput.files[0]));
elements.outputFormat.addEventListener('change', () => {
  if (currentInputFile && !elements.result.hidden) processFile(currentInputFile);
});
elements.comparisonRange.addEventListener('input', updateComparison);
new ResizeObserver(updateComparison).observe(elements.comparison);

elements.downloadFile.addEventListener('click', () => {
  if (!currentResult) return;
  const link = document.createElement('a');
  link.href = currentResult.afterUrl;
  link.download = currentResult.filename;
  link.click();
});

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === 'dragenter') dragDepth += 1;
    elements.dropZone.classList.add('is-dragging');
  });
}
elements.dropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) elements.dropZone.classList.remove('is-dragging');
});
elements.dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  elements.dropZone.classList.remove('is-dragging');
  processFile(event.dataTransfer.files[0]);
});
window.addEventListener('beforeunload', releaseCurrentResult);
