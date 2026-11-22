"use client";
import { useEffect } from "react";

/** A leading unread counter such as `(3) ` or `(99+) ` that another part of the app (the driver's alerts) puts in front of the title. */
const COUNT = /^\(\d+\+?\)\s/;
/** The title the tab should show: ours, behind whatever unread counter is in front right now (two writers must never fight over it). */
export const wantedTitle = (current: string, full: string) => (COUNT.exec(current)?.[0] ?? "") + full;

/**
 * Sets the browser tab title and keeps it. Next renders its own `<title>` from the layout metadata and swaps it in after the page has
 * mounted (and again on every client-side navigation), which overwrote a plain `document.title = …`; the observer puts ours back.
 * The driver's alert banner puts "(3) " in front of the title with an observer of its own: this one leaves such a prefix alone (an earlier version
 * rewrote it, the two answered each other for ever and the driver pages froze), and gives up for a second if the title still changes 25 times in a second.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (!title) return;
    const full = `${title} · JR Logistics`;
    let runs = 0;
    const calm = setInterval(() => { runs = 0; }, 1000);
    const apply = () => {
      const want = wantedTitle(document.title, full);
      if (document.title === want || ++runs > 25) return;
      document.title = want;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); clearInterval(calm); };
  }, [title]);
}
