/* Realtime voice now comes from the Doubao duplex session; this module only keeps UI preferences. */

const SPEECH_SPEED_KEY = "xn_speech_speed";
const CAPTIONS_KEY = "xn_captions_on";

// 语速默认「自然」：慢速只对明确需要放慢的老人开启（点按钮或说「说慢一点」）。
let speechSpeed = (() => {
  try { return localStorage.getItem(SPEECH_SPEED_KEY) === "slow" ? "slow" : "normal"; }
  catch { return "normal"; }
})();

// 字幕默认关闭（和豆包一样）：需要看 AI 说了什么时再点「字幕」按钮打开。
let captionsOn = (() => {
  try { return localStorage.getItem(CAPTIONS_KEY) === "1"; }
  catch { return false; }
})();

let audioMuted = false;

export function setSpeechSpeed(speed) {
  speechSpeed = speed === "slow" ? "slow" : "normal";
  try { localStorage.setItem(SPEECH_SPEED_KEY, speechSpeed); } catch {}
  window.dispatchEvent(new Event("xn-speech-speed"));
}

export function getSpeechSpeed() {
  return speechSpeed;
}

export function setCaptionsEnabled(enabled) {
  captionsOn = !!enabled;
  try { localStorage.setItem(CAPTIONS_KEY, captionsOn ? "1" : "0"); } catch {}
  window.dispatchEvent(new Event("xn-captions"));
}

export function isCaptionsEnabled() {
  return captionsOn;
}

export function setAudioMuted(muted) {
  audioMuted = !!muted;
  window.dispatchEvent(new Event("xn-audio-muted"));
}

export function isAudioMuted() {
  return audioMuted;
}
