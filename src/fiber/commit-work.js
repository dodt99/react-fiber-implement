// =============================================================================
// src/fiber/commit-work.js  -- COMMIT PHASE: thực sự đụng vào DOM
// -----------------------------------------------------------------------------
// Sau khi pha render dựng xong cây WIP và effect-list, scheduler.commitRoot()
// đi qua effect-list, gọi 1 trong 3 hàm chính ở file này:
//
//   commitPlacement(fiber)  -> insert/append fiber.instanceNode vào DOM cha.
//   commitWork(current, fb) -> apply updatePayload (props/text changes).
//   commitDeletion(fiber)   -> gỡ DOM, gọi cleanup (destroyed) trong subtree.
//
// + commitPassiveWithEffects/commitWithEffectList: chạy effect mounted/destroyed
//   của hook lifeCycle.
// =============================================================================
import {
  resetTextContent,
  appendChild,
  appendChildToContainer,
  insertInContainerBefore,
  insertBefore,
  commitUpdate,
  commitTextUpdate,
  removeChildFromContainer,
  removeChild,
} from "../dom/config";
import { Root, DNode, Text, FComponent } from "../shared/tag";
import { ContentReset, Placement } from "../shared/effect-tag";

// "Host parent" = fiber gần nhất có DOM thật để chứa con của ta (DNode/Root).
// FComponent/Fragment KHÔNG phải host parent vì chúng không có DOM riêng.
function isHostParent(fiber) {
  return fiber.tag === DNode || fiber.tag === Root;
}

// Leo lên `return` cho tới khi gặp host parent. Cần thiết để biết append
// vào DOM của ai khi cha trực tiếp là một component/fragment.
function getHostparentFNode(fiber) {
  let parent = fiber.return;
  while (parent !== null) {
    if (isHostParent(parent)) {
      return parent;
    }
    parent = parent.return;
  }
}

/**
 * Tìm DOM "đứng sau" fiber để dùng làm anchor cho insertBefore.
 *
 * Vấn đề: cha của fiber có thể là FComponent/Fragment không có DOM, nên
 * "sibling DOM" không trùng `fiber.sibling`. Ta phải đi sang sibling fiber,
 * rồi xuống sâu cho đến khi gặp một DNode/Text mà:
 *   - là host (có instanceNode), VÀ
 *   - KHÔNG đang được Placement (vì DOM của nó cũng chưa nằm đúng chỗ).
 *
 * Nếu tìm được -> trả DOM của nó (anchor cho insertBefore).
 * Không tìm được -> null -> commitPlacement sẽ appendChild vào cuối.
 */
function getHostSibling(fiber) {
  // We're going to search forward into the tree until we find a sibling host
  // node. Unfortunately, if multiple insertions are done in a row we have to
  // search past them. This leads to exponential search for the next sibling.
  // TODO: Find a more efficient way to do this.
  let node = fiber;
  siblings: while (true) {
    // If we didn't find anything, let's try the next sibling.
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        return null;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
    while (node.tag !== DNode && node.tag !== Text) {
      // If it is not host node and, we might have a host node inside it.
      // Try to search down until we find one.
      if (node.effectTag & Placement) {
        // If we don't have a child, try the siblings instead.
        continue siblings;
      }
      // If we don't have a child, try the siblings instead.
      // We also skip portals because they are not part of this host tree.
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }
    // Check if this host node is stable or about to be placed.
    if (!(node.effectTag & Placement)) {
      // Found it!
      return node.instanceNode;
    }
  }
}

/**
 * Insert / Append fiber `finishedWork` vào DOM cha thật.
 *   1. Tìm host parent fiber -> lấy DOM cha (containerInfo nếu là Root).
 *   2. Tìm "before" anchor (host sibling) để chèn đúng vị trí.
 *   3. Đi qua subtree, mỗi khi gặp DOM "lá" (DNode/Text) thì insert vào DOM cha.
 *      KHÔNG đi vào trong DOM con (vì nội dung bên trong DOM con đã được
 *      ráp từ pha completeWork rồi).
 */
export function commitPlacement(finishedWork) {
  // Recursively insert all host nodes into the parent.
  const parentFNode = getHostparentFNode(finishedWork);

  // Note: these two variables *must* always be updated together.
  let parent;
  let isContainer;

  switch (parentFNode.tag) {
    case DNode:
      parent = parentFNode.instanceNode;
      isContainer = false;
      break;
    case Root:
      parent = parentFNode.instanceNode.containerInfo;
      isContainer = true;
      break;
    default:
      console.log("Invalid host parent");
  }
  if (parentFNode.effectTag & ContentReset) {
    // Reset the text content of the parent before doing any insertions
    resetTextContent(parent);
    // Clear ContentReset from the effect tag
    parentFNode.effectTag &= ~ContentReset;
  }

  const before = getHostSibling(finishedWork);
  let node = finishedWork;
  while (true) {
    if (node.tag === DNode || node.tag === Text) {
      if (before) {
        if (isContainer) {
          insertInContainerBefore(parent, node.instanceNode, before);
        } else {
          insertBefore(parent, node.instanceNode, before);
        }
      } else {
        if (isContainer) {
          appendChildToContainer(parent, node.instanceNode);
        } else {
          appendChild(parent, node.instanceNode);
        }
      }
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === finishedWork) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === finishedWork) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function safelyDetachRef(current) {
  const ref = current.ref;
  if (ref.current !== null) {
  } else {
    ref.current = null;
  }
}

/**
 * Khi 1 fiber bị xoá: nếu là FComponent thì gọi tất cả cleanup function
 * (`destroyed`) của các hook lifeCycle đã từng đăng ký (vd: cleanup của
 * useEffect mounted). Đi qua circular linked-list bằng do-while.
 */
// User-originating errors (lifecycles and refs) should not interrupt
// deletion, so don't let them throw. Host-originating errors should
// interrupt deletion, so it's okay
function commitUnmount(current) {
  switch (current.tag) {
    case FComponent: {
      const lifeCycle = current.lifeCycle;
      if (lifeCycle !== null) {
        const lastEffect = lifeCycle.lastEffect;
        if (lastEffect !== null) {
          const firstEffect = lastEffect.next;
          let effect = firstEffect;
          do {
            const destroyed = effect.destroyed;
            if (!!destroyed && destroyed !== null) {
              destroyed();
            }
            effect = effect.next;
          } while (effect !== firstEffect);
        }
      }
    }
    case DNode: {
      // safelyDetachRef(current);
      return;
    }
  }
}

/**
 * Đi DFS toàn bộ subtree, gọi commitUnmount() cho MỖI fiber để chạy cleanup,
 * nhưng KHÔNG removeChild từng cái - vì khi xoá node DOM gốc, các con DOM
 * đều biến mất theo (browser tự xử). Chỉ cần đảm bảo tất cả lifecycle cleanup
 * trong cây chạy trước khi gỡ DOM "đỉnh" ra.
 */
function commitNestedUnmounts(root) {
  // While we're inside a removed host node we don't want to call
  // removeChild on the inner nodes because they're removed by the top
  // call anyway. We also want to call componentWillUnmount on all
  // composites before this host node is removed from the tree. Therefore
  // we do an inner loop while we're still inside the host node.
  let node = root;
  while (true) {
    commitUnmount(node);
    // Visit children because they may contain more composite or host nodes.
    // Skip portals because commitUnmount() currently visits them recursively.
    if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === root) {
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === root) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

/**
 * Tìm cha host (DOM thật) -> với mỗi DOM "đỉnh" trong subtree gặp được:
 *   - Chạy cleanup cho tất cả con (commitNestedUnmounts).
 *   - removeChild(parent, dom) để gỡ khỏi cây thật.
 * Với fiber không có DOM (FComponent/Fragment) -> chỉ chạy unmount rồi tiếp
 * tục đi sâu xuống tìm DOM bên dưới để remove.
 */
function unmountHostComponents(current) {
  // We only have the top Fiber that was deleted but we need recurse down its
  // children to find all the terminal nodes.
  let node = current;

  // Each iteration, currentParent is populated with node's host parent if not
  // currentParentIsValid.
  let currentParentIsValid = false;
  // Note: these two variables *must* always be updated together.
  let currentParent;
  let currentParentIsContainer;

  while (true) {
    if (!currentParentIsValid) {
      let parent = node.return;
      findParent: while (true) {
        switch (parent.tag) {
          case DNode:
            currentParent = parent.instanceNode;
            currentParentIsContainer = false;
            break findParent;
          case Root:
            currentParent = parent.instanceNode.containerInfo;
            currentParentIsContainer = true;
            break findParent;
        }
        parent = parent.return;
      }
      currentParentIsValid = true;
    }

    if (node.tag === DNode || node.tag === Text) {
      commitNestedUnmounts(node);
      // After all the children have unmounted, it is now safe to remove the
      // node from the tree.
      if (currentParentIsContainer) {
        removeChildFromContainer(currentParent, node.instanceNode);
      } else {
        removeChild(currentParent, node.instanceNode);
      }
    } else {
      commitUnmount(node);
      // Visit children because we may find more host components below.
      if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }
    }

    if (node === current) {
      return;
    }

    while (node.sibling === null) {
      if (node.return === null || node.return === current) {
        return;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// Cắt liên kết của fiber bị xoá khỏi cây để JS GC có thể thu hồi bộ nhớ.
// Phải clear cả 2 phía (current + alternate) vì chúng cross-reference nhau.
function detachFiber(current) {
  // Cut off the return pointers to disconnect it from the tree. Ideally, we
  // should clear the child pointer of the parent alternate to let this
  // get GC:ed but we don't know which for sure which parent is the current
  // one so we'll settle for GC:ing the subtree of this child. This child
  // itself will be GC:ed when the parent updates the next time.
  current.return = null;
  current.child = null;
  if (current.alternate) {
    current.alternate.child = null;
    current.alternate.return = null;
  }
}

// Entry: xoá fiber khỏi DOM + tách ra khỏi cây fiber.
export function commitDeletion(current) {
  unmountHostComponents(current);
  detachFiber(current);
}

/**
 * Áp dụng các thay đổi (Update) cho fiber lên DOM:
 *   - DNode: dùng updatePayload đã tính sẵn ở completeWork (props/text diff).
 *   - Text : đổi nodeValue.
 *   - Root/FComponent: không làm gì (lifecycle xử ở commitWithEffectList).
 */
export function commitWork(current, finishedWork) {
  switch (finishedWork.tag) {
    case FComponent: {
      return;
    }
    case DNode: {
      const instance = finishedWork.instanceNode;
      if (instance !== null) {
        // Commit the work prepared earlier.
        const newProps = finishedWork.prevProps;
        // For hydration we reuse the update path but we treat the oldProps
        // as the newProps. The updatePayload will contain the real change in
        // this case.
        const oldProps = current !== null ? current.prevProps : newProps;
        const type = finishedWork.type;
        // TODO: Type the updateQueue to be specific to host components.
        const updatePayload = finishedWork.updateQueue;
        finishedWork.updateQueue = null;
        if (updatePayload !== null) {
          commitUpdate(
            instance,
            updatePayload,
            type,
            oldProps,
            newProps,
            finishedWork
          );
        }
      }
      return;
    }
    case Text: {
      const textInstance = finishedWork.instanceNode;
      const newText = finishedWork.prevProps;
      const oldText = current !== null ? current.prevProps : newText;
      commitTextUpdate(textInstance, oldText, newText);
      return;
    }
    case Root: {
      return;
    }
    default:
      console.error("Errrrorrrrr!!!");
  }
}

// Passive effects (~ useEffect): được scheduler gọi ở "Pass 3" sau commit.
// Đây CHÍNH LÀ chỗ hook lifeCycle({mounted, destroyed}) của user thực sự fire.
// Theo thứ tự 2 lượt:
//   1) unmount cleanup của lần trước (UnmountPassive=128).
//   2) mount của lần này (MountPassive=64).
// Tách 2 lượt vì destroyed của hook A có thể quan sát DOM/state trước khi
// mounted của hook B chạy. Số literal 128/64 = bit của UnmountPassive/MountPassive
// trong shared/with-effect.js (để tránh phụ thuộc vòng tròn import).
export function commitPassiveWithEffects(finishedWork) {
  commitWithEffectList(128, 0, finishedWork);
  commitWithEffectList(0, 64, finishedWork);
}

/**
 * Helper chung để chạy effect-list của một function component.
 *   unmountTag : bit dùng để chọn các effect cần CLEANUP trong lượt này.
 *   mountTag   : bit dùng để chọn các effect cần MOUNT trong lượt này.
 *
 * `lifeCycle.lastEffect` là 1 circular linked-list, nên cần do-while để duyệt
 * bắt đầu từ first = last.next, dừng khi quay lại first.
 *
 * Mỗi effect:
 *   - Nếu match unmountTag: gọi `destroyed()` (cleanup), clear destroyed.
 *   - Nếu match mountTag  : gọi `mounted()`, lưu giá trị return làm
 *     destroyed cho lần unmount sau.
 */
export function commitWithEffectList(unmountTag, mountTag, finishedWork) {
  const lifeCycle = finishedWork.lifeCycle;
  let lastEffect = lifeCycle !== null ? lifeCycle.lastEffect : null;
  if (lastEffect !== null) {
    let firstEffect = lastEffect.next;
    let effect = firstEffect;
    do {
      if ((effect.tag & unmountTag) !== 0) {
        let destroyed = effect.destroyed;
        effect.destroyed = null;
        if (destroyed !== null && typeof destroyed === "function") {
          destroyed();
        }
      }
      if ((effect.tag & mountTag) !== 0) {
        const mounted = effect.mounted;
        let destroyed = mounted();
        if (typeof destroyed !== "function") {
          destroyed = null;
        }
        effect.destroyed = destroyed;
      }
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}
