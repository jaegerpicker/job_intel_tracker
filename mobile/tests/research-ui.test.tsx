import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ResearchPanel } from "../src/research-ui";
import {
  prepareResearchDraft,
  researchDeliverables,
  ResearchRequestView,
} from "../src/research-view";

const request: ResearchRequestView = {
  id: "synthetic-request",
  jobId: "synthetic-job",
  version: 1,
  status: "queued",
  deliverables: [...researchDeliverables],
  instructions: "Synthetic owner request",
  results: [],
};
const base = {
  jobId: "synthetic-job",
  requests: [] as ResearchRequestView[],
  loading: false,
  error: "",
  busy: false,
  canWrite: true,
  onRequest: jest.fn(async () => true),
  onCancel: jest.fn(),
  onRetry: jest.fn(),
  onOpenSource: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());
test("full package is accessible and failed requests retain their instructions", async () => {
  const onRequest = jest.fn(async () => false);
  render(<ResearchPanel {...base} onRequest={onRequest} />);
  expect(screen.getAllByRole("radio")).toHaveLength(4);
  fireEvent.changeText(
    screen.getByLabelText("Research instructions (optional)"),
    "  Synthetic draft  ",
  );
  await act(async () =>
    fireEvent.press(screen.getByRole("button", { name: "Request research" })),
  );
  expect(onRequest).toHaveBeenCalledWith({
    package: "full_package",
    instructions: "Synthetic draft",
  });
  expect(
    screen.getByLabelText("Research instructions (optional)").props.value,
  ).toBe("  Synthetic draft  ");
  expect(
    screen.getByText("No requests yet. Nothing has been queued."),
  ).toBeOnTheScreen();
});
test("unknown coverage is distinct from missing and result links are safe", () => {
  const view = render(<ResearchPanel {...base} />);
  expect(
    screen.getByText("Material coverage has not loaded."),
  ).toBeOnTheScreen();
  view.rerender(
    <ResearchPanel
      {...base}
      coverage={[{ type: "research", available: true }]}
      requests={[
        {
          ...request,
          status: "completed",
          results: [
            {
              id: "artifact",
              type: "research",
              title: "Synthetic actual result",
              text: "Delivered research text",
              source: "javascript:alert(1)",
            },
          ],
        },
      ]}
    />,
  );
  expect(
    screen.getByText("Job & company research · Available"),
  ).toBeOnTheScreen();
  expect(screen.getByText("Tailored resume · Missing")).toBeOnTheScreen();
  expect(screen.getByText("Delivered research text")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: /Open source/ })).toBeNull();
});
test.each(["queued", "claimed", "blocked"] as const)(
  "owner can cancel %s work but cannot impersonate agent transitions",
  (status) => {
    render(
      <ResearchPanel
        {...base}
        requests={[
          {
            ...request,
            status,
            claimedBy: status === "claimed" ? "synthetic-agent" : undefined,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Request research" }),
    ).toBeDisabled();
    fireEvent.press(
      screen.getByRole("button", { name: `Cancel ${status} request` }),
    );
    expect(base.onCancel).toHaveBeenCalledWith(
      expect.objectContaining({ status }),
    );
    expect(screen.queryByRole("button", { name: /Claim|Complete/ })).toBeNull();
  },
);
test("loading, permissions and unavailable backend fail closed", () => {
  const view = render(<ResearchPanel {...base} loading />);
  expect(screen.getByLabelText("Loading research requests")).toBeOnTheScreen();
  expect(
    screen.getByRole("button", { name: "Request research" }),
  ).toBeDisabled();
  view.rerender(<ResearchPanel {...base} canWrite={false} />);
  expect(
    screen.getByRole("button", { name: "Request research" }),
  ).toBeDisabled();
  view.rerender(
    <ResearchPanel {...base} unavailable="Research queue unavailable." />,
  );
  expect(
    screen.getByRole("button", { name: "Request research" }),
  ).toBeDisabled();
  view.rerender(<ResearchPanel {...base} error="Synthetic read failed" />);
  fireEvent.press(
    screen.getByRole("button", { name: "Retry research requests" }),
  );
  expect(base.onRetry).toHaveBeenCalledTimes(1);
});
test("navigation never displays another job's progress or artifacts", () => {
  render(<ResearchPanel {...base} jobId="other-job" requests={[request]} />);
  expect(screen.queryByText("Synthetic owner request")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Cancel queued request" }),
  ).toBeNull();
});
test("unknown packages and overlong instructions are rejected", () => {
  expect(() => prepareResearchDraft("bogus" as never, "")).toThrow();
  expect(() => prepareResearchDraft("research", "x".repeat(4001))).toThrow();
});
