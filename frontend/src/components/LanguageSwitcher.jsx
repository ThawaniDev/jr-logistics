import { useI18n } from "@/i18n";
import { Languages } from "lucide-react";

export function LanguageSwitcher({ compact = false }) {
  const { lang, setLang, LANGS } = useI18n();
  return (
    <div className="relative" data-testid="language-switcher">
      <Languages className="w-4 h-4 text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
      <select
        data-testid="language-select"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className="bg-navy-800 border border-navy-600 rounded-xl ps-8 pe-3 py-2 text-xs font-semibold text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer appearance-none"
        aria-label="Language"
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code} data-testid={`lang-${l.code}`}>{l.label}</option>
        ))}
      </select>
    </div>
  );
}
