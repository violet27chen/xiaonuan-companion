import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
