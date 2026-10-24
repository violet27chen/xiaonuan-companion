import { defaultReminderTimes } from "./medicationSchedule.js";
import { saveMemory } from "./auth.js";

const ENABLED_KEY = "xn_med_reminders_enabled";
let webTimer = null;
const delivered = new Set();

function nativeBridge() {
  return typeof window !== "undefined" && window.XiaonuanNative ? window.XiaonuanNative : null;
}

export function normalizeReminderTimes(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[，,、\s]+/);
  return [...new Set(values.map((x) => String(x).trim()).filter((x) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x)))].slice(0, 4);
}

function scheduledMeds(medications) {
  return (Array.isArray(medications) ? medications : [])
    .filter((m) => m?.name && normalizeReminderTimes(m.reminder_times).length)
    .map((m) => ({
      name: String(m.name).slice(0, 80),
      dosage: String(m.dosage || "").slice(0, 80),
      reminder_times: normalizeReminderTimes(m.reminder_times),
    }));
}

export function remindersEnabled() {
  const bridge = nativeBridge();
  try {
    if (bridge?.areMedicationRemindersEnabled?.()) return true;
  } catch {}
  return localStorage.getItem(ENABLED_KEY) === "1";
}

function startWebReminders(medications) {
  clearInterval(webTimer);
  const rows = scheduledMeds(medications);
  if (!rows.length || !("Notification" in window) || Notification.permission !== "granted") return;
  webTimer = setInterval(() => {
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    for (const med of rows) {
      for (const time of med.reminder_times) {
        const [hours, minutes] = time.split(":").map(Number);
        const elapsed = minutesNow - (hours * 60 + minutes);
        const key = `${day}:${med.name}:${time}`;
        if (elapsed >= 0 && elapsed < 15 && !delivered.has(key)) {
          delivered.add(key);
          try {
            new Notification("小暖用药提醒", {
              body: `到服药时间了：${med.name}${med.dosage ? `，${med.dosage}` : ""}。请按医生交代服用。`,
              tag: key,
            });
          } catch {}
          // 页面在前台时，让语音助手主动念提醒（后台则只弹通知，避免无声播放）
          if (typeof document === "undefined" || document.visibilityState === "visible") {
            try {
              window.dispatchEvent(new CustomEvent("xn-medication-reminder", {
                detail: { name: med.name, dosage: med.dosage, time },
              }));
            } catch {}
          }
        }
      }
    }
  }, 20000);
}

export async function enableMedicationReminders(medications) {
  const meds = Array.isArray(medications) ? medications : [];
  if (!meds.some((m) => m && m.name)) {
    throw new Error("还没有可提醒的用药记录，请先拍药盒或处方照片，或告诉小暖您的用药情况。");
  }
  // 缺提醒时间的药品：自动按频次 / 默认（每天约3次）补全，并写回记忆，
  // 不让用户跳去手动填钟点。
  const filled = meds.map((m) => {
    if (normalizeReminderTimes(m.reminder_times).length) return m;
    return { ...m, reminder_times: defaultReminderTimes(m.frequency, m.reminder_times).times };
  });
  const hadEmpty = filled.some(
    (m, i) => normalizeReminderTimes(m.reminder_times).length && !normalizeReminderTimes(meds[i]?.reminder_times).length,
  );
  if (hadEmpty) {
    try { await saveMemory({ medications: filled }); } catch {}
  }
  const rows = filled
    .filter((m) => normalizeReminderTimes(m.reminder_times).length)
    .map((m) => ({
      name: String(m.name).slice(0, 80),
      dosage: String(m.dosage || "").slice(0, 80),
      reminder_times: normalizeReminderTimes(m.reminder_times),
    }));
  if (!rows.length) {
    throw new Error("这些用药还没写明服用时间，请点“编辑”填一下钟点，例如 08:00、20:00。");
  }

  const bridge = nativeBridge();
  if (bridge?.setMedicationReminders) {
    bridge.requestNotificationPermission?.();
    bridge.setMedicationReminders(JSON.stringify(rows));
    return "已按默认时间设置提醒；系统询问通知权限时请点允许，具体钟点可在记忆里调整。";
  }

  if (!("Notification" in window)) throw new Error("此浏览器不支持通知，请用小暖 Android App 开启锁屏提醒。");
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("通知权限未开启，请在浏览器设置中允许小暖发送通知。");
  localStorage.setItem(ENABLED_KEY, "1");
  startWebReminders(rows);
  return "网页提醒已开启（按默认时间提醒，可在记忆里调整）；网页保持打开时会检查提醒时间。";
}

export function disableMedicationReminders() {
  clearInterval(webTimer);
  webTimer = null;
  localStorage.removeItem(ENABLED_KEY);
  const bridge = nativeBridge();
  try { bridge?.clearMedicationReminders?.(); } catch {}
  return "用药提醒已关闭。";
}

export function syncMedicationReminders(medications) {
  if (!remindersEnabled()) return;
  const bridge = nativeBridge();
  if (bridge?.areMedicationRemindersEnabled?.()) {
    bridge.setMedicationReminders?.(JSON.stringify(scheduledMeds(medications)));
    return;
  }
  startWebReminders(medications);
}
