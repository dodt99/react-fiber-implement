// =============================================================================
// src/fiber/scheduler.js  -- Trái tim của Fiber: workLoop & commit
// -----------------------------------------------------------------------------
// File này điều phối toàn bộ "vòng đời" một lượt render:
//
//   Pha 1 - RENDER (interruptible, chia thành nhiều unit):
//     scheduleWork()  -> requestIdleCallback -> performWork() -> workLoop()
//     workLoop chạy chừng nào còn time slice rảnh, mỗi tick xử lý 1 fiber:
//        performUnitOfWork = beginWork() → completeUnitOfWork() (khi hết con)
//     Trong pha này CHƯA đụng tới DOM thật. Chỉ dựng cây WIP + effect list.
//
//   Pha 2 - COMMIT (đồng bộ, KHÔNG bị ngắt):
//     commitRoot() duyệt effect list 2 lượt:
//        Lượt 1: commitAllHostEffects()  -> apply DOM (Placement/Update/Deletion)
//        Lượt 2: commitAllLifeCycles()   -> chạy lifecycle (mounted/destroyed)
//     Sau commit đổi root.current = WIP (swap 2 cây).
//
// Cơ chế chia nhỏ work + requestIdleCallback chính là điểm khác biệt cốt lõi
// giữa Fiber và Stack reconciler trước đó: render lâu không còn block UI nữa.
// =============================================================================
// @flow
import type { FNode, FRoot } from "./f-node";

import { Root, Text, DNode, FComponent } from "../shared/tag";
import {
  Incomplete,
  NoEffect,
  PerformedWork,
  Placement,
  Deletion,
  Update,
  Passive,
  PlacementAndUpdate,
} from "../shared/effect-tag";
import { UnmountLayout, MountLayout } from "../shared/with-effect";
import { createWIP } from "./f-node";
import { beginWork } from "./begin-work";
import { completeWork } from "./complete-work";
import {
  commitPlacement,
  commitDeletion,
  commitWork,
  commitPassiveWithEffects,
  commitWithEffectList,
} from "./commit-work";
import { resetWiths } from "./f-with";
import { callLifeCycle } from "./f-life-cycle";
import { LinkedList } from "../structures/linked-list";
// Ngưỡng (ms) còn lại trong frame ta vẫn cố làm thêm 1 unit. Quá nhỏ thì
// trả frame sớm, đủ to thì tận dụng được nhiều thời gian rảnh.
const expireTime = 1;

// Module-level state để giữ tiến độ giữa các tick của requestIdleCallback.
// Nhờ vậy mỗi lần callback chạy lại, ta tiếp tục từ đúng chỗ đã dừng.
let nextUnitOfWork = null;
let nextEffect = null;

// Đánh dấu root nào còn passive effect (useEffect) cần flush sau paint.
let rootWithPendingPassiveEffects = null;

/**
 * ENTRY chính để lên lịch render. Được gọi từ:
 *   - reconciler.scheduleRootUpdate (lần render đầu / render lại từ root)
 *   - hook dispatchAction trong f-with.js (khi setState)
 *
 * Việc cần làm:
 *   1. Leo lên Root (vì work luôn phải bắt đầu từ root để dựng cây WIP).
 *   2. Reset trạng thái hooks (đề phòng lần trước render dở giữa chừng).
 *   3. Đặt 1 callback chạy khi browser rảnh (nhường UI thread cho user).
 */
export function scheduleWork(fnode: FNode): void {
  const root = getRootFromFnode(fnode);
  if (root === null) {
    // clone here
    return;
  }
  resetWiths();
  requestIdleCallback((dl) => performWork(dl, root));
}

// Đệ quy đi theo .return cho tới khi gặp fiber Root, lấy ra FRoot từ
// instanceNode của nó (xem createFRoot).
function getRootFromFnode(fnode: FNode): FRoot {
  let node = fnode;
  if (fnode !== null && node.tag === Root && node.return === null) {
    return fnode.instanceNode;
  }
  node = node.return;
  return getRootFromFnode(node);
}

/**
 * Một "lượt" được idle callback gọi:
 *   - workLoop xử lý được bao nhiêu fiber trong slice hiện tại thì xử.
 *   - Nếu chưa hết việc (nextUnitOfWork khác null) -> đặt tiếp idle callback
 *     khác, khi browser rảnh lại tiếp tục từ đúng vị trí đó.
 *   - Nếu hết việc -> bắt đầu COMMIT (completeRoot).
 */
function performWork(dl: any, root: FRoot): void {
  workLoop(dl, root);
  if (nextUnitOfWork) {
    requestIdleCallback((dl) => performWork(dl, root));
  }
  if (nextUnitOfWork === null) {
    let finishedWork = root.current.alternate;
    if (finishedWork) {
      // complete Root
      completeRoot(root, finishedWork);
    }
  }
}

/**
 * Vòng lặp chính của pha render. Mỗi vòng lặp xử lý 1 fiber. Điều kiện dừng:
 *   - Hết việc (nextUnitOfWork === null), hoặc
 *   - dl.timeRemaining() < expireTime  (gần hết frame, phải nhường lại trình
 *     duyệt để render UI/handle event mượt) -> đây chính là "pause-able" của
 *     Fiber.
 */
function workLoop(dl: any, root: FRoot): void {
  if (!nextUnitOfWork) {
    // Khởi tạo WIP từ Root cho lượt mới.
    nextUnitOfWork = createWIP(root.current, null);
  }
  while (nextUnitOfWork !== null && dl.timeRemaining() > expireTime) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
}

/**
 * Xử lý 1 fiber:
 *   1. beginWork: render component (gọi function), reconcile children, trả
 *      về fiber con để work tiếp (DFS đi xuống).
 *   2. Nếu không có con (next === null) -> completeUnitOfWork (DFS đi lên,
 *      tạo DOM instance, gom effect, sang sibling, rồi return về cha).
 */
function performUnitOfWork(WIP: FNode): FNode {
  const current = WIP.alternate;
  let next;
  next = beginWork(current, WIP);
  // Lưu lại props vừa xử lý để các lần sau bailout (so === === ngay).
  WIP.prevProps = WIP.props;
  if (next === null) {
    next = completeUnitOfWork(WIP);
  }
  return next;
}

/**
 * Đi LÊN khi không còn con để xuống. Tại đây ta:
 *   - Gọi completeWork(WIP) để tạo DOM instance / chuẩn bị updatePayload.
 *   - Gắn fiber có effect vào effect-list của fiber CHA (linkedList) -> commit
 *     phase chỉ cần đi 1 đường thẳng.
 *   - Nếu có sibling -> trả về để workLoop xử lý sibling.
 *   - Nếu không -> tiếp tục đi lên cha (while true).
 *   - Đi tới khi return về null -> đã chạm Root -> kết thúc pha render.
 */
function completeUnitOfWork(WIP: FNode): FNode | null {
  // Attempt to complete the current unit of work, then move to the
  // next sibling. If there are no more siblings, return to the
  // parent fiber.

  while (true) {
    // The current, flushed, state of this fiber is the alternate.
    // Ideally nothing should rely on this, but relying on it here
    // means that we don't need an additional field on the work in
    // progress.
    const current = WIP.alternate;
    const returnFNode = WIP.return;

    const siblingFNode = WIP.sibling;
    if ((WIP.effectTag & Incomplete) === NoEffect) {
      // completeWork work to create instanceNode of this WIP
      let next = completeWork(current, WIP);
      if (next !== null) {
        return next;
      }

      if (
        returnFNode !== null &&
        // Do not append effects to parents if a sibling failed to complete
        (returnFNode.effectTag & Incomplete) === NoEffect
      ) {
        // Gộp effect-list của con (đã hoàn tất) vào của cha.
        returnFNode.linkedList.addEffectToParent(WIP);
        // If this fiber had side-effects, we append it AFTER the children's
        // side-effects. We can perform certain side-effects earlier if
        // needed, by doing multiple passes over the effect list. We don't want
        // to schedule our own side-effect on our own list because if end up
        // reusing children we'll schedule this effect onto itself since we're
        // at the end.
        let effectTag = WIP.effectTag;
        // Skip both NoWork and PerformedWork tags when creating the effect list.
        // PerformedWork effect is read by React DevTools but shouldn't be committed.
        // Bản thân fiber có effect (Placement/Update/Deletion/Passive) -> thêm
        // CHÍNH NÓ vào effect-list của cha SAU effect của con (post-order).
        if (effectTag > PerformedWork) {
          returnFNode.linkedList.add(WIP);
        }
      }

      if (siblingFNode !== null) {
        // If there is more work to do in this returnFNode, do that next.
        return siblingFNode;
      } else if (returnFNode !== null) {
        // If there's no more work in this returnFNode. Complete the returnFNode.
        WIP = returnFNode;
        continue;
      } else {
        // We've reached the root.
        return null;
      }
    } else {
      if (siblingFNode !== null) {
        // If there is more work to do in this returnFNode, do that next.
        return siblingFNode;
      } else if (returnFNode !== null) {
        // If there's no more work in this returnFNode. Complete the returnFNode.
        WIP = returnFNode;
        continue;
      } else {
        return null;
      }
    }
  }

  return null;
}

// Wrapper trước khi commit. Tách ra cho dễ chèn logic chuẩn bị (vd: kiểm tra
// còn task khác cùng priority, batch nhiều update...).
export function completeRoot(root: FRoot, finishedWork: FNode): void {
  // Commit the root.
  root.finishedWork = null;
  commitRoot(root, finishedWork);
}

/**
 * COMMIT PHASE - đồng bộ, không bị ngắt. Có 3 pass:
 *   Pass 1: commitAllHostEffects() - apply mọi mutation DOM (Placement / Update /
 *           Deletion). Sau pass này DOM thật đã ở đúng trạng thái mới.
 *
 *   <SWAP root.current ← finishedWork>
 *
 *   Pass 2: commitAllLifeCycles() - chạy "layout-like" lifecycle (cờ MountLayout/
 *           UnmountLayout). Trong codebase đơn giản này, hook `lifeCycle()` của
 *           user KHÔNG dùng cờ này nên pass 2 thực tế chỉ làm việc đánh dấu
 *           rootWithPendingPassiveEffects nếu có effect Passive.
 *
 *   Pass 3 (passive, deferred): nếu pass 2 đánh dấu rằng còn passive effect,
 *           ta callLifeCycle(commitPassiveEffects) — chính TẠI ĐÂY các
 *           `mounted()`/`destroyed()` của user mới thực sự được gọi (xem
 *           commit-work.js → commitPassiveWithEffects).
 *
 * Lý do tách: layout effect cần DOM ở trạng thái mới (Pass 1 xong rồi);
 * passive thì để "sau paint" (trong React thật), tránh chặn frame. Phiên bản
 * tối giản này flush passive ngay đồng bộ — xem callLifeCycle trong f-life-cycle.js.
 */
export function commitRoot(root: FRoot, finishedWork: FNode): void {
  let firstEffect;
  const linkedList = finishedWork.linkedList;

  // Effect-list của 1 fiber chỉ gồm các CON. Nếu bản thân root cũng có effect
  // thì phải nối nó vào cuối list để commit luôn cả bản thân.
  if (finishedWork.effectTag > PerformedWork) {
    // A fiber's effect list consists only of its children, not itself. So if
    // the root has an effect, we need to add it to the end of the list. The
    // resulting list is the set that would belong to the root's parent, if
    // it had one; that is, all the effects in the tree including the root.
    if (linkedList.last !== null) {
      linkedList.last.next = finishedWork;
      firstEffect = linkedList.first;
    } else {
      firstEffect = finishedWork;
    }
  } else {
    // There is no effect on the root.
    firstEffect = linkedList.first;
  }

  // Pass 1: Apply DOM mutations (Placement/Update/Deletion).
  nextEffect = firstEffect;
  while (nextEffect !== null) {
    commitAllHostEffects();
    if (nextEffect !== null) {
      nextEffect = nextEffect.next;
    }
  }

  // Invoke instances of getSnapshotBeforeUpdate before mutation.

  // SWAP cây: WIP (đã commit xong DOM) trở thành "current".
  // Sau đoạn này, đọc root.current sẽ thấy cây mới.
  root.current = finishedWork;

  // Pass 2: chạy "layout-like" lifecycle. Trong codebase này hook lifeCycle()
  // của user dùng cờ Passive nên pass 2 chỉ ghi nhớ rootWithPendingPassiveEffects;
  // các mounted()/destroyed() user-land sẽ chạy ở Pass 3 (passive flush) bên dưới.
  nextEffect = firstEffect;

  //commitAllLifeCircleHere
  while (nextEffect !== null) {
    commitAllLifeCycles(root);
    if (nextEffect !== null) {
      nextEffect = nextEffect.next;
    }
  }

  // This commit included a passive effect. These do not need to fire until
  // after the next paint. Schedule an callback to fire them in an async
  // event. To ensure serial execution, the callback will be flushed early if
  // we enter rootWithPendingPassiveEffects commit phase before then.
  if (firstEffect !== null && rootWithPendingPassiveEffects !== null) {
    let callback = commitPassiveEffects.bind(null, root, firstEffect);
    callLifeCycle(callback);
  }
}

function commitPassiveEffects(root: FRoot, firstEffect: FNode): void {
  rootWithPendingPassiveEffects = null;
  let effect = firstEffect;
  do {
    if (effect.effectTag & Passive) {
      try {
        commitPassiveWithEffects(effect);
      } catch (err) {
        console.log(err);
      }
    }
    effect = effect.next;
  } while (effect !== null);
}

/**
 * Đi qua effect-list, gọi mutation tương ứng cho mỗi effect:
 *   Placement          -> commitPlacement (insert/append vào DOM)
 *   PlacementAndUpdate -> Placement xong rồi Update
 *   Update             -> commitWork (apply payload props/text)
 *   Deletion           -> commitDeletion (remove khỏi DOM, gọi cleanup)
 *
 * Bitwise trick: effectTag là tổ hợp các flag (cộng dồn bit). Lấy
 * `effectTag & (Placement | Update | Deletion)` để chỉ còn các flag chính.
 */
function commitAllHostEffects() {
  while (nextEffect !== null) {
    const effectTag = nextEffect.effectTag;
    // The following switch statement is only concerned about placement,
    // updates, and deletions. To avoid needing to add a case for every
    // possible bitmap value, we remove the secondary effects from the
    // effect tag and switch on that value.
    let primaryEffectTag = effectTag & (Placement | Update | Deletion);
    switch (primaryEffectTag) {
      case Placement: {
        commitPlacement(nextEffect);
        // Clear the "placement" from effect tag so that we know that this is inserted, before
        // any life-cycles like componentDidMount gets called.
        // TODO: findDOMNode doesn't rely on this any more but isMounted
        // does and isMounted is deprecated anyway so we should be able
        // to kill this.
        nextEffect.effectTag &= ~Placement;
        break;
      }
      case PlacementAndUpdate: {
        // Placement
        commitPlacement(nextEffect);
        // Clear the "placement" from effect tag so that we know that this is inserted, before
        // any life-cycles like componentDidMount gets called.
        nextEffect.effectTag &= ~Placement;

        // Update
        const current = nextEffect.alternate;
        commitWork(current, nextEffect);
        break;
      }
      case Update: {
        const current = nextEffect.alternate;
        commitWork(current, nextEffect);
        break;
      }
      case Deletion: {
        commitDeletion(nextEffect);
        break;
      }
      default:
        break;
    }
    nextEffect = nextEffect.next;
  }
}

// Pass 2: với mỗi effect có cờ Update -> gọi commitLifeCycles. Hàm đó chỉ chạy
// các effect được tag MountLayout/UnmountLayout (giống useLayoutEffect) — đồng bộ
// ngay sau khi DOM đã apply ở Pass 1.
//   Nếu effect là Passive (giống useEffect) -> chỉ ghi nhớ root, KHÔNG chạy ở
//   đây; commitRoot sẽ schedule commitPassiveEffects để chạy ở "Pass 3" (deferred).
//   Trong codebase đơn giản này, hook lifeCycle() của user đăng ký Passive nên
//   thực tế tất cả mounted()/destroyed() user-land đều chạy ở Pass 3.
function commitAllLifeCycles(finishedRoot) {
  while (nextEffect !== null) {
    const effectTag = nextEffect.effectTag;
    if (effectTag & Update) {
      const current = nextEffect.alternate;
      commitLifeCycles(finishedRoot, current, nextEffect);
    }
    if (effectTag & Passive) {
      rootWithPendingPassiveEffects = finishedRoot;
    }
    nextEffect = nextEffect.next;
  }
}

// Layout-style lifecycle chỉ áp dụng cho FComponent. DNode/Text/Root không có
// user-land lifecycle. Lưu ý: pass này dùng cờ MountLayout/UnmountLayout nên
// trong demo (lifeCycle gắn cờ Passive) nó KHÔNG chạy hàm nào — mounted/destroyed
// của user thực sự fire trong commitPassiveWithEffects (commit-work.js).
function commitLifeCycles(finishedRoot, current, finishedWork) {
  switch (finishedWork.tag) {
    case FComponent:
      commitWithEffectList(UnmountLayout, MountLayout, finishedWork);
      return;
    case Root:
      return;
    case DNode:
      return;
    case Text:
      return;
    default:
      console.log("Error");
  }
}
