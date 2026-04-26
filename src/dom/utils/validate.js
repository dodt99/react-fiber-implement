// =============================================================================
// src/dom/utils/validate.js
// -----------------------------------------------------------------------------
// 3 hàm helper để kiểm tra "loại" của một DOM node thông qua thuộc tính
// `nodeType` (chuẩn của Web API). Tầng DOM dùng để rẽ nhánh logic, ví dụ:
//   - Container có thể là một comment (vd: marker của portal) thì phải insert
//     trước comment đó, chứ không thể appendChild vào nó.
//   - Document và Element xử lý ownerDocument khác nhau.
// =============================================================================
import { DOCUMENT_NODE, TEXT_NODE, COMMENT_NODE } from "../constants";

function isDocumentNode(el) {
  return el.nodeType === DOCUMENT_NODE;
}

function isTextNode(el) {
  return el.nodeType === TEXT_NODE;
}

function isCommentNode(el) {
  return el.nodeType === COMMENT_NODE;
}

export { isDocumentNode, isTextNode, isCommentNode };
