import { Link } from "react-router-dom";

export function StatCard({ icon: Icon, label, value, sub, tone = "brand", testid, to }) {
  const tones = {
    brand: "from-brand/15 to-transparent text-brand",
    gold: "from-amber-500/15 to-transparent text-amber-400",
    blue: "from-blue-500/15 to-transparent text-blue-400",
    cyan: "from-cyan-500/15 to-transparent text-cyan-400",
  };
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-400">{label}</p>
          <p className="text-2xl font-heading font-extrabold mt-1 text-slate-50">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className="w-11 h-11 rounded-xl bg-navy-700/80 border border-navy-600/60 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </>
  );
  const cls = `card-surface card-surface-hover p-5 bg-gradient-to-bl ${tones[tone]} block`;
  if (to) return <Link to={to} data-testid={testid} className={cls}>{inner}</Link>;
  return <div data-testid={testid} className={cls}>{inner}</div>;
}
