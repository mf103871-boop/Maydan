// التخزين المحلي وجسر الغلاف الأصلي: كلاهما قد يغيب (تصفح خاص، متصفح عادي) فيفشل بصمت.
export const saveBadeehaKey = async (key, val) => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
};
export function removeBadeehaKey(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {}
}
export function betaNativeMessage(payload) {
  try {
    if (window.MaydanNative && typeof window.MaydanNative.postMessage == "function")
      return (window.MaydanNative.postMessage(JSON.stringify(payload)), !0);
    const handler =
      window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.maydan;
    if (handler && typeof handler.postMessage == "function")
      return (handler.postMessage(payload), !0);
  } catch (error) {}
  return !1;
}
