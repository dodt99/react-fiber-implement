// =============================================================================
// src/fiber/reconciler.js
// -----------------------------------------------------------------------------
// API "công khai" của reconciler để tầng DOM gọi vào. Mỏng — chỉ gồm 2 hàm:
//   - createContainer : tạo FRoot từ một container DOM.
//   - updateContainer : nhận element mới và lên lịch render lại từ root.
//
// Tách ra ở đây để ngăn `dom/index.js` phải biết nội tại của f-node/scheduler.
// =============================================================================
// @flow
import type { VNodeElement, Container } from "../shared/types";
import type { FNode, FRoot } from "./f-node";

import { createFRoot } from "./f-node";
import { scheduleWork } from "./scheduler";
import { createRootRender } from "./root-render";

export function createContainer(container: Container): FRoot {
  return createFRoot(container);
}

export function updateContainer(el: VNodeElement, FRoot: FRoot): void {
  const current = FRoot.current;
  return scheduleRootUpdate(current, el);
}

// Gắn element cần render lên fiber Root rồi lên lịch work.
// scheduleWork() sẽ leo lên tới Root (đã sẵn sàng) và bắt đầu workLoop.
function scheduleRootUpdate(current: FNode, el: VNodeElement): void {
  const rootRender = createRootRender(el);
  current.rootRender = rootRender;

  scheduleWork(current);
}
