import { describe, expect, it } from "vitest";
import {
  buildAstraModelSelectionExpression,
  isAstraSelectionLabel,
} from "../../src/browser/actions/astraModelSelection.js";
import { assertResolvedModelSelectionForTest } from "../../src/browser/actions/modelSelection.js";

async function evaluatePicker(initial: string, latest = "6Pro", available = true) {
  let selected = initial;
  let open = false;
  let advanced = false;
  let now = 0;
  class Element extends EventTarget {
    constructor(
      readonly kind: string,
      readonly value = "",
    ) {
      super();
    }
    get textContent(): string {
      return this.kind === "button"
        ? open
          ? "Thinking effort"
          : selected
        : this.kind === "toggle"
          ? selected
          : this.value;
    }
    getAttribute(name: string) {
      if (name === "aria-expanded") return String(open);
      if (name === "data-active") return String(advanced);
      return null;
    }
    closest() {
      return null;
    }
    getBoundingClientRect() {
      return { width: this.kind === "view" && !advanced ? 0 : 100, height: 30 };
    }
    querySelector(selector: string) {
      if (selector.includes("advanced-view")) return view;
      if (selector.includes("aria-expanded")) return toggle;
      return null;
    }
    querySelectorAll() {
      return rows;
    }
    override dispatchEvent(event: Event) {
      if (event.type !== "click") return true;
      if (this.kind === "button") open = !open;
      if (this.kind === "toggle") advanced = true;
      if (this.kind === "row") selected = latest;
      return true;
    }
  }
  const button = new Element("button");
  const toggle = new Element("toggle");
  const view = new Element("view");
  const root = new Element("root");
  const rows = [
    ...(available ? [new Element("row", "Latest")] : []),
    new Element("row", "GPT-5.6 Sol"),
    new Element("row", "GPT-5.5"),
  ];
  const document = {
    querySelector: () => (open ? toggle : null),
    querySelectorAll: (selector: string) =>
      selector.includes("button") ? [button] : open ? [root] : [],
  };
  const evaluate = new Function(
    "document",
    "window",
    "EventTarget",
    "MouseEvent",
    "performance",
    "setTimeout",
    `return ${buildAstraModelSelectionExpression("select")}`,
  );
  return evaluate(
    document,
    { getComputedStyle: () => ({ display: "block", visibility: "visible" }) },
    EventTarget,
    Event,
    { now: () => now },
    (callback: () => void) => {
      now += 100;
      callback();
    },
  );
}

describe("Astra model selection", () => {
  it.each(["6Pro", "6\nPro", "GPT-6 Astra", "GPT-6 Astra Pro", "6Medium"])(
    "accepts observed version %s",
    (label) => {
      expect(isAstraSelectionLabel(label)).toBe(true);
      expect(() => assertResolvedModelSelectionForTest("GPT-6 Astra", label)).not.toThrow();
    },
  );
  it.each(["Latest", "Pro", "GPT-5.6 Sol Pro", "GPT-6 Luna", "GPT-7 Pro", "16Pro", "GPT-6.1"])(
    "rejects non-evidence %s",
    (label) => {
      expect(isAstraSelectionLabel(label)).toBe(false);
      expect(() => assertResolvedModelSelectionForTest("GPT-6 Astra", label)).toThrow(
        "requires GPT-6 Astra",
      );
    },
  );
  it("recognizes the existing combined model/effort pill", async () => {
    await expect(evaluatePicker("6Pro")).resolves.toEqual({
      status: "already-selected",
      label: "6Pro",
    });
  });
  it("switches from Sol via Latest and verifies the observed version", async () => {
    await expect(evaluatePicker("GPT-5.6 Sol Pro")).resolves.toEqual({
      status: "switched",
      label: "6Pro",
    });
  });
  it("does not claim Astra if Latest advances to a different version", async () => {
    await expect(evaluatePicker("GPT-5.6 Sol Pro", "7Pro")).resolves.toMatchObject({
      status: "option-not-found",
    });
  });
  it("does not fall back to an older available model", async () => {
    await expect(evaluatePicker("GPT-5.5 Pro", "6Pro", false)).resolves.toMatchObject({
      status: "option-not-found",
    });
  });
});
