// =============================================================================
// src/fiber/host-context.js  -- Stack-based "context" của container DOM
// -----------------------------------------------------------------------------
// Trong khi đang render, ta cần biết ROOT CONTAINER hiện tại để một vài chỗ
// (vd: createDomNodeInstance) lấy được `ownerDocument` đúng. Vì có thể có
// nhiều container lồng nhau (Portal trong React thật), ta dùng STACK:
//   - Vào fiber Root  : push container hiện tại lên stack (beginWork).
//   - Ra fiber Root   : pop khỏi stack (completeWork).
// Cursor trong khi đó luôn trỏ tới giá trị TRÊN CÙNG.
//
// Hiện tại simplified version chỉ có 1 root, không có Portal, nên stack
// thực tế chỉ chứa 1 phần tử. Nhưng kiến trúc giữ nguyên như React thật
// để dễ mở rộng.
// =============================================================================
/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */
import type { StackCursor } from "./stack";
import { createCursor, push, pop } from "./stack";

declare class NoContextT {}
const NO_CONTEXT: NoContextT = ({}: any);

// Cursor cho "root host container". cursor.current luôn là giá trị hiện
// tại trên đỉnh stack.
let rootInstanceStackCursor: StackCursor<T> = createCursor(NO_CONTEXT);

// Hàm nhỏ giả định cursor chắc chắn có giá trị (không phải NO_CONTEXT).
function requiredContext<Value>(c: Value | NoContextT): Value {
  return (c: any);
}

// API public: lấy root container DOM hiện tại để completeWork dùng.
function getRootHostContainer() {
  const rootInstance = requiredContext(rootInstanceStackCursor.current);
  return rootInstance;
}

function pushHostContainer(fiber, nextRootInstance) {
  // Push current root instance onto the stack;
  // This allows us to reset root when portals are popped.
  push(rootInstanceStackCursor, nextRootInstance, fiber);
}

function popHostContainer(fiber) {
  pop(rootInstanceStackCursor, fiber);
}

export { getRootHostContainer, popHostContainer, pushHostContainer };
