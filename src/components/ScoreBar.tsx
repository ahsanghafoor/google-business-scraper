"use client";

interface ScoreBarProps {
  score: number;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export default function ScoreBar({ score, label, size = "md" }: ScoreBarProps) {
  const color =
    score >= 70
      ? "bg-red-500"
      : score >= 40
        ? "bg-yellow-500"
        : "bg-green-500";

  const textColor =
    score >= 70
      ? "text-red-400"
      : score >= 40
        ? "text-yellow-400"
        : "text-green-400";

  const heights = { sm: "h-1.5", md: "h-2", lg: "h-3" };

  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-gray-400 min-w-[60px]">{label}</span>}
      <div className={`flex-1 bg-[#2a2d3a] rounded-full ${heights[size]}`}>
        <div
          className={`${color} rounded-full ${heights[size]} transition-all duration-500`}
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-bold ${textColor} min-w-[32px] text-right`}>
        {score}
      </span>
    </div>
  );
}
