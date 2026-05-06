import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import App from "./App";

beforeEach(() => {
  Object.defineProperty(window, "takeoutApi", {
    configurable: true,
    value: undefined,
  });
});

describe("App", () => {
  it("shows desktop bridge warning when API is unavailable", () => {
    const view = render(<App />);

    expect(
      view.getByText(
        "Electron bridge is unavailable. Start the desktop app with npm run dev.",
      ),
    ).toBeInTheDocument();
  });

  it("renders core processing options", () => {
    const view = render(<App />);

    expect(view.getByText("Repair options")).toBeInTheDocument();
    expect(
      view.getByText("Missing input and destination folders to proceed"),
    ).toBeInTheDocument();
  });

  it("keeps start disabled until input and output folders are selected", () => {
    const view = render(<App />);

    expect(view.getByText("Select Source Folder")).toBeInTheDocument();
    expect(view.getByText("Select Output Folder")).toBeInTheDocument();

    const startButton = view.getByRole("button", { name: "Start Repair Run" });
    expect(startButton).toBeDisabled();
    expect(
      view.queryByRole("button", { name: "View report" }),
    ).not.toBeInTheDocument();
    expect(
      view.queryByRole("button", { name: "Start new process queue" }),
    ).not.toBeInTheDocument();
  });
});
