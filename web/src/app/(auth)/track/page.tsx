"use client";
import { PackageSearch } from "lucide-react";
import { TrackForm } from "./track-form";
import { useT } from "@/i18n/provider";

export default function TrackPage() {
  const t = useT();
  return (
    <div className="w-full max-w-md">
      <div className="glass-card-elevated rounded-3xl border border-line/80 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-accent/15 text-accent"><PackageSearch className="size-6" aria-hidden /></span>
          <h1 className="text-2xl font-extrabold tracking-tight">{t("bs.track_title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("bs.track_sub")}</p>
        </div>
        <TrackForm />
        <p className="mt-5 text-center text-xs text-muted">{t("bs.track_privacy")}</p>
      </div>
    </div>
  );
}
