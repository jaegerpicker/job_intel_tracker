import React from "react";
import { View } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { ResearchSection } from "../src/research-section";
import { DemoRepository, fixtures } from "../src/demo";
import { ResearchRequest } from "../src/research";
import { BoardProvider } from "../src/store";
import { BoardApp } from "../App";
const section = (
  repository: DemoRepository,
  jobId = "demo-fern",
  onBusyChange = jest.fn(),
) => (
  <ResearchSection
    key={jobId}
    mode="demo"
    jobId={jobId}
    records={fixtures}
    repository={repository}
    canWrite
    busy={false}
    onBusyChange={onBusyChange}
  />
);
test("lost acknowledgement freezes inputs and retries the exact package, note and key", async () => {
  const repo = new DemoRepository(),
    write = jest.spyOn(repo, "researchWrite"),
    onBusy = jest.fn();
  render(section(repo, "demo-fern", onBusy));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Request research" }),
    ).toBeEnabled(),
  );
  fireEvent.changeText(
    screen.getByLabelText("Research instructions (optional)"),
    "Synthetic package request",
  );
  repo.research.loseNextResponse = true;
  await act(async () =>
    fireEvent.press(screen.getByRole("button", { name: "Request research" })),
  );
  expect(
    screen.getByLabelText("Research instructions (optional)").props.editable,
  ).toBe(false);
  expect(onBusy).toHaveBeenCalledWith(true);
  await act(async () =>
    fireEvent.press(
      screen.getByRole("button", { name: "Retry same research operation" }),
    ),
  );
  await waitFor(() => expect(screen.getByText("Queued")).toBeOnTheScreen());
  expect(write.mock.calls).toHaveLength(2);
  expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0]);
  expect(await repo.researchRequests("demo-fern")).toHaveLength(1);
});
test("late response for a previous route cannot display another job's work", async () => {
  const repo = new DemoRepository();
  const old = await repo.researchRequests("demo-orbit");
  let resolve!: (value: ResearchRequest[]) => void;
  const original = repo.researchRequests.bind(repo);
  jest.spyOn(repo, "researchRequests").mockImplementation((job) =>
    job === "demo-orbit"
      ? new Promise((r) => {
          resolve = r;
        })
      : original(job),
  );
  const view = render(<View>{section(repo, "demo-orbit")}</View>);
  await waitFor(() => expect(resolve).toBeDefined());
  view.rerender(<View>{section(repo, "demo-fern")}</View>);
  await waitFor(() =>
    expect(
      screen.getByText("No requests yet. Nothing has been queued."),
    ).toBeOnTheScreen(),
  );
  await act(async () => resolve(old));
  expect(screen.queryByText(/Synthetic blocker/)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Request research" }),
  ).toBeEnabled();
});
test("read errors retry without inventing coverage or queued success", async () => {
  const repo = new DemoRepository(),
    read = jest.spyOn(repo, "researchRequests");
  read.mockRejectedValueOnce(new Error("Synthetic interruption"));
  render(section(repo));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry research requests" }),
    ).toBeOnTheScreen(),
  );
  expect(
    screen.getByRole("button", { name: "Request research" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Material coverage has not loaded."),
  ).toBeOnTheScreen();
  await act(async () =>
    fireEvent.press(
      screen.getByRole("button", { name: "Retry research requests" }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Request research" }),
    ).toBeEnabled(),
  );
});
test("actual artifacts render and changed references retain missing material status", async () => {
  const repo = new DemoRepository();
  render(section(repo, "demo-cedar"));
  await waitFor(() => expect(screen.getByText("Completed")).toBeOnTheScreen());
  expect(
    screen.getByText(
      fixtures.find((r) => r.id === "demo-research")!.body.text as string,
    ),
  ).toBeOnTheScreen();
  expect(screen.getByText("Tailored resume · Missing")).toBeOnTheScreen();
});
test("native board navigation is frozen during an ambiguous research request", async () => {
  const repo = new DemoRepository();
  render(
    <BoardProvider repository={repo}>
      <BoardApp selectedId="demo-fern" />
    </BoardProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Research" })).toBeOnTheScreen(),
  );
  fireEvent.press(screen.getByRole("button", { name: "Research" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Request research" }),
    ).toBeEnabled(),
  );
  repo.research.loseNextResponse = true;
  await act(async () =>
    fireEvent.press(screen.getByRole("button", { name: "Request research" })),
  );
  expect(screen.getByRole("button", { name: "Overview" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "← Back to board" }),
  ).toBeDisabled();
});
