/* 默认服药钟点推算：老人说"一天3次""每8小时"时，排在非睡眠时段。
 * 睡眠时段按 23:00-06:00 计（22:00 的晚服药仍算清醒时间）。 */

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function cnInt(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (CN_NUM[text] != null) return CN_NUM[text];
  return null;
}

const fmt = (minutes) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const inSleep = (minutes) => minutes >= 23 * 60 || minutes < 6 * 60;

/** 一天 N 次的默认钟点（全部落在 07:00-21:00 清醒时段） */
function slotsForCount(count) {
  if (count <= 1) return ["08:00"];
  if (count === 2) return ["08:00", "18:00"];
  if (count === 3) return ["08:00", "12:00", "18:00"];
  if (count === 4) return ["08:00", "12:00", "16:00", "20:00"];
  // 5 次及以上：07:00-21:00 之间均匀铺开，取整到 5 分钟
  const step = (21 * 60 - 7 * 60) / (count - 1);
  const times = [];
  for (let i = 0; i < count; i++) {
    const raw = Math.round((7 * 60 + i * step) / 5) * 5;
    times.push(fmt(raw));
  }
  return [...new Set(times)];
}

/** 每 X 小时一次：从早上 6 点起排，跳过睡眠时段；排不满 2 次就退回早晚两次 */
function slotsForInterval(hours) {
  if (!hours || hours <= 0) return [];
  if (hours >= 20) return ["08:00"]; // 一天一次按早 8 点
  const times = [];
  for (let minutes = 6 * 60; minutes < 23 * 60; minutes += Math.round(hours * 60)) {
    times.push(fmt(minutes));
  }
  const waking = times.filter((t) => !inSleep(Number(t.slice(0, 2)) * 60 + Number(t.slice(3))));
  return waking.length >= 2 ? waking : ["08:00", "18:00"];
}

/** 从频次文本推断一天几次 / 每几小时 */
export function parseFrequency(text) {
  const t = String(text || "");
  const perDayMatch = t.match(/(?:每|一)[天日]\s*([0-9一二两三四五六七八九十]+)\s*次/)
    || t.match(/([0-9一二两三四五六七八九十]+)\s*次\s*\/?\s*[天日]/)
    || t.match(/每日\s*([0-9一二两三四五六七八九十]+)\s*次/);
  if (perDayMatch) {
    const count = cnInt(perDayMatch[1]);
    if (count && count >= 1 && count <= 8) return { perDay: count };
  }
  const intervalMatch = t.match(/每\s*([0-9一二两三四五六七八九十]+)\s*个?\s*小时/);
  if (intervalMatch) {
    const hours = cnInt(intervalMatch[1]);
    if (hours && hours >= 1 && hours <= 24) return { intervalHours: hours };
  }
  if (/早晚|早一次晚一次|一日两次|一天两次|每天两次/.test(t)) return { perDay: 2 };
  if (/三餐|吃饭时|随餐|饭后服用|饭前服用|一日三次|一天三次|每天三次/.test(t)) return { perDay: 3 };
  if (/睡前/.test(t)) return { explicit: ["21:00"] };
  if (/早上|早晨|晨起|空腹/.test(t) && !/晚/.test(t)) return { perDay: 1 };
  return {};
}

/** 校验并规范化模型给出的钟点（HH:MM，最多 6 个，去重排序） */
export function normalizeTimes(times) {
  if (!Array.isArray(times)) return [];
  return [...new Set(times
    .filter((v) => typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.trim()))
    .map((v) => v.trim()))].sort().slice(0, 6);
}

/**
 * 计算默认提醒钟点：医嘱明确写了钟点就用医嘱的；否则按频次排在非睡眠时段。
 * @returns {{ times: string[], source: "prescription"|"frequency"|"default" }}
 */
export function defaultReminderTimes(frequency, prescriptionTimes) {
  const explicit = normalizeTimes(prescriptionTimes);
  if (explicit.length) return { times: explicit, source: "prescription" };
  const parsed = parseFrequency(frequency);
  if (parsed.explicit) return { times: parsed.explicit, source: "frequency" };
  if (parsed.perDay) return { times: slotsForCount(parsed.perDay), source: "frequency" };
  if (parsed.intervalHours) return { times: slotsForInterval(parsed.intervalHours), source: "frequency" };
  return { times: slotsForCount(3), source: "default" };
}

/** "08:00" → "早上8点"，方便念给老人听 */
export function friendlyTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return String(hhmm || "");
  const hour24 = Number(m[1]);
  const minute = Number(m[2]);
  // 口语用十二小时制：下午2点、傍晚6点、晚上9点（中午12点、凌晨3点除外）
  const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
  const base = minute === 0 ? `${hour12}点` : minute === 30 ? `${hour12}点半` : `${hour12}点${minute}分`;
  if (hour24 < 5) return `凌晨${base}`;
  if (hour24 < 12) return `早上${base}`;
  if (hour24 < 13) return `中午${base}`;
  if (hour24 < 18) return `下午${base}`;
  if (hour24 < 19) return `傍晚${base}`;
  if (hour24 < 23) return `晚上${base}`;
  return `深夜${base}`;
}

/** ["08:00","12:00","18:00"] → "早上8点、中午12点和傍晚6点" */
export function timesToSpeech(times) {
  const list = normalizeTimes(times).map(friendlyTime);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join("、")}和${list[list.length - 1]}`;
}
