import { describe, expect, test } from "bun:test";
import { debounced } from "../src/schedule";

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("debounced", () => {
  test("many rapid changes while a refresh is slow lead to at most 2 refreshes", async () => {
    let runs = 0;
    let running = 0;
    let overlapped = false;
    const schedule = debounced(async () => {
      runs++;
      running++;
      overlapped ||= running > 1;
      await wait(100);
      running--;
    }, 1, () => {});
    schedule();
    await wait(20);
    for (let i = 0; i < 20; i++) {
      schedule();
      await wait(3);
    }
    await wait(400);
    expect(runs).toBe(2);
    expect(overlapped).toBe(false);
  });

  test("a failing run is reported and later changes still run", async () => {
    const errors: unknown[] = [];
    let runs = 0;
    const schedule = debounced(async () => {
      runs++;
      if (runs === 1) throw new Error("boom");
    }, 1, (error) => errors.push(error));
    schedule();
    await wait(30);
    schedule();
    await wait(30);
    expect(runs).toBe(2);
    expect(errors.map(String)).toEqual(["Error: boom"]);
  });
});
