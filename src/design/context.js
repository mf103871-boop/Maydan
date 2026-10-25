import { createContext } from 'react';
import { createDefaultDesign } from './schema.js';
export const DesignContext = createContext({ document: createDefaultDesign(), profile: 'portrait', editing: false, assetUrls: {} });
export const DesignScreenContext = createContext(null);
