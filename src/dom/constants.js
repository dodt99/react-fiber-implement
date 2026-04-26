// =============================================================================
// src/dom/constants.js
// -----------------------------------------------------------------------------
// Các hằng số dùng cho tầng DOM. Giá trị TEXT_NODE/COMMENT_NODE/DOCUMENT_NODE
// chính là các giá trị `Node.nodeType` chuẩn của trình duyệt:
//   - 1: ELEMENT_NODE (vd: <div>)
//   - 3: TEXT_NODE
//   - 8: COMMENT_NODE
//   - 9: DOCUMENT_NODE (chính là `document`)
// Dùng để phân biệt loại node khi append/remove/insert (xem utils/validate.js).
// =============================================================================
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const Namespaces = {
  html: HTML_NAMESPACE,
  svg: SVG_NAMESPACE,
};
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;

const CHILDREN = "children";
