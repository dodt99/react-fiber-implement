// =============================================================================
// src/fiber/children.js  -- Thuật toán reconcile children (diff/key/move)
// -----------------------------------------------------------------------------
// Đây là phần "khó" nhất: cho cùng 1 fiber cha, ta có:
//   - currentFirstChild: danh sách fiber con cũ (linked list qua .sibling)
//   - newChildren     : children mới (có thể là string/number/object/array)
// Cần dựng ra cây fiber con mới sao cho:
//   - Tái sử dụng tối đa fiber cũ (để giữ DOM, state, focus...).
//   - Đánh effectTag = Placement cho fiber cần insert/move.
//   - Đánh effectTag = Deletion cho fiber cũ không còn dùng nữa.
//
// Có 4 trường hợp newChild:
//   1. string/number   -> reconcileSingleTextNode
//   2. element object  -> reconcileSingleElement (tìm theo key + type)
//   3. array           -> reconcileChildrenArray (matching theo INDEX, key)
//   4. khác / null     -> xoá hết các con cũ
//
// Hàm `ChildReconciler(shouldTrackSideEffects)` được gọi 2 lần để tạo 2 phiên bản:
//   - reconcileChilds (true)  : track effect (cho update)
//   - mountChilds     (false) : không cần track (mount lần đầu, mọi fiber sẽ
//                              được Placement bằng cha rồi)
//
// Trick: `placeChild` so sánh `oldIndex` với `lastPlacedIndex` để biết nên
// move hay giữ nguyên. Đây là LIS-lite (Longest Increasing Subsequence) đơn
// giản hoá: phần tử nào có oldIndex lùi về trước -> coi như move (mark
// Placement); ngược lại -> stay in place.
// =============================================================================
import type { Fiber } from "./Fiber";
import { REACT_ELEMENT_TYPE } from "../core/h";
import {
  createWIP,
  createFNodeFromElement,
  createFNodeFromFragment,
  createFNode,
} from "./f-node";
import { Root, DNode, FComponent, Text, Fragment } from "../shared/tag";
import { isArray } from "../shared/validate";
import { NoEffect, Placement, Deletion } from "../shared/effect-tag";

// Closure factory: trả về `reconcileChilds`. Truyền `shouldTrackSideEffects`
// để khi mount lần đầu (false) ta KHÔNG cần đánh Placement/Deletion lên
// từng fiber con - vì cha cũng đang được Placement, append cha là xong cả cây.
function ChildReconciler(shouldTrackSideEffects) {
  // Đánh Deletion lên fiber cũ và đẩy NGAY vào effect-list của cha. Note: ta
  // không thực sự xoá fiber khỏi cây WIP - effect-list vẫn cần giữ tham chiếu
  // tới fiber cũ để commit phase còn gọi removeChild(fiber.instanceNode).
  function deleteChild(returnFNode, childToDelete) {
    if (!shouldTrackSideEffects) {
      return;
    }

    const last = returnFNode.linkedList.last;
    if (last !== null) {
      last.next = childToDelete;
      returnFNode.linkedList.last = childToDelete;
    } else {
      returnFNode.linkedList.first = returnFNode.linkedList.last =
        childToDelete;
    }
    childToDelete.next = null;
    childToDelete.effectTag = Deletion;
  }
  // Xoá tất cả fiber con cũ (và sibling của nó) bắt đầu từ currentFirstChild.
  function deleteRemainingChildren(returnFNode, currentFirstChild) {
    if (!shouldTrackSideEffects) {
      return null;
    }

    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFNode, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }
  /**
   * Quyết định fiber con mới có cần MOVE hay không.
   *   - Insert mới (current === null) -> Placement.
   *   - Tái sử dụng (current khác null):
   *       oldIndex < lastPlacedIndex  -> bị "lùi" -> move -> Placement.
   *       oldIndex >= lastPlacedIndex -> giữ nguyên.
   * Đây là phép so sánh "thuận theo thứ tự cũ" - phần tử nào nằm trong dãy
   * tăng thì giữ, ngược lại bị move.
   */
  function placeChild(newFNode, lastPlacedIndex, newIndex) {
    newFNode.index = newIndex;
    if (!shouldTrackSideEffects) {
      // Noop.
      return lastPlacedIndex;
    }

    const current = newFNode.alternate;
    if (current !== null) {
      const oldIndex = current.index;
      if (oldIndex < lastPlacedIndex) {
        // this is a move
        newFNode.effectTag = Placement;
        return lastPlacedIndex;
      } else {
        // this item can stay in place
        return oldIndex;
      }
    } else {
      // this is an insertion.
      newFNode.effectTag = Placement;
      return lastPlacedIndex;
    }
  }

  // Trường hợp đặc biệt: chỉ có 1 con mới. Nếu là fiber tái sử dụng -> không
  // cần Placement (vẫn ở chỗ cũ); nếu là fiber mới tạo -> Placement.
  function placeSingleChild(newFNode) {
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    if (shouldTrackSideEffects && newFNode.alternate === null) {
      newFNode.effectTag = Placement;
    }
    return newFNode;
  }

  // Tái sử dụng fiber cũ -> tạo WIP từ nó với props mới. Reset index/sibling
  // để cha sẽ set lại theo vị trí mới trong list mới.
  function useFNode(fiber, props) {
    let clone = createWIP(fiber, props);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }

  // Tạo fiber Text. Lưu ý props chính LÀ string text (không có wrapper { children }).
  function createFNodeFromText(content) {
    let fiber = createFNode(Text, content, null);
    return fiber;
  }

  // Tạo fiber con MỚI từ một newChild bất kỳ (không có fiber cũ để tái dùng).
  // Phân loại theo kiểu của newChild.
  function createChild(returnFNode, newChild) {
    if (typeof newChild === "string" || typeof newChild === "number") {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFNodeFromText("" + newChild);
      created.return = returnFNode;
      return created;
    }

    if (typeof newChild === "object" && newChild !== null) {
      if (newChild.$$typeof) {
        const created = createFNodeFromElement(newChild);
        created.return = returnFNode;
        return created;
      }
    }

    if (isArray(newChild)) {
      const created = createFNodeFromFragment(newChild, null);
      created.return = returnFNode;
      return created;
    }
    return null;
  }

  // Cập nhật/insert một text node tại slot tương ứng:
  //   - Slot cũ là fiber Text -> tái sử dụng (đổi nội dung).
  //   - Slot cũ là fiber khác (vd: <p>) -> không tái dùng được -> tạo mới.
  function updateTextNode(returnFNode, current, textContent) {
    if (current !== null && current.tag !== Text) {
      // Insert
      const created = createFNodeFromText(textContent);
      created.return = returnFNode;
      return created;
    } else {
      // Update
      const existing = useFNode(current, textContent);
      existing.return = returnFNode;
      return existing;
    }
  }

  // Tương tự cho element: chỉ tái sử dụng khi cùng `type` (vd: cùng <div>).
  // Nếu khác type (<div> -> <span>) -> phải tạo mới (DOM khác hẳn nhau).
  function updateElement(returnFNode, current, element) {
    if (current !== null && current.elementType === element.type) {
      // Move based on index
      const existing = useFNode(current, element.props);
      existing.return = returnFNode;
      return existing;
    } else {
      // Insert
      const created = createFNodeFromElement(element);
      created.return = returnFNode;
      return created;
    }
  }

  // Fragment-level update.
  function updateFragment(returnFNode, current, fragment) {
    if (current === null || current.tag !== Fragment) {
      // insert
      const created = createFNodeFromFragment(fragment, null);
      created.return = returnFNode;
      return created;
    } else {
      // Update
      const existing = useFNode(current, fragment);
      existing.return = returnFNode;
      return existing;
    }
  }

  /**
   * Đối với 1 cặp (oldFiber, newChild) tại CÙNG vị trí:
   *   - Trả fiber mới (đã update/insert) nếu KHỚP key.
   *   - Trả null nếu KHÔNG khớp key -> caller sẽ break vòng lặp fast-path
   *     và rơi xuống fallback (key matching qua Map - chưa implement đầy đủ).
   *
   * Quy tắc khớp key:
   *   - Text/Array không có key -> chỉ khớp khi oldFiber.key cũng null.
   *   - Element -> phải bằng key của element mới.
   */
  function updateSlot(returnFNode, oldFiber, newChild) {
    const key = oldFiber !== null ? oldFiber.key : null;
    if (typeof newChild === "string" || typeof newChild === "number") {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) {
        return null;
      }
      return updateTextNode(returnFNode, oldFiber, "" + newChild);
    }
    if (typeof newChild === "object" && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          if (newChild.key === key) {
            return updateElement(returnFNode, oldFiber, newChild);
          } else {
            return null;
          }
        }
      }
      if (isArray(newChild)) {
        if (key !== null) {
          return null;
        }
        return updateFragment(returnFNode, oldFiber, newChild);
      }
    }
    return null;
  }

  // Khi không thể match theo thứ tự (vì key đảo lung tung), ta build một
  // Map<key|index, fiberCũ> để lookup O(1). Thuật toán key-aware reconcile
  // thật sự cần phần này, nhưng simplified version chưa dùng (chỉ build map
  // rồi không xài lại).
  function mapRemainingChildren(returnFNode, currentFirstChild) {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<string | number, Fiber> = new Map();
    let existingChild = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        existingChildren.set(existingChild.key, existingChild);
      } else {
        existingChildren.set(existingChild.index, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }

  /**
   * Reconcile cho array children. Có 3 đoạn chính:
   *
   *   1) FAST PATH theo thứ tự: bao lâu key/type cũ và mới còn match -> tái
   *      sử dụng fiber cũ. Vòng for phía dưới chính là phần này.
   *
   *   2) Hết children mới -> xoá các fiber cũ thừa.
   *
   *   3) Hết children cũ -> tạo mới hết phần còn lại (fast path INSERT).
   *
   *   4) (Slow path) Cả 2 phía còn -> xây map theo key rồi match theo key.
   *      Phần này chưa được implement đầy đủ ở simplified version.
   */
  function reconcileChildrenArray(returnFNode, currentFirstChild, newChildren) {
    // resultingFirstChild  : con đầu của list mới (sẽ trả về cho cha)
    // previousnewFNode     : fiber con vừa thêm (để link .sibling)
    // oldFiber             : con cũ đang xét
    // lastPlacedIndex      : "mốc" để biết item có bị move ngược không
    // nextOldFiber         : con cũ kế tiếp (lưu trước khi useFNode reset .sibling)
    let resultingFirstChild = null;
    let previousnewFNode = null;

    let oldFiber = currentFirstChild; // null
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;

    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFNode = updateSlot(returnFNode, oldFiber, newChildren[newIdx]);
      if (newFNode === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      lastPlacedIndex = placeChild(newFNode, lastPlacedIndex, newIdx);

      if (previousnewFNode === null) {
        resultingFirstChild = newFNode;
      } else {
        previousnewFNode.sibling = newFNode;
      }
      previousnewFNode = newFNode;
      oldFiber = nextOldFiber;
    }

    if (newIdx === newChildren.length) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFNode, oldFiber);
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; newIdx < newChildren.length; newIdx++) {
        const newFNode = createChild(returnFNode, newChildren[newIdx]);
        // if newFNode === null continue
        if (!newFNode) {
          continue;
        }
        lastPlacedIndex = placeChild(newFNode, lastPlacedIndex, newIdx);
        // we will set relation ship here
        if (previousnewFNode === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFNode;
        } else {
          previousnewFNode.sibling = newFNode;
        }
        previousnewFNode = newFNode;
      }
      return resultingFirstChild;
    }
    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFNode, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    return resultingFirstChild;
  }

  function reconcileSingleTextNode(
    returnFNode,
    currentFirstChild,
    textContent
  ) {
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    if (currentFirstChild !== null && currentFirstChild.tag === Text) {
      // We already have an existing node so let's just update it and delete
      // the rest.
      deleteRemainingChildren(returnFNode, currentFirstChild.sibling);
      var existing = useFNode(currentFirstChild, textContent);
      existing.return = returnFNode;
      return existing;
    }
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    deleteRemainingChildren(returnFNode, currentFirstChild);
    let created = createFNodeFromText(textContent);
    created.return = returnFNode;
    return created;
  }

  /**
   * Single element: duyệt qua các con cũ tìm fiber có cùng `key`:
   *   - Tìm thấy + cùng type  -> tái sử dụng + xoá phần còn lại của list cũ.
   *   - Tìm thấy + khác type  -> không tái dùng được -> xoá tất cả từ chỗ đó.
   *   - Không thấy            -> tạo mới.
   */
  function reconcileSingleElement(returnFNode, currentFirstChild, el) {
    let key = el.key;
    let child = currentFirstChild;
    while (child !== null) {
      if (child.key === key) {
        if (child.type === el.type) {
          // if we had a child we use exactly it
          deleteRemainingChildren(returnFNode, child.sibling);
          let existing = useFNode(child, el.props);
          existing.return = returnFNode;
          return existing;
        } else {
          deleteRemainingChildren(returnFNode, child);
          break;
        }
      }
      child = child.sibling;
    }
    // create a fiber from this child and set the parent
    const created = createFNodeFromElement(el);
    // created.ref = coerceRef(returnFNode, currentFirstChild, element);
    created.return = returnFNode;
    return created;
  }

  /**
   * Entry chính của ChildReconciler: phân loại newChild và rẽ nhánh.
   * Trả về fiber con đầu tiên (cây con đã được dựng), set effectTag phù hợp.
   */
  function reconcileChilds(returnFNode, currentFirstChild, newChild) {
    const isObject = typeof newChild === "object" && newChild !== null;

    if (isObject) {
      if (newChild.$$typeof) {
        // after find a child we will set effectTag is Placement ... it's mean we will create it
        return placeSingleChild(
          reconcileSingleElement(returnFNode, currentFirstChild, newChild)
        );
      }
    }
    if (typeof newChild === "string" || typeof newChild === "number") {
      // after find a child we will set effectTag is Placement ... it's mean we will create it
      return placeSingleChild(
        reconcileSingleTextNode(returnFNode, currentFirstChild, "" + newChild)
      );
    }
    if (isArray(newChild)) {
      return reconcileChildrenArray(returnFNode, currentFirstChild, newChild);
    }
    return deleteRemainingChildren(returnFNode, currentFirstChild);
  }

  return reconcileChilds;
}

// 2 phiên bản: track effect (cho update) và không track (cho mount).
export const reconcileChilds = ChildReconciler(true);
export const mountChilds = ChildReconciler(false);

/**
 * Bailout helper: KHI props của fiber không thay đổi, ta không cần reconcile
 * lại children theo VNode mới (vẫn là chính nó). Nhưng vẫn phải tạo bản WIP
 * cho từng con (vì WIP và current là 2 cây song song, cần các fiber WIP để
 * đi xuống). Đây là lý do clone "shallow" qua createWIP.
 */
export function cloneChildFNodes(current, WIP) {
  if (WIP.child === null) {
    return;
  }
  let currentChild = WIP.child;
  let newChild = createWIP(currentChild, currentChild.props);
  WIP.child = newChild;

  newChild.return = WIP;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWIP(currentChild, currentChild.props);
    newChild.return = WIP;
  }
  newChild.sibling = null;
}

/**
 * Entry public: chọn version đúng (mount vs update) tuỳ trạng thái current.
 *   - current === null  -> render lần đầu, dùng mountChilds (no track).
 *   - current khác null -> update, dùng reconcileChilds (track effect).
 */
export function reconcileChildren(current, WIP, nextChild) {
  if (current === null) {
    WIP.child = mountChilds(WIP, null, nextChild);
  } else {
    WIP.child = reconcileChilds(WIP, current.child, nextChild);
  }
}
