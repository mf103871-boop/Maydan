import React from 'react';
import { Online } from '../../../online/Online.jsx';
import { navigate } from '../../../platform/router.js';

export function MafiaEntry() {
  // Rooms open immediately. Help retains the tutorial's own resume choice;
  // visiting or skipping this screen never marks the lesson completed.
  return <Online game="mafia" onTutorial={()=>navigate('/tutorial/mafia')}/>;
}
