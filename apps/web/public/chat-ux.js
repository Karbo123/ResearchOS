(() => {
  // src/chat-ux.ts
  (function(root, factory) {
    const api = factory(root);
    root.ResearchChatUX = api;
  })(typeof globalThis !== "undefined" ? globalThis : window, function(root) {
    class ChatRequestError extends Error {
      code;
      cause;
      constructor(code, message, cause) {
        super(message);
        this.name = "ChatRequestError";
        this.code = code;
        this.cause = cause;
      }
    }
    function createBusyGate() {
      let busy = false;
      return {
        tryStart() {
          if (busy) return false;
          busy = true;
          return true;
        },
        finish() {
          busy = false;
        },
        isBusy() {
          return busy;
        }
      };
    }
    function shouldSubmitOnKeyboard(event) {
      return event.key === "Enter" && (event.ctrlKey || event.metaKey);
    }
    async function uploadSequentially(files, uploadFile) {
      for (const file of files) await uploadFile(file);
    }
    async function fetchWithTimeout(fetchImpl, input, init = {}, timeoutMs = 3e5) {
      const Controller = root.AbortController;
      const controller = new Controller();
      const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3e5;
      let timer;
      try {
        timer = root.setTimeout(() => controller.abort(), deadline);
        return await fetchImpl(input, { ...init, signal: controller.signal });
      } catch (error) {
        if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
          throw new ChatRequestError("timeout", "\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u72B6\u6001\u540E\u91CD\u8BD5\u3002", error);
        }
        if (error && (error.name === "TypeError" || error.code === "NETWORK_ERROR")) {
          throw new ChatRequestError("offline", "\u65E0\u6CD5\u8FDE\u63A5 Research OS API\uFF0C\u8BF7\u786E\u8BA4\u672C\u5730\u670D\u52A1\u4ECD\u5728\u8FD0\u884C\u3002", error);
        }
        throw error;
      } finally {
        if (timer !== void 0) root.clearTimeout(timer);
      }
    }
    function formatRequestError(error) {
      return error && error.message ? error.message : "\u8BF7\u6C42\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002";
    }
    return { ChatRequestError, createBusyGate, shouldSubmitOnKeyboard, fetchWithTimeout, formatRequestError, uploadSequentially };
  });
})();
