import React from "react";
import { Text, Pressable } from "react-native";
import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { BoardProvider, useBoard } from "../src/store";
import { DemoRepository, fixtures } from "../src/demo";
import { BoardRecord } from "../src/domain";
function Probe() {
  const { records, load, updateRecord } = useBoard();
  return (
    <>
      <Text>{records[0]?.body.stage ?? "loading"}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh"
        onPress={() => void load()}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Commit"
        onPress={() =>
          updateRecord({
            ...fixtures[0],
            version: 2,
            body: { ...fixtures[0].body, stage: "Offer" },
          })
        }
      />
    </>
  );
}
test("late refresh does not overwrite a committed record", async () => {
  const repo = new DemoRepository();
  let resolve!: (records: BoardRecord[]) => void;
  jest
    .spyOn(repo, "list")
    .mockResolvedValueOnce(fixtures)
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
  await render(
    <BoardProvider repository={repo}>
      <Probe />
    </BoardProvider>,
  );
  await screen.findByText("Interview");
  await fireEvent.press(screen.getByRole("button", { name: "Refresh" }));
  await fireEvent.press(screen.getByRole("button", { name: "Commit" }));
  await act(async () => {
    resolve(fixtures);
  });
  expect(screen.getByText("Offer")).toBeOnTheScreen();
});
