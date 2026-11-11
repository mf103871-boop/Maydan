// Build-only JSON representation; tools continue to read the original packs.
// Each occurrence creates its own object/array, just like a normal JSON module.
export function unpackQuestionBank({ keys, shapes, data }) {
  const decode = value => !Array.isArray(value) ? value : value[0] === 1
    ? value.slice(1).map(decode)
    : Object.fromEntries(shapes[value[1]].map((key, index) => [keys[key], decode(value[index + 2])]));
  return decode(data);
}
