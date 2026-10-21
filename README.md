# Xiaonuan Companion (陪诊小暖)

AI companion for elderly doctor visits — voice-first web app + LangGraph agent on EdgeOne.

- 诊前：陪老人把病情聊清楚，生成「病史摘要卡」给医生
- 诊后：把医嘱整理成服药表和复诊提醒
- 全程语音交互，免提连续对话，支持喊「小暖」唤醒

## Android APK

Built automatically by GitHub Actions (`.github/workflows/android.yml`) on every push to `main`.
Download the latest debug APK from [Releases](../../releases), install on Android 8.0+.

The APK is a WebView shell pointing at the deployed site; microphone permission is requested on first launch.
