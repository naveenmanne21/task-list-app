// CSV import pipeline without the database: parse, validate, dedupe, rejected CSV.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeCsv } from "@/lib/import/analyze";
import { splitInFileDuplicates } from "@/lib/import/dedupe";
import { parseCsv } from "@/lib/import/parse";
import { buildRejectedCsv } from "@/lib/import/rejectedCsv";
import { TOO_MANY_FIELDS, validateRecord, type RejectedRow, type ValidRow } from "@/lib/import/validate";

const HEADER = "title,due_date,priority,notes";
const csv = (...lines: string[]) => lines.join("\n") + "\n";

function analyze(text: string) {
  const a = analyzeCsv(text);
  if (!a.ok) throw new Error(`unexpected file error: ${a.error}`);
  return a;
}

/** Reason for a single-data-row file, or "valid". */
function reasonFor(row: string, header = HEADER): string {
  const a = analyze(csv(header, row));
  if (a.valid.length === 1) return "valid";
  if (a.rejected.length === 1) return a.rejected[0].reason;
  throw new Error(`row was ${a.skippedBlank ? "blank" : "?"}`);
}

describe("parseCsv: whole-file errors", () => {
  it.each([
    ["", /empty/],
    ["   \r\n \n", /empty/],
    ["﻿", /empty/],
    [HEADER + "\n", /no data rows/],
    ["title,priority\nx,1\n", /Missing required column "due_date"/],
    ["name,date\nx,y\n", /Missing required columns "title", "due_date", "priority"/],
    ["title,title,due_date,priority\na,b,2026-01-01,1\n", /"title" appears more than once/],
    [`${HEADER}\n"unterminated,2026-01-01,1,\nnext,2026-01-02,2,\n`, /quoted field is never closed/],
  ])("%j -> error", (text, message) => {
    const r = parseCsv(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it("makes analyzeCsv report the same error instead of rows", () => {
    expect(analyzeCsv("")).toEqual({ ok: false, error: "The file is empty." });
  });
});

describe("parseCsv: format handling", () => {
  it("strips a BOM and normalises headers (trim + lowercase)", () => {
    const r = parseCsv("﻿ Title , DUE_DATE,Priority ,Notes\nx,2026-01-01,1,n\n");
    expect(r.ok && r.csv.header).toEqual(["title", "due_date", "priority", "notes"]);
  });

  it("accepts columns in any order, extra columns, and no notes column", () => {
    const a = analyze(csv("priority,extra,due_date,title", "2,ignored,2026-01-01,Hello"));
    expect(a.valid[0].input).toMatchObject({ title: "Hello", priority: 2, due_date: "2026-01-01", notes: null });
  });

  it("handles CRLF line endings", () => {
    const a = analyze(`${HEADER}\r\nA,2026-01-01,1,x\r\nB,2026-01-02,2,y\r\n`);
    expect(a.valid.map((v) => [v.row, v.input.title, v.input.notes])).toEqual([
      [2, "A", "x"],
      [3, "B", "y"],
    ]);
  });

  it("keeps quoted commas, escaped quotes and line breaks inside one field", () => {
    const a = analyze(csv(HEADER, 'A,2026-01-01,1,"Milk, eggs, ""fresh""\nsecond line"', "B,2026-01-02,2,"));
    expect(a.valid[0].input.notes).toBe('Milk, eggs, "fresh"\nsecond line');
    // The multi-line record is still one row; the next record is row 3.
    expect(a.valid.map((v) => v.row)).toEqual([2, 3]);
  });

  it("numbers rows from the header (row 1), and doesn't count the final line break as a row", () => {
    const withNewline = analyze(csv(HEADER, "A,2026-01-01,1,"));
    const without = analyze(`${HEADER}\nA,2026-01-01,1,`);
    for (const a of [withNewline, without]) {
      expect(a.totalRows).toBe(1);
      expect(a.skippedBlank).toBe(0);
      expect(a.valid[0].row).toBe(2);
    }
  });
});

describe("blank rows", () => {
  it.each([
    ["an empty line", ""],
    ["whitespace only", "   \t "],
    ["commas only", ",,,"],
    ["commas and spaces", " , ,  , "],
  ])("skips %s and counts it", (_label, line) => {
    const a = analyze(csv(HEADER, "A,2026-01-01,1,", line, "B,2026-01-02,2,"));
    expect(a.skippedBlank).toBe(1);
    expect(a.rejected).toEqual([]);
    expect(a.valid.map((v) => v.row)).toEqual([2, 4]); // row numbers still count the blank row
    expect(a.totalRows).toBe(3);
  });

  it("counts a blank line before the final line break", () => {
    expect(analyze(csv(HEADER, "A,2026-01-01,1,", "")).skippedBlank).toBe(1);
  });
});

describe("row validation", () => {
  it("accepts a valid row and trims values", () => {
    expect(reasonFor("  Pay rent  , 2026-11-01 , 3 ,  notes ")).toBe("valid");
    expect(analyze(csv(HEADER, "  Pay rent  ,2026-11-01,3,  notes  ")).valid[0].input).toEqual({
      title: "Pay rent",
      due_date: "2026-11-01",
      priority: 3,
      notes: "notes",
      status: "todo",
    });
  });

  describe("title", () => {
    it("accepts 200 characters and rejects 201", () => {
      expect(reasonFor(`${"a".repeat(200)},2026-01-01,1,`)).toBe("valid");
      expect(reasonFor(`${"a".repeat(201)},2026-01-01,1,`)).toBe("Title must be at most 200 characters");
    });

    it("counts code points (200 emoji is fine, 201 is not)", () => {
      expect(reasonFor(`${"😀".repeat(200)},2026-01-01,1,`)).toBe("valid");
      expect(reasonFor(`${"😀".repeat(201)},2026-01-01,1,`)).toMatch(/at most 200/);
    });

    it.each([[""], ["   "]])("rejects a missing title (%j)", (title) => {
      expect(reasonFor(`${title},2026-01-01,1,notes`)).toBe("Title is required");
    });
  });

  describe("priority", () => {
    it.each([["high"], ["3.5"], ["0"], ["6"], ["-1"], ["1e0"], ["two"]])("rejects %j", (p) => {
      expect(reasonFor(`A,2026-01-01,${p},`)).toBe("Priority must be a whole number from 1 to 5");
    });

    it("rejects a blank priority as required", () => {
      expect(reasonFor("A,2026-01-01,,")).toBe("Priority is required");
      expect(reasonFor("A,2026-01-01,  ,")).toBe("Priority is required");
    });

    it.each([["1"], ["5"], [" 4 "]])("accepts %j", (p) => {
      expect(reasonFor(`A,2026-01-01,${p},`)).toBe("valid");
    });
  });

  describe("due_date", () => {
    it("accepts Feb 29 2024 (leap year) and rejects Feb 29 2025", () => {
      expect(reasonFor("A,2024-02-29,1,")).toBe("valid");
      expect(reasonFor("A,2025-02-29,1,")).toBe("Due date must be a real date in YYYY-MM-DD format");
    });

    it.each([["2026-13-01"], ["2026-04-31"], ["2026-1-5"], ["01/11/2026"], ["11/01/2026"], ["20261101"], ["soon"]])(
      "rejects %j",
      (d) => {
        expect(reasonFor(`A,${d},1,`)).toBe("Due date must be a real date in YYYY-MM-DD format");
      },
    );

    it("rejects a blank due date as required", () => {
      expect(reasonFor("A,,1,")).toBe("Due date is required");
    });
  });

  it("rejects notes over the shared length cap with their own reason", () => {
    expect(reasonFor(`A,2026-01-01,1,${"n".repeat(10_000)}`)).toBe("valid");
    expect(reasonFor(`A,2026-01-01,1,${"n".repeat(10_001)}`)).toBe("Notes must be at most 10000 characters");
  });

  it('reports every problem in a row, joined with "; " in column order', () => {
    expect(reasonFor(",2025-02-29,high,")).toBe(
      "Title is required; Due date must be a real date in YYYY-MM-DD format; Priority must be a whole number from 1 to 5",
    );
  });

  it("rejects a row with more fields than the header as the only reason", () => {
    expect(reasonFor("Fix bike,2026-11-15,2,needs chain,and brakes")).toBe(TOO_MANY_FIELDS);
    expect(reasonFor(",,,,oops")).toBe(TOO_MANY_FIELDS);
  });

  it("treats missing trailing cells as empty and reports them", () => {
    expect(reasonFor("Renew passport,2026-12-01,5")).toBe("valid"); // only notes missing
    expect(reasonFor("Renew passport")).toBe("Due date is required; Priority is required");
  });

  it("keeps the original values for the report", () => {
    const a = analyze(csv(HEADER, "  A ,2025-02-29,high,n"));
    expect(a.rejected[0].data).toEqual({ title: "  A ", due_date: "2025-02-29", priority: "high", notes: "n" });
  });

  it("validateRecord reports blank records", () => {
    expect(
      validateRecord({ row: 5, cells: ["", " "] }, { header: ["title", "due_date"], columns: {} as never }),
    ).toEqual({ kind: "blank", row: 5 });
  });
});

describe("in-file duplicates", () => {
  it("keeps the first valid occurrence and rejects later ones with its row number", () => {
    const a = analyze(
      csv(HEADER, "Pay rent,2026-11-01,1,", "Other,2026-11-01,1,", "  Pay rent ,2026-11-01,3,again", "Pay rent,2026-11-01,2,"),
    );
    expect(a.valid.map((v) => v.row)).toEqual([2, 3]);
    expect(a.rejected.map((r) => [r.row, r.reason])).toEqual([
      [4, "Duplicate of row 2"],
      [5, "Duplicate of row 2"],
    ]);
  });

  it("does not treat a valid row as a duplicate of an earlier INVALID row", () => {
    const a = analyze(csv(HEADER, "Pay rent,2026-11-01,high,", "Pay rent,2026-11-01,2,", "Pay rent,2026-11-01,3,"));
    expect(a.rejected.map((r) => [r.row, r.reason])).toEqual([
      [2, "Priority must be a whole number from 1 to 5"],
      [4, "Duplicate of row 3"],
    ]);
    expect(a.valid.map((v) => v.row)).toEqual([3]);
  });

  it("uses exact title (case-sensitive) and due date", () => {
    const a = analyze(csv(HEADER, "Pay rent,2026-11-01,1,", "pay rent,2026-11-01,1,", "Pay rent,2026-12-01,1,"));
    expect(a.rejected).toEqual([]);
    expect(a.valid).toHaveLength(3);
  });

  it("splitInFileDuplicates preserves order", () => {
    const row = (n: number, title: string): ValidRow => ({
      row: n,
      input: { title, due_date: "2026-01-01", priority: 1, notes: null, status: "todo" },
      data: { title, due_date: "2026-01-01", priority: "1", notes: "" },
    });
    const { unique, duplicates } = splitInFileDuplicates([row(2, "a"), row(3, "b"), row(4, "a")]);
    expect(unique.map((r) => r.row)).toEqual([2, 3]);
    expect(duplicates).toEqual([{ row: 4, reason: "Duplicate of row 2", data: row(4, "a").data }]);
  });
});

describe("rejected-rows CSV", () => {
  const rejected: RejectedRow[] = [
    {
      row: 7,
      reason: "Title is required; Priority must be a whole number from 1 to 5",
      data: { title: "", due_date: "2026-01-01", priority: "high", notes: 'has, comma and "quotes"\nand a newline' },
    },
    { row: 12, reason: TOO_MANY_FIELDS, data: { title: "=HYPERLINK(\"x\")", due_date: "+1", priority: "-1", notes: "@cmd" } },
  ];

  it("writes the header, CRLF line endings and quotes where needed", () => {
    const out = buildRejectedCsv(rejected);
    expect(out.split("\r\n")[0]).toBe("title,due_date,priority,notes,row_number,reason");
    expect(out).toContain('"has, comma and ""quotes""\nand a newline"');
    // "; " needs no quoting; a comma in a reason would be quoted.
    expect(out).toContain(",7,Title is required; Priority must be a whole number from 1 to 5\r\n");
  });

  it("prefixes cells starting with = + - @ with a single quote", () => {
    const parsed = parseCsv(buildRejectedCsv(rejected));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.csv.records[1].cells.slice(0, 4)).toEqual(["'=HYPERLINK(\"x\")", "'+1", "'-1", "'@cmd"]);
  });

  it("round-trips through the parser (commas, quotes, newlines intact)", () => {
    const parsed = parseCsv(buildRejectedCsv(rejected));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.csv.header).toEqual(["title", "due_date", "priority", "notes", "row_number", "reason"]);
    expect(parsed.csv.records.map((r) => r.cells)).toEqual([
      ["", "2026-01-01", "high", 'has, comma and "quotes"\nand a newline', "7", rejected[0].reason],
      ["'=HYPERLINK(\"x\")", "'+1", "'-1", "'@cmd", "12", TOO_MANY_FIELDS],
    ]);
  });

  it("can be re-imported: the original columns are read back and re-validated", () => {
    const a = analyze(buildRejectedCsv(rejected.slice(0, 1)));
    expect(a.rejected[0]).toMatchObject({ row: 2, reason: rejected[0].reason });
  });

  it("writes just the header when nothing was rejected", () => {
    expect(buildRejectedCsv([]).trimEnd()).toBe("title,due_date,priority,notes,row_number,reason");
  });
});

describe("fixtures/edge-cases.csv (the demo file)", () => {
  const text = readFileSync(path.resolve("fixtures/edge-cases.csv"), "utf8");

  it("uses Windows line endings", () => {
    expect(text).toContain("\r\n");
  });

  it("imports the valid rows and reports each bad row with a reason", () => {
    const a = analyze(text);
    expect(a.totalRows).toBe(11);
    expect(a.skippedBlank).toBe(2); // empty line (row 4) and ",,," (row 9)
    expect(a.valid.map((v) => [v.row, v.input.title])).toEqual([
      [2, "Buy groceries"],
      [3, "Pay rent"],
      [10, "Plan trip"],
      [11, "Renew passport"],
    ]);
    expect(a.valid[0].input.notes).toBe("Milk, eggs, and bread");
    expect(a.valid[2].input.notes).toBe('She said "go", so we go');
    expect(a.rejected.map((r) => [r.row, r.reason])).toEqual([
      [5, "Priority must be a whole number from 1 to 5"],
      [6, "Title must be at most 200 characters"],
      [7, "Duplicate of row 3"],
      [8, "Due date must be a real date in YYYY-MM-DD format"],
      [12, TOO_MANY_FIELDS],
    ]);
  });
});
