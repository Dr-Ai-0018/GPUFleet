#!/usr/bin/env node
/**
 * D2 §3.3 兜底:扫描 .tsx 内的 className 字符串,禁止硬编码 hex / rgba
 *
 * stylelint 只能管 .css,Tailwind v4 在 .tsx 用 arbitrary value (bg-[#abc],bg-[rgba(...)])
 * 时绕过 stylelint。这个脚本对 .tsx 做最低粒度的 grep。
 *
 * 不在 scope:tokens.css(允许 hex/rgba 字面量)。
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "src");
const VIOLATION = /className=["'`][^"'`]*?(#[0-9a-fA-F]{3,6}|rgba?\(|hsla?\()/g;

// D2 §10 触动即修策略:这些 .tsx 文件目前还有 hex/rgba 硬编码,迁完一个从这里删一个
// 跑 `pnpm run lint:colors:full` 看完整违规清单
const IGNORE_FILES = new Set(
  [
    "src/shell/AppShell.tsx",
    "src/ui/CommandPalette.tsx",
    "src/ui/ErrorBoundary.tsx",
    "src/ui/GpuHeatCells.tsx",
    "src/ui/PipelineBar.tsx",
    "src/ui/TimeRangePicker.tsx",
    "src/features/nodes/FleetView.tsx",
    "src/features/nodes/OnboardingView.tsx",
    "src/features/nodes/detail/ConfigPanel.tsx",
    "src/features/nodes/detail/MonitorPanel.tsx",
    "src/features/nodes/detail/TasksPanel.tsx",
    "src/features/nodes/detail/hero/HeroSummary.tsx",
    "src/features/observability/SecurityView.tsx",
    "src/features/overview/OverviewView.tsx",
    "src/features/tasks/TasksView.tsx",
  ].map((p) => p.replace(/\//g, process.platform === "win32" ? "\\" : "/")),
);

const STRICT = process.argv.includes("--strict");

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (/\.tsx$/.test(ent.name)) out.push(p);
  }
  return out;
}

const files = await walk(ROOT);
const hits = [];
const ignoredHits = [];
for (const file of files) {
  const rel = relative(process.cwd(), file);
  const src = await readFile(file, "utf8");
  const matches = [...src.matchAll(VIOLATION)];
  for (const m of matches) {
    const line = src.slice(0, m.index).split("\n").length;
    const entry = { file: rel, line, snippet: m[0].slice(0, 80) };
    if (!STRICT && IGNORE_FILES.has(rel)) {
      ignoredHits.push(entry);
    } else {
      hits.push(entry);
    }
  }
}

if (hits.length === 0) {
  const tail = ignoredHits.length
    ? ` (${ignoredHits.length} 处在 ignoreFiles 内,跑 --strict 看完整清单)`
    : "";
  console.log(`✔ lint:colors — 0 个未压制的 .tsx className 硬编码颜色${tail}`);
  process.exit(0);
}

console.error(`✘ lint:colors — 发现 ${hits.length} 处硬编码颜色,必须改为 var(--xxx)`);
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}  ${h.snippet}…`);
}
console.error("\n参考 docs/Frontend_Style_Guide.md §6 Token 使用强制");
process.exit(1);
