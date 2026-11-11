import React from 'react';
import sheet from './plus.css?sheet';
import identitySheet from '../profiles/identity.css?sheet';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
export function PlusStyles() { return <><PresentationStyles sheet={sheet} /><PresentationStyles sheet={identitySheet} /></>; }
