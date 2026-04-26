// =============================================================================
// src/fiber/f-node.js  -- Định nghĩa & helper tạo Fiber Node (FNode)
// -----------------------------------------------------------------------------
// FNode (Fiber Node) là "đơn vị công việc" của reconciler. Mỗi component,
// mỗi DOM element, mỗi text node trong UI đều ứng với một FNode trên cây
// fiber. React thật cũng có cấu trúc tương tự (gọi là Fiber).
//
// Cây fiber được tổ chức kiểu LINKED TREE, không phải mảng:
//   - return : trỏ về cha
//   - child  : con đầu tiên
//   - sibling: anh em kế tiếp
// Nhờ vậy có thể duyệt theo DFS bằng vòng lặp (không đệ quy) và CÓ THỂ
// PAUSE giữa chừng — đó chính là điểm cốt lõi của Fiber.
//
// React duy trì 2 cây song song (double-buffering):
//   - "current"           : đang hiển thị trên màn hình
//   - "work-in-progress"  : đang được dựng cho lần render tiếp theo
// Mỗi node ở cây này có pointer `alternate` trỏ sang node "song sinh" ở
// cây kia. Nhờ thế khi "commit" chỉ cần đổi root.current sang WIP là xong,
// không cần xoá-tạo lại toàn bộ cây.
// =============================================================================
// @flow
import type { VNodeElement, Container } from "../shared/types";
import * as Tag from "../shared/tag";
import * as Status from "../shared/status-work";
import { isString, isFunction } from "../shared/validate";
import { LinkedList } from "../structures/linked-list";

export type FNode = {
  // tag is what we know what is this fiber like root, function component or text ...
  tag: number,
  key: string | null,
  // type of element like button, div
  elementType: string | null,
  // it like element type
  type: string | null,
  // instanceNode is dom element
  instanceNode: any,
  // parent of node
  return: FNode | null,
  // child of node
  child: FNode | null,
  // sibling of node
  sibling: FNode | null,
  // index is index of array children element
  // Eg: [f1, f2, f3] index of f2 is 1
  index: number,
  // props is pending props wait to work
  props: any,
  prevProps: any,
  prevState: any,
  // effect
  effectTag: number,
  nextEffect: FNode | null,
  lastEffect: FNode | null,
  firstEffect: FNode | null,
  // this to test linked list
  linkedList: any,
  // rootRender
  rootRender: any,
  // alternate
  alternate: FNode | null,
  // status to know this fiber need work or not
  status: number,
  // life cycle of this fiber
  lifeCycle: any,
};

export type FRoot = {
  current: FNode,
  containerInfo: any,
};

// Sử dụng function constructor (không phải class) để các JS engine V8 có thể
// "ổn định layout" của object (hidden class) -> truy cập property nhanh hơn.
// Đây là tối ưu y hệt React thật làm.
function FNodeConstructor(tag: number, props: any, key: string | null) {
  this.tag = tag;
  this.key = key;
  this.elementType = null;
  this.type = null;

  this.instanceNode = null;
  this.return = null;
  this.child = null;
  this.sibling = null;
  this.index = 0;

  // props : props "đầu vào" cần xử lý trong lần work này
  // prevProps : props của lần render trước -> để diff (bailout nếu === props mới)
  // prevState : state lưu trữ (đầu danh sách hooks - linked list của các Hook object)
  this.props = props;
  this.prevProps = null;
  this.prevState = null;

  // effect chain: là một linked list nối qua `.next`, gom mọi fiber CÓ side
  // effect (Placement/Update/Deletion/Passive) trong subtree để commit phase
  // chỉ cần "đi một mạch" áp dụng -> không phải duyệt lại cả cây.
  this.effectTag = 0;
  this.nextEffect = null;
  this.firstEffect = null;
  this.lastEffect = null;
  // Phiên bản này dùng class LinkedList (xem structures/linked-list.js) thay
  // vì firstEffect/lastEffect "thô".
  this.linkedList = new LinkedList();
  this.next = null;

  // rootRender chỉ tồn tại trên fiber Root: chứa { element } cần render.
  this.rootRender = null;

  // alternate: trỏ sang fiber đối ứng ở cây song sinh.
  this.alternate = null;

  // Working = cần làm; NoWork = đã xong, có thể bailout.
  this.status = Status.Working;

  // lifeCycle: queue các effect (mounted/destroyed) cho function component này.
  this.lifeCycle = null;
}

// Factory tạo một FNode mới.
export function createFNode(
  tag: number,
  props: any,
  key: string | null
): FNode {
  return new FNodeConstructor(tag, props, key);
}

/**
 * Tạo FRoot — gốc của cả ứng dụng. Bao gồm:
 *   - current        : fiber Root đầu tiên (chính là cây "current" ban đầu)
 *   - containerInfo  : DOM container (#root)
 * Lưu ý kỹ thuật circular: FRoot chứa FNode, mà FNode lại chứa lại FRoot
 * trong instanceNode -> nhờ vậy ở bất cứ fiber nào cũng leo được lên root.
 */
export function createFRoot(container: Container): FRoot {
  const current = new FNodeConstructor(Tag.Root, null, null);
  const root = {
    current: current,
    containerInfo: container,
  };
  current.instanceNode = root;
  return root;
}

/**
 * Tạo (hoặc tái sử dụng) Work-In-Progress fiber từ một fiber "current".
 *
 *   - Lần render đầu  : alternate chưa có -> tạo FNode mới, thiết lập liên
 *                       kết hai chiều current<->WIP qua `alternate`.
 *   - Render lần sau  : alternate đã có sẵn (object cũ ở cây WIP trước đó)
 *                       -> TÁI SỬ DỤNG để giảm allocate (giống free-list).
 *                       Khi tái dùng phải reset effect list & effectTag.
 *
 * Ý tưởng "double buffer" này y hệt cơ chế render frame đồ hoạ: 2 buffer A/B,
 * vẽ xong B thì swap A và B, tránh tearing.
 *
 * @param {FNode} current cây hiện đang hiển thị
 * @param {any}   props    props mới sẽ áp lên WIP
 * @return {FNode} WIP fiber để bắt đầu work
 */

export function createWIP(current: FNode, props: any): FNode {
  if (current === null) return;
  let WIP = current.alternate;
  if (WIP === null) {
    // if workInProgress === null we will start create a work-in-progress tree
    WIP = createFNode(current.tag, props, current.key);
    WIP.elementType = current.elementType;
    WIP.type = current.type;
    // Cùng trỏ về một DOM instance: DOM thuộc về cả 2 phía cho tới khi
    // commit ráp xong.
    WIP.instanceNode = current.instanceNode;

    // Link hai chiều current <-> WIP
    WIP.alternate = current;
    current.alternate = WIP;
  } else {
    // Tái sử dụng: chỉ cần ghi đè props và xoá hết effect cũ.
    WIP.props = props;
    WIP.effectTag = 0;

    // The effect list is no longer valid.
    WIP.nextEffect = null;
    WIP.firstEffect = null;
    WIP.lastEffect = null;
    WIP.linkedList = new LinkedList();
    WIP.next = null;
  }
  // Khởi điểm: WIP "kế thừa" cấu trúc con của current. Đến beginWork() nếu
  // có thay đổi mới clone/tạo mới children (structural sharing).
  WIP.child = current.child;

  WIP.prevProps = current.prevProps;
  WIP.prevState = current.prevState;
  WIP.rootRender = current.rootRender;

  WIP.sibling = current.sibling;
  WIP.index = current.index;

  WIP.status = current.status;

  WIP.lifeCycle = current.lifeCycle;

  return WIP;
}

/**
 * Convert một VNode (element ảo do JSX/`h()` sinh ra) thành FNode.
 *   - type là string ('div', 'p'...)  -> DNode (host element)
 *   - type là function (component)    -> FComponent (function component)
 * Còn Text fiber thì được tạo riêng trong children.js (createFNodeFromText).
 *
 * @param {Element} el is v-node
 * @return {FNode} new Fnode is created based on v-node element
 */

export function createFNodeFromElement(el: VNodeElement): FNode {
  if (el === null) return null;
  const { type = "", key = null, props = {} } = el;
  let fnode;
  if (isString(type)) {
    fnode = createFNode(Tag.DNode, props, key);
  } else if (isFunction(type)) {
    fnode = createFNode(Tag.FComponent, props, key);
  }
  if (fnode !== null) {
    fnode.elementType = type;
    fnode.type = type;
  }
  return fnode;
}

// Khi children là một mảng (vd: users.map(...)) ta gói nó thành 1 fiber
// Fragment -> Fragment không tạo DOM cho chính nó, chỉ chứa danh sách con.
export function createFNodeFromFragment(elements, key) {
  const fnode = createFNode(Tag.Fragment, elements, key);
  return fnode;
}
