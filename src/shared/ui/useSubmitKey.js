import { useRef } from 'react';

// Enter may accept a keyboard suggestion rather than submit the field. Safari
// can clear isComposing on that final keydown while still reporting keyCode 229.
export function useSubmitKey(submit) {
  const composing = useRef(false);
  return {
    onCompositionStart() { composing.current = true; },
    onCompositionEnd() { composing.current = false; },
    onKeyDown(event) {
      const native = event.nativeEvent || event;
      if (event.key !== 'Enter' || event.shiftKey || composing.current ||
          event.isComposing || native.isComposing || event.keyCode === 229 || native.keyCode === 229) return;
      event.preventDefault();
      submit();
    },
  };
}
