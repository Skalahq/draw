# Render component nodes in DOM and drawing geometry in SVG

Draw uses real DOM for live component content and SVG for drawing geometry, with one shared camera. A flattened graphics surface would lose native input and focus behavior and require hosts to rebuild interactive content. Draw owns geometry and hit testing regardless of which layer renders an item.

Document bounds and node-local ports determine anchors. Renderer layout does not implicitly edit the document. A custom connection path supplies geometry for hit testing as well as its appearance. Draw ships scoped structural CSS; UI SDK's default theme is opt-in.

SVG and PNG export use a common visual export representation. Built-in content has one by default; custom node types provide one explicitly. Draw reports unsupported content rather than silently dropping it or treating live DOM as portable output.
