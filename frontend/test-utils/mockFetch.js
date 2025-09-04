import { vi } from 'vitest';

export const mockFetchSuccess = (data) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data)
  });

export const mockFetchFailure = ({ status = 500, statusText = 'Error', response = 'fail' } = {}) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(response)
  });

export const mockFetchError = (error) =>
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    error instanceof Error ? error : new Error(error)
  );
