import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarioMcqs, type ScenarioMcq } from "@/db/schema";
import { defineRoutes } from "../router";
import { toCsv } from "@/server/ops";
import { requirePerm } from "@/server/auth/permissions";

/**
 * The scenario bank is internal (operational decisions, API calls, money math, the owner's answers): signed-in staff only. Reading needs `settings.view` (or
 * `settings.edit`), writing an answer needs `settings.edit`. There is no anonymous access in any mode — a demo deployment signs in like every other.
 */
const bo = "backoffice" as const;

function generateMarkdown(items: ScenarioMcq[]): string {
  let md = `# بنك أسئلة وسيناريوهات منصة JR اللوجستية (${items.length} سيناريو تشغيلي واقعي)\n\n`;
  md += `> **توثيق رسمي لمنصة JR:** يشمل هذا المستند ${items.length} تدفقاً تشغيلياً دقيقاً مع أسئلة متعددة الخيارات (MCQs) ونموذج الإجابة المعتمد وتحديثات المحفظة السالبة (Negative Credit Limit) وفروقات المناطق (Zone Differentiations) وإمكانية إدراج الإجابات المخصصة.\n\n`;
  md += `---\n\n`;

  const categoryMap = new Map<string, ScenarioMcq[]>();
  for (const item of items) {
    const list = categoryMap.get(item.categoryName) ?? [];
    list.push(item);
    categoryMap.set(item.categoryName, list);
  }

  for (const [catName, catItems] of categoryMap.entries()) {
    md += `## 📁 ${catName} (${catItems.length} سيناريو)\n\n`;

    for (const item of catItems) {
      md += `### سيناريو ${item.flowNumber}: ${item.title}\n\n`;
      md += `- **التصنيف:** ${item.categoryName} (\`${item.categoryKey}\`)\n`;
      md += `- **نوع المعالجة:** ${item.processType}\n`;
      if (item.decisionNote) {
        md += `- **مرجع القرار التشغيلي:** ${item.decisionNote}\n`;
      }
      md += `\n**السياق التشغيلي الواقعي:**\n> ${item.scenario}\n\n`;
      md += `**السؤال (MCQ):**\n**${item.question}**\n\n`;
      md += `**الخيارات المتاحة:**\n`;
      const optLetters = ["أ", "ب", "ج", "د"];
      item.options.forEach((opt, idx) => {
        const isCorrect = idx === item.correctIndex;
        md += `- **(${optLetters[idx]})** ${opt} ${isCorrect ? "✅ *(الإجابة الصحيحة)*" : ""}\n`;
      });
      md += `\n**الإجابة الصحيحة المعتمدة:**\n> **${item.answerText}**\n\n`;
      md += `**التبرير والشرح التشغيلي والمالي:**\n${item.explanation}\n\n`;

      if (item.customResponse) {
        md += `**✍️ الإجابة أو المقترح المخصص المسجل:**\n`;
        md += `> ${item.customResponse} ${item.customResponseBy ? `*(بواسطة: ${item.customResponseBy})*` : ""}\n\n`;
      }

      if (item.actors && item.actors.length > 0) {
        md += `**الأطراف المعنية (Actors):** ${item.actors.join(" • ")}\n\n`;
      }

      if (item.steps && item.steps.length > 0) {
        md += `**الخطوات التشغيلية:**\n`;
        item.steps.forEach((step, sIdx) => {
          md += `${sIdx + 1}. ${step}\n`;
        });
        md += `\n`;
      }

      md += `**الحالة البرمجية في المنصة (State Machine):** \`${item.techState}\`\n\n`;
      md += `**استدعاء الواجهة البرمجية (API Call):**\n\`\`\`http\n${item.apiCode}\n\`\`\`\n\n`;

      if (item.finMath && item.finMath.length > 0) {
        md += `**الأثر المالي والعمليات الحسابية:**\n\n`;
        md += `| البند / العملية المالية | القيمة والأثر |\n`;
        md += `| :--- | :--- |\n`;
        for (const row of item.finMath) {
          md += `| ${row.label} | \`${row.val}\` |\n`;
        }
        md += `\n`;
      }

      md += `---\n\n`;
    }
  }

  return md;
}

defineRoutes([
  {
    method: "GET",
    path: "/scenarios",
    auth: bo,
    query: z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      hasCustom: z.string().optional(),
    }),
    handler: async ({ q, user }) => {
      requirePerm(user, "settings.view", "settings.edit");
      let items = await db.select().from(scenarioMcqs).orderBy(asc(scenarioMcqs.flowNumber));

      if (q.category && q.category !== "all") {
        items = items.filter((i) => i.categoryKey === q.category);
      }

      if (q.hasCustom === "true") {
        items = items.filter((i) => i.customResponse && i.customResponse.trim().length > 0);
      }

      if (q.search && q.search.trim()) {
        const s = q.search.trim().toLowerCase();
        items = items.filter(
          (i) =>
            i.title.toLowerCase().includes(s) ||
            i.scenario.toLowerCase().includes(s) ||
            i.question.toLowerCase().includes(s) ||
            i.answerText.toLowerCase().includes(s) ||
            (i.customResponse && i.customResponse.toLowerCase().includes(s)) ||
            String(i.flowNumber) === s
        );
      }

      // Compute categories with counts from full DB
      const allItems = await db.select({
        categoryKey: scenarioMcqs.categoryKey,
        categoryName: scenarioMcqs.categoryName,
        flowNumber: scenarioMcqs.flowNumber,
        customResponse: scenarioMcqs.customResponse,
      }).from(scenarioMcqs).orderBy(asc(scenarioMcqs.flowNumber));

      const categoryCounts = new Map<string, { key: string; name: string; count: number }>();
      let customResponseCount = 0;
      for (const row of allItems) {
        if (row.customResponse && row.customResponse.trim().length > 0) {
          customResponseCount++;
        }
        const ex = categoryCounts.get(row.categoryKey);
        if (ex) {
          ex.count++;
        } else {
          categoryCounts.set(row.categoryKey, { key: row.categoryKey, name: row.categoryName, count: 1 });
        }
      }

      return {
        total: items.length,
        totalInDb: allItems.length,
        customResponseCount,
        categories: Array.from(categoryCounts.values()),
        items,
      };
    },
  },
  {
    method: "GET",
    path: "/scenarios/export",
    auth: bo,
    query: z.object({
      format: z.enum(["csv", "md"]).default("csv"),
      category: z.string().optional(),
    }),
    handler: async ({ q, user }) => {
      requirePerm(user, "settings.view", "settings.edit");
      let items = await db.select().from(scenarioMcqs).orderBy(asc(scenarioMcqs.flowNumber));

      if (q.category && q.category !== "all") {
        items = items.filter((i) => i.categoryKey === q.category);
      }

      if (q.format === "csv") {
        const columns = [
          "رقم_التدفق",
          "التصنيف",
          "مفتاح_التصنيف",
          "عنوان_السيناريو",
          "نوع_المعالجة",
          "السياق_التشغيلي",
          "السؤال",
          "الخيار_أ",
          "الخيار_ب",
          "الخيار_ج",
          "الخيار_د",
          "رقم_الخيار_الصحيح",
          "الإجابة_الصحيحة",
          "الإجابة_المخصصة",
          "كاتب_الإجابة_المخصصة",
          "الشرح_والتبرير",
          "الأطراف_المعنية",
          "الخطوات_التشغيلية",
          "الحالة_البرمجية",
          "استدعاء_API",
          "الأثر_المالي",
          "ملاحظة_القرار",
        ];

        const rows = items.map((i) => {
          const opts = i.options ?? [];
          const optLetters = ["أ", "ب", "ج", "د"];
          return {
            رقم_التدفق: i.flowNumber,
            التصنيف: i.categoryName,
            مفتاح_التصنيف: i.categoryKey,
            عنوان_السيناريو: i.title,
            نوع_المعالجة: i.processType,
            السياق_التشغيلي: i.scenario,
            السؤال: i.question,
            الخيار_أ: opts[0] ?? "",
            الخيار_ب: opts[1] ?? "",
            الخيار_ج: opts[2] ?? "",
            الخيار_د: opts[3] ?? "",
            رقم_الخيار_الصحيح: `${i.correctIndex + 1} (${optLetters[i.correctIndex] ?? ""})`,
            الإجابة_الصحيحة: i.answerText,
            الإجابة_المخصصة: i.customResponse ?? "",
            كاتب_الإجابة_المخصصة: i.customResponseBy ?? "",
            الشرح_والتبرير: i.explanation,
            الأطراف_المعنية: (i.actors ?? []).join(" | "),
            الخطوات_التشغيلية: (i.steps ?? []).join(" -> "),
            الحالة_البرمجية: i.techState,
            استدعاء_API: i.apiCode,
            الأثر_المالي: (i.finMath ?? []).map((m) => `${m.label}: ${m.val}`).join(" | "),
            ملاحظة_القرار: i.decisionNote ?? "",
          };
        });

        const csvContent = "\uFEFF" + toCsv(columns, rows);
        return new Response(csvContent, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="jr-logistics-scenarios-${items.length}.csv"`,
          },
        });
      }

      // Markdown Export
      const mdContent = generateMarkdown(items);
      return new Response(mdContent, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="jr-logistics-scenarios-${items.length}.md"`,
        },
      });
    },
  },
  {
    method: "POST",
    path: "/scenarios/:flowNumber/answer",
    auth: bo,
    body: z.object({
      selectedIndex: z.number().int().min(0).max(3),
    }),
    handler: async ({ params, input, user }) => {
      requirePerm(user, "settings.edit");
      const flowNum = parseInt(params.flowNumber, 10);
      if (isNaN(flowNum)) {
        return new Response(JSON.stringify({ error: "Invalid flow number" }), { status: 400 });
      }

      const [item] = await db
        .select()
        .from(scenarioMcqs)
        .where(eq(scenarioMcqs.flowNumber, flowNum));

      if (!item) {
        return new Response(JSON.stringify({ error: "Scenario not found" }), { status: 404 });
      }

      await db
        .update(scenarioMcqs)
        .set({
          selectedIndex: input.selectedIndex,
          updatedAt: new Date(),
        })
        .where(eq(scenarioMcqs.flowNumber, flowNum));

      const isCorrect = input.selectedIndex === item.correctIndex;
      return {
        flowNumber: flowNum,
        selectedIndex: input.selectedIndex,
        correctIndex: item.correctIndex,
        isCorrect,
        answerText: item.answerText,
        explanation: item.explanation,
      };
    },
  },
  {
    method: "POST",
    path: "/scenarios/:flowNumber/custom-response",
    auth: bo,
    body: z.object({
      customResponse: z.string().trim().max(3000),
      author: z.string().trim().max(100).optional(),
    }),
    handler: async ({ params, input, user }) => {
      requirePerm(user, "settings.edit");
      const flowNum = parseInt(params.flowNumber, 10);
      if (isNaN(flowNum)) {
        return new Response(JSON.stringify({ error: "Invalid flow number" }), { status: 400 });
      }

      const [item] = await db
        .select()
        .from(scenarioMcqs)
        .where(eq(scenarioMcqs.flowNumber, flowNum));

      if (!item) {
        return new Response(JSON.stringify({ error: "Scenario not found" }), { status: 404 });
      }

      const cleanText = input.customResponse.trim();
      const author = user.name || "مشرف تشغيل"; // the author is who is signed in, never what the form says

      await db
        .update(scenarioMcqs)
        .set({
          customResponse: cleanText.length > 0 ? cleanText : null,
          customResponseBy: cleanText.length > 0 ? author : null,
          updatedAt: new Date(),
        })
        .where(eq(scenarioMcqs.flowNumber, flowNum));

      return {
        success: true,
        flowNumber: flowNum,
        customResponse: cleanText.length > 0 ? cleanText : null,
        customResponseBy: cleanText.length > 0 ? author : null,
      };
    },
  },
]);
