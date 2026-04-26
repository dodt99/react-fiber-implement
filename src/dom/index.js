// =============================================================================
// src/dom/index.js
// -----------------------------------------------------------------------------
// Đây là entry point của tầng DOM - tương đương `ReactDOM.render` trong React thật.
// Nhiệm vụ: nhận một VNode (element được tạo bởi `h(...)`) và một container DOM,
// sau đó "khởi tạo cây Fiber" gắn vào container đó và schedule công việc dựng cây.
//
// Ý tưởng kiến trúc: tách phần "platform-specific" (DOM trình duyệt) ra khỏi
// phần "reconciler" (thuật toán fiber dùng chung). React thật cũng làm vậy:
// react-dom, react-native, react-test-renderer... chia sẻ chung reconciler.
// =============================================================================
import { createContainer, updateContainer } from "../fiber/reconciler";

// Mỗi container DOM chỉ có duy nhất 1 instance Root. Class này gói lại
// FRoot (cây fiber) để có API `render(el)` quen thuộc.
class Root {
  constructor(container) {
    // createContainer trả về FRoot { current: <FNode tag=Root>, containerInfo: container }
    const root = createContainer(container);
    this._root = root;
  }

  render(el) {
    // Mỗi lần gọi render = lên lịch một lượt update cho cả cây
    updateContainer(el, this._root);
  }
}

/**
 * API public để khởi động ứng dụng.
 * @param {VNode} el       - cây element ảo được trả về từ JSX/`h(...)`
 * @param {HTMLElement} container - phần tử DOM thật để mount vào (vd: #root)
 *
 * Lưu trên container một property `_rootContainer` để lần sau (nếu có) còn
 * tái sử dụng cùng FRoot, không tạo lại cây Fiber từ đầu.
 */
export function render(el, container) {
  let root = container._rootContainer;
  if (!root) {
    root = container._rootContainer = new Root(container);
    root.render(el);
  }
  // Lưu ý: ở phiên bản đơn giản này, nếu đã có _rootContainer thì không re-render.
  // Trong React thật sẽ gọi tiếp root.render(el) để trigger update.
}
