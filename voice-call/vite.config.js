import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/*
 * WebView 兼容：
 * - build.target: es2015  让 Android 7+ 的 Chromium 能跑（低端机如 V2318A）
 * - assetsInlineLimit: 0  让所有资源走独立文件，配合 index.html 的 crossorigin 去掉后，
 *   海外 EdgeOne 节点从大陆访问时不会因为 module + crossorigin 策略被 WebView 拦截
 * */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2015",
    cssCodeSplit: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 后端 LangGraph agent（EdgeOne 海外免备案区）；开发期走代理规避跨域
      "/companion": {
        target: "https://xiaonuan.27c.site",
        changeOrigin: true,
      },
    },
  },
});
