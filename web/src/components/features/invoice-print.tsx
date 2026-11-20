"use client";

/**
 * Print stylesheet of the invoice sheet (Print / Save as PDF): everything outside `.inv-sheet` is removed, the page chain around it loses its app-shell layout
 * (fixed sidebar, scrolling main area), and the sheet is printed on white paper in black ink. The raw colours are intended: paper does not follow the dark theme.
 */
const CSS = `@media print {
  @page { size: A4; margin: 12mm; }
  html, body { background: #fff !important; color: #000 !important; color-scheme: light !important; }
  body *:not(.inv-sheet):not(.inv-sheet *):not(:has(.inv-sheet)) { display: none !important; }
  body:has(.inv-sheet), body :has(.inv-sheet) { display: block !important; position: static !important; overflow: visible !important; height: auto !important; min-height: 0 !important; max-height: none !important;
    width: auto !important; max-width: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: #fff !important; transform: none !important; box-shadow: none !important; }
  .inv-sheet { display: block !important; border: 0 !important; border-radius: 0 !important; padding: 0 !important; }
  .inv-sheet, .inv-sheet * { color: #000 !important; background: transparent !important; border-color: #777 !important; box-shadow: none !important; }
  .inv-sheet .text-muted, .inv-sheet .text-muted * { color: #444 !important; }
  .inv-sheet a { text-decoration: none !important; }
  .inv-sheet [role="row"] { break-inside: avoid; }
  .inv-sheet .inv-noprint { display: none !important; }
}`;

export function PrintStyles() { return <style>{CSS}</style>; }
