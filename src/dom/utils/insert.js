// =============================================================================
// src/dom/utils/insert.js
// -----------------------------------------------------------------------------
// Insert một node vào ĐÚNG VỊ TRÍ giữa các sibling (đứng trước `beforeChild`).
// Cần dùng khi reconciler phát hiện thứ tự children thay đổi -> không dùng
// appendChild được vì sẽ luôn đẩy ra cuối, gây sai layout.
//
// Phân biệt với append.js: insert có "anchor" là `beforeChild`, append thì
// luôn đặt ra cuối.
// =============================================================================
import { isCommentNode } from "./validate";

function insertBefore(parent, child, beforeChild) {
  parent.insertBefore(child, beforeChild);
}

function insertInContainerBefore(container, child, beforeChild) {
  // Tương tự append: nếu container là comment node, phải xử lý đặc biệt.
  if (isCommentNode(container)) {
    container.parentNode.insertBefore(child, beforeChild);
  } else {
    container.insertBefore(child, beforeChild);
  }
}

export { insertInContainerBefore, insertBefore };
