import { Conversion } from 'https://cdn.jsdelivr.net/npm/mediabunny@1.46.0/+esm';

// Bitrate is an implementation detail now. The video still has to be transcoded
// because pixels are changed, but the encoder target should follow the source
// track instead of an arbitrary 8/12/18 Mbps UI preset.
document.querySelector('.video-bitrate-group')?.remove();

let lastSourceVideoBitrate = null;

function validBitrate(value) {
  return Number.isFinite(value) && value >= 64_000 && value <= 250_000_000;
}

async function sourceVideoBitrate(input) {
  const track = await input?.getPrimaryVideoTrack?.().catch?.(() => null)
    ?? await input?.getPrimaryVideoTrack?.();
  if (!track) return null;

  // Prefer the container's average-video-bitrate metadata when it is present.
  // It is instant and already excludes audio/container overhead.
  try {
    const average = await track.getAverageBitrate?.();
    if (validBitrate(average)) return Math.round(average);
  } catch {}

  // Many MP4s omit btrt metadata. Mediabunny can derive the real average from
  // encoded packet sizes/timestamps without decoding frames. For the short AI
  // clips this tool targets, scanning the packet table is cheap and much more
  // representative than forcing 12 Mbps.
  try {
    const stats = await track.computePacketStats?.(Infinity, { skipLiveWait: true });
    if (validBitrate(stats?.averageBitrate)) return Math.round(stats.averageBitrate);
  } catch {}

  // Last metadata fallback. This may be a peak bitrate, but is still a better
  // source-relative target than the old hard-coded preset.
  try {
    const peak = await track.getBitrate?.();
    if (validBitrate(peak)) return Math.round(peak);
  } catch {}

  return null;
}

function formatBitrate(value) {
  if (!validBitrate(value)) return '';
  const mbps = value / 1_000_000;
  return `${mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)} Mbps`;
}

function keepResultBitrateLabelHonest() {
  const details = document.getElementById('video-result-details');
  if (!details) return;
  new MutationObserver(() => {
    if (!validBitrate(lastSourceVideoBitrate)) return;
    const current = details.textContent || '';
    const replacement = formatBitrate(lastSourceVideoBitrate);
    const next = current.replace(/\b\d+(?:\.\d+)?\s*Mbps\b/i, replacement);
    if (next !== current) details.textContent = next;
  }).observe(details, { childList: true, characterData: true, subtree: true });
}

keepResultBitrateLabelHonest();

// Load the normal video pipeline. It already performs multi-frame detection,
// alpha-shape/gain calibration, per-frame gain refinement and the optional
// footprint/FDnCNN cleanup. The previous version of this shim then restored the
// raw watermark patch and ran a second reverse-alpha pass over that cleaned
// result. That duplicated the remover and could turn a white diamond into the
// dark/negative diamond seen in failed outputs. Do not overwrite the cleaned
// canvas a second time.
await import('./video-bootstrap.js');

const previousConversionInit = Conversion.init.bind(Conversion);
Conversion.init = async function sourceMatchedBitrateConversionInit(options) {
  const video = options?.video;
  if (!video || Array.isArray(video) || typeof video === 'function') {
    return previousConversionInit(options);
  }

  let bitrate = null;
  try {
    bitrate = await sourceVideoBitrate(options.input);
  } catch (error) {
    console.warn('Video Light could not read the source video bitrate; using the pipeline fallback.', error);
  }

  if (!validBitrate(bitrate)) {
    lastSourceVideoBitrate = null;
    return previousConversionInit(options);
  }

  lastSourceVideoBitrate = bitrate;
  console.info(`[Video Light] Source-matched video bitrate: ${formatBitrate(bitrate)}`);

  return previousConversionInit({
    ...options,
    video: {
      ...video,
      bitrate
    }
  });
};
