import {
  Plus,
  ShoppingCart,
  Refrigerator,
  Settings as SettingsIcon,
  Home,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState, ReactNode } from 'react';
import { AddGroceryModal } from './AddGroceryModal';
import { AddStockModal } from './AddStockModal';
import { ThemeToggle } from './ThemeToggle';

interface Props {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
  hideAddButton?: boolean;
}

export function TopBar({ title, subtitle, rightSlot, hideAddButton }: Props) {
  const navigate = useNavigate();
  const [openMenu, setOpenMenu] = useState(false);
  const [openGrocery, setOpenGrocery] = useState(false);
  const [openStock, setOpenStock] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 glass pt-safe">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3.5 flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="sm:hidden w-10 h-10 rounded-xl bg-sage-600 text-white grid place-items-center shadow-soft active:scale-95 transition-transform"
            aria-label="Home"
          >
            <Home size={19} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-extrabold text-lg sm:text-xl text-sage-900 dark:text-cream-50 truncate tracking-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-sage-500 dark:text-ink-300 truncate -mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <ThemeToggle />
          <button
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            className="btn-icon bg-sage-50 dark:bg-ink-700 text-sage-700 dark:text-cream-100 hover:bg-sage-100 dark:hover:bg-ink-600"
          >
            <SettingsIcon size={18} />
          </button>
          {rightSlot}
          {!hideAddButton && (
          <div className="relative">
            <button
              onClick={() => setOpenMenu((v) => !v)}
              className="btn-primary !py-2.5 !px-3 sm:!px-4 text-sm"
              aria-label="Add item"
            >
              <Plus size={18} strokeWidth={2.5} />
              <span className="hidden sm:inline">Add</span>
            </button>
            {openMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setOpenMenu(false)}
                />
                <div className="absolute right-0 mt-2 z-50 w-56 rounded-2xl bg-white dark:bg-ink-800 shadow-pop border border-sage-100 dark:border-ink-700 overflow-hidden animate-scale-in origin-top-right">
                  <button
                    onClick={() => {
                      setOpenMenu(false);
                      setOpenGrocery(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-sage-50 dark:hover:bg-ink-700 transition-colors"
                  >
                    <span className="w-9 h-9 rounded-xl bg-sage-100 dark:bg-sage-900/30 text-sage-700 dark:text-sage-300 grid place-items-center">
                      <ShoppingCart size={18} />
                    </span>
                    <span>
                      <span className="block font-semibold text-sage-900 dark:text-cream-50 text-sm">
                        Add Grocery
                      </span>
                      <span className="block text-xs text-sage-500 dark:text-ink-300">
                        Shopping list item
                      </span>
                    </span>
                  </button>
                  <div className="h-px bg-sage-100 dark:bg-ink-700" />
                  <button
                    onClick={() => {
                      setOpenMenu(false);
                      setOpenStock(true);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-sage-50 dark:hover:bg-ink-700 transition-colors"
                  >
                    <span className="w-9 h-9 rounded-xl bg-butter-100 dark:bg-butter-900/30 text-butter-700 dark:text-butter-300 grid place-items-center">
                      <Refrigerator size={18} />
                    </span>
                    <span>
                      <span className="block font-semibold text-sage-900 dark:text-cream-50 text-sm">
                        Add Stock
                      </span>
                      <span className="block text-xs text-sage-500 dark:text-ink-300">
                        Item you already have
                      </span>
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
          )}
        </div>
      </header>

      <AddGroceryModal open={openGrocery} onClose={() => setOpenGrocery(false)} />
      <AddStockModal open={openStock} onClose={() => setOpenStock(false)} />
    </>
  );
}
