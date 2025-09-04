import { vi } from 'vitest';

export const createSignerMock = (sig = 'sig') => ({
  signMessage: vi.fn().mockResolvedValue(sig)
});

export const createXMTPMock = ({ inboxId = 'inbox-1' } = {}) => ({
  inboxId,
  conversations: {
    getConversationById: vi.fn(),
    sync: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue([])
  }
});
