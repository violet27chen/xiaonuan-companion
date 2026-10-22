/** Float32 PCM -> WAV Blob（16bit 单声道，后端 ASR 直接吃 wav）
 *  targetRate 给定且与采样率不同：先线性插值重采样再编码。
 *  录音常为 44.1/48kHz，降到 ASR 标准 16k 可让上传体积缩小约 2/3，省移动网络上几百毫秒。 */
export function encodeWav(samples, sampleRate, targetRate = 0) {
  if (targetRate > 0 && targetRate !== sampleRate) {
    samples = resampleLinear(samples, sampleRate, targetRate);
    sampleRate = targetRate;
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

/** 线性插值重采样（语音场景足够，比抽值保真） */
function resampleLinear(samples, fromRate, toRate) {
  const n = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(n);
  const step = fromRate / toRate;
  for (let i = 0; i < n; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const f = pos - i0;
    out[i] = samples[i0] * (1 - f) + samples[i1] * f;
  }
  return out;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 按标点切句，供逐句播报 */
export function splitSent(text) {
  const SEP = String.fromCharCode(1);
  return text
    .replace(/\s+/g, " ")
    .replace(/([。！？!?；;])/g, "$1" + SEP)
    .split(SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}
