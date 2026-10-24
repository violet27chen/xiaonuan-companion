import { getCid, getToken, notifyAuthLost } from "./auth.js";

const API = "/companion";
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function compressPrescriptionPhoto(file) {
  if (!file) throw new Error("请选择一张照片");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("照片太大，请重新拍摄或先裁剪");

  // 优先尝试用浏览器原生解码并压缩为 JPEG（兼容绝大多数格式）。
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = null;
  }

  if (bitmap) {
    try {
      const maxSide = 1800;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
      if (blob && blob.size <= MAX_OUTPUT_BYTES) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("照片读取失败，请重试"));
          reader.readAsDataURL(blob);
        });
        return { mime: "image/jpeg", base64: String(dataUrl).split(",", 2)[1] };
      }
      // 压缩后仍然过大：继续走原图回退
    } finally {
      bitmap.close?.();
    }
  }

  // 浏览器无法解码（如 iPhone 的 HEIC/AVIF 等）或压缩后过大：
  // 直接发送原图，由后端识别，不再限制格式。
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("这张照片暂时打不开，请换一张或换个方式上传"));
    reader.readAsDataURL(file);
  });
  const parts = String(dataUrl).split(",", 2);
  const mime = (parts[0].match(/data:([^;]+);/i) || [])[1] || file.type || "image/jpeg";
  return { mime, base64: parts[1] };
}

export async function recognizePrescription(image) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  let response;
  try {
    response = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "makers-conversation-id": getCid(),
      },
      body: JSON.stringify({
        action: "medication_photo_parse",
        token: getToken(),
        mime: image.mime,
        image: image.base64,
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === "AbortError") throw new Error("图片识别有点慢，请稍后再试");
    throw new Error("网络不稳定，请稍后再试");
  }
  clearTimeout(timer);
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    notifyAuthLost();
    throw new Error("登录过期了，请重新登录");
  }
  if (response.status === 524) throw new Error("服务有点忙，请稍等几秒再试");
  if (!response.ok) throw new Error(body.error || "图片识别失败，请重试");
  return body;
}
