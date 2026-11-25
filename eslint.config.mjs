import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default [
	js.configs.recommended,
	{
		plugins: { "@stylistic": stylistic },
		languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: { ...globals.node } },
		rules: {
			// Same style as MagicMirror itself
			"@stylistic/indent": ["error", "tab"],
			"@stylistic/quotes": ["error", "double", { avoidEscape: true }],
			"@stylistic/semi": ["error", "always"],
			"@stylistic/space-before-function-paren": ["error", "always"],
			"@stylistic/comma-dangle": ["error", "never"],
			"@stylistic/no-trailing-spaces": "error",
			"@stylistic/eol-last": "error",
			"eqeqeq": "error",
			"no-var": "error",
			"prefer-const": "error"
		}
	},
	{
		files: ["MMM_ncdeck.js"],
		languageOptions: { sourceType: "script", globals: { ...globals.browser, Module: "readonly", Log: "readonly", NcDeckShared: "readonly", config: "readonly" } }
	},
	{
		files: ["lib/shared.js"],
		languageOptions: { sourceType: "script", globals: { ...globals.browser, ...globals.node } }
	},
	{ files: ["eslint.config.mjs"], languageOptions: { sourceType: "module" } }
];
