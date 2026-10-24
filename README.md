# Xiaonuan Companion (陪诊小暖)

AI companion for elderly doctor visits — voice-first web app and standalone services hosted on the Xiaonuan server.

- 诊前：陪老人把病情聊清楚，生成「病史摘要卡」给医生
- 诊后：把医嘱整理成服药表和复诊提醒
- 豆包实时全双工语音直连：语音输入、识别、回复和音频输出共用一个流式会话
- MiMo-V2.6-Flash 处理明确的健康档案、用药整理和药品图片识别；普通语音闲聊由实时语音模型直接回复
- 实时语音密钥只放在服务端环境变量 `DOUBAO_REALTIME_API_KEY`，不能打包进网页或 APK

## 独立服务器部署

`server/` contains the standalone FastAPI companion API, PostgreSQL user and memory storage, persistent LangGraph checkpoints, and Node.js Doubao WebSocket relay. The site is served by Nginx; runtime secrets belong in `/etc/xiaonuan/xiaonuan.env`, never in Git or frontend assets. Deployment notes are in `server/README.md`.

## Android APK

Built automatically by GitHub Actions (`.github/workflows/android.yml`) on every push to `main`.
Download the latest debug APK from [Releases](../../releases), install on Android 8.0+.

The APK is a WebView shell pointing at the deployed site; microphone permission is requested on first launch.
