/**
 * Full sweep config — 不豁免任何 module,用于查看完整迁移待办
 *   pnpm run lint:css:full
 * 当 .stylelintrc.cjs 的 ignoreFiles 全部清空时,这两个就一致了。
 */
module.exports = {
  rules: {
    "color-no-hex": true,
    "function-disallowed-list": [
      ["rgb", "rgba", "hsl", "hsla"],
      {
        message: "颜色值必须走 var(--xxx),禁止现编 rgba/hsl(D2 §3.1)。tokens.css 是唯一例外。",
      },
    ],
  },
  ignoreFiles: [
    // 唯一允许字面量的位置
    "src/styles/tokens.css",
    "src/styles/base.css",
    "src/styles/animations.css",
    "node_modules/**",
    "dist/**",
    ".vite-build-check/**",
  ],
};
