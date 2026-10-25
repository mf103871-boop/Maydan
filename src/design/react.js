import React from 'react';
import { DesignElement, keyedDesignChildren } from './DesignElement.jsx';
export default {...React,createElement(type,props,...children) {
  const elementProps={...props};
  if(children.length)elementProps.children=children.length===1?children[0]:keyedDesignChildren(children);
  else if(Array.isArray(elementProps.children))elementProps.children=keyedDesignChildren(elementProps.children);
  return typeof type==='string' && (props?.['data-design-screen'] || props?.['data-design-id'])
    ? React.createElement(DesignElement,{as:type,key:props.key,elementProps})
    : React.createElement(type,props,...children);
}};
