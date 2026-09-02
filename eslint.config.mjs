import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  prettier,
  {
    // Existing React 19 debt remains visible while lint becomes a mandatory gate.
    // New work must not add warnings; these rules will be promoted incrementally.
    rules: {
      // Server pages intentionally translate authorization failures to redirects.
      "react-hooks/error-boundaries": "off",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "@next/next/no-html-link-for-pages": "warn",
      "@next/next/no-location-assign-relative-destination": "warn",
      // Branding and signed media URLs cannot always use the Next image optimizer.
      "@next/next/no-img-element": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "tmp/**",
    ".tmp/**",
    ".tmp-docx-render/**",
    ".aws-sam/**",
    ".sam-cli-data/**",
    ".vercel/**",
    ".agents/**",
    "public/sw.js",
    "next-env.d.ts",
  ]),
]);
