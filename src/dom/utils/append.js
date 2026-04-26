// =============================================================================
// src/dom/utils/append.js
// -----------------------------------------------------------------------------
// Các hàm append vào DOM. Có 3 biến thể vì có 3 ngữ cảnh khác nhau:
//
//   appendInitialChild : dùng trong giai đoạn completeWork - ráp các DOM con
//                        vào DOM cha *trước khi* element cha được attach vào
//                        cây thật (offline, chưa nhìn thấy trên screen).
//
//   appendChild        : dùng trong commit phase, parent là một DNode
//                        đã nằm sẵn trên cây thật.
//
//   appendChildToContainer : parent là CONTAINER (root, ví dụ #root). Nếu
//                        container lại là một comment node (trường hợp portal/
//                        marker), phải `insertBefore` trước comment đó thay
//                        vì appendChild vào comment.
// =============================================================================
import { isCommentNode } from "./validate";

function appendInitialChild(parent, child) {
  parent.appendChild(child);
}

function appendChild(parent, child) {
  parent.appendChild(child);
}

function appendChildToContainer(container, child) {
  let parentNode;
  if (isCommentNode(container)) {
    parentNode = container.parentNode;
    parentNode.insertBefore(child, container);
  } else {
    parentNode = container;
    parentNode.appendChild(child);
  }
}

export { appendChildToContainer, appendInitialChild, appendChild };
