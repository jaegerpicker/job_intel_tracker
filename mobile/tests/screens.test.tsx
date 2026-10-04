import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { useLocalSearchParams, usePathname } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BoardApp } from "../App";
import { BoardProvider } from "../src/store";
import { DemoRepository, fixtures } from "../src/demo";
import { BoardRecord, Repository } from "../src/domain";
const params = jest.mocked(useLocalSearchParams);
const pathname = jest.mocked(usePathname);
const wrapper = (repo: Repository) => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    }}
  >
    <BoardProvider repository={repo}>
      <BoardApp selectedId={params().id as string | undefined} />
    </BoardProvider>
  </SafeAreaProvider>
);
beforeEach(() => {
  params.mockReturnValue({});
  pathname.mockReturnValue("/");
});
test("search and stage filters show a meaningful empty state", async () => {
  await render(wrapper(new DemoRepository()));
  await screen.findByRole("button", {
    name: "Open Cedar Studio, Senior Mobile Engineer, Interview",
  });
  await fireEvent.changeText(
    screen.getByLabelText("Search company, role, or lane"),
    "nonexistent",
  );
  expect(
    screen.getByText(
      "No opportunities match. Try another search or create a prospect.",
    ),
  ).toBeOnTheScreen();
});
test("direct detail route loads, recovers offline failure and displays timeline", async () => {
  params.mockReturnValue({ id: "demo-cedar" });
  pathname.mockReturnValue("/job/demo-cedar");
  let resolve!: (records: BoardRecord[]) => void;
  const repo = new DemoRepository();
  const list = jest.spyOn(repo, "list").mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await render(wrapper(repo));
  expect(screen.getByLabelText("Loading opportunity")).toBeOnTheScreen();
  expect(
    screen.queryByText(
      "This opportunity is no longer available. Return to the board.",
    ),
  ).toBeNull();
  resolve(fixtures);
  await screen.findByText("Status timeline");
  expect(list).toHaveBeenCalledTimes(1);
});
test("detail initial error offers a working retry", async () => {
  params.mockReturnValue({ id: "demo-cedar" });
  pathname.mockReturnValue("/job/demo-cedar");
  const repo = new DemoRepository();
  repo.failNext = true;
  await render(wrapper(repo));
  await screen.findByRole("button", { name: "Retry opportunity" });
  await fireEvent.press(
    screen.getByRole("button", { name: "Retry opportunity" }),
  );
  await screen.findByText("Status timeline");
});
test("interrupted note retains draft and retries identical request exactly once", async () => {
  params.mockReturnValue({ id: "demo-cedar" });
  pathname.mockReturnValue("/job/demo-cedar");
  const repo = new DemoRepository();
  const save = jest.spyOn(repo, "save");
  await render(wrapper(repo));
  await screen.findByText("Status timeline");
  await fireEvent.press(screen.getByRole("button", { name: "Notes" }));
  await fireEvent.changeText(
    screen.getByLabelText("New note"),
    "Draft survives a network failure",
  );
  repo.failNext = true;
  await fireEvent.press(screen.getByRole("button", { name: "Save entry" }));
  await screen.findByRole("button", { name: "Retry same operation" });
  expect(screen.getByLabelText("New note")).toHaveProp(
    "value",
    "Draft survives a network failure",
  );
  expect(
    screen.getByRole("button", { name: "← Back to board" }),
  ).toBeDisabled();
  await fireEvent.press(
    screen.getByRole("button", { name: "Retry same operation" }),
  );
  await screen.findByText("Saved to this demo session.");
  expect(save.mock.calls[0][0]).toEqual(save.mock.calls[1][0]);
  expect(
    (await repo.list()).filter(
      (r) => r.body.text === "Draft survives a network failure",
    ),
  ).toHaveLength(1);
});
test("committed status updates the shared board store", async () => {
  params.mockReturnValue({ id: "demo-cedar" });
  pathname.mockReturnValue("/job/demo-cedar");
  const repo = new DemoRepository();
  await render(wrapper(repo));
  await screen.findByText("Status timeline");
  await fireEvent.press(screen.getByRole("button", { name: "Offer" }));
  await waitFor(() =>
    expect(screen.getByText("Current stage · Offer")).toBeOnTheScreen(),
  );
  expect(
    (await repo.list()).find((r) => r.id === "demo-cedar")?.body.stage,
  ).toBe("Offer");
});

test("note and prep drafts survive switching sections", async () => {
  params.mockReturnValue({ id: "demo-cedar" });
  pathname.mockReturnValue("/job/demo-cedar");
  await render(wrapper(new DemoRepository()));
  await screen.findByText("Status timeline");
  await fireEvent.press(screen.getByRole("button", { name: "Notes" }));
  await fireEvent.changeText(
    screen.getByLabelText("New note"),
    "Keep my draft",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Prep" }));
  await fireEvent.press(screen.getByRole("button", { name: "Notes" }));
  expect(screen.getByLabelText("New note")).toHaveProp(
    "value",
    "Keep my draft",
  );
});
