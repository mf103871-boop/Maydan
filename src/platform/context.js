import { createContext, useContext } from 'react';

export const PlatformContext = createContext(null);
export function usePlatform() {
  return useContext(PlatformContext);
}
