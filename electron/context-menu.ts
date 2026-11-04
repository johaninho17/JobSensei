// Local shapes of Electron's ContextMenuParams and menu items: only main.ts, preload.ts, and
// pdf-export.ts may import electron (pipeline scripts run without it).
type MenuParams = { isEditable: boolean; selectionText: string; editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean } };
type MenuItem = { role?: "cut" | "copy" | "paste" | "selectAll"; type?: "separator"; enabled?: boolean };

/**
 * Electron shows no right-click menu by default. Text fields get Cut/Copy/Paste/Select All and
 * selected text gets Copy. Elements that draw their own menu (job and file menus) call
 * preventDefault, so this never fires for them. The terminal routes right-click selections through
 * its hidden text field, so Copy and Paste work there too.
 */
export function textContextMenu(params: MenuParams): MenuItem[] {
  if (params.isEditable) {
    return [
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags.canSelectAll },
    ];
  }
  return params.selectionText.trim() ? [{ role: "copy" }] : [];
}
