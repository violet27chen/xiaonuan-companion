/**
 * 陪诊小暖 · 人物形象（SVG + CSS 动画）
 * - 常驻：呼吸浮动、眨眼
 * - listening：三层涟漪（收听中）
 * - talking：说话嘴型 + 身体轻摇；整体缩放随 audioLevel 呼吸
 */
export default function Companion({ audioLevel = 0, talking = false, listening = true, style }) {
  const level = Math.min(Math.max(audioLevel, 0), 1);
  return (
    <div
      className={`companion${listening ? " listening" : ""}${talking ? " talking" : ""}`}
      style={{
        transform: `scale(${1 + level * 0.05})`,
        transition: "transform .15s ease-out",
        ...style,
      }}
    >
      <span className="ring" aria-hidden="true" />
      <span className="ring r2" aria-hidden="true" />
      <span className="ring r3" aria-hidden="true" />
      <svg className="ip" viewBox="0 0 220 208" aria-label="小暖">
        <g className="bodyG">
          <path
            d="M112 54 C102 36 132 30 127 47 C125 55 114 54 113 49"
            fill="none"
            stroke="#5a4f44"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <ellipse cx="110" cy="124" rx="70" ry="64" fill="#fffdfa" stroke="#e6dccd" strokeWidth="3" />
          <circle cx="62" cy="124" r="10" fill="#f7c6b8" opacity=".8" />
          <circle cx="158" cy="124" r="10" fill="#f7c6b8" opacity=".8" />
          <g className="eyes">
            <g className="eye">
              <circle cx="86" cy="108" r="7" fill="#4a4038" />
            </g>
            <g className="eye">
              <circle cx="134" cy="108" r="7" fill="#4a4038" />
            </g>
          </g>
          <path
            className="mouth-smile"
            d="M96 130 Q110 142 124 130"
            fill="none"
            stroke="#4a4038"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <ellipse className="mouth-talk" cx="110" cy="135" rx="10" ry="9" fill="#7a4a42" />
          <path
            d="M66 148 C66 176 92 187 110 187 C128 187 154 176 154 148"
            fill="none"
            stroke="#1b6c80"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <circle cx="110" cy="186" r="9" fill="#fff" stroke="#1b6c80" strokeWidth="3" />
        </g>
      </svg>
    </div>
  );
}
