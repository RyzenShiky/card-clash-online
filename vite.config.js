import { defineConfig } from "vite";

// base "./" agar jalan di username.github.io/repo-name/ maupun root
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    minify: "esbuild",
    target: "es2020",
    rollupOptions: {
      input: {
        main: "index.html",
        privacy: "privacy.html",
        terms: "terms.html"
      }
    }
  },
  server: {
    port: 5173,
    open: true
  },
  publicDir: "public"
});
