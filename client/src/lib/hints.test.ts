import { describe, it, expect, beforeEach, vi } from "vitest";
import { isHintDismissed, dismissHint, resetAllHints } from "./hints";

describe("hints", () => {
  beforeEach(() => {
    // Mock localStorage som faktisk er enumerable, slik at Object.keys funker.
    let store: Record<string, string> = {};
    const localStorageMock: Storage = new Proxy({} as Storage, {
      get(_target, prop) {
        if (prop === "getItem") return (k: string) => store[k] ?? null;
        if (prop === "setItem") return (k: string, v: string) => { store[k] = v; };
        if (prop === "removeItem") return (k: string) => { delete store[k]; };
        if (prop === "clear") return () => { store = {}; };
        if (prop === "length") return Object.keys(store).length;
        if (prop === "key") return (i: number) => Object.keys(store)[i] ?? null;
        return store[prop as string] ?? null;
      },
      ownKeys() { return Object.keys(store); },
      getOwnPropertyDescriptor(_target, prop) {
        if (prop in store) {
          return { value: store[prop as string], enumerable: true, configurable: true };
        }
        return undefined;
      },
      has(_target, prop) {
        return prop in store;
      },
    });
    vi.stubGlobal("window", { localStorage: localStorageMock });
  });

  it("hint er ikke dismissed by default", () => {
    expect(isHintDismissed("firstRecording")).toBe(false);
  });

  it("dismissHint persisterer", () => {
    dismissHint("firstRecording");
    expect(isHintDismissed("firstRecording")).toBe(true);
  });

  it("ulike keys er uavhengige", () => {
    dismissHint("firstRecording");
    expect(isHintDismissed("firstRecording")).toBe(true);
    expect(isHintDismissed("firstProposal")).toBe(false);
  });

  it("resetAllHints fjerner alle dismiss-flagg", () => {
    dismissHint("firstRecording");
    dismissHint("firstProposal");
    resetAllHints();
    expect(isHintDismissed("firstRecording")).toBe(false);
    expect(isHintDismissed("firstProposal")).toBe(false);
  });
});
