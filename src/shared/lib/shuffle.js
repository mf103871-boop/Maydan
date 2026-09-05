// خلط فيشر–ييتس مع دالة عشوائية قابلة للحقن.
export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

// خلط يضمن أن الناتج يختلف عن الأصل عندما يكون ذلك ممكنًا.
export function shuffleDifferent(items, random = Math.random, attempts = 6) {
  if (items.length < 2) return [...items];
  let out = shuffle(items, random);
  let tries = 0;
  while (tries < attempts && out.every((item, index) => item === items[index])) {
    out = shuffle(items, random);
    tries += 1;
  }
  return out;
}
