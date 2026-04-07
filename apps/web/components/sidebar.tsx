'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/lib/actions';

const NAV_ITEMS = [
  { href: '/', label: 'Visão geral', icon: '◈' },
  { href: '/ads', label: 'Anúncios', icon: '▤' },
  { href: '/leads', label: 'Leads', icon: '◉' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 bg-white border-r border-slate-200 flex flex-col">
      <div className="px-6 py-6 border-b border-slate-200 flex items-center gap-3">
        <Image src="/logo-jt.png" alt="JT" width={40} height={40} />
        <div>
          <p className="text-sm font-semibold text-slate-900">JT Dashboard</p>
          <p className="text-xs text-slate-500">Advocacia Médica</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <form action={logoutAction} className="p-3 border-t border-slate-200">
        <button
          type="submit"
          className="w-full px-3 py-2 text-sm text-slate-600 hover:text-slate-900 text-left rounded-lg hover:bg-slate-100"
        >
          ↩ Sair
        </button>
      </form>
    </aside>
  );
}
