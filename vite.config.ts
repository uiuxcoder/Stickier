import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

    return {
    optimizeDeps: {
      // heic2any ships as a UMD bundle. Excluding it leaves the raw UMD wrapper
      // to be loaded as ESM in dev, where it exports nothing and HEIC uploads
      // fail; pre-bundling gives it a real default export.
      include: ["heic2any"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      // Proxy API calls to the local Wrangler worker so the unbuilt UI can
      // call the worker's endpoints during development.
      proxy: {
        "/api": {
          target: "http://localhost:8788",
          changeOrigin: true,
        },
      },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      // No inline `config`: the plugin auto-discovers wrangler.jsonc, so that
      // file is the single source of truth for bindings and compatibility.
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
      }),
    ],
  };
});
