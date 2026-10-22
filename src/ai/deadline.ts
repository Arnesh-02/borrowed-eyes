import { AIProviderError, createAbortError, throwIfAborted } from './errors';

// Racing the entire operation also bounds response.text(), and fetch shims that
// ignore abort. The operation must check its child signal before further work.
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interruption = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(createAbortError());
      controller.abort();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      reject(new AIProviderError('timeout'));
      controller.abort();
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      interruption,
      Promise.resolve().then(() => {
        throwIfAborted(signal);
        throwIfAborted(controller.signal);
        return operation(controller.signal);
      }),
    ]);
    throwIfAborted(signal);
    throwIfAborted(controller.signal);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
