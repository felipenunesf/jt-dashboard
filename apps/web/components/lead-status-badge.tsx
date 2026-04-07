const STATUS_STYLES: Record<string, { label: string; className: string }> = {
  opened: {
    label: 'Aberto',
    className: 'bg-slate-100 text-slate-700',
  },
  qualified: {
    label: 'Qualificado',
    className: 'bg-amber-50 text-amber-700',
  },
  purchased: {
    label: 'Comprou',
    className: 'bg-emerald-50 text-emerald-700',
  },
  lost: {
    label: 'Perdido',
    className: 'bg-rose-50 text-rose-700',
  },
};

export function LeadStatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? {
    label: status,
    className: 'bg-slate-100 text-slate-600',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}
