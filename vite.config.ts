import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"
import deployment from "./vercel.json"

const dataRewrite = deployment.rewrites.find(rule => rule.source === "/data/:path*")
if (!dataRewrite) throw new Error("Missing data rewrite in vercel.json")

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/data/": { target: new URL(dataRewrite.destination).origin, changeOrigin: true },
    },
  },
})
