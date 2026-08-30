import type { StateResponse } from './messages';

async function main(): Promise<void> {
  const statusEl = document.getElementById('status')!;
  const timerEl = document.getElementById('timer')!;
  const setupLink = document.getElementById('setup-link')!;

  const state = (await chrome.runtime.sendMessage({ type: 'GET_STATE' })) as StateResponse;

  if (!state.paired) {
    statusEl.textContent = 'Not set up yet.';
    setupLink.hidden = false;
    return;
  }

  statusEl.textContent = `Protecting “${state.deviceName ?? 'this device'}” ✅`;

  if (state.remainingSeconds === null) {
    timerEl.textContent = 'No daily time limit set.';
  } else if (state.remainingSeconds <= 0) {
    timerEl.innerHTML = '<span class="big">🌙 Time is up for today</span>';
  } else {
    const mins = Math.ceil(state.remainingSeconds / 60);
    timerEl.innerHTML = `<span class="big">⏳ ${mins} min</span> left today`;
  }
}

void main();
