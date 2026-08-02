import { defineConfig, configDefaults, Plugin } from "vitest/config";
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
    testTimeout: 10_000,
    exclude: [
      ...configDefaults.exclude,
      "**/e2e/**",
      // Superseded schema-v1-only suites. Schema-v2 behavior and one-way
      // migration are covered by schema-v2.test.ts.
      "src/__tests__/config.test.ts",
      "src/__tests__/config/schema.test.ts",
      "src/__tests__/config/resolve.test.ts",
      "src/__tests__/config/loader.test.ts",
      // This suite asserts the removed name/type widget query contract.
      "src/__tests__/api/widget.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        // page.tsx files are thin data-fetch-and-render wiring with no
        // branching logic. layout.tsx is deliberately NOT excluded here —
        // src/app/(protected)/layout.tsx contains real auth-redirect
        // branching that should stay visible in the coverage report.
        "src/app/**/page.tsx",
      ],
    },
  },
});
