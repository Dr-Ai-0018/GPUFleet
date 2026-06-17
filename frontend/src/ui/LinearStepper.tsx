/**
 * Linear stepper — Stripe / Linear / Vercel 标准 stepper 美学.
 *
 * 抛弃"3 个独立发光卡片"的设计 (= 卡片嵌套), 改为:
 *   ●─────────────●─────────────○
 *  done          active        pending
 *  标签          标签          标签
 *  副标          副标          副标
 *
 * 一条水平连接线穿过节点中心 → 视觉上是"一条流", 不是"3 个独立按钮".
 * 节点本身才是焦点 (done 实色 + 内描边 / active 中空 + 软 glow / pending 灰描边).
 */

import type { CSSProperties, ReactNode } from "react";

export type StepperStage = {
  /** 阶段编号 — 显示在 pending / active badge 中央 */
  id: number;
  /** 短标题 — 节点正下方显示 */
  label: string;
  /** 副标 — label 下方一行说明 */
  sub?: string;
};

type Props = {
  stages: StepperStage[];
  /** 当前正在做的 stage id (1-based). currentStage > id → done, === id → active, < id → pending. */
  currentStage: number;
};

export function LinearStepper({ stages, currentStage }: Props): JSX.Element {
  return (
    <div className="flex w-full items-start">
      {stages.map((stage, i) => {
        const isDone = currentStage > stage.id;
        const isActive = currentStage === stage.id;
        const isLast = i === stages.length - 1;
        // 连接到下一节点的段 — 起点是当前节点, 状态由"我们是否已经过了起点"决定
        const connectorDone = currentStage > stage.id;
        return (
          <FragmentNode
            key={stage.id}
            stage={stage}
            isDone={isDone}
            isActive={isActive}
            isLast={isLast}
            connectorDone={connectorDone}
          />
        );
      })}
    </div>
  );
}

// — 单节点 + 紧随其后的 connector (除最后一个) —
function FragmentNode({
  stage,
  isDone,
  isActive,
  isLast,
  connectorDone,
}: {
  stage: StepperStage;
  isDone: boolean;
  isActive: boolean;
  isLast: boolean;
  connectorDone: boolean;
}): JSX.Element {
  return (
    <>
      <div className="flex flex-col items-start" style={{ minWidth: 0, flex: isLast ? "0 0 auto" : "0 0 auto" }}>
        <StageNode id={stage.id} isDone={isDone} isActive={isActive} />
        <div className="mt-3 max-w-[180px] pl-[2px]">
          <div
            className={`text-[13px] font-medium tracking-[-0.005em] ${
              isActive
                ? "text-[var(--c-running-soft-text)]"
                : isDone
                  ? "text-gray-200"
                  : "text-gray-400"
            }`}
          >
            {stage.label}
          </div>
          {stage.sub ? (
            <div className="mt-1 text-[11.5px] leading-[1.5] text-gray-500">{stage.sub}</div>
          ) : null}
        </div>
      </div>

      {!isLast ? (
        <div className="mx-3 mt-[11px] h-px flex-1" style={connectorStyle(connectorDone)} />
      ) : null}
    </>
  );
}

function connectorStyle(done: boolean): CSSProperties {
  return done
    ? {
        background:
          "linear-gradient(90deg, rgba(16,185,129,0.55) 0%, rgba(16,185,129,0.30) 100%)",
      }
    : { background: "rgba(255,255,255,0.07)" };
}

// — 节点圆 (3 态) —
function StageNode({ id, isDone, isActive }: { id: number; isDone: boolean; isActive: boolean }): JSX.Element {
  if (isDone) {
    return (
      <span
        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[var(--c-online-soft-text)]"
        style={{
          backgroundColor: "var(--tone-soft-bg-emerald)",
          boxShadow: "inset 0 0 0 1px rgba(16,185,129,0.55)",
        }}
        aria-label={`阶段 ${id} 已完成`}
      >
        <Check />
      </span>
    );
  }
  if (isActive) {
    return (
      <span
        className="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium text-[var(--c-running-soft-text)]"
        style={{
          backgroundColor: "var(--tone-soft-bg-cyan)",
          boxShadow:
            "inset 0 0 0 1px rgba(6,182,212,0.60), 0 0 10px -3px rgba(6,182,212,0.45), 0 0 20px -8px rgba(6,182,212,0.30)",
        }}
        aria-label={`阶段 ${id} 进行中`}
      >
        {id}
      </span>
    );
  }
  return (
    <span
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-medium text-gray-600"
      style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.09)" }}
      aria-label={`阶段 ${id} 待执行`}
    >
      {id}
    </span>
  );
}

function Check(): ReactNode {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
