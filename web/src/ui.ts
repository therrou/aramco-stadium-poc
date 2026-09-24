const overlay = () => document.getElementById("overlay")!;

export function showProgress(f: number) {
  overlay().innerHTML = `<div class="progress"><div style="width:${(f * 100).toFixed(1)}%"></div></div>
    <p class="muted">Loading stadium… ${(f * 100).toFixed(0)}%</p>`;
  overlay().hidden = false;
}
export function hideOverlay() { overlay().hidden = true; }
export function showError(file: string, message: string, onRetry: () => void) {
  overlay().innerHTML = `<div class="card"><h2>Couldn't load <code>${file}</code></h2><p class="muted">${message}</p>
    <button id="retry">Retry</button></div>`;
  overlay().hidden = false;
  document.getElementById("retry")!.onclick = onRetry;
}
export function showFatal(message: string) {
  overlay().innerHTML = `<div class="card"><h2>This browser can't show the stadium</h2><p>${message}</p></div>`;
  overlay().hidden = false;
}
