// =============================================================================
// src/fiber/stack.js  -- Stack có "cursor" dùng cho host-context và (tương lai)
//                        legacy context API.
// -----------------------------------------------------------------------------
// Mô hình "cursor + stack":
//   - cursor.current giữ giá trị HIỆN TẠI (top of stack).
//   - valueStack lưu các giá trị bị "che" để pop sau khôi phục.
//   - push(cursor, newValue, fiber) :
//        valueStack.push(cursor.current); cursor.current = newValue;
//   - pop(cursor, fiber):
//        cursor.current = valueStack.pop();
//
// Tại sao không dùng `Array.prototype.push/pop` trực tiếp? React tối ưu bằng
// cách dùng index thủ công + tránh allocate array mới. Đây là pattern y hệt
// React thật.
// =============================================================================
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
export type StackCursor<T> = {
  current: T,
};

// Mảng giá trị "bị che" sau khi push. Khi pop sẽ lấy lại từ đây.
const valueStack: Array<any> = [];

// fiberStack (commented): React thật còn dùng để track fiber tại từng level
// stack -> hỗ trợ assertion "pop có khớp với push không" trong dev mode.
let fiberStack: Array<any>;

// "Đỉnh" stack (-1 nghĩa là rỗng). Dùng index thay vì .length để tránh phải
// shift mảng và để có thể "rewind" nhanh trong các scenario đặc biệt.
let index = -1;

// Tạo 1 cursor mới với giá trị mặc định.
function createCursor<T>(defaultValue: T): StackCursor<T> {
  return {
    current: defaultValue,
  };
}

function isEmpty(): boolean {
  return index === -1;
}

// Lấy giá trị "phía dưới" trong valueStack ra rồi gán lại cho cursor.current.
function pop<T>(cursor: StackCursor<T>, fiber): void {
  if (index < 0) {
    return;
  }

  cursor.current = valueStack[index];
  valueStack[index] = null;
  // fiberStack[index] = null;
  index--;
}

// Đẩy giá trị HIỆN TẠI của cursor vào stack rồi đặt cursor.current = value mới.
function push<T>(cursor: StackCursor<T>, value: T, fiber): void {
  index++;

  valueStack[index] = cursor.current;
  // fiberStack[index] = fiber;

  cursor.current = value;
}

export { createCursor, isEmpty, pop, push };
