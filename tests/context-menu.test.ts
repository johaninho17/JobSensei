import { describe, expect, it } from "vitest";
import { textContextMenu } from "../electron/context-menu";

const flags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canUndo: false, canRedo: false, canDelete: false, canEditRichly: false };

describe("right-click menu", () => {
  it("offers cut, copy, paste, and select all in text fields", () => {
    expect(textContextMenu({ isEditable: true, selectionText: "", editFlags: { ...flags, canCut: false } }).map((item) => item.role ?? item.type))
      .toEqual(["cut", "copy", "paste", "separator", "selectAll"]);
    expect(textContextMenu({ isEditable: true, selectionText: "", editFlags: { ...flags, canCut: false } })[0]).toMatchObject({ role: "cut", enabled: false });
  });

  it("offers copy for selected page text and nothing elsewhere", () => {
    expect(textContextMenu({ isEditable: false, selectionText: "Solutions Engineer", editFlags: flags })).toEqual([{ role: "copy" }]);
    expect(textContextMenu({ isEditable: false, selectionText: "  ", editFlags: flags })).toEqual([]);
  });
});
