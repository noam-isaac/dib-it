import js from "@eslint/js"
import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import hooks from "eslint-plugin-react-hooks"

export default [
  { ignores: ["dist/**", "vendor/**", "node_modules/**", ".vercel/**", ".playwright-mcp/**"] },
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
  {
    files: ["src/App.tsx", "src/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["**/catalogData"], message: "Use useCatalog; components must not load or cache course catalogs." },
        { group: ["**/catalog"], importNames: ["importSemesterCourses", "resolveCatalog", "assertCourseCatalog"], message: "Catalog normalization belongs to useCatalog, not a screen." },
        { group: ["**/annualRegistry"], importNames: ["acceptAnnualFeed", "refreshAnnualFeed"], message: "Use the shared refresh action so all consumers receive the same data." },
      ] }],
      "no-restricted-syntax": ["error", {
        selector: "MemberExpression[property.name='examData'], MemberExpression[property.name='groupExamData'], MemberExpression[property.name='exams']",
        message: "Use the exam selectors; screens must not interpret raw exam data.",
      }, {
        selector: "Literal[value=/\\x2fdata\\x2fcourses-/], TemplateElement[value.raw=/\\x2fdata\\x2fcourses-/]",
        message: "Semester catalogs must be loaded through useCatalog.",
      }],
    },
  },
  { files: ["tests/**/*.ts"], languageOptions: { parser: tsParser }, plugins: { "@typescript-eslint": tsPlugin }, rules: { "@typescript-eslint/no-explicit-any": "error" } },
]
