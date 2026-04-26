// =============================================================================
// src/fiber/begin-work.js  -- "Pha XUỐNG" của render (1 nửa của DFS)
// -----------------------------------------------------------------------------
// Với fiber WIP đang xét, beginWork sẽ:
//   1. Tuỳ vào tag (Root / DNode / FComponent / Text / Fragment) chạy logic
//      tương ứng để xác định "nextChildren" (con cần render lần này).
//   2. Reconcile children -> dựng/clone các fiber con cho WIP.
//   3. Trả về fiber con đầu tiên để workLoop tiếp tục đi xuống.
//      Nếu không có con (hoặc Text) -> trả null để completeUnitOfWork đi lên.
//
// Ngoài ra có 2 tối ưu BAILOUT (skip subtree không đổi):
//   - Đầu hàm: nếu props/state không thay đổi -> clone children cũ thay vì
//     reconcile lại.
//   - updateFunctionComponent: shallowEqual props -> bailout tương tự.
// =============================================================================
import type { FNode } from "f-node";

import { Root, DNode, FComponent, Text, Fragment } from "../shared/tag";
import { isObject } from "../shared/validate";
import { PerformedWork } from "../shared/effect-tag";
import { reconcileChildren, cloneChildFNodes } from "./children";
import { pushHostContainer } from "./host-context";
import { prepareWithState, finishedWith } from "./f-with";
import { updateRootRender } from "./root-render";
import * as Status from "../shared/status-work";
import shallowEqual from "../shared/shallowEqual";

// test

// Helper "ghim" props/state vào WIP (gọi sau khi đã xử lý xong, làm "snapshot"
// cho lần render tiếp theo so sánh).
export function saveProps(WIP: FNode, props: any): void {
  WIP.prevProps = props;
}

export function saveState(WIP: FNode, state: any): void {
  WIP.prevState = state;
}

// Trường hợp đặc biệt: nếu children chỉ là string/number, ta KHÔNG tạo fiber
// Text con mà set thẳng vào textContent của DNode -> tiết kiệm 1 fiber. Hiện
// hàm này chưa được dùng đầy đủ trong simplified version.
function shouldSetTextContent(type, props) {
  return (
    type === "textarea" ||
    typeof props.children === "string" ||
    typeof props.children === "number" ||
    (typeof props.dangerouslySetInnerHTML === "object" &&
      props.dangerouslySetInnerHTML !== null &&
      typeof props.dangerouslySetInnerHTML.__html === "string")
  );
}

// Đẩy container DOM vào host-context stack. Khi reconcile children, các fiber
// bên dưới có thể đọc được container hiện tại (vd: để xác định namespace HTML/SVG).
function pushHostRootContext(WIP: FNode): void {
  const root = WIP.instanceNode;
  pushHostContainer(WIP, root.containerInfo);
}

// Render cho fiber Root: đọc element user truyền (rootRender.element) làm
// child duy nhất của Root rồi reconcile.
function updateRoot(current: FNode | null, WIP: FNode): FNode | null {
  pushHostRootContext(WIP);

  const rootRender = WIP.rootRender;
  const nextProps = WIP.props;
  const prevState = WIP.prevState;
  const prevChild = prevState !== null ? prevState.element : null;
  // processUpdateQueue(WIP, updateQueue, nextProps, null);
  updateRootRender(WIP, rootRender, nextProps, null);
  const nextState = WIP.prevState;
  const nextChildren = nextState.element;

  reconcileChildren(current, WIP, nextChildren);
  return WIP.child;
}

// Render cho 1 host element (div/p/button...): không gọi function nào, chỉ
// reconcile `props.children` xuống các fiber con.
function updateDomNode(current: FNode | null, WIP: FNode): FNode | null {
  const type = WIP.type;
  const nextProps = WIP.props;
  const prevProps = current !== null ? current.prevProps : null;
  let nextChildren = nextProps.children;
  reconcileChildren(current, WIP, nextChildren);
  saveProps(WIP, nextProps);
  return WIP.child;
}

/**
 * Render function component:
 *   1. BAILOUT: nếu props không đổi (shallowEqual) và status === NoWork
 *      -> clone children cũ -> không gọi lại function -> tiết kiệm CPU.
 *   2. prepareWithState: thiết lập "đầu danh sách hooks" để hooks bên trong
 *      function biết phải đọc/ghi vào fiber nào.
 *   3. Component(nextProps) -> đây là nơi function component thực sự CHẠY
 *      và các hook (withState, lifeCycle) được gọi.
 *   4. finishedWith: chốt lại danh sách hooks vào WIP.prevState, dọn module
 *      state để không bị "chảy" hooks giữa 2 component khác nhau.
 *   5. effectTag |= PerformedWork: đánh dấu cho DevTools là có chạy render.
 *   6. reconcile children với output trả về.
 */
function updateFunctionComponent(
  current: FNode | null,
  WIP: FNode,
  status
): FNode | null {
  const Component = WIP.type;
  const unresolvedProps = WIP.props;
  const nextProps = resolveDefaultProps(Component, unresolvedProps);
  if (current !== null && status === Status.NoWork) {
    const prevProps = current.prevProps;
    if (shallowEqual(prevProps, nextProps) && current.ref === WIP.ref) {
      cloneChildFNodes(current, WIP);
      return WIP.child;
    }
  }

  let nextChildren;
  prepareWithState(current, WIP);

  nextChildren = Component(nextProps);

  nextChildren = finishedWith(Component, nextProps, nextChildren);
  WIP.effectTag |= PerformedWork;
  reconcileChildren(current, WIP, nextChildren);
  return WIP.child;
}

// Text fiber không có con -> chỉ ghim props (chính là text) lại để
// completeWork lần sau biết text mới.
function updateTextNode(current, WIP) {
  const nextProps = WIP.props;
  saveProps(WIP, nextProps);
  return null;
}

// Fragment: props CHÍNH LÀ array children (xem createFNodeFromFragment).
function updateFragment(current, WIP) {
  const nextChildren = WIP.props;
  reconcileChildren(current, WIP, nextChildren);
  return WIP.child;
}

function resolveDefaultProps(Component: Function, baseProps: any) {
  if (Component && Component.defaultProps) {
    // Resolve default props. Taken from ReactElement
    const props = Object.assign({}, baseProps);
    const defaultProps = Component.defaultProps;
    for (let propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
    return props;
  }
  return baseProps;
}

/**
 * Entrypoint của file. workLoop gọi beginWork() trên mỗi fiber.
 *
 * Flow:
 *   - Bailout chung: nếu cả props (so === === reference) và status (=NoWork)
 *     đều "không đổi" -> clone children cũ và đi xuống. Tránh re-render thừa.
 *   - Otherwise: rẽ nhánh theo tag và gọi handler tương ứng.
 *
 * @return fiber con đầu tiên (đi xuống), hoặc null (đã hoàn tất nhánh này).
 */

export function beginWork(current: FNode | null, WIP: FNode): FNode | null {
  const status = WIP.status;
  if (current !== null) {
    const oldProps = current.prevProps;
    const newProps = WIP.props;
    if (oldProps === newProps && WIP.status === Status.NoWork) {
      // we just push root to stack
      if (WIP.tag === Root) {
        pushHostRootContext(WIP);
      }
      // clone this fiber and return child
      cloneChildFNodes(current, WIP);
      return WIP.child;
    }
  }
  // reset WIP
  // Đã quyết định work lần này -> reset về NoWork. Nếu trong quá trình render
  // có setState (dispatchAction) thì chính nó sẽ set lại status = Working.
  WIP.status = Status.NoWork;

  if (WIP.tag === Root) {
    return updateRoot(current, WIP);
  } else if (WIP.tag === DNode) {
    return updateDomNode(current, WIP);
  } else if (WIP.tag === FComponent) {
    return updateFunctionComponent(current, WIP, status);
  } else if (WIP.tag === Text) {
    return updateTextNode(current, WIP);
  } else if (WIP.tag === Fragment) {
    return updateFragment(current, WIP);
  } else return null;
}
