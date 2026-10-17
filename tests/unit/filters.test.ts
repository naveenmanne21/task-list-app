import { describe, expect, it } from "vitest";
import { hasActiveFilters, parseFilters } from "@/lib/tasks/filters";
import { escapeLike } from "@/lib/tasks/queries";

describe("parseFilters", () => {
  it("reads valid params", () => {
    expect(parseFilters({ q: "  milk ", status: "done", priority: "2", overdue: "1" })).toEqual({
      q: "milk",
      status: "done",
      priority: 2,
      overdue: true,
    });
  });

  it("drops empty and invalid values instead of failing", () => {
    expect(parseFilters({ q: "   ", status: "archived", priority: "high", overdue: "yes" })).toEqual({});
    expect(parseFilters({ priority: "6" })).toEqual({});
    expect(parseFilters({ status: "", priority: "" })).toEqual({});
  });

  it("uses the first value of a repeated param", () => {
    expect(parseFilters({ status: ["todo", "done"] })).toEqual({ status: "todo" });
  });

  it("reports whether any filter is active", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ overdue: true })).toBe(true);
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("C:\\x")).toBe("C:\\\\x");
    expect(escapeLike("plain")).toBe("plain");
  });
});
