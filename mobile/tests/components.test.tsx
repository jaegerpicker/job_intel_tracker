import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { Button, Field } from "../src/components";
test("disabled actions remain labeled and cannot submit twice", async () => {
  const press = jest.fn();
  await render(<Button label="Save entry" onPress={press} disabled />);
  expect(screen.getByRole("button", { name: "Save entry" })).toBeDisabled();
  await fireEvent.press(screen.getByRole("button"));
  expect(press).not.toHaveBeenCalled();
});
test("editor has an accessible label and preserves user input", async () => {
  const change = jest.fn();
  await render(
    <Field label="New note" value="draft" onChange={change} multiline />,
  );
  await fireEvent.changeText(
    screen.getByLabelText("New note"),
    "A thoughtful note",
  );
  expect(change).toHaveBeenCalledWith("A thoughtful note");
});
