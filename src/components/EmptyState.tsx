import type { ComponentType } from 'react';

interface Props {
  /** Any Lucide icon component. Takes the place of the old emoji prop. */
  icon: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, hint, action }: Props) {
  return (
    <div className="card text-center py-12 px-6 animate-fade-in">
      <span className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sage-50 dark:bg-sage-900/30 text-sage-600 dark:text-sage-300 mb-3">
        <Icon size={28} />
      </span>
      <h3 className="font-display text-lg font-bold text-sage-900 dark:text-cream-50">{title}</h3>
      {hint && <p className="text-sm text-sage-500 mt-1 max-w-xs mx-auto">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}