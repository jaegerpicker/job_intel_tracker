import React from "react";
import {
  render,
  renderHook,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react-native";
import { PlanningEditor, AttentionBadge, PlanningSummary } from "../src/planning-ui";
import { fixtures, DemoRepository } from "../src/demo";
import { demoWorkload } from "../src/demo-workload";
import { useWorkload } from "../src/use-workload";
import { BoardRecord, BoardError } from "../src/domain";
import { BoardProvider } from "../src/store";
import { BoardApp } from "../App";
const job = fixtures[0],
  projected = demoWorkload(fixtures);
test("displayed active applications include separately applied linked roles", () => {
  const linked = { ...fixtures[1], id: "synthetic-linked-role", body: { ...fixtures[1].body, stage: "Applied" as const, primary_id: fixtures[1].id } };
  const records = [...fixtures, linked];
  const data = demoWorkload(records);
  expect(data.counts.open_applications).toBe(projected.counts.open_applications + 1);
  render(<PlanningSummary data={data} error="" loading={false} retry={jest.fn()} />);
  expect(screen.getByText("4 / 15 active applications")).toBeOnTheScreen();
  expect(linked.body.primary_id).toBe(fixtures[1].id);
});
const editor = (onSave = jest.fn(), record = job) => (
  <PlanningEditor
    job={record}
    derived={{ ...projected.jobs[job.id], record_version: record.version }}
    localDate="2026-10-05"
    canWrite
    busy={false}
    onSave={onSave}
    onRefresh={jest.fn()}
  />
);
test("planning preserves complete body and explicit action ownership", async () => {
  const save = jest.fn(async (w) => ({
    ...job,
    version: 2,
    body: w.payload.body,
  }));
  render(editor(save));
  fireEvent.changeText(
    screen.getByLabelText("Next action"),
    "Prepare synthetic questions",
  );
  fireEvent.press(screen.getByRole("button", { name: "Action owner: agent" }));
  fireEvent.changeText(
    screen.getByLabelText("Action source"),
    "Synthetic owner assignment",
  );
  fireEvent.changeText(
    screen.getByLabelText("Action due date (YYYY-MM-DD)"),
    "2026-10-07",
  );
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Save planning" }));
  });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  const write = save.mock.calls[0][0];
  expect(write.payload.version).toBe(1);
  expect(write.payload.body).toMatchObject({
    company: job.body.company,
    description: job.body.description,
    tracking: {
      applied_on: "2026-09-15",
      next_action: {
        text: "Prepare synthetic questions",
        owner: "agent",
        due_on: "2026-10-07",
        source: "Synthetic owner assignment",
      },
    },
  });
  expect(write.payload.body).not.toHaveProperty("record_version");
  expect(write.payload.body).not.toHaveProperty("waiting_days");
});
test("review source needs a decision and an explicitly displayed valid date", async () => {
  const save = jest.fn();
  render(editor(save));
  fireEvent.changeText(
    screen.getByLabelText("Review source"),
    "Synthetic review",
  );
  fireEvent.press(screen.getByRole("button", { name: "Save planning" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(/Use valid YYYY-MM-DD/)).toBeOnTheScreen();
  fireEvent.press(
    screen.getByRole("button", { name: "Review decision: keep waiting" }),
  );
  const date = screen.getByLabelText(
    "Review date (YYYY-MM-DD; confirm observed date)",
  );
  expect(date.props.value).toBe("2026-10-05");
  fireEvent.changeText(date, "2026-10-06");
  fireEvent.press(screen.getByRole("button", { name: "Save planning" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.changeText(date, "2026-10-04");
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name: "Save planning" }));
  });
  expect(save.mock.calls[0][0].payload.body.tracking.review).toEqual({
    decision: "keep_waiting",
    on: "2026-10-04",
    source: "Synthetic review",
  });
});
test("a version change retains drafts and requires explicit latest-load", async () => {
  const save = jest.fn(),
    view = render(editor(save));
  fireEvent.changeText(
    screen.getByLabelText("Next action"),
    "Retain my synthetic draft",
  );
  fireEvent.changeText(
    screen.getByLabelText("Review source"),
    "Discarded source",
  );
  fireEvent.press(
    screen.getByRole("button", { name: "Review decision: keep waiting" }),
  );
  fireEvent.changeText(
    screen.getByLabelText("Review date (YYYY-MM-DD; confirm observed date)"),
    "2026-10-06",
  );
  fireEvent.press(screen.getByRole("button", { name: "Save planning" }));
  expect(screen.getByText(/Use valid YYYY-MM-DD/)).toBeOnTheScreen();
  view.rerender(editor(save, { ...job, version: 2 }));
  expect(screen.getByLabelText("Next action").props.value).toBe(
    "Retain my synthetic draft",
  );
  expect(screen.getByRole("button", { name: "Save planning" })).toBeDisabled();
  fireEvent.press(
    screen.getByRole("button", { name: "Load latest planning draft" }),
  );
  expect(screen.getByLabelText("Next action").props.value).toBe("");
  expect(screen.getByLabelText("Review source").props.value).toBe("");
  fireEvent.press(
    screen.getByRole("button", { name: "Review decision: keep waiting" }),
  );
  expect(
    screen.getByLabelText("Review date (YYYY-MM-DD; confirm observed date)")
      .props.value,
  ).toBe("2026-10-05");
  expect(screen.queryByText(/Use valid YYYY-MM-DD/)).toBeNull();
});
test("mismatched projection never displays a stale badge", () => {
  render(<AttentionBadge value={projected.jobs[job.id]} version={2} />);
  expect(screen.getByText("Planning refresh needed")).toBeOnTheScreen();
  expect(screen.queryByText(projected.jobs[job.id].label)).toBeNull();
});
test("disabling an in-flight workload read clears spinner and ignores late result", async () => {
  let resolve!: (v: typeof projected) => void;
  const repo = {
    ...new DemoRepository(),
    workload: jest.fn(
      () =>
        new Promise<typeof projected>((r) => {
          resolve = r;
        }),
    ),
  } as unknown as DemoRepository;
  const view = renderHook(
    ({ enabled }: { enabled: boolean }) => useWorkload(repo, fixtures, enabled),
    { initialProps: { enabled: true } },
  );
  await waitFor(() => expect(view.result.current.loading).toBe(true));
  view.rerender({ enabled: false });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  await act(async () => {
    resolve(projected);
  });
  expect(view.result.current.data).toBeUndefined();
});
test("late planning cannot replace a projection fetched for newer records", async () => {
  let resolve!: (v: typeof projected) => void;
  const newer = {
    ...projected,
    jobs: {
      ...projected.jobs,
      [job.id]: { ...projected.jobs[job.id], record_version: 2 },
    },
  };
  const repo = {
    workload: jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(newer),
  } as unknown as DemoRepository;
  const view = renderHook(
    ({ records }: { records: BoardRecord[] }) =>
      useWorkload(repo, records, true),
    { initialProps: { records: fixtures } },
  );
  await waitFor(() => expect(repo.workload).toHaveBeenCalledTimes(1));
  view.rerender({ records: [{ ...job, version: 2 }, ...fixtures.slice(1)] });
  await waitFor(() =>
    expect(view.result.current.data?.jobs[job.id].record_version).toBe(2),
  );
  await act(async () => resolve(projected));
  expect(view.result.current.data?.jobs[job.id].record_version).toBe(2);
});
test("screen planning response loss freezes inputs and retries the identical operation", async () => {
  const repo = new DemoRepository(),
    original = repo.save.bind(repo);
  const save = jest
    .spyOn(repo, "save")
    .mockRejectedValueOnce(new BoardError("network", "Synthetic lost response"))
    .mockImplementation(original);
  render(
    <BoardProvider repository={repo}>
      <BoardApp selectedId={job.id} />
    </BoardProvider>,
  );
  await screen.findByText("Status timeline");
  fireEvent.press(screen.getByRole("button", { name: "Plan" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Next action")).toBeEnabled(),
  );
  fireEvent.changeText(
    screen.getByLabelText("Next action"),
    "Prepare synthetic questions",
  );
  fireEvent.changeText(
    screen.getByLabelText("Action source"),
    "Synthetic owner plan",
  );
  fireEvent.press(screen.getByRole("button", { name: "Save planning" }));
  await screen.findByRole("button", { name: "Retry same operation" });
  expect(screen.getByLabelText("Next action")).toBeDisabled();
  expect(screen.getByLabelText("Next action").props.value).toBe(
    "Prepare synthetic questions",
  );
  fireEvent.press(screen.getByRole("button", { name: "Retry same operation" }));
  await screen.findByText("Saved to this demo session.");
  expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
  expect((await repo.list()).find((r) => r.id === job.id)?.body.stage).toBe(
    "Interview",
  );
});
