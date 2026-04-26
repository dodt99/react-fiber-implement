// =============================================================================
// src/fiber/complete-work.js  -- "Pha LÊN" của render (nửa còn lại của DFS)
// -----------------------------------------------------------------------------
// Khi 1 fiber không còn con để xuống (hoặc đã xử lý hết con), workLoop sẽ
// gọi completeWork(). Trách nhiệm:
//
//   1) Với DNode/Text lần đầu : TẠO DOM instance thật (offline, chưa attach
//      vào document) và append các con vào nó (appendAllChildren).
//   2) Với DNode đã có instance: DIFF props -> tạo updatePayload, đánh
//      effectTag = Update nếu có thay đổi -> commit phase sau sẽ apply.
//   3) Với Root: pop host context khỏi stack.
//   4) Với FComponent/Fragment: không làm gì (chỉ cần con đã hoàn tất).
//
// Đây là chỗ "kết nối" reconciler với host config (dom/config.js).
// =============================================================================
import { Root, DNode, Text, FComponent, Fragment } from "../shared/tag";
import { Placement, Update } from "../shared/effect-tag";

import { getRootHostContainer, popHostContainer } from "./host-context";

import {
  createTextInstance,
  createDomNodeInstance,
  appendInitialChild,
  finalizeInitialChildren,
  prepareUpdate,
} from "../dom/config";

// Thêm flag Update vào effectTag (giữ nguyên các flag khác). Nếu fiber đã có
// Placement -> kết quả là PlacementAndUpdate (một fiber vừa được insert mới
// vừa cần update props - rare nhưng có).
function markUpdate(WIP) {
  // Tag the fiber with an update effect. This turns a Placement into
  // a PlacementAndUpdate.
  WIP.effectTag |= Update;
}

// Stub - simplified version chưa dùng. Thường dùng để portal hoặc reset
// container giữa các root.
export function updateHostContainer(WIP) {}

/**
 * DNode đã có DOM instance từ trước (đây là update, không phải mount).
 *   - So sánh oldProps vs newProps. Bằng nhau (===) -> bailout.
 *   - Khác nhau -> gọi prepareUpdate -> diffProperties -> cấp updatePayload.
 *   - Lưu payload vào WIP.updateQueue để commitWork đọc ra mà apply.
 *   - markUpdate để fiber được đẩy vào effect-list.
 */
export function updateHostComponent(
  current,
  WIP,
  type,
  newProps,
  rootContainerInstance
) {
  // If we have an alternate, that means this is an update and we need to
  // schedule a side-effect to do the updates.
  const oldProps = current.prevProps;
  if (oldProps === newProps) {
    // In mutation mode, this is sufficient for a bailout because
    // we won't touch this node even if children changed.
    return;
  }

  // If we get updated because one of our children updated, we don't
  // have newProps so we'll have to reuse them.
  // TODO: Split the update API as separate for the props vs. children.
  // Even better would be if children weren't special cased at all tho.
  const instance = WIP.instanceNode;
  // TODO: Experiencing an error where oldProps is null. Suggests a host
  // component is hitting the resume path. Figure out why. Possibly
  // related to `hidden`.
  const updatePayload = prepareUpdate(
    instance,
    type,
    oldProps,
    newProps,
    rootContainerInstance
  );

  // // TODO: Type this specific to this type of component.
  WIP.updateQueue = WIP;
  // If the update payload indicates that there is a change or if there
  // is a new ref we mark this as an update. All the work is done in commitWork.
  if (updatePayload) {
    markUpdate(WIP);
  }
}

// Text fiber update: chỉ cần markUpdate nếu text thật sự thay đổi.
// Không cần payload vì thông tin "newText" nằm sẵn trong prevProps.
export function updateHostText(current, WIP, oldText, newText) {
  if (oldText !== newText) {
    markUpdate(WIP);
  }
}

/**
 * Đi DFS qua subtree của WIP và append mọi DOM instance "lá" (DNode/Text)
 * trực tiếp vào `parent`. Quan trọng: KHÔNG đi qua DOM của fiber con DNode
 * (vì chính DNode con đó đã append các con nó từ lượt completeWork trước).
 *
 * Khi gặp FComponent/Fragment (không có DOM riêng), ta phải đi tiếp xuống
 * con của nó để tìm DOM "thực sự" mà append.
 *
 * Ví dụ cây fiber:
 *     div                <- WIP đang complete
 *      └── App (FComp)
 *           ├── p        <- append
 *           └── span     <- append (KHÔNG đi vào span để append cháu)
 */
function appendAllChildren(parent, WIP) {
  let node = WIP.child;
  while (node !== null) {
    if (node.tag === DNode || node.tag === Text) {
      // Lá DOM -> append rồi nhảy sang sibling/parent (KHÔNG đi xuống).
      appendInitialChild(parent, node.instanceNode);
    } else if (node.child !== null) {
      // FComponent/Fragment -> đi xuống tìm DOM lá.
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === WIP) {
      return;
    }
    // Hết subtree này -> leo lên cha tới khi tìm thấy sibling -> đi sang.
    while (node.sibling === null) {
      if (node.return === null || node.return === WIP) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

/**
 * Entry: xử lý fiber WIP theo tag. Trả null vì pha "lên" không cần đi xuống.
 *   - Root      : pop host context (đối ứng push trong beginWork). Nếu là
 *                 lần render đầu (current.child === null) thì xoá flag
 *                 Placement của Root để không tạo DOM thừa cho root.
 *   - FComponent: chỉ là logic, không cần DOM.
 *   - DNode     : nếu đã có instance -> diff props (update). Lần đầu ->
 *                 createDOM + appendAllChildren + setInitialProperties.
 *   - Text      : tương tự DNode nhưng đơn giản hơn (chỉ có nodeValue).
 *   - Fragment  : không có DOM.
 */
export function completeWork(current, WIP) {
  // after beginWork work we props is new props
  const newProps = WIP.props;
  switch (WIP.tag) {
    case Root: {
      popHostContainer(WIP);
      // const fiberRoot = WIP.instanceNode;
      if (current === null || current.child === null) {
        WIP.effectTag &= ~Placement;
      }
      // updateHostContainer(WIP);
      return null;
    }
    case FComponent: {
      return null;
    }
    case DNode: {
      const rootContainerInstance = getRootHostContainer();
      const type = WIP.type;
      if (current !== null && WIP.instanceNode !== null) {
        // Update path
        updateHostComponent(
          current,
          WIP,
          type,
          newProps,
          rootContainerInstance
        );
      } else {
        if (!newProps) {
          break;
        }

        // Mount path: tạo DOM offline -> ráp con vào -> set thuộc tính.
        // const currentHostContext = getHostContext();
        const currentHostContext = {
          namespace: "http://www.w3.org/1999/xhtml",
        };
        // create instance of element or fiber.. instance will be like document.createElement('div')
        let instance = createDomNodeInstance(
          type,
          newProps,
          rootContainerInstance,
          currentHostContext,
          WIP
        );
        appendAllChildren(instance, WIP);
        // this function to set property to element
        finalizeInitialChildren(
          instance,
          type,
          newProps,
          rootContainerInstance,
          currentHostContext
        );
        // and set state node
        WIP.instanceNode = instance;
      }
      return null;
    }
    case Text: {
      const newText = newProps;
      // that means it rendered
      if (current !== null && WIP.instanceNode !== null) {
        let oldText = current.prevProps;
        updateHostText(current, WIP, oldText, newText);
      } else {
        if (typeof newText !== "string") {
          return null;
        }
        const rootContainerInstance = getRootHostContainer();
        WIP.instanceNode = createTextInstance(
          newText,
          rootContainerInstance,
          WIP
        );
      }
      return null;
    }
    case Fragment: {
      return null;
    }
    default:
      return null;
  }
}
