import { defineConfig, Plugin } from "vitest/config";
import { transformSync } from "esbuild";
import path from "path";

function jsxPlugin(): Plugin {
  return {
    name: "vitest-jsx-transform",
    enforce: "pre",
    transform(code, id) {
      if (!/\.[jt]sx$/.test(id) || id.includes("node_modules")) return null;
      const loader = id.endsWith(".tsx") ? "tsx" : "jsx";
      const result = transformSync(code, {
        loader,
        jsx: "automatic",
        jsxImportSource: "react",
        target: "esnext",
        format: "esm",
        sourcemap: true,
        sourcefile: id,
      });
      return { code: result.code, map: result.map ? JSON.parse(result.map) : null };
    },
  };
}

export default defineConfig({
  plugins: [jsxPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
