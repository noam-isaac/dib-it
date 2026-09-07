import js from "@eslint/js"
import parser from "@typescript-eslint/parser"
import reactHooks from "eslint-plugin-react-hooks"

export default [
  { ignores: ["dist/**", ".vercel/**", ".playwright-mcp/**"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      // TypeScript checks declarations and unused names, including type-only imports.
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react-hooks/rules-of-hooks": "error",
    },
  },
]
