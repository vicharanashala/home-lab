import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Home, ShoppingCart, Refrigerator, Bell, Settings, MapPin, Sparkles, Bot, Globe } from 'lucide-react';
import clsx from 'clsx';
import { useStore } from '../store/useStore';
import { useMemo } from 'react';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  /** When true, click triggers a full page reload instead of client-side nav.
   *  Used for routes that crash under client-side routing (#300). */
  hardNav?: boolean;
}

const items: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/discover', label: 'Discover', icon: Sparkles },
  { to: '/grocery', label: 'Grocery', icon: ShoppingCart },
  { to: '/stock', label: 'Stock', icon: Refrigerator },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/house-bot', label: 'House Bot', icon: Bot, hardNav: true },
];

export function BottomNav() {
  const { stock, grocery } = useStore();
  const location = useLocation();

  // All hooks must run on every render in the same order — never put them after
  // a conditional return (would trip React's "Rendered more/fewer hooks than
  // during the previous render" rule and crash client-side nav).
  const alertsCount = useMemo(() => {
    let n = 0;
    for (const it of stock) {
      if (it.quantity <= it.lowStockThreshold) n++;
    }
    return n;
  }, [stock]);

  const groceryCount = useMemo(
    () => grocery.filter((g) => !g.purchased).length,
    [grocery],
  );

  // Hide bottom nav on full-screen routes (House Bot chat takes the whole screen).
  if (location.pathname === '/house-bot') return null;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-[10000] sm:hidden">
      <div className="mx-auto max-w-screen-sm">
        <div className="m-3 rounded-3xl bg-white/85 dark:bg-ink-800/90 shadow-pop border border-sage-100/80 dark:border-ink-700 backdrop-blur-xl">
          <ul className="flex items-stretch justify-between px-1 py-1">
            {items.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.to;
              const badge =
                item.to === '/alerts'
                  ? alertsCount
                  : item.to === '/grocery'
                  ? groceryCount
                  : 0;
              return (
                <li key={item.to} className="flex-1">
                  {item.hardNav ? (
                    <a
                      href={item.to}
                      className={clsx(
                        'nav-item relative',
                        active
                          ? 'text-sage-700 dark:text-sage-300'
                          : 'text-sage-400 dark:text-ink-400',
                      )}
                    >
                      <div
                        className={clsx(
                          'relative w-11 h-8 rounded-full flex items-center justify-center transition-all duration-200',
                          active && 'bg-sage-100 dark:bg-sage-900/40',
                        )}
                      >
                        <Icon size={19} strokeWidth={active ? 2.5 : 2} />
                      </div>
                      <span
                        className={clsx(
                          'text-[10px] font-semibold',
                          active && 'text-sage-800 dark:text-cream-50',
                        )}
                      >
                        {item.label}
                      </span>
                    </a>
                  ) : (
                    <NavLink
                      to={item.to}
                      className={clsx(
                        'nav-item relative',
                        active
                          ? 'text-sage-700 dark:text-sage-300'
                          : 'text-sage-400 dark:text-ink-400',
                      )}
                    >
                      <div
                        className={clsx(
                          'relative w-11 h-8 rounded-full flex items-center justify-center transition-all duration-200',
                          active && 'bg-sage-100 dark:bg-sage-900/40',
                        )}
                      >
                        <Icon size={19} strokeWidth={active ? 2.5 : 2} />
                        {badge > 0 && (
                          <span
                            className={clsx(
                              'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center text-white shadow-sm',
                              item.to === '/alerts' ? 'bg-tomato-500' : 'bg-sage-600',
                            )}
                          >
                            {badge > 99 ? '99+' : badge}
                          </span>
                        )}
                      </div>
                      <span
                        className={clsx(
                          'text-[10px] font-semibold',
                          active && 'text-sage-800 dark:text-cream-50',
                        )}
                      >
                        {item.label}
                      </span>
                    </NavLink>
                  )}
                </li>
              );
            })}
            {/* Stores button removed from mobile nav — reachable via Dashboard card or SideNav on desktop. */}
          </ul>
        </div>
      </div>
      {/* safe-area spacer */}
      <div className="h-[env(safe-area-inset-bottom)] bg-cream-50 dark:bg-ink-900" />
    </nav>
  );
}

export function SideNav() {
  const { stock, grocery } = useStore();
  const location = useLocation();
  const navigate = useNavigate();

  const goToStores = () => {
    navigate('/stores');
  };

  const alertsCount = useMemo(
    () => stock.filter((it) => it.quantity <= it.lowStockThreshold).length,
    [stock],
  );
  const groceryCount = useMemo(
    () => grocery.filter((g) => !g.purchased).length,
    [grocery],
  );

  // Hide side nav on full-screen routes (House Bot chat).
  if (location.pathname === '/house-bot') return null;

  return (
    <aside className="hidden sm:flex sticky top-0 h-screen w-60 shrink-0 flex-col px-4 py-6 border-r border-sage-100 dark:border-ink-700 bg-white/70 dark:bg-ink-800/70 backdrop-blur-md transition-colors duration-300">
      <div className="flex items-center gap-2 px-2 mb-8">
        <div className="w-9 h-9 rounded-xl bg-sage-600 text-white grid place-items-center shadow-soft">
          <Home size={19} />
        </div>
        <div className="font-display font-extrabold text-lg text-sage-900 dark:text-cream-50 tracking-tight">
          HomeHub
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = location.pathname === item.to;
          const badge =
            item.to === '/alerts'
              ? alertsCount
              : item.to === '/grocery'
              ? groceryCount
              : 0;
          const baseClass = clsx(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold transition-all duration-200 lift',
            active
              ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-800 dark:text-cream-50'
              : 'text-sage-600 dark:text-ink-300 hover:bg-sage-50 dark:hover:bg-ink-700 hover:text-sage-800 dark:hover:text-cream-50',
          );
          return (
            <li key={item.to}>
              {item.hardNav ? (
                <a href={item.to} className={baseClass}>
                  <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                  <span className="flex-1">{item.label}</span>
                </a>
              ) : (
                <NavLink to={item.to} className={baseClass}>
                  <Icon size={18} strokeWidth={active ? 2.5 : 2} />
                  <span className="flex-1">{item.label}</span>
                  {badge > 0 && (
                    <span
                      className={clsx(
                        'min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center text-white shadow-sm',
                        item.to === '/alerts' ? 'bg-tomato-500' : 'bg-sage-600',
                      )}
                    >
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </NavLink>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-auto pt-6 space-y-2 px-2">
        <button
          type="button"
          onClick={goToStores}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold transition-all duration-200 lift text-sage-600 dark:text-ink-300 hover:bg-sage-50 dark:hover:bg-ink-700 hover:text-sage-800 dark:hover:text-cream-50"
        >
          <MapPin size={18} />
          <span>See near stores</span>
        </button>
        {/* The shops that come to the door, next to the ones you can walk into.
            Reached from the side nav only: the mobile bar has no room for
            seven items, and the physical stores are not in it either. */}
        <NavLink
          to="/digital-stores"
          className={({ isActive }) =>
            clsx(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold transition-all duration-200 lift',
              isActive
                ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-800 dark:text-cream-50'
                : 'text-sage-600 dark:text-ink-300 hover:bg-sage-50 dark:hover:bg-ink-700 hover:text-sage-800 dark:hover:text-cream-50',
            )
          }
        >
          <Globe size={18} />
          <span>Digital stores</span>
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold transition-all duration-200 lift',
              isActive
                ? 'bg-sage-100 dark:bg-sage-900/40 text-sage-800 dark:text-cream-50'
                : 'text-sage-600 dark:text-ink-300 hover:bg-sage-50 dark:hover:bg-ink-700 hover:text-sage-800 dark:hover:text-cream-50',
            )
          }
        >
          <Settings size={18} />
          <span>Settings</span>
        </NavLink>
        <p className="text-xs text-sage-500 dark:text-ink-400 leading-relaxed">
          Your groceries and kitchen stock, organized in one calm place.
        </p>
      </div>
    </aside>
  );
}
