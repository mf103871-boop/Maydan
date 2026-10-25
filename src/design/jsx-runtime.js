import React from 'react';
import { DesignElement, keyedDesignChildren } from './DesignElement.jsx';
export const Fragment=React.Fragment;
export function jsx(type,props,key) {
  const elementProps=Array.isArray(props?.children)?{...props,children:keyedDesignChildren(props.children)}:props;
  const config=key==null?elementProps:{...elementProps,key};
  return typeof type==='string' && (props?.['data-design-screen'] || props?.['data-design-id'])
    ? React.createElement(DesignElement,{as:type,elementProps,key:key??props?.key})
    : React.createElement(type,config);
}
export const jsxs=jsx;
export const jsxDEV=jsx;
