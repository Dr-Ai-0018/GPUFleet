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

const DEFAULT_HASH = "#/overview";

function parseHash(raw: string): Route {
  const trimmed = raw.replace(/^#\/?/, "").trim();
  const parts = trimmed.split("/").filter(Boolean);
  const [head, second] = parts;
  switch (head) {
    case undefined:
    case "":
    case "overview":
      return { name: "overview" };
    case "onboarding":
      return { name: "onboarding" };
    case "fleet":
      return { name: "fleet" };
    case "nodes":
      return second
        ? { name: "node-detail", nodeId: decodeURIComponent(second) }
        : { name: "fleet" };
    case "tasks":
      return second
        ? { name: "task-detail", taskId: decodeURIComponent(second) }
        : { name: "tasks" };
    case "security":
      return { name: "security" };
    default:
      return { name: "overview" };
  }
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
