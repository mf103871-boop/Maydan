import React from 'react';

// Original vector drawings of everyday tools. No answer text in the SVG/alt text.
const drawings = {
  'cherry-pitter': <>
    <path d="M100 94 264 42Q281 38 284 51T272 65L130 119M115 123 254 174Q270 180 276 169T264 154L144 109" fill="#bd728b" />
    <circle cx="127" cy="106" r="12" fill="#ede6ef" /><circle cx="127" cy="106" r="3" fill="#74647c" />
    <path d="M112 98H73V153H112M73 113H99" fill="none" strokeWidth="9" /><path d="M101 72V126" strokeWidth="7" />
    <ellipse cx="101" cy="146" rx="26" ry="9" fill="#eee5ed" /><ellipse cx="101" cy="146" rx="8" ry="4" fill="#564061" />
  </>,
  'honey-dipper': <g transform="rotate(-23 180 110)">
    <rect x="164" y="101" width="147" height="17" rx="8" fill="#d7a563" />
    <ellipse cx="122" cy="110" rx="61" ry="39" fill="#e6ba7d" />
    {[84,102,122,142,160].map((x) => <path key={x} d={`M${x} 77Q${x-12} 110 ${x} 143`} fill="none" stroke="#91613d" strokeWidth="6" />)}
  </g>,
  'strawberry-huller': <>
    <path d="M165 55V28Q180 17 195 28V55" fill="#88bca1" />
    <path d="M144 53Q180 36 216 53L204 124Q180 139 156 124Z" fill="#bf637b" />
    <path d="M160 126Q136 166 170 194L180 176M180 134V192M200 126Q224 166 190 194L180 176" fill="none" stroke="#9fa8b1" strokeWidth="8" />
    <path d="M162 66 158 109" stroke="#e9a6b4" strokeWidth="6" />
  </>,
  'egg-separator': <>
    <path d="M219 106H300Q319 106 319 118T300 130H214" fill="#88bca1" />
    <ellipse cx="151" cy="118" rx="78" ry="52" fill="#c1ddd0" />
    <ellipse cx="151" cy="127" rx="34" ry="24" fill="#ecf2eb" />
    <path d="M97 105Q151 62 205 105M98 135Q98 153 121 157M204 135Q204 153 181 157" fill="none" stroke="#60796b" strokeWidth="9" />
    <ellipse cx="300" cy="118" rx="6" ry="3" fill="#60796b" stroke="none" />
  </>,
  'nutcracker': <g transform="rotate(-12 180 110)">
    <path d="M73 72Q142 62 177 93L298 63Q311 60 313 75T301 92L179 118Q134 93 73 91Z" fill="#aeb6bf" />
    <path d="M73 148Q142 158 177 127L298 157Q311 160 313 145T301 128L179 102Q134 127 73 129Z" fill="#aeb6bf" />
    <circle cx="74" cy="110" r="24" fill="#ccd0d5" /><circle cx="74" cy="110" r="7" fill="#827888" />
    <path d="m106 91 6 8 8-7 7 8 8-5 7 8 8-5m-44 31 6-8 8 7 7-8 8 5 7-8 8 5" fill="none" strokeWidth="4" />
  </g>,
  'spaghetti-measure': <g transform="rotate(-10 180 110)">
    <rect x="36" y="65" width="288" height="90" rx="36" fill="#d7a563" />
    {[[78,13],[135,20],[204,27],[278,33]].map(([cx,r]) => <circle key={cx} cx={cx} cy="110" r={r} fill="#f8f1e6" />)}
  </g>,
  'citrus-reamer': <g transform="rotate(-28 180 110)">
    <rect x="175" y="96" width="130" height="29" rx="14" fill="#d7a563" />
    <path d="M57 110Q133 10 190 86V134Q133 210 57 110Z" fill="#e6ba7d" />
    <path d="M62 110 184 95M62 110H188M62 110 184 125" stroke="#a77342" fill="none" strokeWidth="5" />
  </g>,
  'apple-corer': <g transform="rotate(22 180 110)">
    <rect x="125" y="22" width="110" height="39" rx="18" fill="#bd728b" />
    <path d="M165 59H195V163L190 171 185 164 180 173 175 164 169 171 165 163Z" fill="#c2c9cc" />
    <ellipse cx="180" cy="168" rx="15" ry="8" fill="#7d8290" /><path d="M171 67V148" stroke="#f5f4f4" strokeWidth="4" />
  </g>,
  'ravioli-stamp': <>
    <path d="M133 124 219 111 259 167 159 193 112 143Z" fill="#b9c2c5" />
    <path d="m112 143 6 5 0 7 8 1 1 7 8 1 1 7 8 1 2 8 8 0 5 8 7-6 9 2 6-7 10 2 6-7 10 2 6-7 10 2 6-7 10 2 6-7 10 2 6-9" fill="none" strokeWidth="5" />
    <path d="M168 130V72H195V127" fill="#c8a070" />
    <path d="M159 70Q145 19 181 19T206 70Q181 85 159 70Z" fill="#d7a563" /><path d="M162 133 184 149 213 140" fill="none" />
  </>,
  'pastry-wheel': <g transform="rotate(-20 180 110)">
    <rect x="184" y="100" width="128" height="25" rx="12" fill="#d7a563" />
    <path d="M189 112H148" stroke="#aeb6bf" strokeWidth="12" />
    <path d="m117 61 10 9 13-3 5 13 13 4-1 14 9 10-8 11 2 14-13 6-3 13-14-1-10 9-11-8-14 2-6-13-13-3 1-14-9-10 8-11-2-14 13-6 3-13 14 1Z" fill="#c7cdd1" />
    <circle cx="117" cy="110" r="27" fill="#e4e7e8" /><circle cx="117" cy="110" r="7" fill="#827888" />
  </g>,
  'tea-infuser': <>
    <circle cx="149" cy="123" r="57" fill="#c2c9cc" /><path d="M98 99Q153 125 200 97" fill="none" strokeWidth="5" />
    {[[-30,4],[-13,13],[7,17],[28,11],[-31,26],[-10,35],[14,35],[-14,-17],[7,-18],[28,-11]].map(([x,y],i) => <circle key={i} cx={149+x} cy={123+y} r="3" fill="#637080" stroke="none" />)}
    <path d="M196 91Q255 139 270 63" fill="none" stroke="#99a3ad" strokeWidth="5" strokeDasharray="3 7" />
    <path d="M259 38H284V65H259Z" fill="#88bca1" />
  </>,
  'shoehorn': <g transform="rotate(34 180 110)">
    <path d="M171 23Q190 16 194 39L190 119Q225 171 198 195Q177 214 157 190Q142 170 160 119Z" fill="#d5b98e" />
    <path d="M167 133Q155 175 178 188Q202 179 184 137" fill="none" stroke="#ac845e" strokeWidth="4" />
    <circle cx="182" cy="35" r="5" fill="#f8f1e6" />
  </g>,
};

export const illustrationIds = Object.keys(drawings);
export function Illustration({ question }) {
  if (!drawings[question.illustration]) return null;
  return <figure className="fab-illustration">
    <svg viewBox="0 0 360 220" role="img" aria-label={question.imageDescription}>
      <rect width="360" height="220" rx="22" fill="#f8f1e6" />
      <ellipse cx="180" cy="198" rx="94" ry="7" fill="#e5d8c5" />
      <g stroke="#564061" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{drawings[question.illustration]}</g>
    </svg>
    <figcaption>رسم توضيحي لأداة حقيقية</figcaption>
  </figure>;
}
