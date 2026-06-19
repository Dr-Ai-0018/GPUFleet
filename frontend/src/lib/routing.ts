import { useEffect, useState } from "react";

export type RouteName =
  | "overview"
  | "onboarding"
  | "fleet"
  | "node-detail"
  | "tasks"
  | "task-detail"
  | "security";

export type Route =
  | { name: "overview" }
  | { name: "onboarding" }
  | { name: "fleet" }
  | { name: "node-detail"; nodeId: string }
  | { name: "tasks" }
  | { name: "task-detail"; taskId: string }
  | { name: "security" };

const DEFAULT_HASH = "#/onboarding";
const FALLBACK_ROUTE: Route = { name: "overview" };
type StaticRouteName = Exclude<RouteName, "node-detail" | "task-detail">;
const STATIC_ROUTES = new Set<StaticRouteName>(["overview", "onboarding", "fleet", "tasks", "security"]);

function safeDecode(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(value);
    return decoded.trim() ? decoded : null;
  } catch {
    return null;
  }
}

function isStaticRouteName(value: string | undefined): value is StaticRouteName {
  return Boolean(value && STATIC_ROUTES.has(value as StaticRouteName));
}

export function parseHash(raw: string): Route {
  const trimmed = raw.replace(/^#\/?/, "").trim();
  const parts = trimmed.split("/").filter(Boolean);
  const [head, second, ...rest] = parts;
  if (!head) {
    return FALLBACK_ROUTE;
  }
  if (rest.length > 0) {
    return FALLBACK_ROUTE;
  }
  if (head === "nodes") {
    const nodeId = safeDecode(second);
    return nodeId ? { name: "node-detail", nodeId } : { name: "fleet" };
  }
  if (head === "tasks") {
    if (!second) {
      return { name: "tasks" };
    }
    const taskId = safeDecode(second);
    return taskId ? { name: "task-detail", taskId } : { name: "tasks" };
  }
  if (second) {
    return FALLBACK_ROUTE;
  }
  if (isStaticRouteName(head)) {
    return { name: head };
  }
  return FALLBACK_ROUTE;
}

export function buildHash(route: Route): string {
  switch (route.name) {
    case "overview":
      return "#/overview";
    case "onboarding":
      return "#/onboarding";
    case "fleet":
      return "#/fleet";
    case "node-detail":
      return `#/nodes/${encodeURIComponent(route.nodeId)}`;
    case "tasks":
      return "#/tasks";
    case "task-detail":
      return `#/tasks/${encodeURIComponent(route.taskId)}`;
    case "security":
      return "#/security";
  }
}

export function navigate(route: Route): void {
  const target = buildHash(route);
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash || DEFAULT_HASH));
  useEffect(() => {
    if (!window.location.hash) {
      window.location.replace(DEFAULT_HASH);
    }
    function onChange() {
      setRoute(parseHash(window.location.hash || DEFAULT_HASH));
    }
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
