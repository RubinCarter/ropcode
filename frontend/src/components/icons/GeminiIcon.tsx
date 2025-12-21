interface GeminiIconProps {
  className?: string;
}

export const GeminiIcon: React.FC<GeminiIconProps> = ({ className }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
    >
      {/* Google Gemini Logo - Sparkle/Star pattern */}
      <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
    </svg>
  );
};
