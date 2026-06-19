import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src/types.generated.ts"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        AbortController: "readonly",
        Blob: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        File: "readonly",
        Headers: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        KeyboardEvent: "readonly",
        localStorage: "readonly",
        MouseEvent: "readonly",
        navigator: "readonly",
        process: "readonly",
        Request: "readonly",
        Response: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        SVGElement: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        window: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-undef": "off",
      "react/prop-types": "off",
    },
  },
);
