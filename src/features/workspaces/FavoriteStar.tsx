import { Star } from "lucide-react";

export function FavoriteStar({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={active ? "Remove from favorites" : "Add to favorites"}
      className={`shrink-0 rounded p-0.5 ${
        active ? "text-amber-400" : "text-neutral-600 hover:text-neutral-300"
      }`}
    >
      <Star size={13} fill={active ? "currentColor" : "none"} />
    </button>
  );
}
