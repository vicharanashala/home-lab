/**
 * Custom dish icon set.
 *
 * Hand-drawn SVGs replacing the emoji that used to sit next to every recipe.
 * Drawn to match the weight of the Lucide icons the app already uses —
 * 24x24 grid, 1.75 stroke, round caps and joins, `currentColor` so they tint
 * with whatever text colour surrounds them.
 *
 * There is exactly one icon per distinct emoji in the recipe data (32 of
 * them), so a recipe never falls back to a generic glyph when we knew better.
 */

import type { SVGProps } from 'react';
import type { MealType, Recipe } from '../../types';

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

/* ── the set ─────────────────────────────────────────────────────────── */

export const CoffeeIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
    <path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17" />
    <path d="M7.5 3v2.5M11 3v2.5M14.5 3v2.5" />
  </S>
);

export const PlainIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
  </S>
);

export const ChiliIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M15 4c2.5 1.6 4 4.2 4 7a6 6 0 0 1-6 6c-3.3 0-6-2.7-6-6 0-3.5 2.6-6.4 8-7Z" />
    <path d="M15 4c0-1 .6-1.8 1.6-2" />
  </S>
);

export const WheatIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M12 21V9" />
    <path d="M12 9c0-2.2 1.3-4 3-4 0 2.2-1.3 4-3 4ZM12 9c0-2.2-1.3-4-3-4 0 2.2 1.3 4 3 4Z" />
    <path d="M12 14c0-2.2 1.3-4 3-4 0 2.2-1.3 4-3 4ZM12 14c0-2.2-1.3-4-3-4 0 2.2 1.3 4 3 4Z" />
  </S>
);

export const MushroomIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3.5 12a8.5 8.5 0 0 1 17 0Z" />
    <path d="M9.5 12v4.5a2.5 2.5 0 0 0 5 0V12" />
  </S>
);

export const LemonIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M12 3.5c4.7 0 8.5 3.8 8.5 8.5s-3.8 8.5-8.5 8.5S3.5 16.7 3.5 12 7.3 3.5 12 3.5Z" />
    <path d="M12 7.5V12l3 3" />
  </S>
);

export const BurgerIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 9.5a8 8 0 0 1 16 0" />
    <path d="M3.5 12.5h17" />
    <path d="M4.5 15.5h15a7 7 0 0 1-7 5 7 7 0 0 1-8-5Z" />
  </S>
);

export const ChickenIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M14.5 3.5a5.5 5.5 0 0 1 6 6c0 4-3.5 7-7.5 7-2.5 0-4-1.5-4-3.5 0-3.5 3-6.5 5.5-9.5Z" />
    <path d="m8 14.5-4.5 6" />
    <circle cx="4.5" cy="20" r="1.4" />
  </S>
);

export const RiceIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" />
    <path d="M12 7.5c1.5 0 2.5-1 2.5-2.5M9 7.5c0-1.5 1-2.5 2.5-2.5M13.5 6.5c1-.8 1.5-1.8 1.5-3" />
  </S>
);

export const CurryIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3 11.5h18a9 9 0 0 1-18 0Z" />
    <path d="M8 11.5a2 2 0 0 1 4 0M14 11a2 2 0 0 1 3.5 1.2" />
    <path d="M9.5 3.5c1.5 1.5 1.5 3 0 4.5M13.5 3.5c1.5 1.5 1.5 3 0 4.5" />
  </S>
);

export const PastaIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3.5 12h17a8.5 8.5 0 0 1-17 0Z" />
    <path d="M6.5 9c1.5-2 3-2 4.5 0s3 2 4.5 0M8 12c1.2-1.6 2.4-1.6 3.6 0" />
  </S>
);

export const SkewerIcon = (p: IconProps) => (
  <S {...p}>
    <path d="m4 20 16-16" />
    <rect x="12" y="4.2" width="6" height="4.6" rx="1.6" transform="rotate(45 15 6.5)" />
    <rect x="6.5" y="9.7" width="6" height="4.6" rx="1.6" transform="rotate(45 9.5 12)" />
  </S>
);

export const PrawnIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M20 6.5c-6 .5-10.5 3-12.8 7-1.7 3-.6 6 2 6.7 3.4.9 6.6-1.7 7.3-5.6.5-2.8-.4-5.4 1.5-8.1" />
    <path d="M14.5 11.5c1.5 0 3 .5 4 1.5M4 20h4" />
  </S>
);

export const PotIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 10.5h16v4.5a5.5 5.5 0 0 1-11 0Z" />
    <path d="M15 10.5v4.5a5.5 5.5 0 0 1-5 5" />
    <path d="M4 9.5 6 5h12l2 4.5" />
    <path d="M2.5 12.5h2M19.5 12.5h2M10 3.5h4" />
  </S>
);

export const EggIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3 13h18a9 9 0 0 1-18 0Z" />
    <path d="M20 13v3.5a2.5 2.5 0 0 1-2.5 2.5" />
    <circle cx="12" cy="8.5" r="2.2" fill="currentColor" stroke="none" />
  </S>
);

export const TeaIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M5 11h12v4.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V11Z" />
    <path d="M17 12.5h1.5a2.5 2.5 0 0 1 0 5H17" />
    <path d="M12 7.5c1.8-1.4 1.8-3.1 0-4.5" />
  </S>
);

export const PlateIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <path d="M4 4 7 7M20 4l-3 3" />
  </S>
);

export const PopcornIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M6 10h12l-1.2 9.5a2 2 0 0 1-2 1.5H9.2a2 2 0 0 1-2-1.5Z" />
    <path d="M6 10a6 6 0 0 1 12 0" />
    <circle cx="9.5" cy="8" r="1.4" />
    <circle cx="14.5" cy="8" r="1.4" />
    <circle cx="12" cy="5.8" r="1.4" />
  </S>
);

export const DropIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M12 3.5s6 6.4 6 10.2a6 6 0 0 1-12 0c0-3.8 6-10.2 6-10.2Z" />
  </S>
);

export const TriangleSnackIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M12 4.5 21 19H3l9-14.5Z" />
    <path d="M9 14.5h6" />
  </S>
);

export const DotIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none" />
  </S>
);

export const PotatoIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M8.5 5.5c4-2 9 .5 10.5 4.5s1 9-3 11.5-9-.5-10.5-4.5-1-9 3-11.5Z" />
    <circle cx="9.5" cy="10" r=".7" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="13" r=".7" fill="currentColor" stroke="none" />
    <circle cx="11" cy="16" r=".7" fill="currentColor" stroke="none" />
  </S>
);

export const SaladIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
    <path d="M7.5 11c.5-2.5 2.5-3.5 4-2M12 11.5c0-2.8 1.8-4.5 4-4M10 11.5c-.5-2-1.8-3-3.5-3" />
  </S>
);

export const CasseroleIcon = (p: IconProps) => (
  <S {...p}>
    <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />
    <path d="M3.5 9.5 2 8l1.5-2M20.5 9.5 22 8l-1.5-2" />
    <path d="M8 12.5c2.5-1.5 5.5-1.5 8 0" />
  </S>
);

export const MilkIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M8 3h8l-1 4h-6Z" />
    <path d="M7 7h10l-1 12.5a2 2 0 0 1-2 1.5h-4a2 2 0 0 1-2-1.5Z" />
    <path d="M6.5 13.5h11" />
  </S>
);

export const PancakeIcon = (p: IconProps) => (
  <S {...p}>
    <ellipse cx="12" cy="16.5" rx="8" ry="3" />
    <path d="M4.8 13.5a8 3 0 0 0 14.4 0" />
    <path d="M6.5 9.5a7 2.8 0 0 0 11 0" />
    <path d="M9 5.5a5 2.4 0 0 0 6 0" />
  </S>
);

export const BowlIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3.5 11h17a8.5 8.5 0 0 1-17 0Z" />
    <path d="M14 8.5 17.5 4" />
    <circle cx="9" cy="9" r=".9" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="10" r=".9" fill="currentColor" stroke="none" />
  </S>
);

export const SandwichIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M3.5 9 12 4l8.5 5v1.5h-17Z" />
    <path d="M3.5 12.5h17M3.5 15h17" />
    <path d="m4.5 17 15-1.5-1 3.5H5.5Z" />
  </S>
);

export const LeafyIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4.5 19.5c0-7 4.5-12 15-12.5.5 8-3.5 12.5-10 12.5-2 0-3.5 0-5 0Z" />
    <path d="M4.5 19.5 12 12" />
  </S>
);

export const BagelIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 4.2v.9M8 5.6l.5.8M16 5.6l-.5.8M6 10l.9.3M18 10l-.9.3" />
  </S>
);

export const FlatbreadIcon = (p: IconProps) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="9" cy="10" r="1" />
    <circle cx="15" cy="13" r="1" />
    <circle cx="13" cy="8.5" r=".8" />
    <circle cx="9.5" cy="15" r=".8" />
  </S>
);

export const LentilsIcon = (p: IconProps) => (
  <S {...p}>
    <path d="M4 15.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5Z" />
    <ellipse cx="8.5" cy="13.5" rx="1.6" ry="1.2" />
    <ellipse cx="14.5" cy="12.5" rx="1.6" ry="1.2" />
    <ellipse cx="11.5" cy="16" rx="1.6" ry="1.2" />
  </S>
);

/* ── emoji → icon ────────────────────────────────────────────────────── */

/** One icon per distinct emoji present in the recipe data. */
const BY_EMOJI: Record<string, (p: IconProps) => JSX.Element> = {
  '☕': CoffeeIcon,
  '⚪': PlainIcon,
  '🌶️': ChiliIcon,
  '🌾': WheatIcon,
  '🍄': MushroomIcon,
  '🍋': LemonIcon,
  '🍔': BurgerIcon,
  '🍗': ChickenIcon,
  '🍚': RiceIcon,
  '🍛': CurryIcon,
  '🍝': PastaIcon,
  '🍢': SkewerIcon,
  '🍤': PrawnIcon,
  '🍲': PotIcon,
  '🍳': EggIcon,
  '🍵': TeaIcon,
  '🍽️': PlateIcon,
  '🍿': PopcornIcon,
  '💧': DropIcon,
  '🔺': TriangleSnackIcon,
  '🟡': DotIcon,
  '🥔': PotatoIcon,
  '🥗': SaladIcon,
  '🥘': CasseroleIcon,
  '🥛': MilkIcon,
  '🥞': PancakeIcon,
  '🥣': BowlIcon,
  '🥪': SandwichIcon,
  '🥬': LeafyIcon,
  '🥯': BagelIcon,
  '🫓': FlatbreadIcon,
  '🫘': LentilsIcon,
};

/** Sensible defaults when a recipe has no emoji (or an unknown one). */
const BY_MEAL_TYPE: Record<MealType, (p: IconProps) => JSX.Element> = {
  breakfast: EggIcon,
  lunch: CurryIcon,
  dinner: RiceIcon,
  snack: SandwichIcon,
  sweet: PancakeIcon,
};

const FALLBACK = PlateIcon;

/**
 * Resolve the icon for a recipe. Prefers the recipe's own emoji (mapped to a
 * hand-drawn equivalent), then its meal type, then a neutral plate.
 *
 * Emoji without a mapping fall back rather than rendering the raw glyph, so
 * an unmapped value can never leak an emoji into the UI.
 */
export function dishIconFor(
  input: { emoji?: string; mealType?: MealType } | string | null | undefined,
): (p: IconProps) => JSX.Element {
  if (!input) return FALLBACK;
  if (typeof input === 'string') return BY_EMOJI[input] ?? FALLBACK;
  return BY_EMOJI[input.emoji ?? ''] ?? (input.mealType ? BY_MEAL_TYPE[input.mealType] : FALLBACK);
}

/** Convenience: does this emoji have a hand-drawn equivalent? */
export function hasDishIcon(emoji?: string): boolean {
  return !!emoji && emoji in BY_EMOJI;
}

/** Render the icon for a recipe at a given size. */
export function DishIcon({
  recipe,
  size = 20,
  className,
}: {
  recipe?: { emoji?: string; mealType?: MealType } | string | null;
  size?: number;
  className?: string;
}) {
  const Icon = dishIconFor(recipe);
  return <Icon size={size} className={className} />;
}

export const DISH_ICON_COUNT = Object.keys(BY_EMOJI).length;