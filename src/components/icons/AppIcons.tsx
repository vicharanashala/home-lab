/**
 * Custom icon set for the non-recipe parts of the UI: grocery categories,
 * meal types, store types, diet preferences and household members.
 *
 * Same drawing rules as the dish set so everything reads as one family:
 * 24x24, 1.75 stroke, round caps, `currentColor`.
 */

import type { SVGProps } from 'react';
import type { CategoryId, DietaryPreference, MealType } from '../../types';

type IconProps = { size?: number } & SVGProps<SVGSVGElement>;

const S = ({ size = 20, children, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

/* ── grocery categories ───────────────────────────────────────────────── */

export const VegetablesIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M5 20c0-7 4.5-12 14-12.5C19.5 15.5 15.5 20 9 20H5Z" />
    <path d="M5 20 11 13" />
  </S>
);

export const FruitsIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="14.5" cy="14" r="6" />
    <path d="M14.5 8c0-2 1-3.5 3-4" />
  </S>
);

export const DairyIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M8 3h8l-1 4H9Z" />
    <path d="M7 7h10l-1 12.5a2 2 0 0 1-2 1.5h-4a2 2 0 0 1-2-1.5Z" />
    <path d="M6.5 13.5h11" />
  </S>
);

export const MeatIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M13 4a6 6 0 0 1 7 7c0 3.5-3 6-6.5 6-2 0-3.5-1.5-3.5-3.5C10 10 12 7 13 4Z" />
    <path d="m8 15-5 6" />
  </S>
);

export const SeafoodIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M20 6.5c-6 .5-10.5 3-12.8 7-1.7 3-.6 6 2 6.7 3.4.9 6.6-1.7 7.3-5.6.5-2.8-.4-5.4 1.5-8.1" />
    <path d="M4 20h4" />
  </S>
);

export const BakeryIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 14c0-4.5 3.6-8 8-8s8 3.5 8 8Z" />
    <path d="M4 14h16v3.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
  </S>
);

export const GrainsIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M12 21V9" />
    <path d="M12 9c0-2.2 1.3-4 3-4 0 2.2-1.3 4-3 4ZM12 9c0-2.2-1.3-4-3-4 0 2.2 1.3 4 3 4Z" />
    <path d="M12 14.5c0-2.2 1.3-4 3-4 0 2.2-1.3 4-3 4ZM12 14.5c0-2.2-1.3-4-3-4 0 2.2 1.3 4 3 4Z" />
  </S>
);

export const BeveragesIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M6 4h12l-1 16a2 2 0 0 1-2 1.5H9a2 2 0 0 1-2-1.5Z" />
    <path d="M6.3 9.5h11.4" />
  </S>
);

export const SnacksIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="11.5" cy="15" r="1" fill="currentColor" stroke="none" />
  </S>
);

export const FrozenIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M12 3v18M4 7.5l16 9M20 7.5l-16 9" />
    <path d="M12 6.5 9.5 4M12 6.5 14.5 4M12 17.5 9.5 20M12 17.5 14.5 20" />
  </S>
);

export const CondimentsIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M9 3h6v4l2 2v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9l2-2Z" />
    <path d="M7 14h10" />
  </S>
);

export const HouseholdIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 11 12 4l8 7" />
    <path d="M6 10.5V20h12v-9.5" />
    <path d="M10.5 20v-5h3v5" />
  </S>
);

export const OtherIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </S>
);

const CATEGORY_ICON: Record<CategoryId, (p: IconProps) => JSX.Element> = {
  vegetables: VegetablesIcon,
  fruits: FruitsIcon,
  dairy: DairyIcon,
  meat: MeatIcon,
  seafood: SeafoodIcon,
  bakery: BakeryIcon,
  grains: GrainsIcon,
  beverages: BeveragesIcon,
  snacks: SnacksIcon,
  frozen: FrozenIcon,
  condiments: CondimentsIcon,
  household: HouseholdIcon,
  other: OtherIcon,
};

export function CategoryIcon({
  id,
  size = 20,
  className,
}: {
  id: CategoryId;
  size?: number;
  className?: string;
}) {
  const Icon = CATEGORY_ICON[id] ?? OtherIcon;
  return <Icon size={size} className={className} />;
}

/* ── meal types ───────────────────────────────────────────────────────── */

export const SunriseIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3 17h18M6.5 17a5.5 5.5 0 0 1 11 0" />
    <path d="M12 3v3M5 6.5l2 2M19 6.5l-2 2" />
  </S>
);

export const SunIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
  </S>
);

export const MoonIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </S>
);

export const CookieIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="9.5" cy="10" r=".9" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="11" r=".9" fill="currentColor" stroke="none" />
    <circle cx="11" cy="15.5" r=".9" fill="currentColor" stroke="none" />
  </S>
);

export const CakeIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 20h16v-5a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3Z" />
    <path d="M4 16.5c1.5 1 3-1 4.5 0s3-1 4.5 0 3-1 4.5 0" />
    <path d="M8 12V9M12 12V9M16 12V9" />
  </S>
);

const MEAL_ICON: Record<MealType, (p: IconProps) => JSX.Element> = {
  breakfast: SunriseIcon,
  lunch: SunIcon,
  dinner: MoonIcon,
  snack: CookieIcon,
  sweet: CakeIcon,
};

export function MealTypeIcon({
  type,
  size = 20,
  className,
}: {
  type?: MealType;
  size?: number;
  className?: string;
}) {
  const Icon = (type && MEAL_ICON[type]) || SunIcon;
  return <Icon size={size} className={className} />;
}

/* ── store types ──────────────────────────────────────────────────────── */

export const StorefrontIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5" />
    <path d="M3 9.5 5 4h14l2 5.5a3 3 0 0 1-5 1.5 3 3 0 0 1-4 0 3 3 0 0 1-4 0 3 3 0 0 1-5-1.5Z" />
  </S>
);

export const CartIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3 4h2l2.2 10.5a2 2 0 0 0 2 1.5h7.3a2 2 0 0 0 2-1.6L20 8H6" />
    <circle cx="10" cy="20" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="17" cy="20" r="1.2" fill="currentColor" stroke="none" />
  </S>
);

export const KiranaIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 20V9.5L12 4l8 5.5V20" />
    <path d="M9 20v-6h6v6" />
  </S>
);

export const PharmacyIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 20V9l8-5 8 5v11" />
    <path d="M12 9v6M9 12h6" />
  </S>
);

export function StoreTypeIcon({
  type,
  size = 20,
  className,
}: {
  type?: string;
  size?: number;
  className?: string;
}) {
  if (type === 'kirana') return <KiranaIcon size={size} className={className} />;
  if (type === 'pharmacy' || type === 'clinic') return <PharmacyIcon size={size} className={className} />;
  if (type === 'supermarket' || type === 'grocery') return <CartIcon size={size} className={className} />;
  return <StorefrontIcon size={size} className={className} />;
}

/* ── diet ─────────────────────────────────────────────────────────────── */

export const VegIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M5 20c0-7 4.5-12 14-12.5C19.5 15.5 15.5 20 9 20H5Z" />
    <path d="M5 20 11 13" />
  </S>
);

export const NonVegIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M13 5a6 6 0 0 1 7 7c0 3.5-3 6-6.5 6-2 0-3.5-1.5-3.5-3.5C10 11 12 8 13 5Z" />
    <path d="m8 16-5 5" />
  </S>
);

export const VeganIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M12 20V9" />
    <path d="M12 9c0-3 2.5-5.5 6-5.5 0 3.2-2.5 5.5-6 5.5Z" />
    <path d="M12 13.5c-2.5 0-4.5-2-4.5-4.5 2.7 0 4.5 2 4.5 4.5Z" />
  </S>
);

export const NoPreferenceIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12h7" />
  </S>
);

export function DietIcon({
  diet,
  size = 20,
  className,
}: {
  diet?: DietaryPreference;
  size?: number;
  className?: string;
}) {
  if (diet === 'vegetarian') return <VegIcon size={size} className={className} />;
  if (diet === 'vegan') return <VeganIcon size={size} className={className} />;
  if (diet === 'non-vegetarian') return <NonVegIcon size={size} className={className} />;
  return <NoPreferenceIcon size={size} className={className} />;
}

/* ── household members ────────────────────────────────────────────────── */

export const AdultIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="6" r="3.2" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </S>
);

export const TeenIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="7.5" r="3" />
    <path d="M7 20a5 5 0 0 1 10 0" />
  </S>
);

export const ChildIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="9" r="2.7" />
    <path d="M8.5 20a3.5 3.5 0 0 1 7 0" />
  </S>
);

export const ToddlerIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="10.5" r="2.4" />
    <path d="M9.5 20a2.5 2.5 0 0 1 5 0" />
  </S>
);

export function HouseholdMemberIcon({
  kind,
  size = 20,
  className,
}: {
  kind: 'adults' | 'teens' | 'children' | 'toddlers';
  size?: number;
  className?: string;
}) {
  if (kind === 'teens') return <TeenIcon size={size} className={className} />;
  if (kind === 'children') return <ChildIcon size={size} className={className} />;
  if (kind === 'toddlers') return <ToddlerIcon size={size} className={className} />;
  return <AdultIcon size={size} className={className} />;
}