import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import hooks from "eslint-plugin-react-hooks"

export default [
  { ignores: ["dist/**", "node_modules/**", ".vercel/**", ".playwright-mcp/**"] },
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": hooks },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  { files: ["tests/**/*.ts"], languageOptions: { parser: tsParser }, plugins: { "@typescript-eslint": tsPlugin }, rules: { "@typescript-eslint/no-explicit-any": "error" } },
]
