import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { scenarioMcqs } from "@/db/schema";
import { ScenarioQuizView } from "@/components/scenarios/quiz-view";
import { getCurrentUser, homeFor } from "@/server/auth/current";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "بنك الأسئلة والسيناريوهات التشغيلية (48 تدفقاً)",
  description:
    "دليل واختبار السيناريوهات التشغيلية اليومية لمنصة JR اللوجستية، متضمنة نموذج المحفظة السالبة بسقف ائتماني وفروقات المناطق الجغرافية.",
};

/** Internal page: staff with settings.view / settings.edit (the same rule as the API behind it). */
export default async function ScenariosPage() {
  const u = await getCurrentUser();
  if (!u) redirect("/staff/login");
  if (!(u.role === "admin" || (u.role === "staff" && (u.permissions.includes("settings.view") || u.permissions.includes("settings.edit"))))) redirect(homeFor(u.role));
  const items = await db
    .select()
    .from(scenarioMcqs)
    .orderBy(asc(scenarioMcqs.flowNumber));

  return <ScenarioQuizView initialItems={items} />;
}

