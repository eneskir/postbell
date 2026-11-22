// The Chrome DevTools Protocol client shared by the self-tests (WebView2) and the screen capture (headless Edge).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls the debugging port every 200 ms, at most `tries` times, and returns its page target, or undefined if none showed.
export async function findPage(port, tries) {
  let targets = [];
  for (let i = 0; i < tries && !targets.some((t) => t.type === "page"); i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    } catch {
      // The port is not open yet.
    }
    await sleep(200);
  }
  return targets.find((t) => t.type === "page");
}

// `send` calls a CDP method; `ev` evaluates an expression in the page, awaits it and returns its value.
export async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (!m.id || !pending.has(m.id)) return;
    const q = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) q.rej(new Error(JSON.stringify(m.error)));
    else q.res(m.result);
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++seq;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { ws, send, ev };
}
