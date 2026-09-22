import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/data/": { target: "https://tau-tools.vercel.app", changeOrigin: true },
    },
  },
})
