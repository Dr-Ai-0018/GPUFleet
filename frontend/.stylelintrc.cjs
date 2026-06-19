/**
 * Stylelint 规约 — D2 §3.3 + Frontend_Style_Guide §6.4
 *
 * 核心目的:禁 hex / rgba / hsl 硬编码,强制走 var(--xxx)。
 *   - tokens.css 本身是唯一颜色字面量来源,放在 ignoreFiles
 *   - 未完成"触动即修"的旧 module 先列入 ignoreFiles,后续迁完一个删一个
 *
 * 不继承 stylelint-config-standard 全部规则:那套含大量代码风格规则(已被 prettier 接管),
 * 这里只保留"硬约束"。新违规零容忍。
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
    // token 来源文件 — 唯一允许 hex/rgba 字面量的位置
    "src/styles/tokens.css",
    // base / animations 含 reset + 全局 keyframes,允许少量字面量(transparent 等)
    "src/styles/base.css",
    "src/styles/animations.css",
    // 未完成"触动即修"的旧 module(D2 §10 策略,迁完一个从 ignoreFiles 删一个)
    // 4 个示范文件已迁(Button / Card / StatusPill / ConfirmDialog).module.css
    "src/ui/EmptyState.module.css",
    "src/ui/ParticleField.module.css",
    "src/ui/Skeleton.module.css",
    "src/ui/forms.module.css",
    "src/shell/AppShell.module.css",
    "src/features/auth/LoginScreen.module.css",
    "src/features/nodes/FleetView.module.css",
    "src/features/nodes/OnboardingView.module.css",
    "src/features/observability/SecurityView.module.css",
    "src/features/tasks/TasksView.module.css",
    // build artifacts
    "node_modules/**",
    "dist/**",
    ".vite-build-check/**",
  ],
};
