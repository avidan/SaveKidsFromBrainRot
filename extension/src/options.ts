import type { PairResult, StateResponse } from './messages';

const $ = (id: string) => document.getElementById(id)!;

async function refresh(): Promise<void> {
  const state = (await chrome.runtime.sendMessage({ type: 'GET_STATE' })) as StateResponse;
  $('paired-view').hidden = !state.paired;
  $('setup-view').hidden = state.paired;
}

function showMessage(text: string, kind: 'ok' | 'error'): void {
  const el = $('message');
  el.textContent = text;
  el.className = kind;
}

$('pair').addEventListener('click', () => {
  void (async () => {
    const backendUrl = ($('backend') as HTMLInputElement).value.trim();
    const code = ($('code') as HTMLInputElement).value.trim();
    const deviceName = ($('name') as HTMLInputElement).value.trim() || 'Kid laptop';
    if (!backendUrl || !code) {
      showMessage('Server URL and pairing code are required.', 'error');
      return;
    }
    showMessage('Pairing…', 'ok');
    const result = (await chrome.runtime.sendMessage({
      type: 'PAIR',
      backendUrl,
      code,
      deviceName,
    })) as PairResult;
    if (result.ok) {
      showMessage('Paired! This device is now protected. 🎉', 'ok');
      await refresh();
    } else {
      showMessage(`Pairing failed: ${result.error}`, 'error');
    }
  })();
});

$('unpair').addEventListener('click', () => {
  void (async () => {
    await chrome.runtime.sendMessage({ type: 'UNPAIR' });
    showMessage('Device unpaired.', 'ok');
    await refresh();
  })();
});

void refresh();
