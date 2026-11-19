import { createContext, useContext } from 'react';

export const PlatformContext = createContext(null);
export const GameFrameFooterContext = createContext(null);
export function usePlatform() {
  return useContext(PlatformContext);
}
