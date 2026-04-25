# React Fiber Implementation - Project Documentation

## Project Overview

This is an educational implementation of React's Fiber architecture, designed to help developers understand how React works internally. The codebase re-implements the core concepts of React Fiber in a simplified, readable manner while maintaining the essential architectural patterns.

**Author:** tungtbt  
**License:** MIT  
**Purpose:** Learning and understanding React Fiber reconciliation algorithm

## What is React Fiber?

React Fiber is React's reconciliation algorithm that enables:
- **Incremental rendering**: Breaking rendering work into chunks
- **Pause, abort, or reuse work** as new updates come in
- **Priority assignment** to different types of updates
- **Concurrent features** and better user experience

## Core Concepts

### 1. Fiber Node (FNode)

A Fiber is a JavaScript object that represents a unit of work. Each fiber corresponds to a component, DOM node, or text element.

```javascript
{
  tag: number,              // Type of fiber (Root, DNode, FComponent, Text, Fragment)
  type: string | Function,  // 'div', 'span', or function component
  key: string | null,       // React key for reconciliation
  
  // Tree structure
  return: FNode | null,     // Parent fiber
  child: FNode | null,      // First child
  sibling: FNode | null,    // Next sibling
  
  // Work tracking
  alternate: FNode | null,  // Links current ↔ work-in-progress
  effectTag: number,        // What needs to happen (Placement, Update, Deletion)
  
  // Props and state
  props: any,               // Pending props
  prevProps: any,           // Previous props
  prevState: any,           // Previous state (hooks storage)
  
  // DOM reference
  instanceNode: any,        // Actual DOM element
  
  // Effects tracking
  nextEffect: FNode | null,
  firstEffect: FNode | null,
  lastEffect: FNode | null,
  
  // Lifecycle hooks
  lifeCycle: any,           // Lifecycle effects
  status: number            // Work status
}
```

### 2. Fiber Tags

Located in `src/shared/tag.js`:

- `Root (0)`: Root container
- `DNode (1)`: DOM nodes (div, span, etc.)
- `FComponent (2)`: Function components
- `Text (3)`: Text nodes
- `Fragment (7)`: React fragments

### 3. Effect Tags

Located in `src/shared/effect-tag.js`:

- `NoEffect (0)`: No side effects
- `PerformedWork (1)`: Work was performed
- `Placement (2)`: Insert into DOM
- `Update (4)`: Update existing node
- `Deletion (8)`: Remove from DOM
- `Passive (512)`: Passive effects (useEffect)

## Architecture

### Fiber Tree Structure

React maintains two fiber trees:

1. **Current Tree**: What's currently displayed on screen
2. **Work-in-Progress (WIP) Tree**: The tree being built during updates

These trees are connected via the `alternate` property, enabling efficient updates through structural sharing.

```
        Root
         |
      FComponent (App)
         |
       DNode (div)
      /     \
  Text    DNode (button)
            |
          Text
```

### Main Phases

#### Phase 1: Render/Reconciliation (Interruptible)

1. **beginWork()**: Process current fiber, create/update children
2. **reconcileChildren()**: Diff old vs new children, assign effect tags
3. **completeWork()**: Create DOM instances, build effect list
4. Builds the WIP tree without touching the actual DOM

#### Phase 2: Commit (Synchronous)

1. **commitAllHostEffects()**: Apply DOM mutations (insert, update, delete)
2. **commitAllLifeCycles()**: Run lifecycle methods and effects
3. Swap current and WIP trees
4. Cannot be interrupted

## File Structure

### Core Entry Points

- **`index.js`**: Application entry point with demo components
- **`index.html`**: HTML template
- **`webpack.config.js`**: Build configuration
- **`.babelrc`**: Babel configuration for JSX

### Source Organization

```
src/
├── core/                    # Public API
│   ├── h.js                 # JSX factory (createElement)
│   ├── with-state.js        # Hook for state management
│   └── life-cycle.js        # Lifecycle hook
│
├── fiber/                   # Fiber reconciliation engine
│   ├── f-node.js            # Fiber node structure and creation
│   ├── scheduler.js         # Work scheduling with requestIdleCallback
│   ├── begin-work.js        # Start processing a fiber
│   ├── complete-work.js     # Complete a fiber, create DOM
│   ├── commit-work.js       # Commit changes to DOM
│   ├── children.js          # Child reconciliation algorithm
│   ├── reconciler.js        # Core reconciliation logic
│   ├── f-with.js            # Hook implementation
│   ├── f-life-cycle.js      # Lifecycle management
│   ├── root-render.js       # Root rendering
│   ├── host-context.js      # Host environment context
│   └── stack.js             # Stack utilities
│
├── dom/                     # DOM operations
│   ├── index.js             # Main render function
│   ├── config.js            # DOM manipulation functions
│   ├── constants.js         # DOM constants
│   └── utils/               # DOM utilities
│       ├── createElement.js
│       ├── textElement.js
│       ├── insert.js
│       ├── remove.js
│       ├── append.js
│       ├── validate.js
│       └── getDocumentByElement.js
│
├── shared/                  # Shared utilities
│   ├── types.js             # Type definitions
│   ├── tag.js               # Fiber tags
│   ├── effect-tag.js        # Effect tags
│   ├── status-work.js       # Work status
│   ├── with-effect.js       # Effect types
│   ├── validate.js          # Validation utilities
│   └── shallowEqual.js      # Shallow comparison
│
└── structures/              # Data structures
    └── linked-list.js       # Linked list for effect chains
```

## Key Algorithms

### 1. Work Loop (Scheduler)

Uses `requestIdleCallback` to perform work during browser idle time:

```javascript
function workLoop(deadline, root) {
  if (!nextUnitOfWork) {
    nextUnitOfWork = createWIP(root.current, null);
  }
  
  while (nextUnitOfWork !== null && deadline.timeRemaining() > expireTime) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
  }
}
```

### 2. Reconciliation Algorithm

**Child Reconciliation** (`src/fiber/children.js`):
- Compares old children with new children
- Uses keys to track elements
- Assigns effect tags (Placement, Update, Deletion)
- Implements efficient diffing strategy

### 3. Tree Traversal

Depth-first traversal using child → sibling → return pattern:

```
1. Process node (beginWork)
2. If has child → go to child
3. If no child → complete work
4. If has sibling → go to sibling
5. If no sibling → return to parent
```

## Main Workflows

### First Render Process

```
1. render(element, container)
   ↓
2. Create FRoot with current fiber
   ↓
3. scheduleWork()
   ↓
4. workLoop starts
   ↓
5. beginWork() - Build fiber tree
   - Create FNode from element
   - Process each component
   - Reconcile children
   ↓
6. completeWork() - Create DOM instances
   - Build effect list
   - Create actual DOM nodes
   - Set properties
   ↓
7. commitRoot() - Apply to actual DOM
   - commitPlacement: Insert nodes
   - commitWork: Update properties
   - Run lifecycle effects
   ↓
8. Swap current ↔ WIP trees
```

### Update Process

```
1. User interaction triggers state change
   ↓
2. Find fiber that needs update
   ↓
3. Traverse up to find root
   ↓
4. Clone fiber path from root to updated component
   ↓
5. scheduleWork() from that fiber
   ↓
6. beginWork() with optimization
   - Check if props changed
   - Skip unchanged subtrees (memoization)
   - Reconcile only changed children
   ↓
7. completeWork() - Update effect list
   ↓
8. commitRoot() - Apply changes
   - Update: Modify existing nodes
   - Placement: Insert new nodes
   - Deletion: Remove old nodes
```

## Hooks Implementation

### State Hook (withState)

Stored as a linked list in `fiber.prevState`:

```javascript
// Hook structure
{
  prevState: value,     // Current state value
  queue: [],            // Pending updates
  next: Hook | null     // Next hook in the list
}
```

The hook system maintains:
- **Current hook**: From current tree
- **WIP hook**: Being built in work-in-progress tree
- Hook order must be consistent between renders

### Lifecycle Hook (lifeCycle)

Effects are stored in a circular linked list:

```javascript
{
  tag: number,          // Effect type (mount, unmount, layout, passive)
  mounted: Function,    // Effect function
  destroyed: Function,  // Cleanup function
  deps: Array,          // Dependencies
  next: Effect          // Next effect
}
```

## Key Functions Reference

### Core Functions

| Function | File | Purpose |
|----------|------|---------|
| `h()` | `src/core/h.js` | JSX factory, creates VNode elements |
| `render()` | `src/dom/index.js` | Entry point to render tree |
| `scheduleWork()` | `src/fiber/scheduler.js` | Schedule work for a fiber |
| `createWIP()` | `src/fiber/f-node.js` | Clone fiber for work-in-progress |
| `beginWork()` | `src/fiber/begin-work.js` | Process fiber, reconcile children |
| `reconcileChildren()` | `src/fiber/children.js` | Diff and update children |
| `completeWork()` | `src/fiber/complete-work.js` | Create DOM, build effect list |
| `commitRoot()` | `src/fiber/scheduler.js` | Apply all changes to DOM |
| `commitPlacement()` | `src/fiber/commit-work.js` | Insert nodes into DOM |
| `commitWork()` | `src/fiber/commit-work.js` | Update existing DOM nodes |
| `commitDeletion()` | `src/fiber/commit-work.js` | Remove nodes from DOM |

### Data Structures

- **LinkedList** (`src/structures/linked-list.js`): Manages effect chains
- **Stack** (`src/fiber/stack.js`): For host context management

## Running the Project

### Installation

```bash
npm install
```

### Development

```bash
npm start
# Opens dev server at http://localhost:8080
```

### Build

```bash
npm run build
# Outputs to dist/
```

## Demo Application

The `index.js` demonstrates:

1. **Component creation** with JSX
2. **State management** with `withState` hook
3. **Lifecycle effects** with `lifeCycle` hook
4. **List rendering** with keys
5. **Event handling**
6. **CRUD operations** (Create, Update, Delete)

```javascript
// Simple component with hooks
const User = ({ user, update, remove }) => {
  lifeCycle({
    mounted() {
      console.log('mounted User');
      return () => console.log('unmounted User');
    }
  });
  
  return (
    <div>
      <p>Name: {user.name}</p>
      <p>Age: {user.age}</p>
      <button onClick={() => remove(user.id)}>Delete</button>
      <button onClick={() => update(user.id)}>Update</button>
    </div>
  );
};
```

## Prerequisites for Learning

### Essential Concepts

1. **Data Structures**
   - Single linked list
   - Circular linked list
   - Stack and Queue
   - Tree traversal

2. **Algorithms**
   - Depth-first search
   - Tree reconciliation/diffing
   - Recursive algorithms
   - Structural sharing

3. **JavaScript Concepts**
   - Closures
   - Recursion
   - Bitwise operators
   - Event loop
   - requestIdleCallback

4. **React Concepts**
   - JSX
   - Virtual DOM
   - Reconciliation
   - Component lifecycle
   - Hooks

## Learning Resources

### Official React Documentation

- [Reconciliation](https://reactjs.org/docs/reconciliation.html)
- [React Components, Elements, and Instances](https://reactjs.org/blog/2015/12/18/react-components-elements-and-instances.html)
- [Design Principles](https://reactjs.org/docs/design-principles.html)

### React Fiber Deep Dives

- [React Fiber Architecture by @acdlite](https://github.com/acdlite/react-fiber-architecture)
- [React Fiber Resources by @koba04](https://github.com/koba04/react-fiber-resources)
- [Lin Clark - A Cartoon Intro to Fiber (React Conf 2017)](https://www.youtube.com/watch?v=ZCuYPiUIONs)

### Technical Articles

- [Inside Fiber: In-depth overview of the new reconciliation algorithm](https://medium.com/react-in-depth/inside-fiber-in-depth-overview-of-the-new-reconciliation-algorithm-in-react-e1c04700ef6e)
- [The how and why on React's usage of linked list in Fiber](https://medium.com/react-in-depth/the-how-and-why-on-reacts-usage-of-linked-list-in-fiber-67f1014d0eb7)
- [In-depth explanation of state and props update in React](https://medium.com/react-in-depth/in-depth-explanation-of-state-and-props-update-in-react-51ab94563311)
- [A look inside React Fiber](https://makersden.io/blog/look-inside-fiber/)
- [Build your own React Fiber](https://engineering.hexacta.com/didact-fiber-incremental-reconciliation-b2fe028dcaec)

## Comparison with Real React

### Simplifications in This Implementation

1. **No Concurrent Mode**: Uses simple `requestIdleCallback`, not React Scheduler
2. **No Suspense**: Doesn't implement error boundaries or Suspense
3. **Limited Hooks**: Only implements `useState` and basic lifecycle effects
4. **No Context API**: Simplified host context only
5. **No Portals**: No support for rendering to different DOM trees
6. **No Hydration**: No server-side rendering support
7. **Simplified Reconciliation**: Basic diffing without advanced optimizations

### What This Implements Well

1. ✅ Core Fiber architecture (double buffering with alternate)
2. ✅ Work-in-progress tree concept
3. ✅ Effect tags and effect list
4. ✅ Child reconciliation with keys
5. ✅ Incremental rendering pattern
6. ✅ Hook storage mechanism
7. ✅ Lifecycle effects
8. ✅ Tree traversal algorithm

## Debugging Tips

### Enable Logging

Add console logs to track fiber processing:

```javascript
// In beginWork
console.log('Begin work:', WIP.tag, WIP.type);

// In completeWork
console.log('Complete work:', WIP.tag, WIP.type);

// In commit phase
console.log('Committing effect:', effect.effectTag);
```

### Visualize Fiber Tree

Add a helper to print the tree structure:

```javascript
function printFiberTree(fiber, indent = 0) {
  if (!fiber) return;
  console.log(' '.repeat(indent), fiber.tag, fiber.type);
  printFiberTree(fiber.child, indent + 2);
  printFiberTree(fiber.sibling, indent);
}
```

### Common Issues

1. **Infinite loops**: Check if effect tags are cleared after commit
2. **Memory leaks**: Ensure cleanup functions run on unmount
3. **Stale closures**: Verify hook dependencies are correct
4. **Wrong DOM updates**: Check reconciliation key usage

## Next Steps for Learners

### Beginner

1. Read through `index.js` to understand the demo
2. Follow a single render from `render()` to DOM insertion
3. Add console logs to track fiber processing
4. Modify demo to add new components

### Intermediate

1. Trace an update through the reconciliation process
2. Understand how effect lists are built
3. Study the child reconciliation algorithm
4. Implement a new hook (e.g., useReducer)

### Advanced

1. Add priority levels to work scheduling
2. Implement error boundaries
3. Add support for context API
4. Optimize reconciliation with bailout conditions
5. Add support for Suspense-like features

## Contributing

This is an educational project. Suggestions for improvements to clarity and documentation are welcome.

## Related Projects

- [React](https://github.com/facebook/react) - The official React repository
- [Preact](https://github.com/preactjs/preact) - Fast 3kB alternative to React
- [Didact](https://github.com/pomber/didact) - DIY React implementation tutorial

## License

MIT License - See LICENSE file for details

---

**Remember**: This is a simplified implementation for learning purposes. Production React has many more optimizations, features, and edge case handling.
