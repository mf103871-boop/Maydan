import React from 'react';
import toolsCss from './ersomha-tools.css';
export function ErsomhaToolStyles(){return <style>{toolsCss}</style>;}
/** Decorative line icons from the approved board. Commands remain on the buttons. */
export function ErsomhaToolIcon({name='pen',className=''}){
 const shapes={
  pen:<><path d="m4 16-1 5 5-1L20 8a2.8 2.8 0 0 0-4-4Z"/><path d="m13 7 4 4M4 16l4 4"/></>,
  eraser:<><path d="m3 14 9-10a2 2 0 0 1 3 0l6 5a2 2 0 0 1 0 3l-8 9H8l-5-4a2 2 0 0 1 0-3Z"/><path d="m8 8 9 8M13 21h8"/></>,
  undo:<><path d="M9 5 3 11l6 6M3 11h10a7 7 0 0 1 7 7v3"/></>,
  redo:<><path d="m15 5 6 6-6 6M21 11H11a7 7 0 0 0-7 7v3"/></>,
  clear:<><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
  expand:<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>,
  fit:<path d="M3 8h5V3M16 3v5h5M8 21v-5H3M21 16h-5v5"/>,
  hand:<path d="M8 12V5a1.5 1.5 0 0 1 3 0V3a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v3a1.5 1.5 0 0 1 3 0v7c0 5-3 8-7 8-3 0-5-2-6-4l-4-6c-1-2 1-4 3-2l2 3"/>,
  palette:<><path d="M21 10a9 9 0 1 0-11 11c3 1 4-1 3-3-1-2 1-3 3-2 4 1 7-2 5-6Z"/><circle cx="7" cy="10" r=".7"/><circle cx="10" cy="6" r=".7"/><circle cx="15" cy="7" r=".7"/><circle cx="6" cy="15" r=".7"/></>,
  rotate:<><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/></>,
 };
 return shapes[name]?<svg className={`ers-tool-icon ers-tool-icon-${name} ${className}`.trim()} viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-ers-tool-icon={name}>{shapes[name]}</svg>:null;
}
