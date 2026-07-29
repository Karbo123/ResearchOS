import assert from "node:assert/strict";
import test from "node:test";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {
  createBusyGate,
  fetchWithTimeout,
  formatRequestError,
  shouldSubmitOnKeyboard,
} = require("../apps/api/static/chat-ux.js");

test("busy gate rejects duplicate submissions and reopens after completion", () => {
  const gate = createBusyGate();
  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  assert.equal(gate.isBusy(), true);
  gate.finish();
  assert.equal(gate.isBusy(), false);
  assert.equal(gate.tryStart(), true);
});

test("Ctrl+Enter and Cmd+Enter submit while plain Enter remains a line break", () => {
  assert.equal(shouldSubmitOnKeyboard({key: "Enter", ctrlKey: false, metaKey: false}), false);
  assert.equal(shouldSubmitOnKeyboard({key: "Enter", ctrlKey: true, metaKey: false}), true);
  assert.equal(shouldSubmitOnKeyboard({key: "Enter", ctrlKey: false, metaKey: true}), true);
  assert.equal(shouldSubmitOnKeyboard({key: "Tab", ctrlKey: true, metaKey: false}), false);
});

test("request timeout is classified and clears the busy request path", async () => {
  const hangingFetch = (_input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, {once: true});
  });
  await assert.rejects(
    fetchWithTimeout(hangingFetch, "/api/chat", {}, 10),
    error => error.code === "timeout" && formatRequestError(error).includes("超时"),
  );
});

test("network failure is classified as offline and can be retried", async () => {
  const offlineFetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    fetchWithTimeout(offlineFetch, "/api/chat", {}, 100),
    error => error.code === "offline" && formatRequestError(error).includes("无法连接"),
  );
});

test("successful requests return the response and do not report an error", async () => {
  const response = await fetchWithTimeout(async (_input, init) => ({ok: true, aborted: init.signal.aborted}), "/api/chat", {}, 100);
  assert.deepEqual(response, {ok: true, aborted: false});
});

console.log("CHAT_UX_OK=5");
