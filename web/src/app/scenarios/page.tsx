import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { scenarioMcqs } from "@/db/schema";
import { ScenarioQuizView } from "@/components/scenarios/quiz-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "بنك الأسئلة والسيناريوهات التشغيلية (48 تدفقاً)",
  description:
    "دليل واختبار السيناريوهات التشغيلية اليومية لمنصة JR اللوجستية، متضمنة نموذج المحفظة السالبة بسقف ائتماني وفروقات المناطق الجغرافية.",
};

export default async function ScenariosPage() {
  const items = await db
    .select()
    .from(scenarioMcqs)
    .orderBy(asc(scenarioMcqs.flowNumber));

  return <ScenarioQuizView initialItems={items} />;
}

