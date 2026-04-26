// =============================================================================
// src/dom/config.js  -- HOST CONFIG cho môi trường DOM
// -----------------------------------------------------------------------------
// File này là "cầu nối" giữa reconciler (fiber) và DOM thật. Đây là layer
// React gọi là "Host Config": reconciler không hề biết DOM, nó chỉ gọi các
// hàm như `createInstance`, `appendInitialChild`, `commitUpdate`... do file
// này export ra. Muốn port React sang môi trường khác (Native, canvas, ...)
// chỉ cần viết một host config tương ứng.
//
// Các trách nhiệm chính ở đây:
//   1. Tạo DOM instance từ FNode (createDomNodeInstance, createTextInstance).
//   2. Set props ban đầu lên DOM (setInitialProperties + setInitialDOMProperties).
//   3. Diff props khi update (prepareUpdate / diffProperties) -> trả về
//      "updatePayload" là một mảng [key1, value1, key2, value2, ...].
//   4. Apply diff đó vào DOM (commitUpdate + updateProperties).
//   5. Lưu liên kết hai chiều: DOM node <-> FNode + props (precacheFiberNode,
//      updateFiberProps) để event delegation và devtools tra ngược được.
// =============================================================================
import createElement from "./utils/createElement";
import {
  createTextNode,
  setTextContent,
  resetTextContent,
} from "./utils/textElement";
import {
  appendChildToContainer,
  appendInitialChild,
  appendChild,
} from "./utils/append";
import { removeChildFromContainer, removeChild } from "./utils/remove";
import { insertInContainerBefore, insertBefore } from "./utils/insert";
import { isDocumentNode } from "./utils/validate";

const CHILDREN = "children";

// Assumes there is no parent namespace.

// React thật cũng dùng kỹ thuật này: gắn fiber và props lên DOM node qua một
// key "ngẫu nhiên" để tránh đụng độ với code ngoài. Random hoá để chống
// việc bên ngoài hardcode property name vào.
const randomKey = Math.floor(Math.random() * 100 + 1);

const internalInstanceKey = "__reactInternalInstance$" + randomKey;
const internalEventHandlersKey = "__reactEventHandlers$" + randomKey;

// Lưu fiber tương ứng vào DOM node. Nhờ vậy khi có event xảy ra trên DOM
// (vd: click), ta biết được nó thuộc fiber nào để dispatch đúng handler.
export function precacheFiberNode(hostInst, node) {
  node[internalInstanceKey] = hostInst;
}
// Đọc lại props "hiện tại" mà reconciler đã ghim trên DOM node.
export function getFiberCurrentPropsFromNode(node) {
  return node[internalEventHandlersKey] || null;
}

// Cập nhật props mới lên DOM node (gọi sau mỗi lần commit để "ảnh chụp"
// props khớp với trạng thái thật của DOM).
export function updateFiberProps(node, props) {
  node[internalEventHandlersKey] = props;
}

/**
 * Tạo một DOM element thật từ FNode và GẮN fiber + props vào nó.
 * Được gọi trong giai đoạn `completeWork` cho mỗi DNode lần đầu render.
 *
 * @param type                  - tên thẻ ('div', 'button', ...)
 * @param props                 - props của fiber
 * @param rootContainerInstance - phần tử container root (#root)
 * @param hostContext           - context môi trường (namespace svg/html)
 * @param internalInstanceHandle- chính FNode hiện tại để gắn ngược vào DOM
 */
export function createDomNodeInstance(
  type,
  props,
  rootContainerInstance,
  hostContext,
  internalInstanceHandle
) {
  let parentNamespace;
  parentNamespace = hostContext;
  const domElement = createElement(
    type,
    props,
    rootContainerInstance,
    parentNamespace
  );
  // Liên kết hai chiều: DOM nhớ fiber và nhớ props của lần render này.
  precacheFiberNode(internalInstanceHandle, domElement);
  updateFiberProps(domElement, props);
  return domElement;
}

// Đăng ký listener cho event. NOTE: phiên bản đơn giản này hiện đang HARD-CODE
// 'click' nên mọi prop bắt đầu bằng "on" thực ra đều đính vào sự kiện click.
// React thật triển khai SyntheticEvent + event delegation tinh vi hơn nhiều
// (gắn root listener, bubble qua fiber tree, simulate capture/bubble...).
function ensureListeningTo(rootContainerElement, eventName, callback) {
  const isDocumentOrFragment = isDocumentNode(rootContainerElement);
  const dom = isDocumentOrFragment
    ? rootContainerElement.ownerDocument
    : rootContainerElement;
  dom.addEventListener("click", callback, false);
}

/**
 * Lặp qua từng prop và áp lên DOM lần đầu (mount).
 *  - children dạng string/number  -> set làm text node con duy nhất.
 *  - prop bắt đầu bằng "on..."     -> đăng ký event listener.
 *  - các prop khác (className, id, style, ...): ở phiên bản đơn giản này
 *    đang BỎ QUA (chưa hỗ trợ). React thật sẽ phân biệt attribute thường/
 *    boolean/style object/dangerouslySetInnerHTML/...
 */
function setInitialDOMProperties(
  tag,
  domElement,
  rootContainerElement,
  nextProps,
  isCustomComponentTag
) {
  for (const propKey in nextProps) {
    if (!nextProps.hasOwnProperty(propKey)) {
      continue;
    }
    const nextProp = nextProps[propKey];
    if (propKey === CHILDREN) {
      if (typeof nextProp === "string") {
        // Avoid setting initial textContent when the text is empty. In IE11 setting
        // textContent on a <textarea> will cause the placeholder to not
        // show within the <textarea> until it has been focused and blurred again.
        // https://github.com/facebook/react/issues/6731#issuecomment-254874553
        const canSetTextContent = tag !== "textarea" || nextProp !== "";
        if (canSetTextContent) {
          setTextContent(domElement, nextProp);
        }
      } else if (typeof nextProp === "number") {
        setTextContent(domElement, "" + nextProp);
      }
    } else if (propKey[0] === "o" && propKey[1] === "n") {
      // Heuristic kiểu cũ: nếu key bắt đầu bằng "on" thì coi là event handler.
      ensureListeningTo(domElement, propKey, nextProp);
    }
  }
}

// Lớp wrap mỏng quanh setInitialDOMProperties để tách chỗ "tiền xử lý"
// props theo từng loại thẻ (vd: <iframe> có thể cần xử lý sandbox riêng).
// Hiện tại default chỉ pass-through.
export function setInitialProperties(
  domElement,
  tag,
  rawProps,
  rootContainerElement
) {
  let isCustomComponentTag = false;
  let props;
  switch (tag) {
    case "iframe":
    default:
      props = rawProps;
  }

  // assertValidProps(tag, props);
  setInitialDOMProperties(
    tag,
    domElement,
    rootContainerElement,
    props,
    isCustomComponentTag
  );
}

/**
 * Hook cuối cùng cho completeWork: sau khi đã append xong các DOM con,
 * gắn nốt props của bản thân lên element cha.
 * Trả về `false` = không cần auto-focus (React thật trả `true` cho input
 * autoFocus để commit gọi .focus()).
 */
export function finalizeInitialChildren(
  domElement,
  type,
  props,
  rootContainerInstance,
  hostContext
) {
  setInitialProperties(domElement, type, props, rootContainerInstance);
  return false;
}

// Tạo text node và gắn liên kết ngược về fiber.
export function createTextInstance(
  text,
  rootContainerInstance,
  internalInstanceHandle
) {
  const textNode = createTextNode(text, rootContainerInstance);
  precacheFiberNode(internalInstanceHandle, textNode);
  return textNode;
}

/**
 * Áp updatePayload lên DOM. updatePayload là mảng cặp [key, value, key, value...]
 * được sinh ra ở `diffProperties` bên dưới. Bug nhỏ trong simplified version:
 * vòng lặp đang đi từng phần tử (i++) thay vì i += 2, nên thực tế nó vẫn chạy
 * đúng cho case duy nhất là CHILDREN (text), nhưng nếu có nhiều prop sẽ sai.
 * Để chuẩn hơn nên `i += 2`.
 */
function updateDOMProperties(
  domElement,
  updatePayload,
  wasCustomComponentTag,
  isCustomComponentTag
) {
  for (let i = 0; i < updatePayload.length; i++) {
    const propKey = updatePayload[i];
    const propValue = updatePayload[i + 1];
    if (propKey === CHILDREN) {
      setTextContent(domElement, propValue);
    }
  }
}

// Apply the diff
export function updateProperties(
  domElement,
  updatePayload,
  tag,
  lastRawProps,
  nextRawProps
) {
  const wasCustomComponentTag = false;
  const isCustomComponentTag = false;
  // Apply the diff.
  updateDOMProperties(
    domElement,
    updatePayload,
    wasCustomComponentTag,
    isCustomComponentTag
  );
}

/**
 * Được gọi từ `commitWork` (commit phase) cho mỗi DNode có effectTag = Update.
 *  1. Đồng bộ props mới lên DOM (để event delegation dùng đúng handler mới).
 *  2. Áp diff lên thuộc tính DOM (textContent, style, ...).
 */
export function commitUpdate(
  domElement,
  updatePayload,
  type,
  oldProps,
  newProps,
  internalInstanceHandle
) {
  // g('domElement', domElement)
  // Update the props handle so that we know which props are the ones with
  // with current event handlers.
  updateFiberProps(domElement, newProps);
  // Apple the diff to the DOM node
  updateProperties(domElement, updatePayload, type, oldProps, newProps);
}

// Update text: chỉ cần đổi nodeValue. Cực rẻ.
export function commitTextUpdate(textInstance, oldText, newText) {
  textInstance.nodeValue = newText;
}

// Được gọi ở `completeWork` (giai đoạn render) để TÍNH TRƯỚC diff giữa props
// cũ và mới mà chưa apply vào DOM. Nhờ tính trước, commit phase sau đó chỉ
// cần "chạy" payload đã sẵn -> commit phase ngắn, không bị block UI.
export function prepareUpdate(
  domElement,
  type,
  oldProps,
  newProps,
  rootContainerInstance
) {
  return diffProperties(
    domElement,
    type,
    oldProps,
    newProps,
    rootContainerInstance
  );
}

/**
 * So sánh oldProps vs newProps -> trả về updatePayload dạng [k1, v1, k2, v2, ...]
 * hoặc null nếu không có gì cần update.
 *
 * Quy ước:
 *   - CHILDREN (text)  : push ('children', text mới).
 *   - "on..." handler : addEventListener handler mới + remove handler cũ
 *                       (vì addEventListener không override). Đồng thời tạo
 *                       updatePayload = [] (rỗng) để completeWork đánh
 *                       effectTag = Update -> commit gọi updateFiberProps().
 *   - prop khác        : push (key, valueMới) - commit sẽ áp dụng (nhưng
 *                       hiện updateDOMProperties đang skip hết trừ children).
 */
function diffProperties(
  domElement,
  tag,
  lastRawProps,
  nextRawProps,
  rootContainerElement
) {
  let updatePayload = null;
  let lastProps = lastRawProps;
  let nextProps = nextRawProps;

  // Workaround: addEventListener không thay thế listener cũ, nên muốn "đổi"
  // handler ta phải remove handler cũ trước rồi mới add handler mới.
  // (Bản full hơn sẽ wrap qua synthetic event để chỉ cần update reference.)
  if (
    typeof lastProps.onClick === "function" &&
    typeof nextProps.onClick === "function"
  ) {
    removeEvent(domElement, lastProps.onClick);
  }

  let propKey;

  // Vòng 1: tìm các prop có ở lastProps mà KHÔNG còn ở nextProps -> cần xoá.
  // (Phần thân vòng đang trống vì simplified version chưa xử lý xoá thuộc tính.)
  for (propKey in lastProps) {
    if (
      nextProps.hasOwnProperty(propKey) ||
      !lastProps.hasOwnProperty(propKey) ||
      lastProps[propKey] == null
    ) {
      continue;
    }
  }
  // Vòng 2: duyệt nextProps, so với lastProps để phát hiện thay đổi.
  for (propKey in nextProps) {
    const nextProp = nextProps[propKey];
    const lastProp = lastProps != null ? lastProps[propKey] : undefined;
    if (
      !nextProps.hasOwnProperty(propKey) ||
      nextProp === lastProp ||
      (nextProp == null && lastProp == null)
    ) {
      continue;
    }

    if (propKey === CHILDREN) {
      // Chỉ care text thay đổi (children dạng VNode được handle qua reconciler).
      if (
        lastProp !== nextProp &&
        (typeof nextProp === "string" || typeof nextProp === "number")
      ) {
        (updatePayload = updatePayload || []).push(propKey, "" + nextProp);
      }
    } else if (propKey[0] === "o" && propKey[1] === "n") {
      ensureListeningTo(domElement, propKey, nextProp);
      if (!updatePayload && lastProp !== nextProp) {
        // This is a special case. If any listener updates we need to ensure
        // that the "current" props pointer gets updated so we need a commit
        // to update this element.
        updatePayload = [];
      }
    } else {
      // For any other property we always add it to the queue and then we
      // filter it out using the whitelist during the commit.
      (updatePayload = updatePayload || []).push(propKey, nextProp);
    }
  }

  return updatePayload;
}

// Helper xoá listener click (đối ứng với addEventListener trong ensureListeningTo).
function removeEvent(element, callback) {
  element.removeEventListener("click", callback);
}

export {
  createTextNode,
  setTextContent,
  resetTextContent,
  appendChildToContainer,
  appendInitialChild,
  appendChild,
  removeChildFromContainer,
  removeChild,
  insertInContainerBefore,
  insertBefore,
};
