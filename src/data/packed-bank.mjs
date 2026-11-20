// Build-only JSON representation; tools continue to read the original packs.
// Each occurrence creates its own object/array, just like a normal JSON module.
export function unpackQuestionBank({ keys, shapes, data, textVersion }) {
  function decode(value) {
    if (!Array.isArray(value)) {
      return textVersion === 1 && typeof value === 'string' ? unpackBankText(value) : value;
    }
    if (value[0] === 1) return value.slice(1).map(decode);
    return Object.fromEntries(shapes[value[1]].map((key, index) => [keys[key], decode(value[index + 2])]));
  }
  return decode(data);
}

// Swapping these equally sized ranges is reversible even in mixed-script text.
// The ASCII side avoids quotes, escapes and HTML delimiters in the emitted JS.
const asciiLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop';
const firstArabicLetter = 0x621;
const swapLetters = Array(firstArabicLetter + asciiLetters.length).fill('');
for (let index = 0; index < asciiLetters.length; index++) {
  const arabic = String.fromCharCode(firstArabicLetter + index);
  swapLetters[asciiLetters.charCodeAt(index)] = arabic;
  swapLetters[firstArabicLetter + index] = asciiLetters[index];
}
function swapBankText(value) {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    result += swapLetters[value.charCodeAt(index)] || value[index];
  }
  return result;
}
export function packBankText(value) {
  if (/[\u0621-\u064a]{2}/.test(value)) return '~A' + swapBankText(value);
  return value.startsWith('~') ? '~S' + value : value;
}
function unpackBankText(value) {
  if (value.startsWith('~A')) return swapBankText(value.slice(2));
  return value.startsWith('~S') ? value.slice(2) : value;
}
