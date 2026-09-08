import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      // These React Compiler diagnostics are newly enabled by Next 16. Keep
      // the existing lint contract while they are addressed separately.
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // Allow unused variables/parameters prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
