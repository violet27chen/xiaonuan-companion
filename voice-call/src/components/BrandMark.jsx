export default function BrandMark({ className = "h-12 w-12" }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label="小暖">
      <circle cx="32" cy="32" r="32" fill="#f6f1e7" />
      <ellipse cx="32" cy="34" rx="23" ry="22" fill="#fffdfa" stroke="#e6dccd" strokeWidth="1.5" />
      <circle cx="24" cy="35" r="3" fill="#f7c6b8" />
      <circle cx="40" cy="35" r="3" fill="#f7c6b8" />
      <circle cx="26" cy="30" r="2.2" fill="#4a4038" />
      <circle cx="38" cy="30" r="2.2" fill="#4a4038" />
      <path d="M27 39 Q32 43 37 39" fill="none" stroke="#4a4038" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M20 43 C20 51 25 54 32 54 C39 54 44 51 44 43" fill="none" stroke="#1b6c80" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="53" r="2.6" fill="#fff" stroke="#1b6c80" strokeWidth="1.2" />
    </svg>
  );
}
