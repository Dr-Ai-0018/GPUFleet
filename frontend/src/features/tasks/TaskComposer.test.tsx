import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskComposer } from "./TaskComposer";
import type { NodeResponse } from "../../types";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const callApiMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("../../state/ConsoleStore", () => ({
  useConsoleStore: () => ({
    callApi: callApiMock,
    refresh: refreshMock,
  }),
}));

vi.mock("../../ui/Toast", () => ({
  useToast: () => ({
    push: pushMock,
  }),
}));

vi.mock("../../lib/routing", () => ({
  navigate: (...args: unknown[]) => navigateMock(...args),
}));

describe("TaskComposer", () => {
  const node: NodeResponse = {
    node_id: "node-1",
    display_name: "Node 1",
    node_type: "physical",
    os_type: "linux",
    hostname: "box",
    heartbeat_interval_sec: 5,
    allowed_workdirs: ["/tmp/work"],
    tags: [],
    is_enabled: true,
    first_seen_at: null,
    last_seen_at: null,
    connection_status: "online",
    onboarding_status: "connected",
    created_at: "",
    updated_at: "",
  };

  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    callApiMock.mockReset();
    navigateMock.mockReset();
  });

  it("shows inline env JSON validation error", async () => {
    render(<TaskComposer node={node} />);
    fireEvent.change(screen.getByLabelText("环境变量（JSON）"), {
      target: { value: "{broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下发任务" }));
    expect(await screen.findByText("环境变量 JSON 格式无效，请检查语法")).toBeInTheDocument();
    expect(callApiMock).not.toHaveBeenCalled();
  });

  it("shows inline GPU id validation error", async () => {
    render(<TaskComposer node={node} />);
    fireEvent.change(screen.getByPlaceholderText("如 0,1"), {
      target: { value: "0,a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下发任务" }));
    expect(await screen.findByText("requested_gpu_ids 必须是逗号分隔的非负整数列表")).toBeInTheDocument();
    expect(callApiMock).not.toHaveBeenCalled();
  });

  it("submits valid payload", async () => {
    callApiMock.mockResolvedValue({
      task_id: "tsk_1",
      type: "shell",
    });
    render(<TaskComposer node={node} />);
    fireEvent.click(screen.getByRole("button", { name: "下发任务" }));
    await waitFor(() => expect(callApiMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalled();
  });
});
