import type { adminInvoice, businessInvoice } from "@/server/invoice-detail";

/** The two API payloads (`GET /business/invoices/:id`, `GET /admin/finance/invoices/:id`): the admin one is the company one plus an `admin` block. */
export type InvoiceView = Awaited<ReturnType<typeof businessInvoice>>;
export type AdminInvoiceView = Awaited<ReturnType<typeof adminInvoice>>;

/** Bidi isolates for values placed inside a translated sentence: a company name or a date next to Arabic words must not reorder the sentence (invisible in English). */
export const isolate = (s: string | number) => `⁨${s}⁩`;
export const isolateLtr = (s: string | number) => `⁦${s}⁩`;
