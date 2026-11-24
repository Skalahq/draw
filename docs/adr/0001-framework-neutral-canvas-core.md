# Use a framework-neutral canvas core

Draw uses UI SDK's framework-neutral behavior layer for canvas interactions and a React adapter for the first host integration, including Next.js. The core owns the canvas behavior rather than delegating it to React, so the document and commands do not depend on React and other frameworks can integrate without reimplementing the editor.

Draw owns placement, connection geometry, selection, and hit testing. Host renderers supply node content and can replace the connection line and arrowhead independently. Non-React node content can mount into a DOM container managed by Draw.

One npm package provides separate core, React, and DOM entry points. Plain JavaScript and Solid hosts can mount the DOM adapter; a native Solid adapter is not required. Next.js integrates through the React client entry.
