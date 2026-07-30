(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ResearchChatUX = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  class ChatRequestError extends Error {
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
      },
    };
  }

  function shouldSubmitOnKeyboard(event) {
    return event.key === "Enter" && (event.ctrlKey || event.metaKey);
  }

  async function uploadSequentially(files, uploadFile) {
    for (const file of files) await uploadFile(file);
  }

  async function fetchWithTimeout(fetchImpl, input, init = {}, timeoutMs = 300000) {
    const Controller = root.AbortController;
    const controller = new Controller();
    const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300000;
    let timer;
    try {
      timer = root.setTimeout(() => controller.abort(), deadline);
      return await fetchImpl(input, {...init, signal: controller.signal});
    } catch (error) {
      if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
        throw new ChatRequestError("timeout", "请求超时，请检查服务状态后重试。", error);
      }
      if (error && (error.name === "TypeError" || error.code === "NETWORK_ERROR")) {
        throw new ChatRequestError("offline", "无法连接 Research OS API，请确认本地服务仍在运行。", error);
      }
      throw error;
    } finally {
      if (timer !== undefined) root.clearTimeout(timer);
    }
  }

  function formatRequestError(error) {
    return error && error.message ? error.message : "请求失败，请稍后重试。";
  }

  return {ChatRequestError, createBusyGate, shouldSubmitOnKeyboard, fetchWithTimeout, formatRequestError, uploadSequentially};
});
