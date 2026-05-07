import { describe, it, expect } from "vitest";
import { mergeDecisions } from "./merge-decisions";

describe("mergeDecisions", () => {
  it("returnerer kun main hvis dedicated er tom", () => {
    const main = [{ id: "d-1", text: "A", context: null }];
    const result = mergeDecisions(main, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("d-1");
  });

  it("legger til unike fra dedicated", () => {
    const main = [{ id: "d-1", text: "Velge alternativ A", context: null }];
    const dedicated = [{ id: "d-ded-1", text: "Bestemte byggestart Q3", context: null }];
    const result = mergeDecisions(main, dedicated);
    expect(result).toHaveLength(2);
  });

  it("dedup'er på ID-match", () => {
    const main = [{ id: "d-1", text: "A", context: null }];
    const dedicated = [{ id: "d-1", text: "A endret", context: "ny kontekst" }];
    const result = mergeDecisions(main, dedicated);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("A"); // beholder main
  });

  it("dedup'er på substring-match", () => {
    const main = [{ id: "d-1", text: "Velge grupperom A fremfor B", context: null }];
    const dedicated = [{ id: "d-2", text: "Velge grupperom A", context: null }];
    const result = mergeDecisions(main, dedicated);
    expect(result).toHaveLength(1);
  });

  it("dedup'er på 60% felles ord", () => {
    const main = [{ id: "d-1", text: "Tørkerom skal velges fremfor tørkeskap basert på arealeffektivitet", context: null }];
    const dedicated = [{ id: "d-2", text: "Tørkerom velges fremfor tørkeskap arealeffektivitet", context: null }];
    const result = mergeDecisions(main, dedicated);
    expect(result).toHaveLength(1);
  });

  it("hopper over tomme decisions", () => {
    const main: any[] = [];
    const dedicated = [{ id: "d-2", text: "", context: null }];
    const result = mergeDecisions(main, dedicated);
    expect(result).toHaveLength(0);
  });

  it("beholder ulike beslutninger fra dedicated", () => {
    const main = [{ id: "d-1", text: "Velge betong A", context: null }];
    const dedicated = [
      { id: "d-2", text: "Igangsette grunnarbeid uke 22", context: null },
      { id: "d-3", text: "Inngå kontrakt med UE Per Hansen", context: null },
    ];
    const result = mergeDecisions(main, dedicated);
    expect(result).toHaveLength(3);
  });
});
