/* Realtime voice now comes from the Doubao duplex session; this module only keeps UI preferences. */
const SPEECH_SPEED_KEY = "xn_speech_speed";
let speechSpeed = (() => {
  try { return localStorage.getItem(SPEECH_SPEED_KEY) === "normal" ? "normal" : "slow"; }
  catch { return "slow"; }
})();
let audioMuted = false;

export function setSpeechSpeed(speed) {
  speechSpeed = speed === "normal" ? "normal" : "slow";
  try { localStorage.setItem(SPEECH_SPEED_KEY, speechSpeed); } catch {}
  window.dispatchEvent(new Event("xn-speech-speed"));
}

export function getSpeechSpeed() {
  return speechSpeed;
}

export function setAudioMuted(muted) {
  audioMuted = !!muted;
  window.dispatchEvent(new Event("xn-audio-muted"));
}

export function isAudioMuted() {
  return audioMuted;
}
