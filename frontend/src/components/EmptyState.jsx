import { Inbox } from "lucide-react";

export function EmptyState({ icon: Icon = Inbox, title, desc, children, testid }) {
  return (
    <div data-testid={testid} className="card-surface p-10 text-center flex flex-col items-center gap-3">
      <div className="w-14 h-14 rounded-2xl bg-navy-700/70 border border-navy-600/60 flex items-center justify-center">
        <Icon className="w-6 h-6 text-slate-500" />
      </div>
      <p className="font-heading font-bold text-slate-200">{title}</p>
      {desc && <p className="text-sm text-slate-500 max-w-md">{desc}</p>}
      {children}
    </div>
  );
}
