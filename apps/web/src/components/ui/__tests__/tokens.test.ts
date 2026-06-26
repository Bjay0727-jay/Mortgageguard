import { describe, it, expect } from "vitest";
import { scoreVariant, stageVariant, stageLabel } from "../tokens";

describe("score → badge variant", () => {
  it("maps high scores to green, mid to amber, low to red", () => {
    expect(scoreVariant(80)).toBe("green");
    expect(scoreVariant(95)).toBe("green");
    expect(scoreVariant(50)).toBe("amber");
    expect(scoreVariant(79)).toBe("amber");
    expect(scoreVariant(49)).toBe("red");
    expect(scoreVariant(0)).toBe("red");
  });
});

describe("loan stage tokens", () => {
  it("maps known stages to their variant + label", () => {
    expect(stageVariant("post_close")).toBe("green");
    expect(stageVariant("denied")).toBe("red");
    expect(stageLabel("post_close")).toBe("Post-Close");
  });

  it("falls back to gray + raw value for unknown stages", () => {
    expect(stageVariant("nonsense")).toBe("gray");
    expect(stageLabel("nonsense")).toBe("nonsense");
  });
});
