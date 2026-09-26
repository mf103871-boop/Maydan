// Conservative server-side screening of explicit abuse, not a claim to detect
// every harmful sentence. Reports and human moderation remain necessary.
export function normalizeModerationText(value) {
  return String(value || '').normalize('NFKC').toLowerCase()
    .replace(/[\p{Cf}\u0640\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/gu, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[ؤ]/g, 'و').replace(/[ئ]/g, 'ي')
    .replace(/[@]/g, 'a').replace(/[$]/g, 's')
    .replace(/(?<=[a-z])[013457](?=[a-z])/g, c => ({0:'o',1:'i',3:'e',4:'a',5:'s',7:'t'})[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const explicit = [
  /(?:^| )(?:fuck|fucking|motherfucker|motherfuckers|nigger|niggers|faggot|faggots|cocksucker)(?: |$)/,
  /(?:^| )(?:kill yourself|go kill yourself|i will kill you|i am going to kill you|i will rape you)(?: |$)/,
  /(?:^| )(?:قحبه|شرموطه|متناك|منيوك|كسامك|كسمك|كسختك|كسمامك|زبك|زبي)(?: |$)/,
  /(?:^| )(?:يا قحبه|يا شرموطه|ابن القحبه|ابن الشرموطه|كس امك|كس اختك|روح انتحر|سوف اقتلك|ساقتلك|ساغتصبك)(?: |$)/,
];
const compactWords = ['fuck','fucking','motherfucker','nigger','faggot','cocksucker','كسمك','كسامك','قحبه','شرموطه'];
export function objectionableText(value) {
  const text = normalizeModerationText(value);
  if (explicit.some(pattern => pattern.test(text))) return true;
  // Obvious punctuation/letter-spacing evasion, bounded to complete runs so
  // unrelated words cannot accidentally join into a forbidden substring.
  const collapsed = text.replace(/(?:^| )((?:[a-z\u0621-\u064a] ){2,}[a-z\u0621-\u064a])(?= |$)/g,
    (_, run) => ' ' + run.replaceAll(' ', ''));
  return compactWords.some(word => collapsed.split(' ').includes(word));
}
