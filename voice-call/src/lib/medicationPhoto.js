import { getCid, getToken, notifyAuthLost } from "./auth.js";

const API = "/companion";
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export async function compressPrescriptionPhoto(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("请选择一张照片");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("照片太大，请重新拍摄或先裁剪");

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("这张照片暂时打不开，请改用 JPG、PNG 或 WebP 格式");
  }
  try {
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob) throw new Error("照片处理失败，请重试");
    if (blob.size > MAX_OUTPUT_BYTES) throw new Error("照片仍然太大，请裁剪后再试");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("照片读取失败，请重试"));
      reader.readAsDataURL(blob);
    });
    return { mime: "image/jpeg", base64: String(dataUrl).split(",", 2)[1] };
  } finally {
    bitmap.close?.();
  }
}

export async function recognizePrescription(image) {
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
    });
  } catch {
    throw new Error("网络不稳定，请稍后再试");
  }
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    notifyAuthLost();
    throw new Error("登录过期了，请重新登录");
  }
  if (!response.ok) throw new Error(body.error || "图片识别失败，请重试");
  return body;
}
