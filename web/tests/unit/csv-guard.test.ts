import { describe, it, expect } from "vitest";
import { csvLine, toCsv } from "@/server/ops";

/** CSV cells that a spreadsheet could read as a formula (audit K / A4). */
describe("csv formula guard", () => {
  it("prefixes a leading = + - @ tab or CR, but leaves plain negative numbers alone", () => {
    expect(csvLine(["=1+1", "+966500000001", "-2+3", "@SUM(A1)", "\tx", "-32.84", "-5", "plain"])).toBe("'=1+1,'+966500000001,'-2+3,'@SUM(A1),'\tx,-32.84,-5,plain");
  });
  it("quotes a cell that contains a bare CR, so `Bob<CR>=1+1` can never become a second record starting with a formula", () => {
    const line = csvLine(["Bob\r=1+1", "ok"]);
    expect(line).toBe('"Bob\r=1+1",ok');
    // a reader that treats a bare CR as a record end sees ONE record
    expect(line.replace(/"[^"]*"/g, "").split(/\r|\n/)).toHaveLength(1);
  });
  it("quotes commas, quotes and line feeds and doubles inner quotes", () => {
    expect(csvLine(['a,b', 'say "hi"', "l1\nl2"])).toBe('"a,b","say ""hi""","l1\nl2"');
  });
  it("toCsv guards the header too and writes null as an empty cell", () => {
    expect(toCsv(["=x", "b"], [{ "=x": null, b: undefined }])).toBe("'=x,b\n,");
  });
});
