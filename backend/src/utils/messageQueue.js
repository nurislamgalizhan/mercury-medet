function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const defaultWait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

export function createThrottledQueue({
  intervalMs,
  maxPending,
  now = () => Date.now(),
  wait = defaultWait,
}) {
  const safeIntervalMs = parsePositiveInteger(intervalMs, 5000);
  const safeMaxPending = parsePositiveInteger(maxPending, 20);
  let tail = Promise.resolve();
  let pending = 0;
  let lastStartedAt = null;

  return async function enqueue(task) {
    if (pending >= safeMaxPending) {
      const error = new Error('Очередь отправки WhatsApp временно заполнена');
      error.statusCode = 503;
      throw error;
    }

    pending += 1;
    const run = tail.then(async () => {
      if (lastStartedAt !== null) {
        const elapsed = now() - lastStartedAt;
        const delay = Math.max(0, safeIntervalMs - elapsed);
        if (delay > 0) await wait(delay);
      }

      lastStartedAt = now();
      return task();
    });

    tail = run.catch(() => {});
    try {
      return await run;
    } finally {
      pending -= 1;
    }
  };
}
