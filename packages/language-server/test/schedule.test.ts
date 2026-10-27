import { describe, expect, test } from "bun:test";
import { debounced } from "../src/schedule";

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe("debounced", () => {
  test("many rapid changes while a refresh is slow lead to at most 2 refreshes", async () => {
    let release!: () => void;
    const slow = new Promise<void>((done) => (release = done));
    let runs = 0;
    let running = 0;
    let overlapped = false;
    const schedule = debounced(async () => {
      runs++;
      running++;
      overlapped ||= running > 1;
      if (runs === 1) await slow;
      running--;
    }, 1, () => {});
    schedule();
    while (runs === 0) await wait(1);
    for (let i = 0; i < 20; i++) {
      schedule();
      await wait(3);
    }
    release();
    await schedule.settled();
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
    await schedule.settled();
    schedule();
    await schedule.settled();
    expect(runs).toBe(2);
    expect(errors.map(String)).toEqual(["Error: boom"]);
  });

  test("an error reporter that throws does not stop later runs", async () => {
    let runs = 0;
    const schedule = debounced(async () => {
      runs++;
      if (runs === 1) throw new Error("boom");
    }, 1, () => {
      throw new Error("reporter down");
    });
    schedule();
    await schedule.settled();
    schedule();
    await schedule.settled();
    expect(runs).toBe(2);
  });

  test("settled resolves at once when nothing is pending, and after the pending run otherwise", async () => {
    let runs = 0;
    const schedule = debounced(async () => {
      await wait(5);
      runs++;
    }, 1, () => {});
    await schedule.settled();
    expect(runs).toBe(0);
    schedule();
    await schedule.settled();
    expect(runs).toBe(1);
  });
});
