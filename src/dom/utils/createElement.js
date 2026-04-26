// =============================================================================
// src/dom/utils/createElement.js
// -----------------------------------------------------------------------------
// Tạo một DOM element thật từ type ('div', 'button', ...). Wrapper mỏng quanh
// `document.createElement` nhưng có 2 điểm đáng chú ý:
//
//   1) `props.is`  -> hỗ trợ Custom Elements (Web Components builtin), ví dụ:
//        <button is="my-button" />  =>  document.createElement('button', { is: 'my-button' })
//
//   2) Edge case `<select multiple>`: thuộc tính `multiple` cần được set TRỰC
//      TIẾP lên DOM property ngay lúc tạo (set qua attribute sau có thể bị bỏ qua
//      do trình duyệt chỉ đọc attr này khi parsing HTML).
//
// Các attribute/prop khác (children, onClick, ...) sẽ được gán sau ở
// `setInitialProperties` trong `dom/config.js`.
// =============================================================================
import getDocumentByElement from "./getDocumentByElement";

/**
 * @param {string} type
 * @param {object} props
 * @param {HTMLElement} rootContainerElement
 * @param {string} parentNamespace
 * @return {HTMLElement}
 */
function createElement(type, props, rootContainerElement, parentNamespace) {
  const ownerDocument = getDocumentByElement(rootContainerElement);
  let element;
  if (typeof props.is === "string") {
    element = ownerDocument.createElement(type, { is: props.is });
  } else {
    element = ownerDocument.createElement(type);
    if (type === "select" && props.multiple) {
      const node = element;
      node.multiple = true;
    }
  }
  return element;
}

export default createElement;
