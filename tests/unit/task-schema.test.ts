import { describe, expect, it } from "vitest";
import { isValidIsoDate, parsePriority, taskInputSchema } from "@/lib/tasks/schema";

const valid = { title: "Pay rent", due_date: "2026-11-01", priority: "3", notes: "", status: "todo" };

function errorsFor(input: Record<string, unknown>) {
  const r = taskInputSchema.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
}

describe("taskInputSchema", () => {
  it("accepts a valid task and normalises it", () => {
    expect(taskInputSchema.parse({ ...valid, title: "  Pay rent  ", notes: "  " })).toEqual({
      title: "Pay rent",
      due_date: "2026-11-01",
      priority: 3,
      notes: null,
      status: "todo",
    });
  });

  it("defaults status to todo and accepts a missing notes field", () => {
    const { notes: _n, status: _s, ...rest } = valid;
    expect(taskInputSchema.parse(rest)).toMatchObject({ status: "todo", notes: null });
  });

  describe("title", () => {
    it("accepts exactly 200 characters and rejects 201", () => {
      expect(taskInputSchema.safeParse({ ...valid, title: "a".repeat(200) }).success).toBe(true);
      expect(errorsFor({ ...valid, title: "a".repeat(201) }).title).toMatch(/at most 200/);
    });

    it("counts code points, not UTF-16 units (200 emoji is fine)", () => {
      expect("😀".repeat(200).length).toBe(400);
      expect(taskInputSchema.safeParse({ ...valid, title: "😀".repeat(200) }).success).toBe(true);
      expect(taskInputSchema.safeParse({ ...valid, title: "😀".repeat(201) }).success).toBe(false);
    });

    it("measures length after trimming", () => {
      expect(taskInputSchema.safeParse({ ...valid, title: `  ${"a".repeat(200)}  ` }).success).toBe(true);
    });

    it.each([[""], ["   "], [undefined], [null]])("rejects a missing title (%j)", (title) => {
      expect(errorsFor({ ...valid, title }).title).toBe("Title is required.");
    });
  });

  describe("priority", () => {
    it.each([["1", 1], ["5", 5], [" 3 ", 3], [4, 4]])("accepts %j", (priority, expected) => {
      expect(taskInputSchema.parse({ ...valid, priority }).priority).toBe(expected);
    });

    it.each([["0"], ["6"], ["3.5"], [3.5], [0], [6], ["high"], [""], ["-1"], ["1e0"], ["0x3"], [undefined]])(
      "rejects %j",
      (priority) => {
        expect(errorsFor({ ...valid, priority }).priority).toBeDefined();
      },
    );
  });

  describe("due_date", () => {
    it("accepts Feb 29 in a leap year (2024) and rejects it in 2025", () => {
      expect(taskInputSchema.safeParse({ ...valid, due_date: "2024-02-29" }).success).toBe(true);
      expect(errorsFor({ ...valid, due_date: "2025-02-29" }).due_date).toMatch(/real date/);
    });

    it.each([
      ["2026-13-01"],
      ["2026-04-31"],
      ["2026-00-10"],
      ["2026-1-5"],
      ["01/11/2026"],
      ["2026-11-01T00:00"],
      ["tomorrow"],
      ["0000-01-01"],
    ])("rejects %j", (due_date) => {
      expect(errorsFor({ ...valid, due_date }).due_date).toMatch(/real date/);
    });

    it.each([[""], [undefined]])("requires a due date (%j)", (due_date) => {
      expect(errorsFor({ ...valid, due_date }).due_date).toBe("Due date is required.");
    });
  });

  it("rejects an unknown status", () => {
    expect(errorsFor({ ...valid, status: "archived" }).status).toBeDefined();
  });
});

describe("isValidIsoDate", () => {
  it.each([["2000-02-29", true], ["1900-02-29", false], ["0099-12-31", true], ["2026-12-31", true]])(
    "%s -> %s",
    (s, ok) => {
      expect(isValidIsoDate(s)).toBe(ok);
    },
  );
});

describe("parsePriority", () => {
  it("returns null for anything but a whole number 1-5", () => {
    expect(parsePriority("high")).toBeNull();
    expect(parsePriority(null)).toBeNull();
    expect(parsePriority("2")).toBe(2);
  });
});
