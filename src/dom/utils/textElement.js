// =============================================================================
// src/dom/utils/textElement.js
// -----------------------------------------------------------------------------
// Các thao tác liên quan tới text:
//   - createTextNode  : tạo một Text node thật (Node.nodeType === 3)
//   - setTextContent  : ghi text vào element. Có 1 micro-optimization quan trọng.
//   - resetTextContent: clear text bằng cách set thành "".
// =============================================================================
import getDocumentByElement from "./getDocumentByElement";
import { isTextNode } from "./validate";

function resetTextContent(element) {
  setTextContent(element, "");
}

function setTextContent(node, text) {
  // Tối ưu: nếu element đang có DUY NHẤT 1 text node con -> chỉ cần đổi giá
  // trị `nodeValue` thay vì set lại `textContent` (set textContent sẽ tạo lại
  // text node mới và xoá hết các con khác, gây tốn hơn cũng như mất focus,
  // selection... trong một số trường hợp).
  if (text) {
    let firstChild = node.firstChild;

    if (firstChild && firstChild === node.lastChild && isTextNode(firstChild)) {
      firstChild.nodeValue = text;
      return;
    }
  }
  // Nếu không thoả điều kiện trên -> rơi về cách thông thường.
  node.textContent = text;
}

function createTextNode(text, element) {
  // Nếu lỡ truyền vào object thì JSON-stringify (an toàn cho dev không bị
  // crash khi quên format). React thật sẽ throw warning trong trường hợp này.
  const value = typeof text === "object" ? JSON.stringify(text) : text;
  return getDocumentByElement(element).createTextNode(value);
}

export { createTextNode, setTextContent, resetTextContent };
