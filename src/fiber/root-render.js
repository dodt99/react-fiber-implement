// =============================================================================
// src/fiber/root-render.js
// -----------------------------------------------------------------------------
// Wrapper rất nhỏ giữ "element gốc" mà người dùng truyền vào render(). Trên
// fiber Root, ta lưu nó vào `prevState` để `beginWork -> updateRoot` đọc ra
// và reconcile làm child duy nhất của Root.
//
// Tương đương "updateQueue" của HostRoot trong React thật, nhưng đơn giản
// hơn - chỉ chứa 1 element mới nhất.
// =============================================================================
export function createRootRender(el) {
  const rootRender = {
    element: el,
  };
  return rootRender;
}

export function updateRootRender(WIP, rootRender) {
  let resultState;
  if (rootRender && rootRender.element) {
    resultState = rootRender;
  }
  WIP.prevState = resultState;
}
