// =============================================================================
// src/dom/utils/remove.js
// -----------------------------------------------------------------------------
// Xoá DOM node. Hai biến thể giống cặp append/insert:
//   - removeChild              : parent là DNode bình thường.
//   - removeChildFromContainer : parent là root container (có thể là comment).
// Được gọi từ `commitDeletion` khi reconciler đánh effectTag = Deletion.
// =============================================================================
import { isCommentNode } from "./validate";

export function removeChildFromContainer(container, child) {
  if (isCommentNode(container)) {
    container.parentNode.removeChild(child);
  } else {
    container.removeChild(child);
  }
}

export function removeChild(parentInstance, child) {
  parentInstance.removeChild(child);
}
