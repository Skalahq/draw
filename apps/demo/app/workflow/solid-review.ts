import type { DrawNode } from "@skalahq/draw/core";
import type { ForeignNodeRenderer } from "@skalahq/draw/react";
import { createRenderEffect, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";

export function solidReviewRenderer(onMountChange?: (delta: 1 | -1) => void): ForeignNodeRenderer {
  return {
    mount(container) {
      const [node, setNode] = createSignal<DrawNode>();
      const doc = container.ownerDocument;
      const dispose = render(() => {
        const [reviews, setReviews] = createSignal(0);
        const card = doc.createElement("div");
        card.className = "workflow-node";
        const title = doc.createElement("h2");
        const reviewCount = doc.createElement("output");
        reviewCount.setAttribute("aria-label", "Reviews");
        const review = doc.createElement("button");
        review.type = "button";
        review.textContent = "Add review";
        review.addEventListener("click", () => setReviews((count) => count + 1));
        const position = doc.createElement("p");
        const x = doc.createElement("output");
        x.setAttribute("aria-label", "Node x");
        position.append("Canvas x: ", x);
        const reviewLine = doc.createElement("p");
        reviewLine.append("Reviews: ", reviewCount);
        card.append(title, reviewLine, review, position);

        createRenderEffect(() => {
          reviewCount.value = String(reviews());
        });
        createRenderEffect(() => {
          const current = node();
          const label = current?.metadata?.label;
          title.textContent = typeof label === "string" ? label : "Solid review";
          x.value = current ? String(current.bounds.x) : "";
        });
        if (onMountChange) {
          onMount(() => {
            onMountChange(1);
            onCleanup(() => onMountChange(-1));
          });
        }
        return card;
      }, container);

      return { update: ({ node }) => setNode(node), dispose };
    },
  };
}
