"use client";

interface LeadBadgeProps {
  type: string;
  size?: "sm" | "md";
}

export default function LeadBadge({ type, size = "md" }: LeadBadgeProps) {
  const styles: Record<string, string> = {
    hot: "bg-red-500/20 text-red-400 border-red-500/30",
    warm: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    cold: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    new: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  };

  const sizeStyles = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1";

  return (
    <span
      className={`inline-flex items-center font-bold uppercase rounded border ${
        styles[type] || styles.new
      } ${sizeStyles}`}
    >
      {type === "hot" && (
        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
        </svg>
      )}
      {type}
    </span>
  );
}
