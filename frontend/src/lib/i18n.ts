import type { RouteName } from "./routing";

export const i18n = {
  common: {
    confirm: "确认",
    cancel: "取消",
    back: "返回",
    retry: "重试",
    refresh: "同步数据",
    copyNow: "立即复制",
    saveSuccess: "已保存",
    deleteSuccess: "已删除",
    failed: "失败",
    notAvailable: "N/A",
    dash: "—",
  },
  shell: {
    brandTrail: "GPUFleet Node-Network",
    nav: {
      overview: "系统总览",
      onboarding: "节点接入",
      fleet: "节点舰队",
      tasks: "任务管理",
      security: "安全审计",
    },
    commandSearchPlaceholder: "搜索...",
    logoutTitle: "退出",
    online: "Online",
    lastSync: "Last Sync",
    operations: "Operations",
    beijingTime: "Beijing Time",
    dataIssue: "数据异常",
  },
  errorBoundary: {
    appTitle: "控制台骨架暂时不可用",
    appDescription: "先刷新页面恢复工作区，如果问题持续，再回到登录页重新进入。",
    routeTitle: "当前视图加载失败",
    routeDescription: "其他页面仍然可用，你可以先重试，或者退回总览继续操作。",
    goOverview: "返回总览",
    reloadPage: "刷新页面",
  },
  console: {
    overviewSection: "总览",
    nodesSection: "节点",
    tasksSection: "任务",
    loadFailed: "加载控制台数据失败",
  },
  nodeDetail: {
    notFound: "未找到节点",
    resetSecretTitle: "新密钥",
    resetSecretNote: "立即复制",
    tabs: {
      monitor: "硬件监控 Monitor",
      config: "环境配置 Env Config",
      tasks: "任务调度 Dispatch",
    },
    actions: {
      resetSecret: "重置密钥",
      deleteNode: "删除",
      disableNode: "停用节点",
      enableNode: "启用节点",
      disabled: "已停用",
      enabled: "已启用",
      resetDone: "密钥已重置",
      saveBusy: "保存中…",
      save: "保存配置",
    },
    dialogs: {
      disableTitle: "停用节点",
      enableTitle: "启用节点",
      disableMessage: "停用后不再接收任务。",
      enableMessage: "确认启用？",
      deleteTitle: "删除节点",
      deleteMessage: "不可撤销。",
      resetTitle: "重置密钥",
      resetMessage: "当前 Agent 将失效。",
    },
  },
} as const;

export const routeLabels: Record<RouteName, string> = {
  overview: i18n.shell.nav.overview,
  onboarding: i18n.shell.nav.onboarding,
  fleet: i18n.shell.nav.fleet,
  "node-detail": i18n.shell.nav.fleet,
  tasks: i18n.shell.nav.tasks,
  "task-detail": i18n.shell.nav.tasks,
  security: i18n.shell.nav.security,
};

export function formatSectionError(sectionLabel: string, message: string): string {
  return `${sectionLabel}: ${message}`;
}
