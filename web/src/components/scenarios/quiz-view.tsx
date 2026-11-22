"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  FileSpreadsheet,
  FileCode2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RotateCcw,
  Search,
  Filter,
  Layers,
  ChevronDown,
  ChevronUp,
  Cpu,
  Coins,
  Award,
  Sparkles,
  ArrowRight,
  BookOpen,
  Check,
  PenLine,
  Save,
  Trash2,
  MessageSquarePlus,
} from "lucide-react";
import type { ScenarioMcq } from "@/db/schema";
import { Logo } from "@/components/layout/shell";
import { ThemeMenu } from "@/components/theme/theme-menu";

interface QuizViewProps {
  initialItems: ScenarioMcq[];
}

export function ScenarioQuizView({ initialItems }: QuizViewProps) {
  const [items, setItems] = useState<ScenarioMcq[]>(initialItems);
  const [mode, setMode] = useState<"quiz" | "review">("quiz");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [onlyCustomFilter, setOnlyCustomFilter] = useState<boolean>(false);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [expandedCards, setExpandedCards] = useState<Record<number, boolean>>({});

  // Custom response editor states
  const [editingCustom, setEditingCustom] = useState<Record<number, boolean>>({});
  const [customTextDraft, setCustomTextDraft] = useState<Record<number, string>>({});
  const [customAuthorDraft, setCustomAuthorDraft] = useState<Record<number, string>>({});
  const [isSavingCustom, setIsSavingCustom] = useState<Record<number, boolean>>({});
  const [customSuccessMessage, setCustomSuccessMessage] = useState<Record<number, string>>({});

  // Distinct categories with item counts
  const categories = useMemo(() => {
    const map = new Map<string, { key: string; name: string; count: number }>();
    for (const item of items) {
      const ex = map.get(item.categoryKey);
      if (ex) {
        ex.count++;
      } else {
        map.set(item.categoryKey, {
          key: item.categoryKey,
          name: item.categoryName,
          count: 1,
        });
      }
    }
    return Array.from(map.values());
  }, [items]);

  // Count of items that have custom responses
  const customResponsesCount = useMemo(() => {
    return items.filter((i) => i.customResponse && i.customResponse.trim().length > 0).length;
  }, [items]);

  // Filtered items based on category, search, and custom response filter
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (onlyCustomFilter && (!item.customResponse || item.customResponse.trim().length === 0)) {
        return false;
      }
      if (selectedCategory !== "all" && item.categoryKey !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesTitle = item.title.toLowerCase().includes(q);
        const matchesScenario = item.scenario.toLowerCase().includes(q);
        const matchesQuestion = item.question.toLowerCase().includes(q);
        const matchesAnswer = item.answerText.toLowerCase().includes(q);
        const matchesCustom = (item.customResponse ?? "").toLowerCase().includes(q);
        const matchesNumber = String(item.flowNumber) === q || `#${item.flowNumber}` === q;
        if (!matchesTitle && !matchesScenario && !matchesQuestion && !matchesAnswer && !matchesCustom && !matchesNumber) {
          return false;
        }
      }
      return true;
    });
  }, [items, selectedCategory, searchQuery, onlyCustomFilter]);

  // Quiz Stats
  const totalAnswered = Object.keys(userAnswers).length;
  const totalCorrect = useMemo(() => {
    let correct = 0;
    for (const [flowNumStr, chosenIdx] of Object.entries(userAnswers)) {
      const flowNum = Number(flowNumStr);
      const question = items.find((i) => i.flowNumber === flowNum);
      if (question && question.correctIndex === chosenIdx) {
        correct++;
      }
    }
    return correct;
  }, [userAnswers, items]);

  const scorePercentage = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const handleSelectOption = (flowNumber: number, optionIndex: number) => {
    if (mode === "review") return;
    setUserAnswers((prev) => ({
      ...prev,
      [flowNumber]: optionIndex,
    }));
  };

  const toggleExpand = (flowNumber: number) => {
    setExpandedCards((prev) => ({
      ...prev,
      [flowNumber]: !prev[flowNumber],
    }));
  };

  const handleResetQuiz = () => {
    if (confirm("هل تريد تصفير جميع إجاباتك والبدء من جديد؟")) {
      setUserAnswers({});
    }
  };

  const startEditCustom = (item: ScenarioMcq) => {
    setEditingCustom((prev) => ({ ...prev, [item.flowNumber]: true }));
    setCustomTextDraft((prev) => ({ ...prev, [item.flowNumber]: item.customResponse ?? "" }));
    setCustomAuthorDraft((prev) => ({ ...prev, [item.flowNumber]: item.customResponseBy ?? "" }));
  };

  const cancelEditCustom = (flowNumber: number) => {
    setEditingCustom((prev) => ({ ...prev, [flowNumber]: false }));
  };

  const saveCustomResponse = async (flowNumber: number) => {
    const text = customTextDraft[flowNumber]?.trim() ?? "";
    const author = customAuthorDraft[flowNumber]?.trim() || "مشرف تشغيل";

    setIsSavingCustom((prev) => ({ ...prev, [flowNumber]: true }));
    try {
      const res = await fetch(`/api/v1/scenarios/${flowNumber}/custom-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customResponse: text, author }),
      });

      if (!res.ok) throw new Error("Failed to save custom response");

      setItems((prev) =>
        prev.map((item) =>
          item.flowNumber === flowNumber
            ? {
                ...item,
                customResponse: text.length > 0 ? text : null,
                customResponseBy: text.length > 0 ? author : null,
              }
            : item
        )
      );

      setEditingCustom((prev) => ({ ...prev, [flowNumber]: false }));
      setCustomSuccessMessage((prev) => ({
        ...prev,
        [flowNumber]: text.length > 0 ? "تم حفظ المقترح المخصص بنجاح!" : "تم مسح المقترح بنجاح",
      }));

      setTimeout(() => {
        setCustomSuccessMessage((prev) => ({ ...prev, [flowNumber]: "" }));
      }, 3000);
    } catch {
      alert("تعذر حفظ الإجابة المخصصة. يرجى المحاولة مرة أخرى.");
    } finally {
      setIsSavingCustom((prev) => ({ ...prev, [flowNumber]: false }));
    }
  };

  const optLetters = ["أ", "ب", "ج", "د"];

  return (
    <div className="min-h-screen bg-bg text-ink hero-grid-pattern selection:bg-accent/30 font-sans" dir="rtl">
      {/* ── Top Navigation Bar ── */}
      <header className="sticky top-0 z-50 border-b border-line/70 bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link href="/" aria-label="JR Logistics Home">
              <Logo size={34} compact />
            </Link>
            <div className="hidden sm:block h-6 w-px bg-line/80" />
            <div className="hidden sm:flex items-center gap-2">
              <span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-bold text-accent border border-accent/30">
                78 سيناريو تشغيلي
              </span>
              <span className="text-xs text-muted">
                نموذج المحفظة السالبة، سلسلة التبريد، والإجابات المخصصة
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeMenu />
            {/* Export CSV */}
            <a
              href="/api/v1/scenarios/export?format=csv"
              download="jr-logistics-scenarios-78.csv"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card/80 px-2.5 py-2 sm:px-3.5 text-xs font-medium text-ink transition hover:border-accent hover:text-accent hover:bg-card"
              title="تصدير جميع الأسئلة والسيناريوهات والإجابات المخصصة كملف إكسل CSV مع دعم كامل للغة العربية UTF-8"
            >
              <FileSpreadsheet className="size-4 text-accent" />
              <span className="hidden md:inline">تصدير</span> CSV
            </a>

            {/* Export Markdown */}
            <a
              href="/api/v1/scenarios/export?format=md"
              download="jr-logistics-scenarios-78.md"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card/80 px-2.5 py-2 sm:px-3.5 text-xs font-medium text-ink transition hover:border-cyan hover:text-cyan hover:bg-card"
              title="تصدير كملف توثيقي بتنسيق Markdown"
            >
              <FileCode2 className="size-4 text-cyan" />
              <span className="hidden md:inline">تصدير</span> MD
            </a>

            {/* Visual HTML Flows */}
            <a
              href="/flows-ar.html"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-2.5 py-2 sm:px-3.5 text-xs font-medium text-gold transition hover:bg-gold/20"
              title="فتح لوحة المخططات والتدفقات المرئية التفاعلية"
            >
              <ExternalLink className="size-4" />
              <span className="hidden md:inline">لوحة</span> المخططات
            </a>

            <Link
              href="/"
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-2 sm:px-3.5 text-xs font-bold text-accent-ink transition hover:brightness-110 shadow-[0_0_15px_color-mix(in_srgb,var(--jr-accent)_30%,transparent)]"
            >
              <span className="hidden sm:inline">الرئيسية</span>
              <ArrowRight className="size-3.5 rotate-180" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Main Hero Section ── */}
      <section className="relative overflow-hidden border-b border-line/60 bg-hero py-10 sm:py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-semibold text-accent mb-4">
              <Sparkles className="size-3.5" />
              بنك الأسئلة والسيناريوهات الميدانية المعتمدة لمنصة JR (78 تدفقاً تشغيلياً)
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-ink mb-3 leading-snug">
              78 سيناريو تشغيلي مع أسئلة <span className="text-gradient">MCQ وخيار الإجابة المخصصة</span>
            </h1>
            <p className="text-sm sm:text-base text-muted leading-relaxed max-w-3xl">
              تغطي كافة العمليات اليومية الواقعية في قطاع الخدمات اللوجستية السعودي: رصيف المستودع، التوزيع المبرد،
              سلسلة التبريد وحساسات IoT، تصاريح البوابات ورسوم الساحات (Demurrage)، التوزيع متعدد النقاط B2B Milk-Run،
              الأمن ومكافحة الاحتيال، إشعارات ZATCA الدائنة، والقوة القاهرة، مع إمكانية إدخال مقترحاتك وإجاباتك المخصصة وحفظها.
            </p>

            {/* Quick KPI badges */}
            <div className="mt-6 flex flex-wrap gap-3">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-card/60 px-3.5 py-2">
                <Layers className="size-4 text-cyan" />
                <span className="text-xs text-muted">إجمالي السيناريوهات:</span>
                <span className="text-sm font-bold text-ink ltr-num">{items.length}</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-card/60 px-3.5 py-2">
                <Coins className="size-4 text-gold" />
                <span className="text-xs text-muted">النموذج المالي:</span>
                <span className="text-sm font-bold text-gold">محفظة سالبة بسقف ائتماني</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-card/60 px-3.5 py-2">
                <Cpu className="size-4 text-accent" />
                <span className="text-xs text-muted">التصنيفات:</span>
                <span className="text-sm font-bold text-accent ltr-num">{categories.length} مجموعات</span>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-2">
                <PenLine className="size-4 text-accent" />
                <span className="text-xs text-muted">الإجابات المخصصة المسجلة:</span>
                <span className="text-sm font-bold text-accent ltr-num">{customResponsesCount}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Mode & Filter Bar ── */}
      <div className="sticky top-20 z-40 border-b border-line/70 bg-bg2/95 backdrop-blur-md py-4">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-3">
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Mode Switcher */}
            <div className="inline-flex rounded-xl border border-line bg-card p-1 shadow-inner">
              <button
                type="button"
                onClick={() => setMode("quiz")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  mode === "quiz"
                    ? "bg-accent text-accent-ink shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
              >
                <HelpCircle className="size-4" />
                وضع الاختبار التفاعلي (Quiz)
              </button>
              <button
                type="button"
                onClick={() => setMode("review")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  mode === "review"
                    ? "bg-accent text-accent-ink shadow-sm"
                    : "text-muted hover:text-ink"
                }`}
              >
                <BookOpen className="size-4" />
                دليل الحلول والمراجعة الشاملة (Audit)
              </button>
            </div>

            {/* Quiz Progress & Score (Visible in Quiz Mode) */}
            {mode === "quiz" && (
              <div className="flex items-center gap-3 bg-card/80 border border-line rounded-xl px-4 py-2">
                <div className="flex items-center gap-1.5 text-xs">
                  <Award className="size-4 text-gold" />
                  <span className="text-muted">النتيجة:</span>
                  <span className="font-bold text-accent ltr-num">
                    {totalCorrect} / {totalAnswered}
                  </span>
                  <span className="text-muted">({scorePercentage}%)</span>
                </div>
                <div className="h-4 w-px bg-line" />
                <button
                  type="button"
                  onClick={handleResetQuiz}
                  className="inline-flex items-center gap-1 text-xs text-muted hover:text-danger transition"
                  title="تصفير الإجابات"
                >
                  <RotateCcw className="size-3.5" />
                  <span>تصفير</span>
                </button>
              </div>
            )}

            {/* Search Input & Custom Filter Toggle */}
            <div className="flex items-center gap-2 flex-1 max-w-lg">
              <div className="relative flex-1">
                <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 size-4 text-muted pointer-events-none" />
                <input
                  type="text"
                  placeholder="ابحث برقم السيناريو (#60)، كلمة مفتاحية، السؤال أو الإجابة المخصصة..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-xl border border-line-strong bg-card/90 py-2.5 pr-10 pl-4 text-xs text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-ink"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Only Custom Responses Filter Button */}
              <button
                type="button"
                onClick={() => setOnlyCustomFilter(!onlyCustomFilter)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-semibold shrink-0 transition ${
                  onlyCustomFilter
                    ? "bg-accent text-accent-ink border-accent font-bold"
                    : "bg-card border-line text-muted hover:text-ink hover:border-accent/40"
                }`}
                title="عرض السيناريوهات التي تحتوي على إجابات أو مقترحات مخصصة فقط"
              >
                <PenLine className="size-3.5" />
                <span className="hidden sm:inline">مقترحاتي</span> ({customResponsesCount})
              </button>
            </div>
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 no-scrollbar text-xs">
            <span className="text-muted font-medium shrink-0 flex items-center gap-1">
              <Filter className="size-3.5" />
              التصنيف:
            </span>
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`shrink-0 rounded-lg px-3 py-1.5 font-medium transition ${
                selectedCategory === "all"
                  ? "bg-accent/20 light:bg-accent/10 border border-accent/50 text-accent font-bold"
                  : "bg-card border border-line/60 text-muted hover:text-ink hover:border-line"
              }`}
            >
              الكل ({items.length})
            </button>
            {categories.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelectedCategory(c.key)}
                className={`shrink-0 rounded-lg px-3 py-1.5 font-medium transition ${
                  selectedCategory === c.key
                    ? "bg-accent/20 light:bg-accent/10 border border-accent/50 text-accent font-bold"
                    : "bg-card border border-line/60 text-muted hover:text-ink hover:border-line"
                }`}
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Questions List Container ── */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-line bg-card p-12 text-center">
            <HelpCircle className="size-12 text-muted mx-auto mb-3 opacity-60" />
            <h3 className="text-base font-bold text-ink">لا توجد سيناريوهات مطابقة للبحث</h3>
            <p className="text-xs text-muted mt-1">جرّب تغيير كلمات البحث أو إلغاء فلتر الإجابات المخصصة.</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const userAnswer = userAnswers[item.flowNumber];
            const hasAnswered = userAnswer !== undefined;
            const isCorrect = hasAnswered && userAnswer === item.correctIndex;
            const isExpanded = !!expandedCards[item.flowNumber];
            const isEditingThisCustom = !!editingCustom[item.flowNumber];
            const hasCustomResponse = item.customResponse && item.customResponse.trim().length > 0;

            return (
              <article
                key={item.flowNumber}
                id={`flow-${item.flowNumber}`}
                className="rounded-2xl border border-line/80 bg-card/80 p-5 sm:p-7 shadow-sm transition hover:border-line relative overflow-hidden"
              >
                {/* Top Flow Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="flex items-center justify-center rounded-lg bg-accent/15 border border-accent/30 px-2.5 py-1 text-xs font-black text-accent ltr-num">
                      #{String(item.flowNumber).padStart(2, "0")}
                    </span>
                    <span className="rounded-md bg-card border border-line px-2.5 py-1 text-xs text-muted">
                      {item.categoryName}
                    </span>
                    <span
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                        item.badgeClass === "badge-auto"
                          ? "bg-accent/15 text-accent border border-accent/30"
                          : item.badgeClass === "badge-dispatch"
                          ? "bg-cyan/15 text-cyan border border-cyan/30"
                          : item.badgeClass === "badge-claim"
                          ? "bg-gold/15 text-gold border border-gold/30"
                          : "bg-danger/15 text-danger border border-danger/30"
                      }`}
                    >
                      {item.processType}
                    </span>
                    {hasCustomResponse && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-cyan/15 border border-cyan/30 px-2.5 py-0.5 text-[11px] font-bold text-cyan">
                        <PenLine className="size-3" />
                        مقترح مخصص مسجل
                      </span>
                    )}
                  </div>

                  {item.decisionNote && (
                    <span className="rounded-full bg-gold/10 border border-gold/30 px-3 py-1 text-[11px] font-medium text-gold">
                      {item.decisionNote}
                    </span>
                  )}
                </div>

                {/* Scenario Title */}
                <h2 className="text-lg sm:text-xl font-bold text-ink mb-3 leading-snug">
                  {item.title}
                </h2>

                {/* Scenario Context Box */}
                <div className="rounded-xl border border-line/60 bg-bg2/80 p-4 mb-5 text-xs sm:text-sm text-ink/90 leading-relaxed">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted mb-1.5">
                    <BookOpen className="size-3.5 text-cyan" />
                    السياق التشغيلي الميداني:
                  </div>
                  <p className="text-muted/95 light:text-muted leading-relaxed">{item.scenario}</p>
                </div>

                {/* MCQ Question Box */}
                <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 mb-5">
                  <div className="flex items-start gap-2.5">
                    <HelpCircle className="size-4 text-accent shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-accent uppercase tracking-wide mb-1">
                        السؤال التشغيلي (MCQ):
                      </div>
                      <p className="text-sm sm:text-base font-bold text-ink leading-relaxed">
                        {item.question}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 4 Options Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  {item.options.map((optionText, optIdx) => {
                    const isOptionCorrect = optIdx === item.correctIndex;
                    const isOptionSelected = userAnswer === optIdx;

                    let btnStyle = "border-line/70 bg-bg2/60 text-ink/90 hover:border-accent/60 hover:bg-card";

                    if (mode === "review") {
                      if (isOptionCorrect) {
                        btnStyle = "border-accent bg-accent/15 text-accent font-semibold ring-1 ring-accent";
                      }
                    } else if (hasAnswered) {
                      if (isOptionCorrect) {
                        btnStyle = "border-accent bg-accent/20 light:bg-accent/10 text-accent font-semibold ring-1 ring-accent";
                      } else if (isOptionSelected) {
                        btnStyle = "border-danger bg-danger/20 text-danger font-semibold ring-1 ring-danger";
                      } else {
                        btnStyle = "border-line/40 bg-bg2/40 text-muted/60 light:text-muted opacity-60";
                      }
                    }

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => handleSelectOption(item.flowNumber, optIdx)}
                        disabled={mode === "review"}
                        className={`flex items-start gap-3 rounded-xl border p-3.5 text-right text-xs sm:text-sm transition duration-150 ${btnStyle}`}
                      >
                        <span
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            (mode === "review" && isOptionCorrect) || (hasAnswered && isOptionCorrect)
                              ? "bg-accent text-accent-ink font-extrabold"
                              : hasAnswered && isOptionSelected
                              ? "bg-danger text-accent-ink font-extrabold"
                              : "bg-card border border-line text-muted"
                          }`}
                        >
                          {(mode === "review" && isOptionCorrect) || (hasAnswered && isOptionCorrect) ? (
                            <Check className="size-3.5 stroke-[3]" />
                          ) : hasAnswered && isOptionSelected ? (
                            "✕"
                          ) : (
                            optLetters[optIdx]
                          )}
                        </span>
                        <span className="leading-relaxed flex-1">{optionText}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Explanation & Answer Key (Revealed in review mode OR after user answers in quiz mode) */}
                {(mode === "review" || hasAnswered) && (
                  <div
                    className={`rounded-xl border p-4 mb-4 transition ${
                      isCorrect || mode === "review"
                        ? "border-accent/40 bg-accent/5"
                        : "border-danger/40 bg-danger/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {mode === "quiz" ? (
                        isCorrect ? (
                          <>
                            <CheckCircle2 className="size-4 text-accent" />
                            <span className="text-xs font-bold text-accent">إجابة صحيحة ومطابقة للنظام!</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="size-4 text-danger" />
                            <span className="text-xs font-bold text-danger">إجابة خاطئة! الإجابة المعتمدة موضحة أدناه:</span>
                          </>
                        )
                      ) : (
                        <>
                          <CheckCircle2 className="size-4 text-accent" />
                          <span className="text-xs font-bold text-accent">الإجابة الصحيحة المعتمدة من منصة JR:</span>
                        </>
                      )}
                    </div>

                    <p className="text-xs sm:text-sm font-bold text-ink mb-2">
                      ({optLetters[item.correctIndex]}) {item.answerText}
                    </p>

                    <div className="text-xs text-muted leading-relaxed border-t border-line/40 pt-2.5">
                      <strong className="text-ink">التبرير والشرح التشغيلي والمالي: </strong>
                      {item.explanation}
                    </div>

                    {item.actors && item.actors.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-2 border-t border-line/30">
                        <span className="text-[11px] text-muted font-medium">الأطراف المعنية:</span>
                        {item.actors.map((actor, aIdx) => (
                          <span
                            key={aIdx}
                            className="rounded-full bg-card border border-line px-2.5 py-0.5 text-[10px] text-ink"
                          >
                            {actor}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── CUSTOM RESPONSE SECTION ── */}
                <div className="rounded-xl border border-line/80 bg-bg2/40 p-4 mb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-cyan">
                      <MessageSquarePlus className="size-4 text-cyan" />
                      إجابتك أو مقترحك المخصص (Custom Response)
                    </span>

                    {!isEditingThisCustom && (
                      <button
                        type="button"
                        onClick={() => startEditCustom(item)}
                        className="inline-flex items-center gap-1 text-xs text-cyan hover:text-accent font-medium transition"
                      >
                        <PenLine className="size-3.5" />
                        <span>{hasCustomResponse ? "تعديل المقترح" : "✍️ كتابة إجابة مخصصة"}</span>
                      </button>
                    )}
                  </div>

                  {/* Display existing custom response when not editing */}
                  {!isEditingThisCustom && (
                    <>
                      {hasCustomResponse ? (
                        <div className="rounded-lg border border-cyan/30 bg-cyan/10 p-3 text-xs sm:text-sm">
                          <div className="text-[11px] text-muted mb-1 flex items-center justify-between">
                            <span>المقترح المسجل:</span>
                            {item.customResponseBy && (
                              <span className="font-semibold text-cyan">بواسطة: {item.customResponseBy}</span>
                            )}
                          </div>
                          <p className="text-ink whitespace-pre-wrap leading-relaxed">
                            {item.customResponse}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted/70 light:text-muted italic">
                          لم يتم تسجيل مقترح مخصص لهذا السيناريو بعد. انقر على &quot;كتابة إجابة مخصصة&quot; لتدوين تحليلك أو حلك المقترح وتخزينه في قاعدة البيانات.
                        </p>
                      )}
                    </>
                  )}

                  {/* Custom Response Edit Form */}
                  {isEditingThisCustom && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">
                          نص الإجابة المخصصة أو التوصية البديلة:
                        </label>
                        <textarea
                          rows={3}
                          placeholder="اكتب حلك أو وجهة نظرك التشغيلية لهذا السيناريو (مثال: اقتراح تطبيق تسوية مختلفة، أو إضافة شرط جزائي، أو إجراء وقائي ميداني)..."
                          value={customTextDraft[item.flowNumber] ?? ""}
                          onChange={(e) =>
                            setCustomTextDraft((prev) => ({ ...prev, [item.flowNumber]: e.target.value }))
                          }
                          className="w-full rounded-xl border border-line bg-card p-3 text-xs sm:text-sm text-ink placeholder:text-muted/60 focus:border-cyan focus:outline-none transition"
                        />
                      </div>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                        <div className="sm:max-w-xs flex-1">
                          <input
                            type="text"
                            placeholder="اسم الكاتب أو المسمى (مثال: مدير المستودع)"
                            value={customAuthorDraft[item.flowNumber] ?? ""}
                            onChange={(e) =>
                              setCustomAuthorDraft((prev) => ({ ...prev, [item.flowNumber]: e.target.value }))
                            }
                            className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-ink placeholder:text-muted/60 focus:border-cyan focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveCustomResponse(item.flowNumber)}
                            disabled={isSavingCustom[item.flowNumber]}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan px-4 py-1.5 text-xs font-bold text-accent-ink hover:brightness-110 transition disabled:opacity-50"
                          >
                            <Save className="size-3.5" />
                            <span>{isSavingCustom[item.flowNumber] ? "جاري الحفظ..." : "حفظ المقترح"}</span>
                          </button>

                          {hasCustomResponse && (
                            <button
                              type="button"
                              onClick={() => {
                                setCustomTextDraft((prev) => ({ ...prev, [item.flowNumber]: "" }));
                                saveCustomResponse(item.flowNumber);
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs text-danger hover:bg-danger/10 transition"
                              title="مسح الإجابة المخصصة"
                            >
                              <Trash2 className="size-3.5" />
                              <span>مسح</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => cancelEditCustom(item.flowNumber)}
                            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-ink transition"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {customSuccessMessage[item.flowNumber] && (
                    <div className="mt-2 text-xs font-semibold text-accent flex items-center gap-1">
                      <CheckCircle2 className="size-3.5" />
                      <span>{customSuccessMessage[item.flowNumber]}</span>
                    </div>
                  )}
                </div>

                {/* Collapsible Deep Operational & Tech Details */}
                <div className="border-t border-line/60 pt-3">
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.flowNumber)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-muted hover:text-accent transition py-1"
                  >
                    <span className="flex items-center gap-1.5">
                      <Cpu className="size-3.5 text-cyan" />
                      التفاصيل التقنية، استدعاء الـ API، والحسابات المالية
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="mt-4 space-y-4 rounded-xl bg-bg2/50 border border-line/60 p-4 text-xs">
                      {/* Steps sequence */}
                      {item.steps && item.steps.length > 0 && (
                        <div>
                          <div className="font-bold text-ink mb-2 flex items-center gap-1">
                            <span className="size-2 rounded-full bg-accent" />
                            الخطوات التشغيلية والبرمجية:
                          </div>
                          <ol className="list-decimal list-inside space-y-1.5 text-muted leading-relaxed pr-1">
                            {item.steps.map((st, sIdx) => (
                              <li key={sIdx} className="text-ink/90">
                                <span>{st}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {/* State Machine Transition */}
                      <div>
                        <div className="font-bold text-ink mb-1.5 flex items-center gap-1">
                          <span className="size-2 rounded-full bg-cyan" />
                          تحولات الحالة البرمجية (Platform State Machine):
                        </div>
                        <div className="rounded-lg bg-bg border border-line p-2.5 font-mono text-[11px] text-cyan whitespace-pre-wrap ltr-num text-left">
                          {item.techState}
                        </div>
                      </div>

                      {/* API Call */}
                      <div>
                        <div className="font-bold text-ink mb-1.5 flex items-center gap-1">
                          <span className="size-2 rounded-full bg-accent" />
                          استدعاء الواجهة البرمجية (API Call):
                        </div>
                        <div className="rounded-lg bg-bg border border-line p-2.5 font-mono text-[11px] text-accent whitespace-pre-wrap ltr-num text-left">
                          {item.apiCode}
                        </div>
                      </div>

                      {/* Financial Math Table */}
                      {item.finMath && item.finMath.length > 0 && (
                        <div>
                          <div className="font-bold text-ink mb-1.5 flex items-center gap-1">
                            <span className="size-2 rounded-full bg-gold" />
                            الأثر المالي والعمليات الحسابية:
                          </div>
                          <div className="overflow-x-auto rounded-lg border border-line">
                            <table className="w-full text-right text-xs">
                              <thead className="bg-card text-muted border-b border-line">
                                <tr>
                                  <th className="p-2.5 font-semibold">البند / العملية المالية</th>
                                  <th className="p-2.5 font-semibold">القيمة والأثر</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line/40">
                                {item.finMath.map((m, mIdx) => (
                                  <tr key={mIdx} className="hover:bg-card/40">
                                    <td className="p-2.5 text-muted">{m.label}</td>
                                    <td className="p-2.5 font-semibold text-accent ltr-num">{m.val}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="mt-16 border-t border-line/60 bg-bg2/80 py-8 text-center text-xs text-muted">
        <div className="mx-auto max-w-7xl px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© 2026 منصة JR Logistics. كافة الحقوق محفوظة وموثقة في قاعدة البيانات.</p>
          <div className="flex items-center gap-4">
            <a href="/api/v1/scenarios/export?format=csv" download className="hover:text-accent transition">
              تصدير CSV (78 سيناريو)
            </a>
            <span>•</span>
            <a href="/api/v1/scenarios/export?format=md" download className="hover:text-cyan transition">
              تصدير Markdown
            </a>
            <span>•</span>
            <a href="/flows-ar.html" target="_blank" rel="noopener noreferrer" className="hover:text-gold transition">
              لوحة المخططات التفاعلية
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
