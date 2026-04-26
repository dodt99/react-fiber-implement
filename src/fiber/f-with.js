// =============================================================================
// src/fiber/f-with.js  -- Cài đặt hooks (withState ~ useState, withLifeCycle ~ useEffect)
// -----------------------------------------------------------------------------
// Hooks không phải "ma thuật" - chúng dựa vào 2 tính chất:
//   1. Function component được render TUẦN TỰ; thứ tự gọi hook là cố định.
//   2. Có một biến module ghi nhớ "fiber đang render" để hook biết phải đọc/
//      ghi vào đâu.
//
// Mỗi hook là một object Hook = { prevState, baseState, queue, baseUpdate, next }.
// Tất cả hook của 1 component xếp thành LINKED LIST, đầu danh sách lưu ở
// `fiber.prevState`. Đó là lý do khi render lại ta lấy `current.prevState`
// để biết hook nào ứng với hook nào.
//
// Quy ước biến module:
//   currentlyRenderingFNode : fiber WIP đang chạy hàm component.
//   firstCurrentWith        : đầu list Hook ở fiber CURRENT (lần render trước).
//   currentWith             : con trỏ đang đi trong list current.
//   firstWIPFNode           : đầu list Hook đang dựng cho fiber WIP.
//   WIPWith                 : con trỏ đang dựng trong list WIP.
//   componentUpdateQueue    : queue effect (mounted/destroyed) cho WIP.
// =============================================================================
import { scheduleWork } from "./scheduler";
import * as Status from "../shared/status-work";
import { Update as UpdateEffect } from "../shared/effect-tag";
import { isObject } from "../shared/validate";
import {
  NoEffect as NoHookEffect,
  UnmountSnapshot,
  UnmountMutation,
  MountMutation,
  MountLayout,
  UnmountPassive,
  MountPassive,
} from "../shared/with-effect";

//test
import { withState } from "../core/with-state";
import { lifeCycle } from "../core/life-cycle";
// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFNode = null;
// Hooks are stored as a linked list on the fiber's prevState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
let firstCurrentWith = null;
let currentWith = null;
let firstWIPFNode = null;
let WIPWith = null;
let componentUpdateQueue = null;
// Updates scheduled during render will trigger an immediate re-render at the
// end of the current pass. We can't store these updates on the normal queue,
// because if the work is aborted, they should be discarded. Because this is
// a relatively rare case, we also don't want to add an additional field to
// either the hook or queue object types. So we store them in a lazily create
// map of queue -> render-phase updates, which are discarded once the component
// completes without re-rendering.
function getCurrentRenderingFNode() {
  return currentlyRenderingFNode;
}

// Gọi NGAY TRƯỚC khi gọi hàm Component(props): set fiber đang render và
// "đọc" list hook cũ từ fiber current để tái sử dụng giá trị state.
export function prepareWithState(current, WIP) {
  currentlyRenderingFNode = WIP;
  firstCurrentWith = current !== null ? current.prevState : null;
}

// Gọi NGAY SAU khi Component trả về JSX: chốt list hook đã dựng vào WIP và
// queue effect lifecycle. Sau đó dọn module state để KHÔNG bị "rò" sang
// component khác (vì tất cả render đều dùng chung biến module).
export function finishedWith(Component, props, children) {
  // This must be called after every function component to prevent hooks from
  // being used in classes.
  const renderedWork = currentlyRenderingFNode;
  renderedWork.prevState = firstWIPFNode;
  renderedWork.lifeCycle = componentUpdateQueue;

  currentlyRenderingFNode = null;
  currentWith = null;
  firstCurrentWith = null;
  firstWIPFNode = null;
  WIPWith = null;

  componentUpdateQueue = null;

  return children;
}

// Reset toàn bộ trạng thái hooks. Được gọi đầu mỗi lần scheduleWork để bảo
// đảm môi trường sạch (đề phòng lượt render trước throw error giữa chừng).
export function resetWiths() {
  // This is called instead of `finishHooks` if the component throws. It's also
  // called inside mountIndeterminateComponent if we determine the component
  // is a module-style component.
  currentlyRenderingFNode = null;
  firstCurrentWith = null;
  currentWith = null;
  firstWIPFNode = null;
  WIPWith = null;
  componentUpdateQueue = null;
}

// Tạo Hook trống cho lần MOUNT đầu tiên.
function createWith() {
  return {
    prevState: null,

    baseState: null,
    queue: null,
    baseUpdate: null,

    next: null,
  };
}

// Clone Hook từ current sang WIP cho lần UPDATE. Phải clone (không share
// reference) để render dở dang có thể bỏ đi mà không hỏng state hiện tại.
function cloneWith(With) {
  return {
    prevState: With.prevState,

    baseState: With.prevState,
    queue: With.queue,
    baseUpdate: With.baseUpdate,

    next: null,
  };
}

/**
 * Mỗi lần một hook (withState/withLifeCycle) được gọi trong component, hàm này
 * "tiến" con trỏ WIPWith sang Hook tiếp theo trong list (tạo mới nếu chưa có).
 *
 * Cây quyết định:
 *   - Đầu list (WIPWith === null):
 *       Lần render đầu (firstWIPFNode === null): tạo Hook đầu tiên, có thể
 *       clone từ firstCurrentWith nếu component đã render trước đó.
 *       Lần render sau (đã có firstWIPFNode): chỉ cần reset con trỏ về đầu.
 *   - Giữa list: đi tiếp .next; tạo mới nếu cuối list (= hook mới được thêm).
 *
 * Chính cấu trúc này khiến RULE OF HOOKS tồn tại: nếu thay đổi thứ tự gọi hook
 * giữa các lần render, ta sẽ map nhầm Hook[i] cũ với Hook[i] mới (khác bản chất).
 */
function createWIPWith() {
  if (WIPWith === null) {
    // this is the first hook in the list
    if (firstWIPFNode === null) {
      currentWith = firstCurrentWith;
      if (currentWith === null) {
        // This is a newly mounted hook
        WIPWith = createWith();
      } else {
        // clone the current with
        WIPWith = cloneWith(currentWith);
      }
      firstWIPFNode = WIPWith;
    } else {
      // There's already a work-in-progress. Reuse it.
      currentWith = firstCurrentWith;
      WIPWith = firstWIPFNode;
    }
  } else {
    if (WIPWith.next === null) {
      let With;
      if (currentWith === null) {
        // This is a newly mounted hook
        With = createWith();
      } else {
        // clone
        currentWith = currentWith.next;
        if (currentWith === null) {
          // This is a newly mounted hook
          With = createWith();
        } else {
          // Clone the current hook.
          With = cloneWith(currentWith);
        }
      }
      // Append to the end of the list
      WIPWith = WIPWith.next = With;
    } else {
      // There's already a work-in-progress. Reuse it.
      WIPWith = WIPWith.next;
      currentWith = currentWith !== null ? currentWith.next : null;
    }
  }

  return WIPWith;
}

// Reducer mặc định cho withState: nếu action là function -> gọi với state cũ,
// ngược lại -> coi action chính là state mới. Y hệt useState trong React.
function basicStateReducer(state, action) {
  return typeof action === "function" ? action(state) : action;
}

// export const generalId = () => {
//   return '_' + Math.random().toString(36).substr(2, 9);
// };

/**
 * Cài đặt thực sự của useState (đặt tên là withReducer/withState).
 *
 * MOUNT (queue === null):
 *   - Tạo Hook + queue rỗng, lưu initialState.
 *   - Tạo dispatcher đóng-gói (fnode + queue) để bên ngoài gọi.
 *
 * UPDATE (queue đã có):
 *   - queue chứa các "update" được dispatch giữa render trước và render này
 *     (linked list TUẦN HOÀN: queue.last.next = first, để có thể append O(1)
 *     mà vẫn duyệt được từ first).
 *   - Áp tuần tự các update lên baseState để được state mới -> trả về.
 */
export function withReducer(initialState) {
  // const id = generalId();
  currentlyRenderingFNode = getCurrentRenderingFNode();
  // set work to this fiber
  // currentlyRenderingFNode.status = Status.Working;
  WIPWith = createWIPWith();

  let queue = WIPWith.queue;
  if (queue !== null) {
    // Already have a queue, so this is an update.

    // The last update in the entire queue
    const last = queue.last;
    // The last update that is part of the base state.
    const baseUpdate = WIPWith.baseUpdate;
    // Find the first unprocessed update.
    let first;
    if (baseUpdate !== null) {
      if (last !== null) {
        // For the first update, the queue is a circular linked list where
        // `queue.last.next = queue.first`. Once the first update commits, and
        // the `baseUpdate` is no longer empty, we can unravel the list.
        last.next = null;
      }
      first = baseUpdate.next;
    } else {
      first = last !== null ? last.next : null;
    }
    if (first !== null) {
      let newState = WIPWith.baseState;
      let newBaseState = null;
      let newBaseUpdate = null;
      let prevUpdate = baseUpdate;
      let update = first;
      let didSkip = false;
      do {
        const action = update.action;
        newState = basicStateReducer(newState, action);
        prevUpdate = update;
        update = update.next;
      } while (update !== null && update !== first);

      if (!didSkip) {
        newBaseUpdate = prevUpdate;
        newBaseState = newState;
      }

      WIPWith.prevState = newState;
      WIPWith.baseUpdate = newBaseUpdate;
      WIPWith.baseState = newBaseState;
    }

    const dispatch = queue.dispatch;
    return [WIPWith.prevState, dispatch];
  }
  // There's no existing queue, so this is the initial render.
  // if (true) {
  //
  // }
  WIPWith.prevState = WIPWith.baseState = initialState;
  queue = WIPWith.queue = {
    last: null,
    dispatch: null,
  };
  const dispatch = (queue.dispatch = dispatchAction.bind(
    null,
    currentlyRenderingFNode,
    queue
  ));

  return [WIPWith.prevState, dispatch];
}

/**
 * Hàm setState trả về cho user. Khi user gọi `dispatch(value)`:
 *   1. Đẩy fiber về Working để beginWork không bailout.
 *   2. Nối update vào queue.last (linked-list tuần hoàn).
 *   3. scheduleWork(fnode) -> kick một idle callback để render lại.
 *
 * Vì update lưu trên QUEUE (không apply ngay), nhiều setState liên tục
 * trong cùng 1 callback sẽ được "batch" lại thành 1 lần render.
 */
function dispatchAction(fnode, queue, action) {
  fnode.status = 1;
  const alternate = fnode.alternate;

  if (alternate !== null) {
    alternate.status = 1;
  }

  const update = {
    action,
    next: null,
  };
  // flushPassiveEffects();
  // append the update to the end of the list
  const last = queue.last;
  if (last === null) {
    // This is the first update. Create a circular list.
    update.next = update;
  } else {
    const first = last.next;
    if (first !== null) {
      // Still circular.
      update.next = first;
    }
    last.next = update;
  }
  queue.last = update;
  scheduleWork(fnode);
}

/**
 * Cài đặt useEffect-like (lifeCycle). Khi user gọi `lifeCycle({mounted, ...})`:
 *   - Tiến hook (createWIPWith).
 *   - Nếu deps không đổi (inputsAreEqual) -> chỉ pushEffect với tag NoEffect
 *     để giữ chỗ trong list (đảm bảo thứ tự hook), KHÔNG đánh effectTag fiber.
 *   - Nếu deps đổi -> đánh fiber.effectTag |= UpdateEffect (để commit phase
 *     sẽ chạy mounted/destroyed) và pushEffect với tag thực.
 *
 * Effect được lưu trong `componentUpdateQueue.lastEffect` (circular linked list).
 *
 * Hai điểm chưa hoàn thiện trong codebase đơn giản này (giúp người đọc lưu ý):
 *   1) `inputs` đang hard-code = undefined -> nextInputs = []. Vì `prevEffect.inputs`
 *      cũng là [], nên inputsAreEqual luôn true ở lần re-render. Hệ quả: hook
 *      lifeCycle chạy đúng 1 lần (mount), về sau coi như deps=[] cố định.
 *   2) `prevEffect.destroy` (dòng dưới) THIẾU chữ "ed" -> đáng lẽ là `destroyed`.
 *      Bug này khiến cleanup function gắn từ lần mount KHÔNG được kế thừa qua
 *      các re-render trung gian. Nó vẫn fire khi unmount lần đầu (vì commitUnmount
 *      đọc trực tiếp current.lifeCycle), nhưng nếu component re-render trước rồi
 *      mới unmount, destroyed sẽ bị mất do bug này.
 */
export function withLifeCycle(fnodeEffectTag, withEffectTag, lifeCycle) {
  currentlyRenderingFNode = getCurrentRenderingFNode();
  WIPWith = createWIPWith();
  const inputs = undefined;
  const nextInputs = inputs !== undefined && inputs !== null ? inputs : [];
  let destroyed = null;
  if (currentWith !== null) {
    // for componentdidupdate
    const prevEffect = currentWith.prevState;
    destroyed = prevEffect.destroy; // BUG: đáng lẽ prevEffect.destroyed (xem comment hàm).
    if (inputsAreEqual(nextInputs, prevEffect.inputs)) {
      pushEffect(NoHookEffect, lifeCycle, destroyed);
      return;
    }
  }
  currentlyRenderingFNode.effectTag |= fnodeEffectTag;

  WIPWith.prevState = pushEffect(withEffectTag, lifeCycle, destroyed);
}

// Chèn effect vào cuối circular linked list. Nếu list trống thì khởi tạo
// (effect.next = effect). Sau khi chèn, lastEffect luôn trỏ phần tử cuối cùng,
// và lastEffect.next chính là phần tử ĐẦU TIÊN -> tiện cho do-while duyệt.
function pushEffect(tag, lifeCycle, destroyed) {
  const { mounted, updated } = lifeCycle;
  const effect = {
    tag,
    mounted: mounted || null,
    updated: updated || null,
    destroyed: destroyed || null,
    inputs: [],
    // circular linked-list
    next: null,
  };
  if (componentUpdateQueue === null) {
    componentUpdateQueue = createFunctionComponentUpdateQueue();
    componentUpdateQueue.lastEffect = effect.next = effect;
  } else {
    const lastEffect = componentUpdateQueue.lastEffect;
    if (lastEffect === null) {
      componentUpdateQueue.lastEffect = effect.next = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      componentUpdateQueue.lastEffect = effect;
    }
  }
  return effect;
}

function createFunctionComponentUpdateQueue() {
  return {
    lastEffect: null,
  };
}

// So sánh 2 mảng deps theo Object.is (không dùng === để xử lý NaN và -0/+0
// đúng quy chuẩn). Thay thế cho việc gọi Object.is trong môi trường cũ.
function inputsAreEqual(arr1, arr2) {
  // Don't bother comparing lengths in prod because these arrays should be
  // passed inline.
  for (let i = 0; i < arr1.length; i++) {
    // Inlined Object.is polyfill.
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
    const val1 = arr1[i];
    const val2 = arr2[i];
    if (
      (val1 === val2 && (val1 !== 0 || 1 / val1 === 1 / (val2: any))) ||
      (val1 !== val1 && val2 !== val2) // eslint-disable-line no-self-compare
    ) {
      continue;
    }
    return false;
  }
  return true;
}
