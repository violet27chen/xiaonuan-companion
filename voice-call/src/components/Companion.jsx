/** 小暖：日系动漫风陪伴角色，以 SVG 绘制，适配手机和低带宽环境。 */
export default function Companion({ audioLevel = 0, talking = false, thinking = false, listening = true, style }) {
  const level = Math.min(Math.max(audioLevel, 0), 1);
  return (
    <div
      className={`companion${listening ? " listening" : ""}${thinking ? " thinking" : ""}${talking ? " talking" : ""}`}
      style={{ transform: `scale(${1 + level * 0.025})`, transition: "transform .18s ease-out", ...style }}
    >
      <svg className="ip" viewBox="0 0 320 320" role="img" aria-label="小暖陪伴助手">
        <defs>
          <linearGradient id="warmHair" x1=".15" y1="0" x2=".9" y2="1">
            <stop offset="0" stopColor="#69505d" />
            <stop offset=".54" stopColor="#463746" />
            <stop offset="1" stopColor="#302d3b" />
          </linearGradient>
          <linearGradient id="warmHairLight" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#b37c82" stopOpacity=".7" />
            <stop offset="1" stopColor="#b37c82" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="warmFace" cx="43%" cy="30%" r="75%">
            <stop stopColor="#fff0df" />
            <stop offset="1" stopColor="#f0b9a9" />
          </radialGradient>
          <linearGradient id="warmCoat" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#82c7bd" />
            <stop offset="1" stopColor="#398d8a" />
          </linearGradient>
          <linearGradient id="warmEarphone" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffd5bd" />
            <stop offset="1" stopColor="#e99b8d" />
          </linearGradient>
          <radialGradient id="warmIris" cx="40%" cy="28%" r="70%">
            <stop stopColor="#89c6bd" />
            <stop offset=".48" stopColor="#448d89" />
            <stop offset="1" stopColor="#285d69" />
          </radialGradient>
          <filter id="warmShadow" x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#315f68" floodOpacity=".18" />
          </filter>
        </defs>

        <ellipse cx="160" cy="302" rx="92" ry="12" fill="#548e8b" opacity=".14" />
        <g className="bodyG" filter="url(#warmShadow)">
          {/* 长发从肩后垂下 */}
          <path d="M76 114c-9-55 22-91 79-96 58-5 91 32 88 91l-5 89c-2 37-19 63-39 76H112c-28-18-42-49-40-87z" fill="url(#warmHair)" />
          <path d="M83 116c-5-37 9-65 31-81-13 28-8 57-3 77l-4 111c-1 19-9 35-21 47-10-18-13-40-11-67zM231 103c3-29-3-51-18-67 29 20 39 50 34 86l-1 79c-1 28-11 49-29 64 9-29 12-61 11-92z" fill="url(#warmHairLight)" opacity=".6" />
          {/* 衣服与肩部 */}
          <path d="M42 315c4-51 30-78 79-91l39 17 39-17c48 12 74 40 79 91z" fill="url(#warmCoat)" />
          <path d="m125 221 35 25 35-25-9-27h-52z" fill="#f2c8b6" />
          <path d="m115 224 45 28-26 28-34-43zM205 224l-45 28 26 28 34-43z" fill="#fffaf5" />
          <path d="m160 253 10 14-10 39-10-39z" fill="#e9f5ef" />
          <path d="M160 266v36" stroke="#71aaa4" strokeWidth="2" opacity=".7" />
          <path d="M224 278c-12-7-25-7-36 0 11 14 25 14 36 0z" fill="#fff7ee" />
          <path d="M212 282c-5-3-8-6-8-9 0-4 5-5 8-1 3-4 8-3 8 1 0 3-3 6-8 9z" fill="#e98d82" />
          {/* 脖子 */}
          <path d="M137 184h46v44c-13 16-33 16-46 0z" fill="url(#warmFace)" />
          {/* 脸 */}
          <path d="M91 119c0-43 27-70 69-70s69 27 69 70v38c0 43-30 73-69 73s-69-30-69-73z" fill="url(#warmFace)" />
          {/* 耳朵 */}
          <path d="M96 130c-14-10-25 0-20 17 3 11 11 18 20 16zM224 130c14-10 25 0 20 17-3 11-11 18-20 16z" fill="#f2c4b2" />
          {/* 眼睛：虹膜、高光与上扬眼线 */}
          <path d="M106 137c6-12 25-14 36-3" fill="none" stroke="#493842" strokeWidth="4" strokeLinecap="round" />
          <path d="M178 134c11-14 31-11 37 2" fill="none" stroke="#493842" strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="124" cy="148" rx="13" ry="17" fill="#fffdf8" />
          <ellipse cx="196" cy="148" rx="13" ry="17" fill="#fffdf8" />
          <ellipse cx="126" cy="150" rx="8.5" ry="13" fill="url(#warmIris)" />
          <ellipse cx="194" cy="150" rx="8.5" ry="13" fill="url(#warmIris)" />
          <ellipse cx="127" cy="151" rx="4" ry="8" fill="#293c4a" />
          <ellipse cx="193" cy="151" rx="4" ry="8" fill="#293c4a" />
          <circle cx="123" cy="144" r="4" fill="#fff" />
          <circle cx="190" cy="144" r="4" fill="#fff" />
          <circle cx="131" cy="156" r="2" fill="#d5f2e7" />
          <circle cx="199" cy="156" r="2" fill="#d5f2e7" />
          <path d="M108 134l-5-5M116 131l-2-6M204 131l3-6M213 134l5-5" stroke="#493842" strokeWidth="2.5" strokeLinecap="round" />
          {/* 眉、腮红与微笑 */}
          <path d="M111 122q12-7 24 0M184 122q12-7 24 0" fill="none" stroke="#92616a" strokeWidth="2.4" strokeLinecap="round" opacity=".75" />
          <ellipse cx="105" cy="174" rx="13" ry="6" fill="#e88987" opacity=".25" />
          <ellipse cx="215" cy="174" rx="13" ry="6" fill="#e88987" opacity=".25" />
          <path className="mouth-smile" d="M145 181q15 14 30 0" fill="none" stroke="#a85c67" strokeWidth="3" strokeLinecap="round" />
          <ellipse className="mouth-talk" cx="160" cy="183" rx="6" ry="8" fill="#a85c67" />
          {/* 刘海与两侧发束 */}
          <path d="M89 118c-4-51 24-82 72-83 45-1 73 29 70 76-18-5-31-17-41-34-13 20-42 34-101 41z" fill="url(#warmHair)" />
          <path d="M103 99c16-37 42-49 69-48-27 8-42 23-51 46 24-4 42-13 57-27-8 27-34 44-75 50z" fill="#80616b" opacity=".4" />
          <path d="M96 110c-2 23-1 50 5 74-15-10-23-26-22-45 0-15 6-24 17-29zM223 108c3 22 2 50-4 76 15-10 23-27 22-46 0-14-7-24-18-30z" fill="#39313f" />
          {/* 耳机头梁与耳罩 */}
          <path d="M84 122c-7-64 23-98 76-98s83 34 76 98" fill="none" stroke="url(#warmEarphone)" strokeWidth="10" strokeLinecap="round" />
          <rect x="75" y="119" width="21" height="43" rx="10" fill="url(#warmEarphone)" />
          <rect x="224" y="119" width="21" height="43" rx="10" fill="url(#warmEarphone)" />
          <rect x="81" y="125" width="8" height="30" rx="4" fill="#fff4ec" opacity=".9" />
          <rect x="231" y="125" width="8" height="30" rx="4" fill="#fff4ec" opacity=".9" />
          {/* 蝴蝶结发饰 */}
          <path d="m205 74 15-13 1 18-14 3zM205 74l-16-11-1 18 16 3z" fill="#f2a99a" />
          <circle cx="205" cy="74" r="4" fill="#ffdfc3" />
          <path d="m199 63 2 8M216 65l-4 8" stroke="#ffe4d1" strokeWidth="2" strokeLinecap="round" opacity=".85" />
        </g>
        <g className="thinking-bubble" aria-hidden="true">
          <rect x="26" y="77" width="62" height="32" rx="16" fill="#fffdf9" stroke="#e9e1dc" strokeWidth="1.5" />
          <circle className="thinking-dot dot-one" cx="43" cy="93" r="3" fill="#83b7b0" />
          <circle className="thinking-dot dot-two" cx="57" cy="93" r="3" fill="#83b7b0" />
          <circle className="thinking-dot dot-three" cx="71" cy="93" r="3" fill="#83b7b0" />
        </g>
        <path d="m265 61 4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#e6b86f" className="sparkle" />
        <circle cx="54" cy="87" r="4.5" fill="#74b9ae" className="sparkle sparkle-delay" />
        <circle cx="263" cy="212" r="3" fill="#f0a897" className="sparkle sparkle-delay" />
      </svg>
    </div>
  );
}
