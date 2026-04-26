// =============================================================================
// src/fiber/f-life-cycle.js  -- Mini scheduler cho passive callback
// -----------------------------------------------------------------------------
// Một queue (circular doubly linked list) lưu các callback "chạy sau commit"
// (vd: passive effects của useEffect). Hiện tại là phiên bản tối giản:
// thêm 1 callback rồi flush ngay (xem callLifeCycle).
//
// Trong React thật, file này tương ứng với scheduler hỗ trợ priority levels;
// ở đây ta chỉ cần một hàng đợi để chạy passive effect "sau paint".
// =============================================================================
let firstCallbackNode = null;

// Lấy callback đầu tiên ra khỏi list rồi gọi. Nếu list chỉ còn 1 node, list
// trở thành null. Ngược lại, nối lại các pointer next/previous để giữ tính
// circular.
function flushFirstCallback() {
  let flushedNode = firstCallbackNode;

  let next = firstCallbackNode.next;
  if (firstCallbackNode === next) {
    // This is the last callback in the list.
    firstCallbackNode = null;
    next = null;
  } else {
    let lastCallbackNode = firstCallbackNode.previous;
    firstCallbackNode = lastCallbackNode.next = next;
    next.previous = lastCallbackNode;
  }
  flushedNode.next = flushedNode.previous = null;

  const callback = flushedNode.callback;
  let continuationCallback;

  continuationCallback = callback();
}

/**
 * Đăng ký 1 callback chạy sau commit. Được gọi từ commitRoot khi phát hiện
 * còn passive effect (useEffect-like) chưa chạy.
 *
 * Phiên bản đơn giản: nếu list rỗng -> chèn rồi flush luôn (chạy đồng bộ).
 * Trong implementation đầy đủ, ta sẽ dùng setImmediate/MessageChannel để
 * trì hoãn callback ra ngoài frame -> không chặn paint.
 */
export function callLifeCycle(callback) {
  const newNode = {
    callback: callback,
    next: null,
    previous: null,
  };
  if (firstCallbackNode === null) {
    firstCallbackNode = newNode.next = newNode.previous = newNode;
    flushFirstCallback();
  } else {
    let next = null;
    let node = firstCallbackNode;

    do {
      next = node;
    } while (node !== firstCallbackNode);

    if (next === null) {
      next = firstCallbackNode;
    } else if (next === firstCallbackNode) {
      firstCallbackNode = newNode;
      flushFirstCallback();
    }

    let previous = next.previous;
    previous.next = next.previous = newNode;
    newNode.next = next;
    newNode.previous = previous;
  }
}
