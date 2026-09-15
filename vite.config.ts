import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"
import { randomUUID } from "node:crypto"

// https://vitejs.dev/config/
export default defineConfig(() => {
  const version = randomUUID()
  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [react(), {
      name: "app-version",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version }) })
      },
    }],
  }
})
