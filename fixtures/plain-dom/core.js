import assert from "node:assert/strict";
import { createDrawController } from "@skalahq/draw/core";

assert.equal(typeof document, "undefined");
assert.equal(typeof window, "undefined");
assert.throws(() => import.meta.resolve("react"));
assert.throws(() => import.meta.resolve("react-dom"));
assert.deepEqual(createDrawController().getSnapshot(), { version: 1, nodes: [] });
assert.ok(import.meta.resolve("@skalahq/draw/dom"));
assert.ok(import.meta.resolve("@skalahq/draw/styles.css"));
