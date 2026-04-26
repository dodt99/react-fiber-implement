// =============================================================================
// src/dom/utils/getDocumentByElement.js
// -----------------------------------------------------------------------------
// Trả về `document` "sở hữu" element đó. Quan trọng vì:
//   - Nếu element được pass vào chính là `document` -> dùng luôn.
//   - Nếu element là một Element bình thường -> lấy `ownerDocument` (ví dụ
//     khi render trong iframe sẽ là document của iframe đó, không phải
//     document toplevel).
// Dùng trong `createElement`/`createTextNode` để tạo node đúng "vũ trụ".
// =============================================================================
import { isDocumentNode } from "./validate";

/**
 * @param {HTMLElement} element
 * @return {Document}
 */
function getDocumentByElement(element) {
  return isDocumentNode(element) ? element : element.ownerDocument;
}

export default getDocumentByElement;
