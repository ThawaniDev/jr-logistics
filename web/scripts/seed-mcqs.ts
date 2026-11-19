import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });

async function main() {
  const { db, closeDb } = await import("../src/db");
  const { scenarioMcqs } = await import("../src/db/schema");
  const { SCENARIO_MCQS } = await import("../src/data/mcqs-data");

  console.log(`Starting seed for ${SCENARIO_MCQS.length} scenario MCQs...`);

  let count = 0;

  for (const m of SCENARIO_MCQS) {
    const values = {
      flowNumber: m.flowNumber,
      categoryKey: m.categoryKey,
      categoryName: m.categoryName,
      title: m.title,
      processType: m.processType,
      badgeClass: m.badgeClass,
      scenario: m.scenario,
      question: m.question,
      options: m.options,
      correctIndex: m.correctIndex,
      selectedIndex: -1,
      answerText: m.answerText,
      explanation: m.explanation,
      actors: m.actors,
      steps: m.steps,
      techState: m.techState,
      apiCode: m.apiCode,
      finMath: m.finMath,
      decisionNote: m.decisionNote ?? null,
    };

    await db
      .insert(scenarioMcqs)
      .values(values)
      .onConflictDoUpdate({
        target: scenarioMcqs.flowNumber,
        set: {
          categoryKey: values.categoryKey,
          categoryName: values.categoryName,
          title: values.title,
          processType: values.processType,
          badgeClass: values.badgeClass,
          scenario: values.scenario,
          question: values.question,
          options: values.options,
          correctIndex: values.correctIndex,
          answerText: values.answerText,
          explanation: values.explanation,
          actors: values.actors,
          steps: values.steps,
          techState: values.techState,
          apiCode: values.apiCode,
          finMath: values.finMath,
          decisionNote: values.decisionNote,
          updatedAt: new Date(),
        },
      });

    count++;
  }

  console.log(`✓ Successfully seeded ${count} scenario MCQs into PostgreSQL table 'scenario_mcqs'.`);
  await closeDb();
}

main().catch((err) => {
  console.error("Failed to seed scenario MCQs:", err);
  process.exit(1);
});
